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
