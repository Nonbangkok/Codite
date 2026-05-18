# Go, C, and C++ Parsers Implementation Plan

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agent/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** Implement robust, high-performance AST parsers for Go, C, and C++ in the Rust analyzer backend, resolving and mapping internal codebase imports/includes.

**Architecture:** Extend the existing modular `LanguageParser` registry by implementing individual Rust modules (`go.rs`, `c.rs`, `cpp.rs`) using tree-sitter grammars and standard SCM query logic.

**Tech Stack:** Rust (Edition 2024), tree-sitter, tree-sitter-go, tree-sitter-c, tree-sitter-cpp.

---

### Task 1: Setup Backend Infrastructure

**Files:**
- Modify: `analyzer/Cargo.toml`
- Create: `analyzer/src/parsers/go.rs`
- Create: `analyzer/src/parsers/c.rs`
- Create: `analyzer/src/parsers/cpp.rs`
- Modify: `analyzer/src/parsers/mod.rs`
- Modify: `analyzer/src/main.rs`

**Step 1: Install new tree-sitter dependencies**
Add `tree-sitter-go = "0.23"`, `tree-sitter-c = "0.23"`, and `tree-sitter-cpp = "0.23"` in `analyzer/Cargo.toml` under `[dependencies]`.

**Step 2: Create parser stub files**
Create minimal placeholder implementations of `LanguageParser` in:
- `analyzer/src/parsers/go.rs`
- `analyzer/src/parsers/c.rs`
- `analyzer/src/parsers/cpp.rs`

**Step 3: Register stub parsers**
Import and expose the new parsers in `analyzer/src/parsers/mod.rs` and add them to the `registry` vector in `analyzer/src/main.rs`.

**Step 4: Run compilation check**
Run: `cargo check` inside the `analyzer/` folder.
Expected: Compilation passes successfully with no warnings/errors.

**Step 5: Commit setup**
```bash
git add analyzer/Cargo.toml analyzer/src/parsers/go.rs analyzer/src/parsers/c.rs analyzer/src/parsers/cpp.rs analyzer/src/parsers/mod.rs analyzer/src/main.rs
git commit -m "chore: setup dependencies and stub files for Go, C, and C++ parsers"
```

---

### Task 2: Implement Go Parser & Test Fixtures

**Files:**
- Create: `analyzer/tests/fixtures/go/sample.go`
- Create: `analyzer/tests/fixtures/go/imported.go`
- Modify: `analyzer/src/parsers/go.rs`
- Modify: `analyzer/tests/parsers_test.rs`

**Step 1: Create Go test fixtures**
Create sample Go files under `analyzer/tests/fixtures/go/` defining:
*   Standard imports (`fmt`), local relative imports (`./imported.go`), and external/mock-absolute imports (`github.com/gin-gonic/gin`).
*   A custom function (`func HelloWorld()`).
*   A custom struct (`type Config struct`).
*   An interface (`type Database interface`).
*   A custom type (`type ID string`).

**Step 2: Write failing test case**
Add `go_parser_extracts_all_constructs_and_resolves_relative_imports` in `analyzer/tests/parsers_test.rs` asserting correct numbers of functions, structs, interfaces, types, and resolved file links.
Run: `cargo test --test parsers_test`
Expected: Test fails (as GoParser only has a stub).

**Step 3: Implement SCM query & resolution logic**
Complete `analyzer/src/parsers/go.rs`:
*   Compile `tree-sitter-go` grammar.
*   Construct query for function declarations, structs, interfaces, custom types, and imports.
*   Resolve local imports (both relative and local module-relative).

**Step 4: Verify test passes**
Run: `cargo test --test parsers_test`
Expected: Test passes successfully.

**Step 5: Commit Go Parser**
```bash
git add analyzer/tests/fixtures/go/ analyzer/src/parsers/go.rs analyzer/tests/parsers_test.rs
git commit -m "feat(analyzer): implement GoParser with AST query and relative import resolution"
```

---

### Task 3: Implement C Parser & Test Fixtures

**Files:**
- Create: `analyzer/tests/fixtures/c/sample.c`
- Create: `analyzer/tests/fixtures/c/helper.h`
- Modify: `analyzer/src/parsers/c.rs`
- Modify: `analyzer/tests/parsers_test.rs`

**Step 1: Create C test fixtures**
Create sample C files under `analyzer/tests/fixtures/c/` defining:
*   A standard header include (`#include <stdio.h>`) and a local header include (`#include "helper.h"`).
*   A basic function (`int calculate_sum(int a, int b)`).
*   A struct (`struct Connection { int port; };`).
*   A typedef (`typedef unsigned long ulong;`).

**Step 2: Write failing test case**
Add `c_parser_extracts_all_constructs_and_resolves_includes` in `analyzer/tests/parsers_test.rs` asserting correct number of functions, structs, types, and includes resolved.
Run: `cargo test --test parsers_test`
Expected: Test fails.

**Step 3: Implement C SCM Query and Include Resolution**
Complete `analyzer/src/parsers/c.rs`:
*   Compile `tree-sitter-c` grammar.
*   Construct query for functions, struct specifiers, typedefs, and preprocessor includes.
*   Implement include resolution ignoring angle brackets `<>` and resolving double quotes `""`.

**Step 4: Verify test passes**
Run: `cargo test --test parsers_test`
Expected: Test passes successfully.

**Step 5: Commit C Parser**
```bash
git add analyzer/tests/fixtures/c/ analyzer/src/parsers/c.rs analyzer/tests/parsers_test.rs
git commit -m "feat(analyzer): implement CParser with AST query and relative include resolution"
```

---

### Task 4: Implement C++ Parser & Test Fixtures

**Files:**
- Create: `analyzer/tests/fixtures/cpp/sample.cpp`
- Create: `analyzer/tests/fixtures/cpp/class.hpp`
- Modify: `analyzer/src/parsers/cpp.rs`
- Modify: `analyzer/tests/parsers_test.rs`

**Step 1: Create C++ test fixtures**
Create sample C++ files under `analyzer/tests/fixtures/cpp/` defining:
*   A system header include (`#include <iostream>`) and local include (`#include "class.hpp"`).
*   A namespace (`namespace MathUtils`).
*   A class with method definitions (`class Vector3 { public: void normalize(); };`).
*   A struct (`struct Vertex { float x; float y; };`).

**Step 2: Write failing test case**
Add `cpp_parser_extracts_all_constructs_and_resolves_includes` in `analyzer/tests/parsers_test.rs` asserting correct count of functions, classes, structs, and includes resolved.
Run: `cargo test --test parsers_test`
Expected: Test fails.

**Step 3: Implement C++ SCM Query and Include Resolution**
Complete `analyzer/src/parsers/cpp.rs`:
*   Compile `tree-sitter-cpp` grammar.
*   Construct query for functions, classes, structs, and preprocessor includes.
*   Resolve internal includes.

**Step 4: Verify test passes**
Run: `cargo test --test parsers_test`
Expected: Test passes successfully.

**Step 5: Commit C++ Parser**
```bash
git add analyzer/tests/fixtures/cpp/ analyzer/src/parsers/cpp.rs analyzer/tests/parsers_test.rs
git commit -m "feat(analyzer): implement CppParser with AST query and relative include resolution"
```

---

### Task 5: End-to-End Local Execution & Verification

**Files:** None (Manual check)

**Step 1: Run comprehensive local scan**
Run: `cargo run -- .. ../ui/public/data.json` inside the `analyzer/` folder.
Expected: Scans successfully and outputs `data.json` to the UI static directory.

**Step 2: Run frontend test suites**
Run: `node --import tsx --test tests/graphLayout.test.ts` inside the `ui/` folder.
Expected: All frontend tests pass successfully.

**Step 3: Final commit & push**
Run git commands to clean up and verify working status.
