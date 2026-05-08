use std::path::PathBuf;

use analyzer::models::{Link, Node};
use analyzer::parsers::{LanguageParser, TypeScriptParser};

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
