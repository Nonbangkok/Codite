use std::fs;
use std::path::Path;
use tree_sitter::{Parser, Query, QueryCursor, StreamingIterator};

use crate::models::{Link, Node};
use crate::parsers::LanguageParser;

pub struct TypeScriptParser;

impl LanguageParser for TypeScriptParser {
    fn language_name(&self) -> &'static str {
        "typescript"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &[".ts", ".tsx"]
    }

    fn parse(&self, path: &Path, nodes: &mut Vec<Node>, links: &mut Vec<Link>) {
        let full_path = path.to_string_lossy().into_owned();
        let file_name = path.file_name().unwrap().to_string_lossy().into_owned();
        let group = path
            .parent()
            .and_then(|p| p.file_name())
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "root".to_string());

        let source_code = fs::read_to_string(path).ok();

        nodes.push(Node {
            id: full_path.clone(),
            label: file_name,
            group: group.clone(),
            language: "typescript".to_string(),
            val: 20,
            code: source_code.clone(),
        });

        let Some(source_code) = source_code else { return };

        let is_tsx = path.extension().and_then(|e| e.to_str()) == Some("tsx");
        let language = if is_tsx {
            tree_sitter_typescript::LANGUAGE_TSX.into()
        } else {
            tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()
        };

        let mut parser = Parser::new();
        if parser.set_language(&language).is_err() {
            eprintln!("Failed to load TypeScript grammar for {}", full_path);
            return;
        }

        // Captures filled in by Task 7
        let query_code = "
            (function_declaration) @func
            (class_declaration) @class
            (interface_declaration) @interface
            (type_alias_declaration) @type
            (enum_declaration) @enum
            (method_definition) @method
            (import_statement) @import
        ";

        let query = match Query::new(&language, query_code) {
            Ok(q) => q,
            Err(e) => {
                eprintln!("Error compiling TS query for {}: {}", full_path, e);
                return;
            }
        };

        let tree = match parser.parse(&source_code, None) {
            Some(t) => t,
            None => return,
        };

        let mut cursor = QueryCursor::new();
        let mut captures = cursor.captures(&query, tree.root_node(), source_code.as_bytes());

        // Capture handling implemented in Task 7. Variables held to suppress warnings.
        let _ = (&mut captures, &full_path, &group, nodes, links);
    }
}
