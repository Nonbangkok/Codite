use std::fs;
use std::path::Path;
use tree_sitter::{Parser, Query, QueryCursor, StreamingIterator};

use crate::models::{Link, Node};
use crate::parsers::LanguageParser;

pub struct PythonParser;

impl LanguageParser for PythonParser {
    fn language_name(&self) -> &'static str {
        "python"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &[".py"]
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
            language: "python".to_string(),
            val: 20,
            code: source_code.clone(),
        });

        let Some(source_code) = source_code else { return };

        let language = tree_sitter_python::LANGUAGE.into();
        let mut parser = Parser::new();
        if parser.set_language(&language).is_err() {
            eprintln!("Failed to load Python grammar for {}", full_path);
            return;
        }

        let query_code = "
            (function_definition) @func
            (class_definition) @class
            (decorated_definition) @decorated
            (import_statement) @import
            (import_from_statement) @import_from
        ";

        let query = match Query::new(&language, query_code) {
            Ok(q) => q,
            Err(e) => {
                eprintln!("Error compiling Python query for {}: {}", full_path, e);
                return;
            }
        };

        let tree = match parser.parse(&source_code, None) {
            Some(t) => t,
            None => return,
        };

        let mut cursor = QueryCursor::new();
        let mut captures = cursor.captures(&query, tree.root_node(), source_code.as_bytes());

        while let Some((m, idx)) = captures.next() {
            {
                let capture = &m.captures[*idx];
                let node = capture.node;
                let full_content = &source_code[node.start_byte()..node.end_byte()];
                let capture_name = query.capture_names()[capture.index as usize];
                let start = node.start_byte();

                match capture_name {
                    "func" => {
                        // Skip methods inside classes (they'll be captured via class body)
                        if let Some(parent) = node.parent() {
                            let parent_kind = parent.kind();
                            if parent_kind == "block" {
                                if let Some(grandparent) = parent.parent() {
                                    if grandparent.kind() == "class_definition" {
                                        // This is a method — still emit as function but tag it
                                        let name = node
                                            .child_by_field_name("name")
                                            .map(|n| source_code[n.start_byte()..n.end_byte()].to_string())
                                            .unwrap_or_else(|| "<anonymous>".to_string());

                                        // Skip dunder methods except __init__
                                        if name.starts_with("__") && name.ends_with("__") && name != "__init__" {
                                            continue;
                                        }

                                        let id = format!("{}::method::{}::{}", full_path, name, start);
                                        nodes.push(Node {
                                            id: id.clone(),
                                            label: format!("{}()", name),
                                            group: "functions".to_string(),
                                            language: "python".to_string(),
                                            val: 8,
                                            code: Some(full_content.to_string()),
                                        });
                                        links.push(Link {
                                            source: full_path.clone(),
                                            target: id,
                                            link_type: "contains".to_string(),
                                        });
                                        continue;
                                    }
                                }
                            }
                        }

                        // Top-level or nested function
                        let name = node
                            .child_by_field_name("name")
                            .map(|n| source_code[n.start_byte()..n.end_byte()].to_string())
                            .unwrap_or_else(|| "<anonymous>".to_string());

                        let id = format!("{}::fn::{}::{}", full_path, name, start);
                        nodes.push(Node {
                            id: id.clone(),
                            label: format!("{}()", name),
                            group: "functions".to_string(),
                            language: "python".to_string(),
                            val: 8,
                            code: Some(full_content.to_string()),
                        });
                        links.push(Link {
                            source: full_path.clone(),
                            target: id,
                            link_type: "contains".to_string(),
                        });
                    }
                    "class" => {
                        if let Some(name_node) = node.child_by_field_name("name") {
                            let name = &source_code[name_node.start_byte()..name_node.end_byte()];
                            let id = format!("{}::class::{}::{}", full_path, name, start);
                            nodes.push(Node {
                                id: id.clone(),
                                label: name.to_string(),
                                group: "classes".to_string(),
                                language: "python".to_string(),
                                val: 12,
                                code: Some(full_content.to_string()),
                            });
                            links.push(Link {
                                source: full_path.clone(),
                                target: id,
                                link_type: "contains".to_string(),
                            });
                        }
                    }
                    "decorated" => {
                        // Decorated definitions wrap a function or class — skip to avoid
                        // double-counting (the inner func/class will be captured separately)
                    }
                    "import" | "import_from" => {
                        let id = format!("{}::import::{}", full_path, start);
                        nodes.push(Node {
                            id: id.clone(),
                            label: full_content.to_string(),
                            group: "imports".to_string(),
                            language: "python".to_string(),
                            val: 5,
                            code: Some(full_content.to_string()),
                        });
                        links.push(Link {
                            source: full_path.clone(),
                            target: id,
                            link_type: "imports".to_string(),
                        });
                    }
                    _ => {}
                }
            }
        }
    }
}
