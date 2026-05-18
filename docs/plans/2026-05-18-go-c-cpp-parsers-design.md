# Design Document: Parsers for Go, C, and C++

## Goal
Implement modular, high-performance AST relationship parsers for Go, C, and C++ in the Rust analyzer backend. This will allow Codite to extract key constructs (functions, methods, classes, structs, interfaces) and map internal dependency networks via relative imports and includes.

---

## Architecture: Modular Integration
Following the established parser pattern in the codebase, we will integrate three separate parser structs implementing the `LanguageParser` trait:

1.  **GoParser (`go.rs`)**: For Go source files.
2.  **CParser (`c.rs`)**: For C source and header files.
3.  **CppParser (`cpp.rs`)**: For C++ source and header files.

### Components and Extensions
*   **Go**: `.go` (Group: `functions`, `structs`, `interfaces`, `types`, `imports`)
*   **C**: `.c`, `.h` (Group: `functions`, `structs`, `types`, `imports`)
*   **C++**: `.cpp`, `.hpp`, `.cc`, `.cxx`, `.hxx` (Group: `functions`, `classes`, `structs`, `imports`)

---

## AST SCM Queries

### 1. Go Parser (`go.rs`)
Querying tree-sitter-go grammar:
```rust
let query_code = "
    (function_declaration) @func
    (method_declaration) @method
    (type_spec name: (type_identifier) @struct.name type: (struct_type)) @struct
    (type_spec name: (type_identifier) @interface.name type: (interface_type)) @interface
    (type_spec name: (type_identifier) @type.name) @type
    (import_spec) @import
";
```

### 2. C Parser (`c.rs`)
Querying tree-sitter-c grammar:
```rust
let query_code = "
    (function_definition) @func
    (struct_specifier name: (type_identifier) @struct.name) @struct
    (typedef_declaration declarator: (type_identifier) @typedef.name) @typedef
    (preproc_include) @include
";
```

### 3. C++ Parser (`cpp.rs`)
Querying tree-sitter-cpp grammar:
```rust
let query_code = "
    (function_definition) @func
    (class_specifier name: (type_identifier) @class.name) @class
    (struct_specifier name: (type_identifier) @struct.name) @struct
    (preproc_include) @include
";
```

---

## Import and Include Resolution Rules

### 1. Go Imports
*   **Standard / External**: If the import path is bare (e.g. `"fmt"`, `"os"`) or references a remote domain (starts with `"github.com"`, `"golang.org"`, etc.), it is completely ignored.
*   **Local Relative**: Paths starting with `"./"` or `"../"` are resolved relative to the current file's directory.
*   **Local Module-Relative**: Paths starting with the scanned project's module name (e.g. `"myproject/models"`) will have the prefix `"myproject/"` stripped and replaced with the absolute path to the scanned project root, resolving files correctly.

### 2. C & C++ Includes
*   **Angle Brackets `< >`**: (e.g. `#include <stdio.h>`, `#include <vector>`) System or external paths are ignored.
*   **Double Quotes `" "`**: (e.g. `#include "helper.h"`, `#include "../utils/math.h"`) Internal includes are resolved relative to the current file's directory, and mapped to local nodes on disk.

---

## Verification Plan

### Automated Integration Tests
1.  **Test Fixtures**: Create mock sample files under `analyzer/tests/fixtures/`:
    *   `go/sample.go` (defining structs, interfaces, functions, local relative imports).
    *   `c/sample.c`, `c/helper.h` (defining C structs, functions, local relative includes).
    *   `cpp/sample.cpp`, `cpp/class.hpp` (defining C++ classes, methods, local relative includes).
2.  **Parser Integration Tests**: Add test cases to [parsers_test.rs](file:///Users/nonbangkok/Documents/Workspace/Project/Codite/analyzer/tests/parsers_test.rs):
    *   `go_parser_extracts_constructs_and_resolves_imports`
    *   `c_parser_extracts_constructs_and_resolves_includes`
    *   `cpp_parser_extracts_constructs_and_resolves_includes`
3.  **Command Execution**: Verify correctness by running `cargo test` in the `analyzer/` folder.
