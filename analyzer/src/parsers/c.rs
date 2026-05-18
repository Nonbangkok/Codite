use std::path::Path;
use crate::models::{Link, Node};
use crate::parsers::LanguageParser;

pub struct CParser;

impl LanguageParser for CParser {
    fn language_name(&self) -> &'static str {
        "c"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &[".c", ".h"]
    }

    fn parse(&self, _path: &Path, _nodes: &mut Vec<Node>, _links: &mut Vec<Link>) {
        // Stub implementation
    }
}
