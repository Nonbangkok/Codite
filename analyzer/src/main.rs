use std::env;
use std::fs;

use analyzer::models::GraphData;
use analyzer::parsers::{LanguageParser, RustParser, TypeScriptParser, JavaScriptParser, PythonParser, all_extensions, parser_for_path};
use analyzer::scanner;
use indicatif::{ProgressBar, ProgressStyle};

fn main() {
    let args: Vec<String> = env::args().collect();
    let default_dir = env!("DEFAULT_SCAN_DIR");
    let target_dir = if args.len() > 1 { &args[1] } else { default_dir };

    println!("Scanning directory: {}", target_dir);

    let registry: Vec<Box<dyn LanguageParser>> = vec![
        Box::new(RustParser),
        Box::new(TypeScriptParser),
        Box::new(JavaScriptParser),
        Box::new(PythonParser),
    ];
    let extensions = all_extensions(&registry);

    let mut nodes = Vec::new();
    let mut links = Vec::new();

    let files = scanner::find_source_files(target_dir, &extensions);
    let total_files = files.len();

    let pb = ProgressBar::new(total_files as u64);
    pb.set_style(ProgressStyle::default_bar()
        .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} ({percent}%) {msg}")
        .unwrap()
        .progress_chars("#>-"));
    pb.enable_steady_tick(std::time::Duration::from_millis(100));

    for file in files {
        let display_path = file.strip_prefix(target_dir).unwrap_or(&file).to_string_lossy();
        pb.set_message(format!("{}", display_path));
        
        if let Some(parser) = parser_for_path(&file, &registry) {
            parser.parse(&file, &mut nodes, &mut links);
        }
        pb.inc(1);
    }
    pb.finish_with_message("Scan completed successfully");

    let graph = GraphData { nodes, links };

    if let Ok(json) = serde_json::to_string_pretty(&graph) {
        let output_path = "../ui/public/data.json";
        match fs::write(output_path, json) {
            Ok(_) => println!("Successfully saved graph data to {}", output_path),
            Err(e) => eprintln!("Error saving graph data: {}", e),
        }
    }
}
