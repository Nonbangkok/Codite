use std::path::Path;
use crate::models::{Link, Node};
use crate::parsers::LanguageParser;

pub struct CppParser;

impl LanguageParser for CppParser {
    fn language_name(&self) -> &'static str {
        "cpp"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &[".cpp", ".hpp", ".cc", ".cxx", ".hxx"]
    }

    fn parse(&self, _path: &Path, _nodes: &mut Vec<Node>, _links: &mut Vec<Link>) {
        // Stub implementation
    }
}
