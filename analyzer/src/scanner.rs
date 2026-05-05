use std::path::PathBuf;
use walkdir::WalkDir;

pub fn find_rust_files(target_dir: &str) -> Vec<PathBuf> {
    let mut files = Vec::new();

    for entry in WalkDir::new(target_dir)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            let is_hidden = name.starts_with(".") && name != "." && name != "..";
            name != "target" && !is_hidden
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        if let Some(ext) = path.extension() {
            if ext == "rs" {
                files.push(path.to_path_buf());
            }
        }
    }

    files
}
