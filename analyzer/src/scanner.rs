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
