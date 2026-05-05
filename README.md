# AtloGraph

**AtloGraph** is a multi-language codebase visualizer designed to transform complex source code into beautiful, interactive, and comprehensible graphs. It helps developers quickly understand project architecture, dependencies, and code structure without having to manually read through thousands of lines of code.

---

## 🌟 Key Features

*   **Multi-Language Support (Local Scanning):** Analyzes C, C++, Rust, Go, TypeScript/JavaScript, and more.
*   **Relationship Mapping:** Automatically maps dependencies between Classes, Structs, Interfaces, Functions, and Imports/Includes.
*   **Obsidian-Style Interactive Graph:** A web-based, highly interactive 2D force-directed graph UI (built with D3.js/Canvas) providing smooth zooming, hovering highlights, and dynamic filtering.
*   **High Performance:** Powered by a Rust backend utilizing [Tree-sitter](https://tree-sitter.github.io/tree-sitter/) for lightning-fast, incremental code parsing.

## 🏗️ Architecture

The system is decoupled into two main components communicating via JSON:

### 1. Analyzer CLI (Backend)
- **Language:** Rust (focusing on concurrent file processing with Rayon/Tokio).
- **Core Engine:** Tree-sitter for robust incremental parsing using `.scm` queries.
- **Output:** Generates a structured JSON file containing `nodes` and `edges`.

### 2. Visualization UI (Frontend)
- **Framework:** React / Svelte.
- **Rendering Engine:** D3.js / `react-force-graph` utilizing HTML5 Canvas for performance.
- **Aesthetic:** Designed to provide an intuitive, "Obsidian-like" feel with natural physics, color-coded directories, and interactive focus modes.

## 🚀 Getting Started (MVP Scope)

Currently, the project is focusing on a Minimum Viable Product (MVP) prioritizing **Rust** codebases at the **File & Function** level.

*More detailed installation and usage instructions will be added as the MVP develops.*

## 🤝 Contributing

We welcome contributions! Please see our [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to get started, our code of conduct, and our development process.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
