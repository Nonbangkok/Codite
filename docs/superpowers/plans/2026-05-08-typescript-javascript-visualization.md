# TypeScript / JavaScript Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend AtloGraph to visualize TypeScript and JavaScript files alongside Rust by introducing a `LanguageParser` trait, language-aware nodes, and UI controls for language metadata and color modes.

**Architecture:** A `LanguageParser` trait in `analyzer/src/parsers/mod.rs` is implemented by `RustParser`, `TypeScriptParser`, and `JavaScriptParser`. The scanner walks for any registered extension; `main.rs` dispatches each file to the matching parser. The `Node` model gains a `language` field surfaced in the UI through a hover-panel row, a code-preview-panel badge, and a graph-coloring mode toggle.

**Tech Stack:** Rust 2024, tree-sitter 0.26, `tree-sitter-rust`, `tree-sitter-typescript`, `tree-sitter-javascript`, React 18, Vite, react-force-graph-2d, react-syntax-highlighter.

**Spec:** `docs/superpowers/specs/2026-05-08-typescript-javascript-visualization-design.md`

---

## File Structure

**Analyzer (created):**
- `analyzer/src/parsers/mod.rs` — `LanguageParser` trait + helpers
- `analyzer/src/parsers/rust.rs` — RustParser (extracted from current `parser.rs`)
- `analyzer/src/parsers/typescript.rs` — TypeScriptParser
- `analyzer/src/parsers/javascript.rs` — JavaScriptParser
- `analyzer/src/parsers/import_resolver.rs` — shared TS/JS relative-path resolver
- `analyzer/tests/fixtures/typescript/sample.ts`
- `analyzer/tests/fixtures/typescript/imported.ts`
- `analyzer/tests/fixtures/javascript/sample.js`
- `analyzer/tests/fixtures/rust/sample.rs`
- `analyzer/tests/parsers_test.rs`

**Analyzer (modified):**
- `analyzer/Cargo.toml` — add tree-sitter-typescript, tree-sitter-javascript
- `analyzer/src/models.rs` — add `language` field to `Node`
- `analyzer/src/scanner.rs` — extension-agnostic + extra skip dirs
- `analyzer/src/main.rs` — registry-based dispatch
- `analyzer/src/parser.rs` — DELETED (replaced by `parsers/rust.rs`)

**UI (modified):**
- `ui/src/types/index.ts` — add `language` to `NodeData`
- `ui/src/components/GraphView.tsx` — `colorMode` prop, `LANGUAGE_COLORS`, hover panel language row, new construct colors
- `ui/src/App.tsx` — owns `colorMode` state + toggle button
- `ui/src/components/CodePreviewPanel.tsx` — language badge in header + dynamic `language` prop on syntax highlighter

---

## Phase 1: Refactor analyzer to trait-based abstraction (no behavior change)

This phase extracts the existing Rust parser into a trait without changing what gets emitted into `data.json`. All Rust nodes simply gain `language: "rust"`.

### Task 1: Add `language` field to `Node` model

**Files:**
- Modify: `analyzer/src/models.rs`
- Modify: `analyzer/src/parser.rs` (every `Node { ... }` literal needs the new field)

- [ ] **Step 1: Add the `language` field to the struct**

Edit `analyzer/src/models.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
pub struct Node {
    pub id: String,
    pub label: String,
    pub group: String,
    pub language: String,
    pub val: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Link {
    pub source: String,
    pub target: String,
    #[serde(rename = "type")]
    pub link_type: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct GraphData {
    pub nodes: Vec<Node>,
    pub links: Vec<Link>,
}
```

- [ ] **Step 2: Update every `Node { ... }` literal in `parser.rs` to include `language: "rust".to_string()`**

There are 6 `Node { ... }` literals in `analyzer/src/parser.rs` (one for the file node and one each for func, struct, enum, trait, use). Add `language: "rust".to_string(),` after `group:` in every one. Example for the file node:

```rust
nodes.push(Node {
    id: full_path.clone(),
    label: file_name,
    group: group.clone(),
    language: "rust".to_string(),
    val: 20,
    code: source_code.clone(),
});
```

- [ ] **Step 3: Build to verify**

Run: `cd analyzer && cargo build`
Expected: compiles cleanly, no warnings about unused field.

- [ ] **Step 4: Commit**

```bash
git add analyzer/src/models.rs analyzer/src/parser.rs
git commit -m "feat(analyzer): add language field to Node model"
```

---

### Task 2: Define `LanguageParser` trait and parsers module

**Files:**
- Create: `analyzer/src/parsers/mod.rs`

- [ ] **Step 1: Create the parsers module file**

Create `analyzer/src/parsers/mod.rs`:

```rust
use std::path::Path;

use crate::models::{Link, Node};

pub trait LanguageParser {
    fn language_name(&self) -> &'static str;
    fn extensions(&self) -> &'static [&'static str];
    fn parse(&self, path: &Path, nodes: &mut Vec<Node>, links: &mut Vec<Link>);
}

pub fn parser_for_path<'a>(
    path: &Path,
    parsers: &'a [Box<dyn LanguageParser>],
) -> Option<&'a dyn LanguageParser> {
    let ext = path.extension()?.to_str()?;
    let dot_ext = format!(".{}", ext);
    parsers
        .iter()
        .find(|p| p.extensions().iter().any(|e| *e == dot_ext))
        .map(|b| b.as_ref())
}

pub fn all_extensions(parsers: &[Box<dyn LanguageParser>]) -> Vec<&'static str> {
    parsers.iter().flat_map(|p| p.extensions().iter().copied()).collect()
}
```

- [ ] **Step 2: Wire the module into `main.rs` (temporarily — full rewire happens in Task 5)**

Edit `analyzer/src/main.rs` to add the module declaration near the top, alongside the existing `mod` lines:

```rust
mod models;
mod parser;
mod parsers;
mod scanner;
```

- [ ] **Step 3: Build**

Run: `cd analyzer && cargo build`
Expected: compiles. Warnings about unused `parsers` module are acceptable for now.

- [ ] **Step 4: Commit**

```bash
git add analyzer/src/parsers/mod.rs analyzer/src/main.rs
git commit -m "feat(analyzer): add LanguageParser trait scaffolding"
```

---

### Task 3: Move existing Rust parser into `parsers/rust.rs` behind the trait

**Files:**
- Create: `analyzer/src/parsers/rust.rs`
- Delete: `analyzer/src/parser.rs`
- Modify: `analyzer/src/parsers/mod.rs` (export `RustParser`)

- [ ] **Step 1: Create `analyzer/src/parsers/rust.rs` with the existing logic wrapped in a struct**

Copy the entire body of the current `analyzer/src/parser.rs` `parse_rust_file` function into a `parse` method on a new `RustParser` struct. Final contents of `analyzer/src/parsers/rust.rs`:

```rust
use std::fs;
use std::path::Path;
use tree_sitter::{Parser, Query, QueryCursor, StreamingIterator};

use crate::models::{Link, Node};
use crate::parsers::LanguageParser;

pub struct RustParser;

impl LanguageParser for RustParser {
    fn language_name(&self) -> &'static str {
        "rust"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &[".rs"]
    }

    fn parse(&self, path: &Path, nodes: &mut Vec<Node>, links: &mut Vec<Link>) {
        let full_path = path.to_string_lossy().into_owned();
        let file_name = path.file_name().unwrap().to_string_lossy().into_owned();
        let group = path
            .parent()
            .and_then(|p| p.file_name())
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "root".to_string());

        let source_code = fs::read_to_string(path).ok();

        nodes.push(Node {
            id: full_path.clone(),
            label: file_name,
            group: group.clone(),
            language: "rust".to_string(),
            val: 20,
            code: source_code.clone(),
        });

        if let Some(source_code) = source_code {
            let mut parser = Parser::new();
            let language = tree_sitter_rust::LANGUAGE.into();
            parser.set_language(&language).expect("Error loading Rust grammar");

            let query_code = "
                (function_item) @func
                (struct_item) @struct
                (enum_item) @enum
                (trait_item) @trait
                (impl_item type: (type_identifier) @impl.name)
                (use_declaration) @use
                (mod_item name: (identifier) @mod)
            ";
            let query = Query::new(&language, query_code).expect("Error creating query");

            let tree = parser.parse(&source_code, None).unwrap();
            let mut cursor = QueryCursor::new();
            let mut captures = cursor.captures(&query, tree.root_node(), source_code.as_bytes());

            while let Some((m, _)) = captures.next() {
                for capture in m.captures {
                    let node = capture.node;
                    let full_content = &source_code[node.start_byte()..node.end_byte()];
                    let capture_name = query.capture_names()[capture.index as usize];

                    match capture_name {
                        "mod" => {
                            let name = &source_code[node.start_byte()..node.end_byte()];
                            if let Some(parent_dir) = path.parent() {
                                let target_1 = parent_dir.join(format!("{}.rs", name));
                                let target_2 = parent_dir.join(name).join("mod.rs");

                                if target_1.exists() {
                                    links.push(Link {
                                        source: full_path.clone(),
                                        target: target_1.to_string_lossy().into_owned(),
                                        link_type: "declares_module".to_string(),
                                    });
                                } else if target_2.exists() {
                                    links.push(Link {
                                        source: full_path.clone(),
                                        target: target_2.to_string_lossy().into_owned(),
                                        link_type: "declares_module".to_string(),
                                    });
                                }
                            }
                        }
                        "func" => {
                            if let Some(name_node) = node.child_by_field_name("name") {
                                let name = &source_code[name_node.start_byte()..name_node.end_byte()];
                                let id = format!("{}::fn::{}::{}", full_path, name, node.start_byte());
                                nodes.push(Node {
                                    id: id.clone(),
                                    label: format!("{}()", name),
                                    group: "functions".to_string(),
                                    language: "rust".to_string(),
                                    val: 8,
                                    code: Some(full_content.to_string()),
                                });
                                links.push(Link {
                                    source: full_path.clone(),
                                    target: id,
                                    link_type: "contains".to_string(),
                                });
                            }
                        }
                        "struct" => {
                            if let Some(name_node) = node.child_by_field_name("name") {
                                let name = &source_code[name_node.start_byte()..name_node.end_byte()];
                                let id = format!("{}::struct::{}", full_path, name);
                                nodes.push(Node {
                                    id: id.clone(),
                                    label: name.to_string(),
                                    group: "structs".to_string(),
                                    language: "rust".to_string(),
                                    val: 12,
                                    code: Some(full_content.to_string()),
                                });
                                links.push(Link {
                                    source: full_path.clone(),
                                    target: id,
                                    link_type: "contains".to_string(),
                                });
                            }
                        }
                        "enum" => {
                            if let Some(name_node) = node.child_by_field_name("name") {
                                let name = &source_code[name_node.start_byte()..name_node.end_byte()];
                                let id = format!("{}::enum::{}::{}", full_path, name, node.start_byte());
                                nodes.push(Node {
                                    id: id.clone(),
                                    label: name.to_string(),
                                    group: "enums".to_string(),
                                    language: "rust".to_string(),
                                    val: 10,
                                    code: Some(full_content.to_string()),
                                });
                                links.push(Link {
                                    source: full_path.clone(),
                                    target: id,
                                    link_type: "contains".to_string(),
                                });
                            }
                        }
                        "trait" => {
                            if let Some(name_node) = node.child_by_field_name("name") {
                                let name = &source_code[name_node.start_byte()..name_node.end_byte()];
                                let id = format!("{}::trait::{}::{}", full_path, name, node.start_byte());
                                nodes.push(Node {
                                    id: id.clone(),
                                    label: name.to_string(),
                                    group: "traits".to_string(),
                                    language: "rust".to_string(),
                                    val: 14,
                                    code: Some(full_content.to_string()),
                                });
                                links.push(Link {
                                    source: full_path.clone(),
                                    target: id,
                                    link_type: "contains".to_string(),
                                });
                            }
                        }
                        "impl.name" => {
                            let struct_id = format!("{}::struct::{}", full_path, full_content);
                            links.push(Link {
                                source: full_path.clone(),
                                target: struct_id,
                                link_type: "implements".to_string(),
                            });
                        }
                        "use" => {
                            if !full_content.contains("std::")
                                && !full_content.contains("serde")
                                && !full_content.contains("tree_sitter")
                                && !full_content.contains("walkdir")
                            {
                                let id = format!("{}::use::{}", full_path, full_content);
                                nodes.push(Node {
                                    id: id.clone(),
                                    label: full_content.replace("use ", "").replace(";", ""),
                                    group: "imports".to_string(),
                                    language: "rust".to_string(),
                                    val: 5,
                                    code: Some(full_content.to_string()),
                                });
                                links.push(Link {
                                    source: full_path.clone(),
                                    target: id,
                                    link_type: "imports".to_string(),
                                });
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }
}
```

- [ ] **Step 2: Re-export `RustParser` from `parsers/mod.rs`**

Add to the top of `analyzer/src/parsers/mod.rs`:

```rust
pub mod rust;
pub use rust::RustParser;
```

- [ ] **Step 3: Delete the old `parser.rs`**

Run: `rm analyzer/src/parser.rs`

- [ ] **Step 4: Update `main.rs` to drop the old module declaration**

In `analyzer/src/main.rs`, remove the `mod parser;` line. Final top section:

```rust
mod models;
mod parsers;
mod scanner;

use std::env;
use std::fs;
use models::GraphData;
use parsers::{LanguageParser, RustParser, parser_for_path};
```

(`parser::parse_rust_file` callsites in `main.rs` will be replaced in Task 5; for now you'll get a temporary unresolved-symbol error — that's expected and Task 5 fixes it.)

- [ ] **Step 5: Skip building (next task fixes the temporary breakage)**

This intermediate state does not compile. Do **not** commit yet — Task 4 and Task 5 complete the migration before the next commit.

---

### Task 4: Make scanner extension-agnostic and skip more directories

**Files:**
- Modify: `analyzer/src/scanner.rs`

- [ ] **Step 1: Replace the function with an extension-list parameter**

Edit `analyzer/src/scanner.rs`:

```rust
use std::path::PathBuf;
use walkdir::WalkDir;

const SKIP_DIRS: &[&str] = &["target", "node_modules", "dist", "build"];

pub fn find_source_files(target_dir: &str, extensions: &[&str]) -> Vec<PathBuf> {
    let mut files = Vec::new();

    for entry in WalkDir::new(target_dir)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            let is_hidden = name.starts_with(".") && name != "." && name != "..";
            !SKIP_DIRS.contains(&name.as_ref()) && !is_hidden
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            let dot_ext = format!(".{}", ext);
            if extensions.iter().any(|e| *e == dot_ext) {
                files.push(path.to_path_buf());
            }
        }
    }

    files
}
```

- [ ] **Step 2: Skip building (Task 5 fixes the callsite)**

Compilation still broken — that's fine. Continue to Task 5.

---

### Task 5: Wire registry-based dispatch in `main.rs`

**Files:**
- Modify: `analyzer/src/main.rs`

- [ ] **Step 1: Replace `main.rs` with the registry-based version**

Final contents of `analyzer/src/main.rs`:

```rust
mod models;
mod parsers;
mod scanner;

use std::env;
use std::fs;

use models::GraphData;
use parsers::{LanguageParser, RustParser, all_extensions, parser_for_path};

fn main() {
    let args: Vec<String> = env::args().collect();
    let default_dir = env!("DEFAULT_SCAN_DIR");
    let target_dir = if args.len() > 1 { &args[1] } else { default_dir };

    println!("Scanning directory: {}", target_dir);

    let registry: Vec<Box<dyn LanguageParser>> = vec![Box::new(RustParser)];
    let extensions = all_extensions(&registry);

    let mut nodes = Vec::new();
    let mut links = Vec::new();

    let files = scanner::find_source_files(target_dir, &extensions);

    for file in files {
        if let Some(parser) = parser_for_path(&file, &registry) {
            parser.parse(&file, &mut nodes, &mut links);
        }
    }

    let graph = GraphData { nodes, links };

    if let Ok(json) = serde_json::to_string_pretty(&graph) {
        let output_path = "../ui/public/data.json";
        match fs::write(output_path, json) {
            Ok(_) => println!("Successfully saved graph data to {}", output_path),
            Err(e) => eprintln!("Error saving graph data: {}", e),
        }
    }
}
```

- [ ] **Step 2: Build**

Run: `cd analyzer && cargo build`
Expected: compiles cleanly.

- [ ] **Step 3: Smoke test against the existing default scan target**

Run: `cd analyzer && cargo run`
Expected: prints `Scanning directory: ../Panos/src` and `Successfully saved graph data to ../ui/public/data.json`. Inspect `ui/public/data.json` and confirm nodes have `"language": "rust"`.

Run: `head -c 400 ../ui/public/data.json`
Expected: JSON output containing `"language": "rust"` on at least one node.

- [ ] **Step 4: Commit the full Phase 1 refactor**

```bash
git add analyzer/src/parsers/ analyzer/src/scanner.rs analyzer/src/main.rs
git rm analyzer/src/parser.rs
git commit -m "refactor(analyzer): migrate Rust parser to LanguageParser trait"
```

---

## Phase 2: TypeScript parser

### Task 6: Add tree-sitter-typescript dependency and create empty TypeScriptParser

**Files:**
- Modify: `analyzer/Cargo.toml`
- Create: `analyzer/src/parsers/typescript.rs`
- Modify: `analyzer/src/parsers/mod.rs`

- [ ] **Step 1: Add the dependency**

Edit `analyzer/Cargo.toml`. In `[dependencies]`, add:

```toml
tree-sitter-typescript = "0.23"
```

- [ ] **Step 2: Create the TypeScriptParser stub**

Create `analyzer/src/parsers/typescript.rs`:

```rust
use std::fs;
use std::path::Path;
use tree_sitter::{Parser, Query, QueryCursor, StreamingIterator};

use crate::models::{Link, Node};
use crate::parsers::LanguageParser;

pub struct TypeScriptParser;

impl LanguageParser for TypeScriptParser {
    fn language_name(&self) -> &'static str {
        "typescript"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &[".ts", ".tsx"]
    }

    fn parse(&self, path: &Path, nodes: &mut Vec<Node>, links: &mut Vec<Link>) {
        let full_path = path.to_string_lossy().into_owned();
        let file_name = path.file_name().unwrap().to_string_lossy().into_owned();
        let group = path
            .parent()
            .and_then(|p| p.file_name())
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "root".to_string());

        let source_code = fs::read_to_string(path).ok();

        nodes.push(Node {
            id: full_path.clone(),
            label: file_name,
            group: group.clone(),
            language: "typescript".to_string(),
            val: 20,
            code: source_code.clone(),
        });

        let Some(source_code) = source_code else { return };

        let is_tsx = path.extension().and_then(|e| e.to_str()) == Some("tsx");
        let language = if is_tsx {
            tree_sitter_typescript::LANGUAGE_TSX.into()
        } else {
            tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()
        };

        let mut parser = Parser::new();
        if parser.set_language(&language).is_err() {
            eprintln!("Failed to load TypeScript grammar for {}", full_path);
            return;
        }

        // Captures filled in by Task 7
        let query_code = "
            (function_declaration) @func
            (class_declaration) @class
            (interface_declaration) @interface
            (type_alias_declaration) @type
            (enum_declaration) @enum
            (method_definition) @method
            (import_statement) @import
        ";

        let query = match Query::new(&language, query_code) {
            Ok(q) => q,
            Err(e) => {
                eprintln!("Error compiling TS query for {}: {}", full_path, e);
                return;
            }
        };

        let tree = match parser.parse(&source_code, None) {
            Some(t) => t,
            None => return,
        };

        let mut cursor = QueryCursor::new();
        let mut captures = cursor.captures(&query, tree.root_node(), source_code.as_bytes());

        // Capture handling implemented in Task 7. Variables held to suppress warnings.
        let _ = (&mut captures, &full_path, &group, nodes, links);
    }
}
```

- [ ] **Step 3: Re-export from the parsers module**

Edit `analyzer/src/parsers/mod.rs` to add:

```rust
pub mod typescript;
pub use typescript::TypeScriptParser;
```

(Add these lines next to the existing `pub mod rust;` / `pub use rust::RustParser;` lines.)

- [ ] **Step 4: Register in main.rs**

Edit `analyzer/src/main.rs`. Update the import line and the registry construction:

```rust
use parsers::{LanguageParser, RustParser, TypeScriptParser, all_extensions, parser_for_path};
```

```rust
let registry: Vec<Box<dyn LanguageParser>> = vec![
    Box::new(RustParser),
    Box::new(TypeScriptParser),
];
```

- [ ] **Step 5: Build**

Run: `cd analyzer && cargo build`
Expected: compiles. Some unused-variable warnings inside `typescript.rs` are acceptable — Task 7 fills in the body.

- [ ] **Step 6: Commit**

```bash
git add analyzer/Cargo.toml analyzer/Cargo.lock analyzer/src/parsers/typescript.rs analyzer/src/parsers/mod.rs analyzer/src/main.rs
git commit -m "feat(analyzer): scaffold TypeScript parser"
```

---

### Task 7: Implement TypeScript construct extraction (TDD)

**Files:**
- Create: `analyzer/tests/fixtures/typescript/sample.ts`
- Create: `analyzer/tests/fixtures/typescript/imported.ts`
- Create: `analyzer/tests/parsers_test.rs`
- Modify: `analyzer/src/parsers/typescript.rs`

- [ ] **Step 1: Create TS fixture files**

Create `analyzer/tests/fixtures/typescript/sample.ts`:

```typescript
import { helper } from "./imported";
import * as fs from "fs";

export function greet(name: string): string {
  return `Hello, ${name}`;
}

export class User {
  constructor(public name: string) {}
  greet(): string {
    return greet(this.name);
  }
}

export interface Greeter {
  greet(): string;
}

export type UserId = string;

export enum Role {
  Admin,
  Guest,
}
```

Create `analyzer/tests/fixtures/typescript/imported.ts`:

```typescript
export function helper(): number {
  return 42;
}
```

- [ ] **Step 2: Write the failing test**

Create `analyzer/tests/parsers_test.rs`:

```rust
use std::path::PathBuf;

use analyzer::models::{Link, Node};
use analyzer::parsers::{LanguageParser, TypeScriptParser};

fn fixture(rel: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(rel)
}

fn count_group(nodes: &[Node], group: &str) -> usize {
    nodes.iter().filter(|n| n.group == group).count()
}

#[test]
fn typescript_parser_extracts_all_constructs() {
    let parser = TypeScriptParser;
    let mut nodes: Vec<Node> = Vec::new();
    let mut links: Vec<Link> = Vec::new();

    parser.parse(&fixture("typescript/sample.ts"), &mut nodes, &mut links);

    // file node + 1 function + 1 class + 1 interface + 1 type alias + 1 enum + 2 imports + 1 method
    assert!(nodes.iter().all(|n| n.language == "typescript"));
    assert_eq!(count_group(&nodes, "functions"), 2, "expected greet() + User.greet()");
    assert_eq!(count_group(&nodes, "classes"), 1);
    assert_eq!(count_group(&nodes, "interfaces"), 1);
    assert_eq!(count_group(&nodes, "types"), 1);
    assert_eq!(count_group(&nodes, "enums"), 1);
    assert_eq!(count_group(&nodes, "imports"), 2);
}
```

The test will not compile until `analyzer` exposes a library target. We need `analyzer/src/lib.rs`.

- [ ] **Step 3: Add a library entry point**

Create `analyzer/src/lib.rs`:

```rust
pub mod models;
pub mod parsers;
pub mod scanner;
```

Edit `analyzer/Cargo.toml` to declare both targets explicitly. Add below `[package]`:

```toml
[lib]
name = "analyzer"
path = "src/lib.rs"

[[bin]]
name = "analyzer"
path = "src/main.rs"
```

Then update `analyzer/src/main.rs` so it pulls modules from the library crate instead of re-declaring them. Replace the top of `main.rs` with:

```rust
use std::env;
use std::fs;

use analyzer::models::GraphData;
use analyzer::parsers::{LanguageParser, RustParser, TypeScriptParser, all_extensions, parser_for_path};
use analyzer::scanner;

fn main() {
    // ... body unchanged from Task 6 ...
```

(Remove the three `mod` declarations at the top of `main.rs`.)

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd analyzer && cargo test --test parsers_test typescript_parser_extracts_all_constructs`
Expected: FAIL — counts will be zero because Task 6 left the capture-handling body empty.

- [ ] **Step 5: Implement capture handling in `parsers/typescript.rs`**

Replace the body of `parse` (everything after the `Query::new(...)` and `tree = parser.parse(...)` setup) with this capture loop. This goes where the `let _ = (&mut captures, ...)` placeholder is:

```rust
while let Some((m, _)) = captures.next() {
    for capture in m.captures {
        let node = capture.node;
        let full_content = &source_code[node.start_byte()..node.end_byte()];
        let capture_name = query.capture_names()[capture.index as usize];
        let start = node.start_byte();

        match capture_name {
            "func" | "method" => {
                let name = node
                    .child_by_field_name("name")
                    .map(|n| source_code[n.start_byte()..n.end_byte()].to_string())
                    .unwrap_or_else(|| "default".to_string());
                let id = format!("{}::fn::{}::{}", full_path, name, start);
                nodes.push(Node {
                    id: id.clone(),
                    label: format!("{}()", name),
                    group: "functions".to_string(),
                    language: "typescript".to_string(),
                    val: 8,
                    code: Some(full_content.to_string()),
                });
                links.push(Link {
                    source: full_path.clone(),
                    target: id,
                    link_type: "contains".to_string(),
                });
            }
            "class" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    let name = &source_code[name_node.start_byte()..name_node.end_byte()];
                    let id = format!("{}::class::{}::{}", full_path, name, start);
                    nodes.push(Node {
                        id: id.clone(),
                        label: name.to_string(),
                        group: "classes".to_string(),
                        language: "typescript".to_string(),
                        val: 12,
                        code: Some(full_content.to_string()),
                    });
                    links.push(Link {
                        source: full_path.clone(),
                        target: id,
                        link_type: "contains".to_string(),
                    });
                }
            }
            "interface" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    let name = &source_code[name_node.start_byte()..name_node.end_byte()];
                    let id = format!("{}::interface::{}::{}", full_path, name, start);
                    nodes.push(Node {
                        id: id.clone(),
                        label: name.to_string(),
                        group: "interfaces".to_string(),
                        language: "typescript".to_string(),
                        val: 14,
                        code: Some(full_content.to_string()),
                    });
                    links.push(Link {
                        source: full_path.clone(),
                        target: id,
                        link_type: "contains".to_string(),
                    });
                }
            }
            "type" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    let name = &source_code[name_node.start_byte()..name_node.end_byte()];
                    let id = format!("{}::type::{}::{}", full_path, name, start);
                    nodes.push(Node {
                        id: id.clone(),
                        label: name.to_string(),
                        group: "types".to_string(),
                        language: "typescript".to_string(),
                        val: 10,
                        code: Some(full_content.to_string()),
                    });
                    links.push(Link {
                        source: full_path.clone(),
                        target: id,
                        link_type: "contains".to_string(),
                    });
                }
            }
            "enum" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    let name = &source_code[name_node.start_byte()..name_node.end_byte()];
                    let id = format!("{}::enum::{}::{}", full_path, name, start);
                    nodes.push(Node {
                        id: id.clone(),
                        label: name.to_string(),
                        group: "enums".to_string(),
                        language: "typescript".to_string(),
                        val: 10,
                        code: Some(full_content.to_string()),
                    });
                    links.push(Link {
                        source: full_path.clone(),
                        target: id,
                        link_type: "contains".to_string(),
                    });
                }
            }
            "import" => {
                let id = format!("{}::import::{}", full_path, start);
                nodes.push(Node {
                    id: id.clone(),
                    label: full_content.to_string(),
                    group: "imports".to_string(),
                    language: "typescript".to_string(),
                    val: 5,
                    code: Some(full_content.to_string()),
                });
                links.push(Link {
                    source: full_path.clone(),
                    target: id,
                    link_type: "imports".to_string(),
                });
            }
            _ => {}
        }
    }
}
```

Also remove the placeholder `let _ = (&mut captures, ...);` line.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd analyzer && cargo test --test parsers_test typescript_parser_extracts_all_constructs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add analyzer/Cargo.toml analyzer/src/lib.rs analyzer/src/main.rs analyzer/src/parsers/typescript.rs analyzer/tests/
git commit -m "feat(analyzer): extract TypeScript constructs"
```

---

### Task 8: Resolve relative TypeScript imports to file links

**Files:**
- Create: `analyzer/src/parsers/import_resolver.rs`
- Modify: `analyzer/src/parsers/mod.rs`
- Modify: `analyzer/src/parsers/typescript.rs`
- Modify: `analyzer/tests/parsers_test.rs`

- [ ] **Step 1: Write the failing test**

Append to `analyzer/tests/parsers_test.rs`:

```rust
#[test]
fn typescript_parser_resolves_relative_import_to_file_link() {
    let parser = TypeScriptParser;
    let mut nodes: Vec<Node> = Vec::new();
    let mut links: Vec<Link> = Vec::new();

    parser.parse(&fixture("typescript/sample.ts"), &mut nodes, &mut links);

    let imported_path = fixture("typescript/imported.ts").to_string_lossy().into_owned();
    let module_links: Vec<&Link> = links
        .iter()
        .filter(|l| l.link_type == "imports_module")
        .collect();

    assert!(
        module_links.iter().any(|l| l.target == imported_path),
        "expected an imports_module link to {}, got {:?}",
        imported_path,
        module_links
    );
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd analyzer && cargo test --test parsers_test typescript_parser_resolves_relative_import_to_file_link`
Expected: FAIL — no `imports_module` link emitted yet.

- [ ] **Step 3: Implement the resolver**

Create `analyzer/src/parsers/import_resolver.rs`:

```rust
use std::path::{Path, PathBuf};

const CANDIDATE_EXTENSIONS: &[&str] = &[".ts", ".tsx", ".js", ".jsx"];
const INDEX_FILES: &[&str] = &["index.ts", "index.tsx", "index.js", "index.jsx"];

/// Extracts the specifier from an `import_statement` source string.
/// Examples: `import x from "./foo"` → Some("./foo")
pub fn extract_specifier(import_text: &str) -> Option<String> {
    let mut chars = import_text.chars();
    let mut quote: Option<char> = None;
    let mut buf = String::new();
    while let Some(c) = chars.next() {
        match (quote, c) {
            (None, '"') | (None, '\'') => quote = Some(c),
            (Some(q), c) if c == q => return Some(buf),
            (Some(_), c) => buf.push(c),
            _ => {}
        }
    }
    None
}

/// Resolves a relative import specifier from `from_file` to a concrete
/// scanned-file path on disk. Returns `None` for bare specifiers (e.g. "react")
/// or unresolvable paths.
pub fn resolve_relative(from_file: &Path, specifier: &str) -> Option<PathBuf> {
    if !specifier.starts_with("./") && !specifier.starts_with("../") {
        return None;
    }
    let base = from_file.parent()?;
    let joined = base.join(specifier);

    // Try direct extensions: ./foo.ts, ./foo.tsx, ...
    for ext in CANDIDATE_EXTENSIONS {
        let mut candidate = joined.clone();
        let new_name = format!(
            "{}{}",
            candidate.file_name()?.to_string_lossy(),
            ext
        );
        candidate.set_file_name(new_name);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    // If the specifier already had an extension, also try the path as-is.
    if joined.exists() && joined.is_file() {
        return Some(joined);
    }

    // Try index files inside a directory: ./foo/index.ts ...
    if joined.is_dir() {
        for index in INDEX_FILES {
            let candidate = joined.join(index);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }

    None
}
```

- [ ] **Step 4: Re-export the resolver**

Add to `analyzer/src/parsers/mod.rs`:

```rust
pub mod import_resolver;
```

- [ ] **Step 5: Use the resolver in TypeScriptParser**

In `analyzer/src/parsers/typescript.rs`, replace the `"import" => { ... }` arm with:

```rust
"import" => {
    let id = format!("{}::import::{}", full_path, start);
    nodes.push(Node {
        id: id.clone(),
        label: full_content.to_string(),
        group: "imports".to_string(),
        language: "typescript".to_string(),
        val: 5,
        code: Some(full_content.to_string()),
    });
    links.push(Link {
        source: full_path.clone(),
        target: id.clone(),
        link_type: "imports".to_string(),
    });

    if let Some(spec) = crate::parsers::import_resolver::extract_specifier(full_content) {
        if let Some(resolved) = crate::parsers::import_resolver::resolve_relative(path, &spec) {
            links.push(Link {
                source: full_path.clone(),
                target: resolved.to_string_lossy().into_owned(),
                link_type: "imports_module".to_string(),
            });
        }
    }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd analyzer && cargo test --test parsers_test typescript_parser_resolves_relative_import_to_file_link`
Expected: PASS.

- [ ] **Step 7: Run all tests**

Run: `cd analyzer && cargo test`
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add analyzer/src/parsers/import_resolver.rs analyzer/src/parsers/mod.rs analyzer/src/parsers/typescript.rs analyzer/tests/parsers_test.rs
git commit -m "feat(analyzer): resolve relative TypeScript imports to file links"
```

---

## Phase 3: JavaScript parser

### Task 9: Add tree-sitter-javascript and JavaScriptParser

**Files:**
- Modify: `analyzer/Cargo.toml`
- Create: `analyzer/src/parsers/javascript.rs`
- Modify: `analyzer/src/parsers/mod.rs`
- Modify: `analyzer/src/main.rs`

- [ ] **Step 1: Add dependency**

Edit `analyzer/Cargo.toml` `[dependencies]`:

```toml
tree-sitter-javascript = "0.23"
```

- [ ] **Step 2: Create JavaScriptParser**

Create `analyzer/src/parsers/javascript.rs`:

```rust
use std::fs;
use std::path::Path;
use tree_sitter::{Parser, Query, QueryCursor, StreamingIterator};

use crate::models::{Link, Node};
use crate::parsers::{LanguageParser, import_resolver};

pub struct JavaScriptParser;

impl LanguageParser for JavaScriptParser {
    fn language_name(&self) -> &'static str {
        "javascript"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &[".js", ".jsx"]
    }

    fn parse(&self, path: &Path, nodes: &mut Vec<Node>, links: &mut Vec<Link>) {
        let full_path = path.to_string_lossy().into_owned();
        let file_name = path.file_name().unwrap().to_string_lossy().into_owned();
        let group = path
            .parent()
            .and_then(|p| p.file_name())
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "root".to_string());

        let source_code = fs::read_to_string(path).ok();

        nodes.push(Node {
            id: full_path.clone(),
            label: file_name,
            group: group.clone(),
            language: "javascript".to_string(),
            val: 20,
            code: source_code.clone(),
        });

        let Some(source_code) = source_code else { return };

        let language = tree_sitter_javascript::LANGUAGE.into();
        let mut parser = Parser::new();
        if parser.set_language(&language).is_err() {
            eprintln!("Failed to load JavaScript grammar for {}", full_path);
            return;
        }

        let query_code = "
            (function_declaration) @func
            (class_declaration) @class
            (method_definition) @method
            (import_statement) @import
        ";

        let query = match Query::new(&language, query_code) {
            Ok(q) => q,
            Err(e) => {
                eprintln!("Error compiling JS query for {}: {}", full_path, e);
                return;
            }
        };

        let tree = match parser.parse(&source_code, None) {
            Some(t) => t,
            None => return,
        };

        let mut cursor = QueryCursor::new();
        let mut captures = cursor.captures(&query, tree.root_node(), source_code.as_bytes());

        while let Some((m, _)) = captures.next() {
            for capture in m.captures {
                let node = capture.node;
                let full_content = &source_code[node.start_byte()..node.end_byte()];
                let capture_name = query.capture_names()[capture.index as usize];
                let start = node.start_byte();

                match capture_name {
                    "func" | "method" => {
                        let name = node
                            .child_by_field_name("name")
                            .map(|n| source_code[n.start_byte()..n.end_byte()].to_string())
                            .unwrap_or_else(|| "default".to_string());
                        let id = format!("{}::fn::{}::{}", full_path, name, start);
                        nodes.push(Node {
                            id: id.clone(),
                            label: format!("{}()", name),
                            group: "functions".to_string(),
                            language: "javascript".to_string(),
                            val: 8,
                            code: Some(full_content.to_string()),
                        });
                        links.push(Link {
                            source: full_path.clone(),
                            target: id,
                            link_type: "contains".to_string(),
                        });
                    }
                    "class" => {
                        if let Some(name_node) = node.child_by_field_name("name") {
                            let name = &source_code[name_node.start_byte()..name_node.end_byte()];
                            let id = format!("{}::class::{}::{}", full_path, name, start);
                            nodes.push(Node {
                                id: id.clone(),
                                label: name.to_string(),
                                group: "classes".to_string(),
                                language: "javascript".to_string(),
                                val: 12,
                                code: Some(full_content.to_string()),
                            });
                            links.push(Link {
                                source: full_path.clone(),
                                target: id,
                                link_type: "contains".to_string(),
                            });
                        }
                    }
                    "import" => {
                        let id = format!("{}::import::{}", full_path, start);
                        nodes.push(Node {
                            id: id.clone(),
                            label: full_content.to_string(),
                            group: "imports".to_string(),
                            language: "javascript".to_string(),
                            val: 5,
                            code: Some(full_content.to_string()),
                        });
                        links.push(Link {
                            source: full_path.clone(),
                            target: id.clone(),
                            link_type: "imports".to_string(),
                        });

                        if let Some(spec) = import_resolver::extract_specifier(full_content) {
                            if let Some(resolved) = import_resolver::resolve_relative(path, &spec) {
                                links.push(Link {
                                    source: full_path.clone(),
                                    target: resolved.to_string_lossy().into_owned(),
                                    link_type: "imports_module".to_string(),
                                });
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }
}
```

- [ ] **Step 3: Re-export and register**

Edit `analyzer/src/parsers/mod.rs`, append:

```rust
pub mod javascript;
pub use javascript::JavaScriptParser;
```

Edit `analyzer/src/main.rs`. Update import:

```rust
use analyzer::parsers::{LanguageParser, RustParser, TypeScriptParser, JavaScriptParser, all_extensions, parser_for_path};
```

And the registry:

```rust
let registry: Vec<Box<dyn LanguageParser>> = vec![
    Box::new(RustParser),
    Box::new(TypeScriptParser),
    Box::new(JavaScriptParser),
];
```

- [ ] **Step 4: Build**

Run: `cd analyzer && cargo build`
Expected: compiles cleanly.

- [ ] **Step 5: Commit**

```bash
git add analyzer/Cargo.toml analyzer/Cargo.lock analyzer/src/parsers/javascript.rs analyzer/src/parsers/mod.rs analyzer/src/main.rs
git commit -m "feat(analyzer): add JavaScript parser"
```

---

### Task 10: Test JavaScript parser end-to-end

**Files:**
- Create: `analyzer/tests/fixtures/javascript/sample.js`
- Modify: `analyzer/tests/parsers_test.rs`

- [ ] **Step 1: Create JS fixture**

Create `analyzer/tests/fixtures/javascript/sample.js`:

```javascript
import { thing } from "./other.js";

export function add(a, b) {
  return a + b;
}

export class Counter {
  constructor() {
    this.value = 0;
  }
  increment() {
    this.value += 1;
  }
}
```

- [ ] **Step 2: Write the failing test**

Append to `analyzer/tests/parsers_test.rs`:

```rust
use analyzer::parsers::JavaScriptParser;

#[test]
fn javascript_parser_extracts_constructs_and_tags_language() {
    let parser = JavaScriptParser;
    let mut nodes: Vec<Node> = Vec::new();
    let mut links: Vec<Link> = Vec::new();

    parser.parse(&fixture("javascript/sample.js"), &mut nodes, &mut links);

    assert!(nodes.iter().all(|n| n.language == "javascript"));
    assert_eq!(count_group(&nodes, "functions"), 3, "add() + constructor() + increment()");
    assert_eq!(count_group(&nodes, "classes"), 1);
    assert_eq!(count_group(&nodes, "imports"), 1);
}
```

(Move the `use analyzer::parsers::JavaScriptParser;` line to the top of the file alongside the existing `use analyzer::parsers::{...};` import — combine them into one.)

- [ ] **Step 3: Run the test**

Run: `cd analyzer && cargo test --test parsers_test javascript_parser_extracts_constructs_and_tags_language`
Expected: PASS.

- [ ] **Step 4: Run the full test suite**

Run: `cd analyzer && cargo test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add analyzer/tests/
git commit -m "test(analyzer): cover JavaScript parser construct extraction"
```

---

### Task 11: End-to-end smoke test on a real TS/JS codebase

**Files:**
- (none modified — verification only)

- [ ] **Step 1: Find or create a target directory**

Pick any small TS/JS project to scan. The repo's `ui/src` is a good candidate since it already exists.

- [ ] **Step 2: Run the analyzer against it**

Run: `cd analyzer && cargo run -- ../ui/src`
Expected: prints `Scanning directory: ../ui/src` and writes `data.json` containing nodes with `"language": "typescript"`.

- [ ] **Step 3: Verify the JSON contains expected groups**

Run: `grep -o '"language": "[^"]*"' ../ui/public/data.json | sort -u`
Expected output includes `"language": "typescript"`.

Run: `grep -o '"group": "[^"]*"' ../ui/public/data.json | sort -u`
Expected output includes `"functions"`, `"classes"`, and at least one of `"interfaces"`, `"types"`.

- [ ] **Step 4: Restore the default scan target so subsequent UI work uses the prior data**

Run: `cd analyzer && cargo run`
Expected: rescans `../Panos/src` and rewrites `data.json`.

(No commit — this is verification.)

---

## Phase 4: UI changes

### Task 12: Add `language` to UI types

**Files:**
- Modify: `ui/src/types/index.ts`

- [ ] **Step 1: Add the field**

Edit `ui/src/types/index.ts`:

```typescript
export interface NodeData {
  id: string;
  label: string;
  group: string;
  language: string;
  val: number;
  code?: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}
```

- [ ] **Step 2: Type-check**

Run: `cd ui && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add ui/src/types/index.ts
git commit -m "feat(ui): add language field to NodeData"
```

---

### Task 13: Add language colors and color-mode toggle

**Files:**
- Modify: `ui/src/components/GraphView.tsx`
- Modify: `ui/src/App.tsx`

- [ ] **Step 1: Add LANGUAGE_RGB and new TYPE_RGB entries to GraphView**

Edit `ui/src/components/GraphView.tsx`. Replace the `TYPE_RGB` and `TYPE_RGB_BRIGHT` constants with the expanded versions, and add `LANGUAGE_RGB` / `LANGUAGE_RGB_BRIGHT`:

```tsx
const TYPE_RGB: Record<string, readonly [number, number, number]> = {
  functions: [209, 154, 102],
  structs: [97, 175, 239],
  enums: [198, 120, 221],
  traits: [152, 195, 121],
  classes: [86, 182, 194],
  interfaces: [152, 195, 121],
  types: [224, 108, 117],
  default: [162, 167, 182],
};
const TYPE_RGB_BRIGHT: Record<string, readonly [number, number, number]> = {
  functions: [249, 183, 121],
  structs: [115, 209, 255],
  enums: [236, 143, 255],
  traits: [181, 233, 144],
  classes: [102, 217, 232],
  interfaces: [181, 233, 144],
  types: [255, 129, 140],
  default: [193, 199, 217],
};
const LANGUAGE_RGB: Record<string, readonly [number, number, number]> = {
  rust: [222, 165, 132],
  typescript: [49, 120, 198],
  javascript: [247, 223, 30],
  default: [162, 167, 182],
};
const LANGUAGE_RGB_BRIGHT: Record<string, readonly [number, number, number]> = {
  rust: [255, 197, 158],
  typescript: [80, 159, 240],
  javascript: [255, 248, 100],
  default: [193, 199, 217],
};
```

- [ ] **Step 2: Add `colorMode` prop and use it in `paintNode`**

In the same file, update the `GraphViewProps` interface:

```tsx
interface GraphViewProps {
  graphData: GraphData;
  selectedNode: NodeData | null;
  onNodeSelect: (node: NodeData | null) => void;
  customWidthOffset?: number;
  colorMode: 'group' | 'language';
}
```

Update the component signature:

```tsx
export const GraphView: React.FC<GraphViewProps> = ({ graphData, selectedNode, onNodeSelect, customWidthOffset = 0, colorMode }) => {
```

Replace the rgb-picking lines inside `paintNode` (currently `(TYPE_RGB_BRIGHT[node.group] ?? TYPE_RGB_BRIGHT.default)` and the `TYPE_RGB[node.group]` line) with:

```tsx
const palette = colorMode === 'language' ? LANGUAGE_RGB : TYPE_RGB;
const paletteBright = colorMode === 'language' ? LANGUAGE_RGB_BRIGHT : TYPE_RGB_BRIGHT;
const key = colorMode === 'language' ? node.language : node.group;

const rgb = (isSelected || isHovered)
  ? HOVER_RGB
  : isNeighbor
    ? (paletteBright[key] ?? paletteBright.default)
    : (palette[key] ?? palette.default);
```

Add `colorMode` to the `paintNode` `useCallback` dependency array.

- [ ] **Step 3: Wire `colorMode` through App**

Edit `ui/src/App.tsx`. Add state right after the existing `useState` calls (near the top of `function App()`):

```tsx
const [colorMode, setColorMode] = useState<'group' | 'language'>('group');
```

Pass it to `<GraphView>`:

```tsx
<GraphView
  graphData={filteredData}
  selectedNode={selectedNode}
  onNodeSelect={(node) => setSelectedNodeId(node ? node.id : null)}
  customWidthOffset={selectedNode ? panelWidth : 0}
  colorMode={colorMode}
/>
```

Add a toggle button. Insert this just before `<GraphView ... />` inside the main graph area `<div>`:

```tsx
<button
  type="button"
  onClick={() => setColorMode(prev => prev === 'group' ? 'language' : 'group')}
  style={{
    position: 'absolute',
    top: 20,
    right: 110,
    zIndex: 12,
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '999px',
    background: 'rgba(22, 22, 24, 0.82)',
    color: '#a2a7b6',
    fontFamily: 'Inter, sans-serif',
    fontSize: '0.75rem',
    fontWeight: 600,
    padding: '7px 12px',
    cursor: 'pointer',
    backdropFilter: 'blur(8px)'
  }}
>
  Color: {colorMode === 'group' ? 'Type' : 'Language'}
</button>
```

- [ ] **Step 4: Type-check and run dev server**

Run: `cd ui && npm run build`
Expected: build succeeds.

Run: `cd ui && npm run dev` (in a separate terminal)
Open http://localhost:5173 and verify:
- The graph renders.
- A "Color: Type" button appears in the top-right area near the existing "Names" toggle.
- Clicking it flips to "Color: Language" and node colors change accordingly.

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/GraphView.tsx ui/src/App.tsx
git commit -m "feat(ui): add language color mode and palette toggle"
```

---

### Task 14: Show language in the hover info panel

**Files:**
- Modify: `ui/src/components/GraphView.tsx`

- [ ] **Step 1: Add a language row to the hover panel**

In `ui/src/components/GraphView.tsx`, find the hover panel `<div>` block (the one that renders `hoverNode.group` and `hoverNode.label`). Replace its inner content with:

```tsx
<div style={{ color: '#8b949e', fontSize: '0.68rem', marginBottom: '3px', textTransform: 'uppercase' }}>
  {hoverNode.group}
</div>
<div style={{ color: '#e6edf3', fontSize: '0.82rem', fontWeight: 600, lineHeight: 1.3, wordBreak: 'break-word' }}>
  {hoverNode.label}
</div>
<div style={{ color: '#64748b', fontSize: '0.68rem', marginTop: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
  Language: <span style={{ color: '#cbd5e1' }}>{hoverNode.language}</span>
</div>
```

- [ ] **Step 2: Verify in the browser**

Run dev server (if not running) and hover any node. Expected: bottom-right tooltip now shows a "LANGUAGE: rust" (or `typescript`/`javascript`) row beneath the node label.

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/GraphView.tsx
git commit -m "feat(ui): show language in hover info panel"
```

---

### Task 15: Language badge and dynamic syntax highlighting in CodePreviewPanel

**Files:**
- Modify: `ui/src/components/CodePreviewPanel.tsx`

- [ ] **Step 1: Add language badge and use language in syntax highlighter**

Edit `ui/src/components/CodePreviewPanel.tsx`. Replace the file contents with:

```tsx
import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { NodeData } from '../types';

interface CodePreviewPanelProps {
  selectedNode: NodeData;
  onClose: () => void;
}

const LANGUAGE_BADGE: Record<string, { label: string; color: string }> = {
  rust: { label: 'RS', color: '#dea584' },
  typescript: { label: 'TS', color: '#3178c6' },
  javascript: { label: 'JS', color: '#f7df1e' },
};

const HIGHLIGHTER_LANGUAGE: Record<string, string> = {
  rust: 'rust',
  typescript: 'typescript',
  javascript: 'javascript',
};

export const CodePreviewPanel: React.FC<CodePreviewPanelProps> = ({ selectedNode, onClose }) => {
  const badge = LANGUAGE_BADGE[selectedNode.language] ?? { label: selectedNode.language.toUpperCase().slice(0, 3), color: '#475569' };
  const highlighterLang = HIGHLIGHTER_LANGUAGE[selectedNode.language] ?? 'text';

  return (
    <div style={{
      width: '100%',
      height: '100vh',
      background: '#161618',
      borderLeft: '1px solid rgba(255,255,255,0.05)',
      color: '#e2e8f0',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'Inter, sans-serif'
    }}>
      <div style={{
        padding: '24px 24px 20px 24px',
        flexShrink: 0,
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        background: 'linear-gradient(to bottom, #1e1e20, #161618)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{
                background: '#475569',
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '0.7rem',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: '#cbd5e1',
                display: 'inline-block'
              }}>
                TYPE: {selectedNode.group}
              </span>
              <span style={{
                background: badge.color,
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '0.7rem',
                fontWeight: 'bold',
                color: '#161618',
                display: 'inline-block'
              }}>
                {badge.label}
              </span>
            </div>
            <h2 style={{ fontSize: '1.4rem', margin: '0 0 8px 0', color: '#fff', fontWeight: 600, wordBreak: 'break-all' }}>
              {selectedNode.label}
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#64748b',
              cursor: 'pointer',
              fontSize: '1.5rem',
              padding: '4px',
              lineHeight: 1,
              transition: 'color 0.2s',
              marginTop: '-4px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
            onMouseLeave={(e) => e.currentTarget.style.color = '#64748b'}
          >
            ×
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', color: '#64748b', fontSize: '0.8rem' }}>
          <span style={{ fontWeight: 600, marginRight: '8px', opacity: 0.7, marginTop: '2px' }}>PATH:</span>
          <span style={{ wordBreak: 'break-all', opacity: 0.9, lineHeight: 1.4 }}>{selectedNode.id}</span>
        </div>
      </div>

      <div style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '24px',
        minHeight: 0
      }}>
        {selectedNode.code ? (
          <div style={{
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.05)',
            background: '#1e1e20',
            overflow: 'hidden'
          }}>
            <SyntaxHighlighter
              language={highlighterLang}
              style={atomDark}
              showLineNumbers={true}
              wrapLines={true}
              lineProps={{
                style: {
                  display: 'block',
                  paddingLeft: '4em',
                  textIndent: '-4em',
                  wordBreak: 'break-all',
                  whiteSpace: 'pre-wrap'
                }
              }}
              codeTagProps={{
                style: {
                  whiteSpace: 'pre-wrap',
                }
              }}
              customStyle={{
                margin: 0,
                padding: '20px',
                fontSize: '0.85rem',
                lineHeight: '1.6',
                background: 'transparent',
                overflow: 'visible'
              }}
            >
              {selectedNode.code}
            </SyntaxHighlighter>
          </div>
        ) : (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
            <p style={{ fontStyle: 'italic' }}>No code content available for this node.</p>
          </div>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Verify in the browser**

Reload the dev server. Click any TypeScript or JavaScript node and confirm:
- The header shows both a "TYPE: …" pill and a colored language badge (RS / TS / JS).
- Code is highlighted using the correct language grammar (e.g., TypeScript syntax for `.ts` files instead of being mis-highlighted as Rust).

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/CodePreviewPanel.tsx
git commit -m "feat(ui): show language badge and use language-aware syntax highlighting"
```

---

## Phase 5: Final verification

### Task 16: End-to-end mixed-language verification

**Files:** none modified — verification only.

- [ ] **Step 1: Run analyzer against a mixed-language target**

Pick a mixed target. If none exists locally, create a temporary one:

```bash
mkdir -p /tmp/mixed-test/{rust,ts}
cp analyzer/tests/fixtures/typescript/sample.ts /tmp/mixed-test/ts/
cp analyzer/tests/fixtures/typescript/imported.ts /tmp/mixed-test/ts/
cat > /tmp/mixed-test/rust/lib.rs <<'EOF'
pub fn hello() -> &'static str { "hi" }
pub struct Greeter;
EOF
```

Run: `cd analyzer && cargo run -- /tmp/mixed-test`
Expected: `Successfully saved graph data to ../ui/public/data.json`.

- [ ] **Step 2: Confirm both languages present in the JSON**

Run: `grep -o '"language": "[^"]*"' ui/public/data.json | sort -u`
Expected: at least two of `"language": "rust"`, `"language": "typescript"`.

- [ ] **Step 3: Visual check in the UI**

Run: `cd ui && npm run dev` (if not already running)
Open http://localhost:5173. Verify:
- The graph contains nodes for both languages.
- "Color: Type" mode shows the construct palette.
- "Color: Language" toggle visibly distinguishes Rust nodes from TypeScript nodes.
- Hovering shows the correct language in the tooltip.
- Clicking a TypeScript node opens the code preview with the TS badge and TypeScript syntax highlighting.

- [ ] **Step 4: Run all analyzer tests one more time**

Run: `cd analyzer && cargo test`
Expected: all tests pass.

- [ ] **Step 5: Run UI build**

Run: `cd ui && npm run build && npm run lint`
Expected: build and lint succeed.

- [ ] **Step 6: Restore default scan target before finishing**

Run: `cd analyzer && cargo run`

(No commit — verification only.)
