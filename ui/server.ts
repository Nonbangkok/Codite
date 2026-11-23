import express, { Request, Response } from 'express';
import { execFile } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { parseAllowedHosts, parseRepoUrl, RepoUrlError } from './server/repoUrl.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.basename(__dirname) === 'dist-server' ? path.resolve(__dirname, '..') : __dirname;
const staticRoot = path.join(uiRoot, 'dist');

const envNumber = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const port = envNumber('PORT', 3002);
const ALLOWED_HOSTS = parseAllowedHosts(process.env.SCAN_ALLOWED_HOSTS);
const CLONE_TIMEOUT_MS = envNumber('SCAN_CLONE_TIMEOUT_MS', 60_000);
const ANALYZE_TIMEOUT_MS = envNumber('SCAN_ANALYZE_TIMEOUT_MS', 120_000);
const MAX_REPO_BYTES = envNumber('SCAN_MAX_REPO_MB', 200) * 1024 * 1024;
const MAX_CONCURRENT_SCANS = envNumber('SCAN_MAX_CONCURRENT', 1);
const ANALYZER_BIN = process.env.ANALYZER_BIN || path.join(uiRoot, '../analyzer/target/release/analyzer');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4kb' }));

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

class ScanError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface RunError extends Error {
  killed?: boolean;
  stderr?: string;
}

const runFile = (file: string, args: string[], opts: { cwd?: string; timeout: number; env?: NodeJS.ProcessEnv }) =>
  new Promise<void>((resolve, reject) => {
    execFile(
      file,
      args,
      { cwd: opts.cwd, env: opts.env, timeout: opts.timeout, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 * 16 },
      (err, _stdout, stderr) => {
        if (err) reject(Object.assign(err, { stderr: String(stderr) }) as RunError);
        else resolve();
      },
    );
  });

/** Total size of a directory tree in bytes, without following symlinks. Stops early past `limit`. */
const dirSize = async (dir: string, limit: number): Promise<number> => {
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of await fs.promises.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) total += (await fs.promises.lstat(full)).size;
      if (total > limit) return total;
    }
  }
  return total;
};

const cloneRepo = async (cloneUrl: string, repoDir: string) => {
  try {
    await runFile(
      'git',
      [
        '-c', 'core.symlinks=false',
        '-c', 'protocol.file.allow=never',
        'clone', '--depth', '1', '--single-branch', '--no-tags',
        '--', cloneUrl, repoDir,
      ],
      {
        timeout: CLONE_TIMEOUT_MS,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' },
      },
    );
  } catch (err) {
    const e = err as RunError;
    if (e.killed) throw new ScanError(504, 'Cloning took too long. The repository may be too large.');
    if (/not found|could not read username|authentication failed/i.test(e.stderr ?? '')) {
      throw new ScanError(404, 'Repository not found. Make sure it exists and is public.');
    }
    throw new ScanError(502, 'Failed to clone the repository.');
  }
};

let activeScans = 0;

app.post('/api/scan', async (req: Request, res: Response) => {
  let repo;
  try {
    repo = parseRepoUrl(req.body?.url, ALLOWED_HOSTS);
  } catch (err) {
    const message = err instanceof RepoUrlError ? err.message : 'Repository URL is invalid.';
    return res.status(400).json({ error: message });
  }

  if (activeScans >= MAX_CONCURRENT_SCANS) {
    return res.status(429).json({ error: 'The server is busy with another scan. Please try again shortly.' });
  }
  activeScans++;

  const label = `${repo.owner}/${repo.repo}`;
  const started = Date.now();
  let baseDir: string | undefined;
  console.log(`[scan] start ${label}`);

  try {
    baseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codite-scan-'));
    const repoDir = path.join(baseDir, repo.repo);
    const outputPath = path.join(baseDir, 'data.json');

    await cloneRepo(repo.cloneUrl, repoDir);

    if ((await dirSize(repoDir, MAX_REPO_BYTES)) > MAX_REPO_BYTES) {
      throw new ScanError(413, `Repository is larger than the ${MAX_REPO_BYTES / 1024 / 1024} MB limit.`);
    }

    // Run from baseDir so node IDs are rooted at the repo name.
    try {
      await runFile(ANALYZER_BIN, [repo.repo, outputPath], { cwd: baseDir, timeout: ANALYZE_TIMEOUT_MS });
    } catch (err) {
      console.error(`[scan] analyzer failed for ${label}:`, (err as RunError).stderr || err);
      throw new ScanError((err as RunError).killed ? 504 : 500, 'Analysis failed.');
    }

    const graph = JSON.parse(await fs.promises.readFile(outputPath, 'utf8'));
    console.log(`[scan] done ${label} in ${Date.now() - started}ms (${graph.nodes?.length ?? 0} nodes)`);
    res.json({ status: 'success', repo: label, graph });
  } catch (err) {
    if (err instanceof ScanError) {
      console.warn(`[scan] ${label}: ${err.message}`);
      res.status(err.status).json({ error: err.message });
    } else {
      console.error(`[scan] ${label}:`, err);
      res.status(500).json({ error: 'Scan failed unexpectedly.' });
    }
  } finally {
    activeScans--;
    if (baseDir) {
      await fs.promises.rm(baseDir, { recursive: true, force: true }).catch((rmErr) => {
        console.error(`[scan] cleanup error: ${rmErr}`);
      });
    }
  }
});

if (fs.existsSync(staticRoot)) {
  app.use(express.static(staticRoot));
  app.get(/.*/, (_req: Request, res: Response) => {
    res.sendFile(path.join(staticRoot, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`Codite Bridge Server listening on port ${port} (allowed hosts: ${ALLOWED_HOSTS.join(', ')})`);
});
