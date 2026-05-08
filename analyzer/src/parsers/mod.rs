pub mod rust;
pub use rust::RustParser;

pub mod typescript;
pub use typescript::TypeScriptParser;

pub mod javascript;
pub use javascript::JavaScriptParser;

pub mod python;
pub use python::PythonParser;

pub mod import_resolver;

use std::path::Path;

use crate::models::{Link, Node};

pub trait LanguageParser {
    fn language_name(&self) -> &'static str;
    fn extensions(&self) -> &'static [&'static str];
    fn parse(&self, path: &Path, nodes: &mut Vec<Node>, links: &mut Vec<Link>);
}

pub fn parser_for_path<'a>(
    path: &Path,
    parsers: &'a [Box<dyn LanguageParser>],
) -> Option<&'a dyn LanguageParser> {
    let ext = path.extension()?.to_str()?;
    let dot_ext = format!(".{}", ext);
    parsers
        .iter()
        .find(|p| p.extensions().iter().any(|e| *e == dot_ext))
        .map(|b| b.as_ref())
}

pub fn all_extensions(parsers: &[Box<dyn LanguageParser>]) -> Vec<&'static str> {
    parsers.iter().flat_map(|p| p.extensions().iter().copied()).collect()
}
