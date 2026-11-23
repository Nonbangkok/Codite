use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use analyzer::enrich::build_output;
use analyzer::models::{Link, Node};
use analyzer::parsers::{
    CParser, CppParser, GoParser, JavaScriptParser, LanguageParser, PythonParser, RustParser,
    TypeScriptParser, all_extensions, parser_for_path,
};
use analyzer::scanner;
use indicatif::{ProgressBar, ProgressStyle};
use rayon::prelude::*;

const USAGE: &str = "Usage: analyzer [TARGET_DIR] [OUTPUT_JSON] [--inline-code]

Scans TARGET_DIR (default from Cargo.toml metadata) and writes the graph to OUTPUT_JSON
(default ../ui/public/data.json when it exists, else ./data.json).

By default source code is written to a separate file next to the graph
(data.json -> data.code.json) so the graph loads fast; --inline-code keeps it inline.";

struct Args {
    target: String,
    output: Option<String>,
    split_code: bool,
}

fn parse_args() -> Result<Args, String> {
    let mut positional = Vec::new();
    let mut split_code = true;
    for arg in env::args().skip(1) {
        match arg.as_str() {
            "--inline-code" => split_code = false,
            "-h" | "--help" => return Err(USAGE.to_string()),
            flag if flag.starts_with("--") => {
                return Err(format!("Unknown option {flag}\n\n{USAGE}"));
            }
            _ => positional.push(arg),
        }
    }
    if positional.len() > 2 {
        return Err(USAGE.to_string());
    }
    let mut it = positional.into_iter();
    Ok(Args {
        target: it
            .next()
            .unwrap_or_else(|| env!("DEFAULT_SCAN_DIR").to_string()),
        output: it.next(),
        split_code,
    })
}

/// `data.json` -> `data.code.json`
fn code_path_for(output: &Path) -> PathBuf {
    let stem = output
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "data".into());
    output.with_file_name(format!("{stem}.code.json"))
}

fn run() -> Result<(), String> {
    let args = parse_args()?;

    let canonical = fs::canonicalize(&args.target)
        .map_err(|e| format!("Cannot open target directory {}: {e}", args.target))?;
    let root_name = canonical
        .file_name()
        .ok_or("Target directory has no name")?
        .to_string_lossy()
        .into_owned();
    let parent = canonical.parent().ok_or("Target directory has no parent")?;

    let output_raw = args.output.unwrap_or_else(|| {
        if Path::new("../ui/public").exists() {
            "../ui/public/data.json".into()
        } else {
            "data.json".into()
        }
    });
    let output = if Path::new(&output_raw).is_absolute() {
        PathBuf::from(output_raw)
    } else {
        env::current_dir()
            .map_err(|e| e.to_string())?
            .join(output_raw)
    };

    println!("Target project: {root_name}");
    println!("Output: {}", output.display());

    // IDs are rooted at the project folder name, so scan from its parent.
    env::set_current_dir(parent).map_err(|e| format!("Cannot enter {}: {e}", parent.display()))?;

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
    let files = scanner::find_source_files(&root_name, &extensions);

    let pb = ProgressBar::new(files.len() as u64);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} ({percent}%) {msg}")
            .map_err(|e| e.to_string())?
            .progress_chars("#>-"),
    );

    // Parse files in parallel; each file produces its own nodes and links.
    let results: Vec<(Vec<Node>, Vec<Link>)> = files
        .par_iter()
        .map(|file| {
            let mut nodes = Vec::new();
            let mut links = Vec::new();
            if let Some(parser) = parser_for_path(file, &registry) {
                parser.parse(file, &mut nodes, &mut links);
            }
            pb.inc(1);
            (nodes, links)
        })
        .collect();
    pb.finish_with_message("parsed");

    let (mut nodes, mut links) = (Vec::new(), Vec::new());
    for (n, l) in results {
        nodes.extend(n);
        links.extend(l);
    }

    let (mut graph, code) = build_output(nodes, links, args.split_code);
    let calls = graph
        .links
        .iter()
        .filter(|l| l.link_type == "calls")
        .count();

    if let Some(code) = code {
        let code_path = code_path_for(&output);
        let json = serde_json::to_string(&code).map_err(|e| e.to_string())?;
        fs::write(&code_path, json)
            .map_err(|e| format!("Cannot write {}: {e}", code_path.display()))?;
        graph.code_file = code_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned());
    }
    let json = serde_json::to_string(&graph).map_err(|e| e.to_string())?;
    fs::write(&output, json).map_err(|e| format!("Cannot write {}: {e}", output.display()))?;

    println!(
        "Saved {} nodes, {} links ({calls} calls) from {} files to {}",
        graph.nodes.len(),
        graph.links.len(),
        files.len(),
        output.display()
    );
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}
