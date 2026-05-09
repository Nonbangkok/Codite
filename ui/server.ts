import express, { Request, Response } from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

interface ScanRequest {
  url: string;
}

// Scan endpoint
app.post('/api/scan', (req: Request<{}, {}, ScanRequest>, res: Response) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const tempDir = path.join(__dirname, 'cloned_temp');
  const scanId = Date.now().toString();
  const repoDir = path.join(tempDir, scanId);

  // Ensure tempDir exists
  if (!fs.existsSync(tempDir)) {
    try {
      fs.mkdirSync(tempDir);
    } catch (e) {
      console.error(`Dir creation error: ${e}`);
    }
  }

  console.log(`Starting scan for: ${url}`);

  // 1. Clone the repository
  exec(`git clone --depth 1 ${url} ${repoDir}`, (err) => {
    if (err) {
      console.error(`Clone error: ${err.message}`);
      return res.status(500).json({ error: 'Failed to clone repository. Make sure the URL is valid and public.' });
    }

    console.log(`Cloned to ${repoDir}. Starting analysis...`);

    // 2. Run the analyzer
    const analyzerPath = path.join(__dirname, '../analyzer/target/release/analyzer');
    
    exec(`"${analyzerPath}" "${repoDir}"`, (err) => {
      // 3. Cleanup
      fs.rm(repoDir, { recursive: true, force: true }, (rmErr) => {
        if (rmErr) console.error(`Cleanup error: ${rmErr}`);
      });

      if (err) {
        console.error(`Analyzer error: ${err.message}`);
        return res.status(500).json({ error: 'Analysis failed.' });
      }

      console.log('Scan successfully completed!');
      res.json({ status: 'success' });
    });
  });
});

app.listen(port, () => {
  console.log(`Codite Bridge Server (TypeScript) listening at http://localhost:${port}`);
});
