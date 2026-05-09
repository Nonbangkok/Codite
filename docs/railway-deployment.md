# Railway Deployment

Codite deploys to Railway as a single Docker service.

## What the image does

- Builds the Rust analyzer in release mode.
- Builds the Vite React UI.
- Compiles the Express bridge server to JavaScript.
- Runs one Node process that serves both the UI and `/api/*` endpoints on Railway's `PORT`.

## Deploy

1. Create a Railway project from this repository.
2. Railway should detect `railway.json` and use the root `Dockerfile`.
3. Deploy without adding a custom start command.

The service exposes:

- `/` for the Codite UI.
- `/api/health` for Railway health checks.
- `/api/scan` for public HTTP(S) repository scans.

## Notes

- No required environment variables are needed for the default deployment.
- The Docker image sets `ANALYZER_BIN=/app/analyzer/analyzer`.
- Scan results are written to the container filesystem, so they are ephemeral across redeploys and restarts.
