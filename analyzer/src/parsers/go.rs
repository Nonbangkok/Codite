use std::path::Path;
use crate::models::{Link, Node};
use crate::parsers::LanguageParser;

pub struct GoParser;

impl LanguageParser for GoParser {
    fn language_name(&self) -> &'static str {
        "go"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &[".go"]
    }

    fn parse(&self, _path: &Path, _nodes: &mut Vec<Node>, _links: &mut Vec<Link>) {
        // Stub implementation
    }
}
