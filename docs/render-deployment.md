# Render Deployment

Codite deploys to Render as a single Docker web service.

## What the image does

- Builds the Rust analyzer in release mode.
- Builds the Vite React UI.
- Compiles the Express bridge server to JavaScript.
- Runs one Node process that serves both the UI and `/api/*` endpoints on Render's `PORT`.

## Deploy

1. Create a new Render **Web Service** from this repository (or run `render blueprint launch` / apply the Blueprint from `render.yaml`).
2. Render should detect `render.yaml` and use the root `Dockerfile` (`runtime: docker`).
3. Deploy without adding a custom start command — the Dockerfile's `CMD` handles it.

The service exposes:

- `/` for the Codite UI.
- `/api/health` for Render health checks.
- `/api/scan` for public HTTP(S) repository scans.

## Notes

- No required environment variables are needed for the default deployment.
- The Docker image sets `ANALYZER_BIN=/app/analyzer/analyzer`.
- The server listens on `process.env.PORT`, which Render sets automatically — no manual port configuration is needed.
- Scan results are written to the container filesystem, so they are ephemeral across redeploys and restarts.
- `render.yaml` uses `plan: free`, which does not require a credit card. The free plan has trade-offs: the service spins down after 15 minutes of inactivity (the next request triggers a cold start), and build minutes/bandwidth are capped. Bump `plan` to `starter` or higher (card required) if always-on hosting is needed later.
