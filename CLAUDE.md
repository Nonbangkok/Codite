# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

Codite is a codebase visualizer with two decoupled components:

1. **`analyzer/`** — Rust CLI that scans source code using Tree-sitter and outputs `ui/public/data.json`
2. **`ui/`** — React + Vite frontend that reads `data.json` and renders an interactive force-directed graph

The two components communicate only through `ui/public/data.json`. The analyzer writes it; the UI polls it every 5 seconds.

## Commands

### Analyzer (Rust backend)
```bash
cd analyzer
cargo build                  # build
cargo run                    # scan default target (../Panos/src) → writes ../ui/public/data.json
cargo run -- /path/to/target # scan a custom directory
cargo test                   # run tests
```

The default scan directory is set in `analyzer/Cargo.toml` under `[package.metadata.codite].default_scan_dir` and baked in at compile time via `build.rs`.

### UI (React frontend)
```bash
cd ui
npm install
npm run dev     # start dev server (http://localhost:5173)
npm run build   # type-check + production build
npm run lint    # ESLint
```

## Architecture

### Data Flow
```
analyzer (Rust) → ui/public/data.json → UI (React, polls every 5s)
```

### Analyzer internals (`analyzer/src/`)
- `models.rs` — `Node`, `Link`, `GraphData` structs (serialized to JSON)
- `scanner.rs` — walks directory with `walkdir`, finds `.rs` files
- `parser.rs` — Tree-sitter queries extract functions, structs, enums, traits, `impl` blocks, `use` declarations, and `mod` declarations; creates nodes and links for each
- `main.rs` — orchestrates scan → parse → write JSON

Node `id` encoding:
- Files: absolute path string
- Functions: `{file_path}::fn::{name}::{byte_offset}`
- Structs: `{file_path}::struct::{name}`
- Enums: `{file_path}::enum::{name}::{byte_offset}`
- Traits: `{file_path}::trait::{name}::{byte_offset}`

### UI internals (`ui/src/`)
- `App.tsx` — root; owns `graphData`, `selectedNodeId`, `activeFolderPath`, panel resize state; filters `imports` group nodes on load; folder scoping filters both nodes and links
- `components/GraphView.tsx` — `react-force-graph-2d` canvas renderer; custom pan momentum, cursor-anchored scroll zoom, hover highlight, zoom-to-node on selection; node colors defined in `TYPE_COLORS`
- `components/CodePreviewPanel.tsx` — right-side sliding panel with syntax-highlighted source for the selected node
- `components/FileExplorer.tsx` — left sidebar tree built from node ids by `utils/treeUtils.ts`
- `components/CommandPalette.tsx` — Cmd/Ctrl+K fuzzy search over all nodes using Fuse.js
- `types/index.ts` — shared `NodeData`, `LinkData`, `GraphData` interfaces (must match analyzer's JSON output)

### Node groups and their colors (GraphView.tsx)
| group | color |
|---|---|
| `functions` | `#d19a66` (orange) |
| `structs` | `#61afef` (blue) |
| `enums` | `#c678dd` (purple) |
| `traits` | `#98c379` (green) |
| files/other | `#a2a7b6` (grey-blue) |