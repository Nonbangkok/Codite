# Walkthrough: Remote Repository Visualization

## Overview
This feature enables Codite to visualize any public Git repository by cloning and analyzing it on-demand. It transitions the app from a local-only tool to a powerful hybrid visualization platform.

## Features Implemented
- **Hybrid Architecture**: A Node.js/Express bridge server (TypeScript) that executes Git and Rust commands locally.
- **Remote Scanner UI**: A sleek, glassmorphism input bar at the top of the graph for pasting repository URLs.
- **Project-Relative Paths**: Modified the analyzer and backend to ensure file paths in the UI start with the project name, stripping away local system prefixes.
- **Cache Resilience**: Implemented cache-busting logic to ensure new scans are immediately reflected in the browser.

## Technical Details
- **Backend**: `ui/server.ts` handles:
    - `git clone --depth 1` for fast repository retrieval.
    - Spawning the Rust `analyzer` binary in a unique temporary workspace.
    - Cleaning up source code immediately after analysis to save space.
- **Analyzer**: Updated to allow portable output to `data.json` in any working directory.
- **Integrated Dev Loop**: Updated `npm run dev` to launch both Vite and the Bridge Server concurrently.

## Verification Results
- Successfully visualized several repositories including:
    - `octocat/Spoon-Knife`
    - `Nonbangkok/Randomizer`
- Verified that folder structures are correctly synthesized from project-relative paths.

## How to use
1. Navigate to the `ui` directory.
2. Run `npm run dev`.
3. Paste a GitHub URL in the top bar.
4. Watch the graph evolve!
