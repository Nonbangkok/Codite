use std::path::PathBuf;

use ignore::WalkBuilder;

/// Directories never worth scanning, even when a project forgets to ignore them.
const SKIP_DIRS: &[&str] = &[
    "target",
    "node_modules",
    "dist",
    "dist-server",
    "build",
    "out",
    "coverage",
    "vendor",
    ".git",
    ".vscode",
    ".agent",
    ".claude",
    "__pycache__",
    ".venv",
    "venv",
];

/// Source files under `target_dir` with one of `extensions` (including the dot).
/// Respects `.gitignore`, `.ignore` and global git excludes, skips hidden files and the
/// directories in `SKIP_DIRS`, and does not follow symlinks. Results are sorted for stable output.
pub fn find_source_files(target_dir: &str, extensions: &[&str]) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = WalkBuilder::new(target_dir)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .require_git(false)
        .follow_links(false)
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !(e.file_type().is_some_and(|t| t.is_dir()) && SKIP_DIRS.contains(&name.as_ref()))
        })
        .build()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_some_and(|t| t.is_file()))
        .map(|e| e.into_path())
        .filter(|p| {
            p.extension()
                .and_then(|e| e.to_str())
                .is_some_and(|ext| extensions.iter().any(|e| e.strip_prefix('.') == Some(ext)))
        })
        .collect();
    files.sort();
    files
}
