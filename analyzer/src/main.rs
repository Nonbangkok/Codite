mod models;
mod parsers;
mod scanner;

use std::env;
use std::fs;

use models::GraphData;
use parsers::{LanguageParser, RustParser, all_extensions, parser_for_path};

fn main() {
    let args: Vec<String> = env::args().collect();
    let default_dir = env!("DEFAULT_SCAN_DIR");
    let target_dir = if args.len() > 1 { &args[1] } else { default_dir };

    println!("Scanning directory: {}", target_dir);

    let registry: Vec<Box<dyn LanguageParser>> = vec![Box::new(RustParser)];
    let extensions = all_extensions(&registry);

    let mut nodes = Vec::new();
    let mut links = Vec::new();

    let files = scanner::find_source_files(target_dir, &extensions);

    for file in files {
        if let Some(parser) = parser_for_path(&file, &registry) {
            parser.parse(&file, &mut nodes, &mut links);
        }
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
