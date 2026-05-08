use std::fs;
use std::path::Path;
use tree_sitter::{Parser, Query, QueryCursor, StreamingIterator};

use crate::models::{Link, Node};

pub fn parse_rust_file(path: &Path, nodes: &mut Vec<Node>, links: &mut Vec<Link>) {
    let full_path = path.to_string_lossy().into_owned();
    let file_name = path.file_name().unwrap().to_string_lossy().into_owned();
    let group = path.parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "root".to_string());

    let source_code = fs::read_to_string(path).ok();

    // สร้างโหนดสำหรับไฟล์
    nodes.push(Node {
        id: full_path.clone(),
        label: file_name,
        group: group.clone(),
        language: "rust".to_string(),
        val: 20,
        code: source_code.clone(),
    });

    if let Some(source_code) = source_code {
        let mut parser = Parser::new();
        let language = tree_sitter_rust::LANGUAGE.into();
        parser.set_language(&language).expect("Error loading Rust grammar");

        let query_code = "
            (function_item) @func
            (struct_item) @struct
            (enum_item) @enum
            (trait_item) @trait
            (impl_item type: (type_identifier) @impl.name)
            (use_declaration) @use
            (mod_item name: (identifier) @mod)
        ";
        let query = Query::new(&language, query_code).expect("Error creating query");

        let tree = parser.parse(&source_code, None).unwrap();
        let mut cursor = QueryCursor::new();
        let mut captures = cursor.captures(&query, tree.root_node(), source_code.as_bytes());

        while let Some((m, _)) = captures.next() {
            for capture in m.captures {
                let node = capture.node;
                let full_content = &source_code[node.start_byte()..node.end_byte()];
                let capture_name = query.capture_names()[capture.index as usize];

                match capture_name {
                    "mod" => {
                        let name = &source_code[node.start_byte()..node.end_byte()];
                        if let Some(parent_dir) = path.parent() {
                            let target_1 = parent_dir.join(format!("{}.rs", name));
                            let target_2 = parent_dir.join(name).join("mod.rs");
                            
                            if target_1.exists() {
                                links.push(Link {
                                    source: full_path.clone(),
                                    target: target_1.to_string_lossy().into_owned(),
                                    link_type: "declares_module".to_string(),
                                });
                            } else if target_2.exists() {
                                links.push(Link {
                                    source: full_path.clone(),
                                    target: target_2.to_string_lossy().into_owned(),
                                    link_type: "declares_module".to_string(),
                                });
                            }
                        }
                    },
                    "func" => {
                        if let Some(name_node) = node.child_by_field_name("name") {
                            let name = &source_code[name_node.start_byte()..name_node.end_byte()];
                            let id = format!("{}::fn::{}::{}", full_path, name, node.start_byte());
                            nodes.push(Node {
                                id: id.clone(),
                                label: format!("{}()", name),
                                group: "functions".to_string(),
                                language: "rust".to_string(),
                                val: 8,
                                code: Some(full_content.to_string()),
                            });
                            links.push(Link {
                                source: full_path.clone(),
                                target: id,
                                link_type: "contains".to_string(),
                            });
                        }
                    },
                    "struct" => {
                        if let Some(name_node) = node.child_by_field_name("name") {
                            let name = &source_code[name_node.start_byte()..name_node.end_byte()];
                            let id = format!("{}::struct::{}", full_path, name);
                            nodes.push(Node {
                                id: id.clone(),
                                label: name.to_string(),
                                group: "structs".to_string(),
                                language: "rust".to_string(),
                                val: 12,
                                code: Some(full_content.to_string()),
                            });
                            links.push(Link {
                                source: full_path.clone(),
                                target: id,
                                link_type: "contains".to_string(),
                            });
                        }
                    },
                    "enum" => {
                        if let Some(name_node) = node.child_by_field_name("name") {
                            let name = &source_code[name_node.start_byte()..name_node.end_byte()];
                            let id = format!("{}::enum::{}::{}", full_path, name, node.start_byte());
                            nodes.push(Node {
                                id: id.clone(),
                                label: name.to_string(),
                                group: "enums".to_string(),
                                language: "rust".to_string(),
                                val: 10,
                                code: Some(full_content.to_string()),
                            });
                            links.push(Link {
                                source: full_path.clone(),
                                target: id,
                                link_type: "contains".to_string(),
                            });
                        }
                    },
                    "trait" => {
                        if let Some(name_node) = node.child_by_field_name("name") {
                            let name = &source_code[name_node.start_byte()..name_node.end_byte()];
                            let id = format!("{}::trait::{}::{}", full_path, name, node.start_byte());
                            nodes.push(Node {
                                id: id.clone(),
                                label: name.to_string(),
                                group: "traits".to_string(),
                                language: "rust".to_string(),
                                val: 14,
                                code: Some(full_content.to_string()),
                            });
                            links.push(Link {
                                source: full_path.clone(),
                                target: id,
                                link_type: "contains".to_string(),
                            });
                        }
                    },
                    "impl.name" => {
                        let struct_id = format!("{}::struct::{}", full_path, full_content);
                        links.push(Link {
                            source: full_path.clone(),
                            target: struct_id,
                            link_type: "implements".to_string(),
                        });
                    },
                    "use" => {
                        if !full_content.contains("std::") &&
                           !full_content.contains("serde") &&
                           !full_content.contains("tree_sitter") &&
                           !full_content.contains("walkdir") {
                            let id = format!("{}::use::{}", full_path, full_content);
                            nodes.push(Node {
                                id: id.clone(),
                                label: full_content.replace("use ", "").replace(";", ""),
                                group: "imports".to_string(),
                                language: "rust".to_string(),
                                val: 5,
                                code: Some(full_content.to_string()),
                            });
                            links.push(Link {
                                source: full_path.clone(),
                                target: id,
                                link_type: "imports".to_string(),
                            });
                        }
                    },
                    _ => {}
                }
            }
        }

    }
}
