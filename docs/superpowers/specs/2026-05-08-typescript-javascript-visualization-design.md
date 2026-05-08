# TypeScript / JavaScript Visualization Design

**Date:** 2026-05-08
**Status:** Approved (pending user spec review)

## Goal

Extend AtloGraph's analyzer so it can visualize TypeScript and JavaScript codebases alongside Rust, supporting mixed-language repositories in a single graph. The graph must surface both the construct type (function, class, etc.) and the source language for every node.

## Non-Goals

- Scanning `node_modules` or other vendored dependency trees.
- Resolving non-relative imports (bare specifiers like `react`, `lodash`).
- Cross-language linking (e.g., a Rust FFI binding pointing to a JS function).
- Type-level analysis beyond the syntactic constructs Tree-sitter can extract.

## Architecture

### Trait-based parser abstraction

Introduce a `LanguageParser` trait. Each language gets its own implementation, registered in `main.rs`:

```rust
pub trait LanguageParser {
    fn language_name(&self) -> &'static str;          // "rust" | "typescript" | "javascript"
    fn extensions(&self) -> &'static [&'static str];  // e.g. [".ts", ".tsx"]
    fn parse(&self, path: &Path, nodes: &mut Vec<Node>, links: &mut Vec<Link>);
}
```

### File layout

```
analyzer/src/
├── main.rs                  (builds parser registry, dispatches per file)
├── models.rs                (+ language field on Node)
├── scanner.rs               (extension-agnostic, skips node_modules/dist/build/target)
└── parsers/
    ├── mod.rs               (LanguageParser trait, registry helpers)
    ├── rust.rs              (RustParser — extracted from existing parser.rs)
    ├── typescript.rs        (TypeScriptParser — handles .ts and .tsx)
    └── javascript.rs        (JavaScriptParser — handles .js and .jsx)
```

### Dispatch flow

1. `main.rs` builds `Vec<Box<dyn LanguageParser>>`.
2. Scanner walks the target directory and returns every file whose extension matches any registered parser's `extensions()`.
3. For each file, `main.rs` looks up the parser by extension and invokes `parse(...)`.
4. Combined `nodes` and `links` are serialized to `ui/public/data.json` exactly as today.

## Data Model Changes

### `Node` struct (Rust + UI `NodeData` type)

Add `language: String` (`"rust" | "typescript" | "javascript"`).

### Node ID encoding (TS/JS)

Same scheme as Rust — `{file_path}::{kind}::{name}::{byte_offset}`:

- `{path}::fn::{name}::{offset}`
- `{path}::class::{name}::{offset}`
- `{path}::interface::{name}::{offset}`
- `{path}::type::{name}::{offset}`
- `{path}::enum::{name}::{offset}` (TS only)
- `{path}::import::{offset}` (anonymous, byte-offset disambiguates)

### Link types

Existing vocabulary, plus:

| Link type | Source → Target | Notes |
|---|---|---|
| `contains` | file → construct | unchanged |
| `imports` | file → import node | unchanged |
| `imports_module` | file → resolved file node | TS/JS analogue of Rust `declares_module` |
| `extends` | class → parent class | TS/JS |
| `implements` | class → interface | TS only |

## Parser Behavior

### TypeScriptParser (`.ts`, `.tsx`)

| Construct | Tree-sitter node | Group |
|---|---|---|
| Function declaration | `function_declaration` | `functions` |
| Top-level/exported arrow function | `lexical_declaration` containing `arrow_function` | `functions` |
| Method | `method_definition` | `functions` |
| Class | `class_declaration` | `classes` |
| Interface | `interface_declaration` | `interfaces` |
| Type alias | `type_alias_declaration` | `types` |
| Enum | `enum_declaration` | `enums` |
| Import | `import_statement` | `imports` |

`tree-sitter-typescript` ships two grammars (`typescript` and `tsx`); the parser selects the right one per extension.

### JavaScriptParser (`.js`, `.jsx`)

Same as TypeScript minus interfaces, type aliases, and enums. JSX components are captured naturally as either functions or classes.

### RustParser

Unchanged from the current implementation, just relocated into `parsers/rust.rs` and made to satisfy the trait.

### Import resolution

For each relative import (`./foo`, `../bar/baz`), try in order:
1. `./foo.ts`, `./foo.tsx`, `./foo.js`, `./foo.jsx`
2. `./foo/index.ts`, `./foo/index.tsx`, `./foo/index.js`, `./foo/index.jsx`

If any resolves to a scanned file, emit an `imports_module` link. Otherwise, the import remains as a standalone node with no link target. Bare imports (`react`, `lodash`) always stay standalone.

### Edge cases

- **Anonymous default exports** (`export default function () {}`): assigned the synthetic name `default`.
- **Re-exports** (`export { foo } from './bar'`): treated as imports.
- **`.d.ts` files**: scanned as normal TypeScript. Future: optional flag to exclude.
- **Skipped directories**: `target`, `node_modules`, `dist`, `build`, plus any dotfile/dotdir.

## UI Changes

### `types/index.ts`
Add `language: string` to `NodeData`.

### `components/GraphView.tsx`
- Accept new prop `colorMode: 'group' | 'language'`.
- Add `LANGUAGE_COLORS`:
  - `rust` → `#dea584`
  - `typescript` → `#3178c6`
  - `javascript` → `#f7df1e`
- Add new entries to `TYPE_COLORS`:
  - `classes` → `#56b6c2` (teal)
  - `interfaces` → `#98c379` (reuse green — same role as Rust traits)
  - `types` → `#e06c75` (pink)
- Node-color picker selects from `TYPE_COLORS` or `LANGUAGE_COLORS` per `colorMode`.

### `App.tsx`
- Owns `colorMode` state, default `'group'`.
- Adds a toggle button (top-right toolbar area) flipping between "Color: Type" and "Color: Language".

### Hover info panel (bottom-right)
- Adds a "Language" row showing the node's language capitalized (e.g., "TypeScript").

### `CodePreviewPanel.tsx`
- Header gets a small language badge (`RS` / `TS` / `JS`) colored from `LANGUAGE_COLORS`.
- Syntax-highlighter `language` prop driven by `node.language` instead of being hardcoded.

### `FileExplorer.tsx`
No functional change — already groups by file path.

## Error Handling

- Per-file parse failures are logged to stderr and the file is skipped (today's behavior).
- Files with unrecognized extensions are silently skipped by the scanner.
- Tree-sitter grammar load failures are fatal — programmer error, not data error.

## Testing

- Per-parser unit tests under `analyzer/tests/`, with small fixture files at `analyzer/tests/fixtures/{rust,typescript,javascript}/`. Each test asserts expected node counts plus correct `group` and `language` fields.
- UI: no new tests required if no new utility helpers are introduced. If a color-mode helper is extracted, add a unit test for it under `ui/tests/`.

## Dependencies

Add to `analyzer/Cargo.toml`:
- `tree-sitter-typescript`
- `tree-sitter-javascript`

No new UI dependencies expected.

## Open Questions

None — design is fully specified for implementation.
