mod models;
mod parser;
mod scanner;

use std::env;
use std::fs;
use models::GraphData;

fn main() {
    let args: Vec<String> = env::args().collect();
    let default_dir = env!("DEFAULT_SCAN_DIR");
    let target_dir = if args.len() > 1 { &args[1] } else { default_dir };

    println!("Scanning directory: {}", target_dir);

    let mut nodes = Vec::new();
    let mut links = Vec::new();

    let files = scanner::find_rust_files(target_dir);

    for file in files {
        parser::parse_rust_file(&file, &mut nodes, &mut links);
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
