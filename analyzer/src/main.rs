use std::env;
use std::fs;
use std::path::PathBuf;

use analyzer::models::GraphData;
use analyzer::parsers::{LanguageParser, RustParser, TypeScriptParser, JavaScriptParser, PythonParser, GoParser, CParser, CppParser, all_extensions, parser_for_path};
use analyzer::scanner;
use indicatif::{ProgressBar, ProgressStyle};

fn main() {
    let args: Vec<String> = env::args().collect();
    let default_dir = env!("DEFAULT_SCAN_DIR");
    let target_dir_raw = if args.len() > 1 { &args[1] } else { default_dir };

    // 1. Get the absolute, canonical path of the target directory
    let canonical_target = fs::canonicalize(target_dir_raw)
        .expect(&format!("Failed to resolve target directory: {}", target_dir_raw));
    
    let root_name = canonical_target.file_name()
        .expect("Failed to get folder name from target path")
        .to_string_lossy()
        .into_owned();
    
    let parent_dir = canonical_target.parent()
        .expect("Failed to get parent directory of target path");

    // 2. Resolve output path before changing directory
    let output_path_raw = if args.len() > 2 {
        args[2].clone()
    } else if std::path::Path::new("../ui/public").exists() {
        "../ui/public/data.json".to_string()
    } else {
        "data.json".to_string()
    };
    
    // Convert output_path to absolute path to ensure it remains valid after CWD change
    let output_path = if std::path::Path::new(&output_path_raw).is_absolute() {
        PathBuf::from(output_path_raw)
    } else {
        env::current_dir().unwrap().join(output_path_raw)
    };

    println!("Target project: {}", root_name);
    println!("Scanning from parent: {}", parent_dir.display());
    println!("Output will be saved to: {}", output_path.display());

    // 3. Change working directory to the parent of the target
    // This ensures that walkdir and the parsers generate IDs starting with root_name/
    env::set_current_dir(parent_dir).expect("Failed to change working directory");

    let registry: Vec<Box<dyn LanguageParser>> = vec![
        Box::new(RustParser),
        Box::new(TypeScriptParser),
        Box::new(JavaScriptParser),
        Box::new(PythonParser),
        Box::new(GoParser),
        Box::new(CParser),
        Box::new(CppParser),
    ];
    let extensions = all_extensions(&registry);

    let mut nodes = Vec::new();
    let mut links = Vec::new();

    // Scan using the root_name (the folder name itself)
    let files = scanner::find_source_files(&root_name, &extensions);
    let total_files = files.len();

    let pb = ProgressBar::new(total_files as u64);
    pb.set_style(ProgressStyle::default_bar()
        .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} ({percent}%) {msg}")
        .unwrap()
        .progress_chars("#>-"));
    pb.enable_steady_tick(std::time::Duration::from_millis(100));

    for file in files {
        let display_path = file.strip_prefix(&root_name).unwrap_or(&file).to_string_lossy();
        pb.set_message(format!("{}", display_path));
        
        if let Some(parser) = parser_for_path(&file, &registry) {
            parser.parse(&file, &mut nodes, &mut links);
        }
        pb.inc(1);
    }
    pb.finish_with_message("Scan completed successfully");

    let graph = GraphData { nodes, links };

    if let Ok(json) = serde_json::to_string_pretty(&graph) {
        match fs::write(&output_path, json) {
            Ok(_) => println!("Successfully saved graph data to {}", output_path.display()),
            Err(e) => eprintln!("Error saving graph data to {}: {}", output_path.display(), e),
        }
    }
}
