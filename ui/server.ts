import express, { Request, Response } from 'express';
import cors from 'cors';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.basename(__dirname) === 'dist-server' ? path.resolve(__dirname, '..') : __dirname;
const staticRoot = path.join(uiRoot, 'dist');

const app = express();
const port = Number(process.env.PORT) || 3002;

app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

interface ScanRequest {
  url: string;
}

const runFile = (file: string, args: string[], cwd?: string) =>
  new Promise<void>((resolve, reject) => {
    execFile(file, args, { cwd, maxBuffer: 1024 * 1024 * 16 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

// Scan endpoint
app.post('/api/scan', async (req: Request<object, object, ScanRequest>, res: Response) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    const repoUrl = new URL(url);
    if (!['http:', 'https:'].includes(repoUrl.protocol)) {
      return res.status(400).json({ error: 'Only HTTP(S) repository URLs are supported.' });
    }
  } catch {
    return res.status(400).json({ error: 'Repository URL is invalid.' });
  }

  console.log(`Starting scan for: ${url}`);

  // Robust repo name extraction (handles trailing slashes and .git suffix)
  const repoName = url.replace(/\/$/, '').split('/').pop()?.replace('.git', '') || 'repository';
  const tempDir = path.join(uiRoot, 'cloned_temp');
  const scanId = Date.now().toString();
  const baseDir = path.join(tempDir, scanId);
  const repoDir = path.join(baseDir, repoName);

  console.log(`Extracted project name: ${repoName}`);

  try {
    // Ensure baseDir exists
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir);

    // 1. Clone the repository into repoDir
    await runFile('git', ['clone', '--depth', '1', url, repoDir]);
    console.log(`Cloned to ${repoDir}. Starting analysis...`);

    // 2. Run the analyzer from baseDir, targeting repoName
    // This makes the analyzer use repoName as the root path for IDs
    const analyzerPath = process.env.ANALYZER_BIN || path.join(uiRoot, '../analyzer/target/release/analyzer');
    await runFile(analyzerPath, [repoName, 'data.json'], baseDir);

    // 3. Move the generated data.json for the UI to reload.
    const generatedDataPath = path.join(baseDir, 'data.json');
    const targetDataPath = path.join(staticRoot, 'data.json');

    if (fs.existsSync(generatedDataPath)) {
      fs.copyFileSync(generatedDataPath, targetDataPath);
    }

    console.log('Scan successfully completed!');
    res.json({ status: 'success' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Scan failed. Make sure the repository URL is valid and public.' });
  } finally {
    fs.rm(baseDir, { recursive: true, force: true }, (rmErr) => {
      if (rmErr) console.error(`Cleanup error: ${rmErr}`);
    });
  }
});

if (fs.existsSync(staticRoot)) {
  app.use(express.static(staticRoot));
  app.get(/.*/, (_req: Request, res: Response) => {
    res.sendFile(path.join(staticRoot, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`Codite Bridge Server listening on port ${port}`);
});
