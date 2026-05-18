use std::fs;
use std::path::Path;
use tree_sitter::{Parser, Query, QueryCursor, StreamingIterator};

use crate::models::{Link, Node};
use crate::parsers::LanguageParser;
use crate::parsers::import_resolver;

pub struct GoParser;

impl LanguageParser for GoParser {
    fn language_name(&self) -> &'static str {
        "go"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &[".go"]
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
            language: "go".to_string(),
            val: 20,
            code: source_code.clone(),
        });

        if let Some(source_code) = source_code {
            let mut parser = Parser::new();
            let language = tree_sitter_go::LANGUAGE.into();
            parser.set_language(&language).expect("Error loading Go grammar");

            let query_code = "
                (function_declaration) @func
                (method_declaration) @method
                (type_spec name: (type_identifier) @struct.name type: (struct_type)) @struct
                (type_spec name: (type_identifier) @interface.name type: (interface_type)) @interface
                (type_spec name: (type_identifier) @type.name) @type
                (import_spec) @import
            ";
            let query = Query::new(&language, query_code).expect("Error creating query");

            let tree = parser.parse(&source_code, None).unwrap();
            let mut cursor = QueryCursor::new();
            let mut captures = cursor.captures(&query, tree.root_node(), source_code.as_bytes());

            while let Some((m, idx)) = captures.next() {
                let capture = &m.captures[*idx];
                let node = capture.node;
                let full_content = &source_code[node.start_byte()..node.end_byte()];
                let capture_name = query.capture_names()[capture.index as usize];

                match capture_name {
                        "func" => {
                            if let Some(name_node) = node.child_by_field_name("name") {
                                let name = &source_code[name_node.start_byte()..name_node.end_byte()];
                                let id = format!("{}::fn::{}::{}", full_path, name, node.start_byte());
                                nodes.push(Node {
                                    id: id.clone(),
                                    label: format!("{}()", name),
                                    group: "functions".to_string(),
                                    language: "go".to_string(),
                                    val: 8,
                                    code: Some(full_content.to_string()),
                                });
                                links.push(Link {
                                    source: full_path.clone(),
                                    target: id,
                                    link_type: "contains".to_string(),
                                });
                            }
                        }
                        "method" => {
                            if let Some(name_node) = node.child_by_field_name("name") {
                                let name = &source_code[name_node.start_byte()..name_node.end_byte()];
                                let receiver = node.child_by_field_name("receiver")
                                    .map(|r_node| &source_code[r_node.start_byte()..r_node.end_byte()])
                                    .unwrap_or("");

                                let label = if !receiver.is_empty() {
                                    format!("{}::{}()", receiver.trim_matches(|c| c == '(' || c == ')'), name)
                                } else {
                                    format!("{}()", name)
                                };

                                let id = format!("{}::method::{}::{}", full_path, name, node.start_byte());
                                nodes.push(Node {
                                    id: id.clone(),
                                    label,
                                    group: "functions".to_string(),
                                    language: "go".to_string(),
                                    val: 8,
                                    code: Some(full_content.to_string()),
                                });
                                links.push(Link {
                                    source: full_path.clone(),
                                    target: id,
                                    link_type: "contains".to_string(),
                                });
                            }
                        }
                        "struct" => {
                            if let Some(name_node) = node.child_by_field_name("name") {
                                let name = &source_code[name_node.start_byte()..name_node.end_byte()];
                                let id = format!("{}::struct::{}", full_path, name);
                                nodes.push(Node {
                                    id: id.clone(),
                                    label: name.to_string(),
                                    group: "structs".to_string(),
                                    language: "go".to_string(),
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
                                let id = format!("{}::interface::{}", full_path, name);
                                nodes.push(Node {
                                    id: id.clone(),
                                    label: name.to_string(),
                                    group: "interfaces".to_string(),
                                    language: "go".to_string(),
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
                                let id = format!("{}::type::{}", full_path, name);

                                let mut is_special = false;
                                if let Some(type_node) = node.child_by_field_name("type") {
                                    let kind = type_node.kind();
                                    if kind == "struct_type" || kind == "interface_type" {
                                        is_special = true;
                                    }
                                }

                                if !is_special {
                                    nodes.push(Node {
                                        id: id.clone(),
                                        label: name.to_string(),
                                        group: "types".to_string(),
                                        language: "go".to_string(),
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
                        }
                        "import" => {
                            if let Some(path_node) = node.child_by_field_name("path") {
                                let specifier = &source_code[path_node.start_byte()..path_node.end_byte()];
                                let clean_spec = specifier.trim_matches('"');

                                let is_std = !clean_spec.contains('/') || clean_spec.starts_with("std/");
                                let is_external = clean_spec.starts_with("github.com")
                                    || clean_spec.starts_with("golang.org")
                                    || clean_spec.starts_with("gopkg.in")
                                    || clean_spec.starts_with("google.golang.org");

                                if !is_std && !is_external {
                                    let id = format!("{}::import::{}", full_path, path_node.start_byte());
                                    nodes.push(Node {
                                        id: id.clone(),
                                        label: clean_spec.to_string(),
                                        group: "imports".to_string(),
                                        language: "go".to_string(),
                                        val: 5,
                                        code: Some(full_content.to_string()),
                                    });
                                    links.push(Link {
                                        source: full_path.clone(),
                                        target: id,
                                        link_type: "imports".to_string(),
                                    });

                                    if clean_spec.starts_with("./") || clean_spec.starts_with("../") {
                                        if let Some(resolved) = import_resolver::resolve_relative(path, clean_spec) {
                                            links.push(Link {
                                                source: full_path.clone(),
                                                target: resolved.to_string_lossy().into_owned(),
                                                link_type: "imports_module".to_string(),
                                            });
                                        }
                                    } else {
                                        let path_parts: Vec<&str> = clean_spec.split('/').collect();
                                        if !path_parts.is_empty() {
                                            let module_root_name = path_parts[0];
                                            let mut current = path.parent();
                                            while let Some(curr) = current {
                                                if curr.file_name().map(|n| n.to_string_lossy()) == Some(module_root_name.into()) {
                                                    let sub_path: String = path_parts[1..].join("/");
                                                    let target_dir = curr.join(sub_path);
                                                    if target_dir.exists() {
                                                        links.push(Link {
                                                            source: full_path.clone(),
                                                            target: target_dir.to_string_lossy().into_owned(),
                                                            link_type: "imports_module".to_string(),
                                                        });
                                                    }
                                                    break;
                                                }
                                                current = curr.parent();
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
            }
        }
    }
}
