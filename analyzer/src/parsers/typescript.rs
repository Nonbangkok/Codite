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

        while let Some((m, _)) = captures.next() {
            for capture in m.captures {
                let node = capture.node;
                let full_content = &source_code[node.start_byte()..node.end_byte()];
                let capture_name = query.capture_names()[capture.index as usize];
                let start = node.start_byte();

                match capture_name {
                    "func" | "method" => {
                        let name = node
                            .child_by_field_name("name")
                            .map(|n| source_code[n.start_byte()..n.end_byte()].to_string())
                            .unwrap_or_else(|| "default".to_string());
                        if capture_name == "method" && name == "constructor" {
                            continue;
                        }
                        let id = format!("{}::fn::{}::{}", full_path, name, start);
                        nodes.push(Node {
                            id: id.clone(),
                            label: format!("{}()", name),
                            group: "functions".to_string(),
                            language: "typescript".to_string(),
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
                                language: "typescript".to_string(),
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
                    "interface" => {
                        if let Some(name_node) = node.child_by_field_name("name") {
                            let name = &source_code[name_node.start_byte()..name_node.end_byte()];
                            let id = format!("{}::interface::{}::{}", full_path, name, start);
                            nodes.push(Node {
                                id: id.clone(),
                                label: name.to_string(),
                                group: "interfaces".to_string(),
                                language: "typescript".to_string(),
                                val: 14,
                                code: Some(full_content.to_string()),
                            });
                            links.push(Link {
                                source: full_path.clone(),
                                target: id,
                                link_type: "contains".to_string(),
                            });
                        }
                    }
                    "type" => {
                        if let Some(name_node) = node.child_by_field_name("name") {
                            let name = &source_code[name_node.start_byte()..name_node.end_byte()];
                            let id = format!("{}::type::{}::{}", full_path, name, start);
                            nodes.push(Node {
                                id: id.clone(),
                                label: name.to_string(),
                                group: "types".to_string(),
                                language: "typescript".to_string(),
                                val: 10,
                                code: Some(full_content.to_string()),
                            });
                            links.push(Link {
                                source: full_path.clone(),
                                target: id,
                                link_type: "contains".to_string(),
                            });
                        }
                    }
                    "enum" => {
                        if let Some(name_node) = node.child_by_field_name("name") {
                            let name = &source_code[name_node.start_byte()..name_node.end_byte()];
                            let id = format!("{}::enum::{}::{}", full_path, name, start);
                            nodes.push(Node {
                                id: id.clone(),
                                label: name.to_string(),
                                group: "enums".to_string(),
                                language: "typescript".to_string(),
                                val: 10,
                                code: Some(full_content.to_string()),
                            });
                            links.push(Link {
                                source: full_path.clone(),
                                target: id,
                                link_type: "contains".to_string(),
                            });
                        }
                    }
                    "import" => {
                        let id = format!("{}::import::{}", full_path, start);
                        nodes.push(Node {
                            id: id.clone(),
                            label: full_content.to_string(),
                            group: "imports".to_string(),
                            language: "typescript".to_string(),
                            val: 5,
                            code: Some(full_content.to_string()),
                        });
                        links.push(Link {
                            source: full_path.clone(),
                            target: id.clone(),
                            link_type: "imports".to_string(),
                        });

                        if let Some(spec) = crate::parsers::import_resolver::extract_specifier(full_content) {
                            if let Some(resolved) = crate::parsers::import_resolver::resolve_relative(path, &spec) {
                                links.push(Link {
                                    source: full_path.clone(),
                                    target: resolved.to_string_lossy().into_owned(),
                                    link_type: "imports_module".to_string(),
                                });
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }
}
