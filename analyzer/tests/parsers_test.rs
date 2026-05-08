use std::path::PathBuf;

use analyzer::models::{Link, Node};
use analyzer::parsers::{LanguageParser, TypeScriptParser, JavaScriptParser};

fn fixture(rel: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(rel)
}

fn count_group(nodes: &[Node], group: &str) -> usize {
    nodes.iter().filter(|n| n.group == group).count()
}

#[test]
fn typescript_parser_extracts_all_constructs() {
    let parser = TypeScriptParser;
    let mut nodes: Vec<Node> = Vec::new();
    let mut links: Vec<Link> = Vec::new();

    parser.parse(&fixture("typescript/sample.ts"), &mut nodes, &mut links);

    // file node + 1 function + 1 class + 1 interface + 1 type alias + 1 enum + 2 imports + 1 method
    assert!(nodes.iter().all(|n| n.language == "typescript"));
    assert_eq!(count_group(&nodes, "functions"), 2, "expected greet() + User.greet()");
    assert_eq!(count_group(&nodes, "classes"), 1);
    assert_eq!(count_group(&nodes, "interfaces"), 1);
    assert_eq!(count_group(&nodes, "types"), 1);
    assert_eq!(count_group(&nodes, "enums"), 1);
    assert_eq!(count_group(&nodes, "imports"), 2);
}

#[test]
fn typescript_parser_resolves_relative_import_to_file_link() {
    let parser = TypeScriptParser;
    let mut nodes: Vec<Node> = Vec::new();
    let mut links: Vec<Link> = Vec::new();

    parser.parse(&fixture("typescript/sample.ts"), &mut nodes, &mut links);

    let imported_path = fixture("typescript/imported.ts").to_string_lossy().into_owned();
    let module_links: Vec<&Link> = links
        .iter()
        .filter(|l| l.link_type == "imports_module")
        .collect();

    assert!(
        module_links.iter().any(|l| l.target == imported_path),
        "expected an imports_module link to {}, got {:?}",
        imported_path,
        module_links
    );
}

#[test]
fn javascript_parser_extracts_constructs_and_tags_language() {
    let parser = JavaScriptParser;
    let mut nodes: Vec<Node> = Vec::new();
    let mut links: Vec<Link> = Vec::new();

    parser.parse(&fixture("javascript/sample.js"), &mut nodes, &mut links);

    assert!(nodes.iter().all(|n| n.language == "javascript"));
    assert_eq!(count_group(&nodes, "functions"), 2, "add() + increment() (constructor excluded)");
    assert_eq!(count_group(&nodes, "classes"), 1);
    assert_eq!(count_group(&nodes, "imports"), 1);
}
