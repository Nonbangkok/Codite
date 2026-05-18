use std::fs;
use std::path::Path;
use tree_sitter::{Parser, Query, QueryCursor, StreamingIterator};

use crate::models::{Link, Node};
use crate::parsers::LanguageParser;
use crate::parsers::import_resolver;

pub struct CParser;

fn find_declarator_identifier(node: tree_sitter::Node, source_code: &str) -> Option<String> {
    let kind = node.kind();
    if kind == "identifier" || kind == "field_identifier" {
        return Some(source_code[node.start_byte()..node.end_byte()].to_string());
    }
    if let Some(child) = node.child_by_field_name("declarator") {
        return find_declarator_identifier(child, source_code);
    }
    for i in 0..node.child_count() {
        if let Some(child) = node.child(i as u32) {
            if let Some(name) = find_declarator_identifier(child, source_code) {
                return Some(name);
            }
        }
    }
    None
}

impl LanguageParser for CParser {
    fn language_name(&self) -> &'static str {
        "c"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &[".c", ".h"]
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
            language: "c".to_string(),
            val: 20,
            code: source_code.clone(),
        });

        if let Some(source_code) = source_code {
            let mut parser = Parser::new();
            let language = tree_sitter_c::LANGUAGE.into();
            parser.set_language(&language).expect("Error loading C grammar");

            let query_code = "
                (function_definition) @func
                (struct_specifier name: (type_identifier) @struct.name) @struct
                (type_definition declarator: (type_identifier) @typedef.name) @typedef
                (preproc_include) @include
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
                        if let Some(declarator_node) = node.child_by_field_name("declarator") {
                            if let Some(name) = find_declarator_identifier(declarator_node, &source_code) {
                                let id = format!("{}::fn::{}::{}", full_path, name, node.start_byte());
                                nodes.push(Node {
                                    id: id.clone(),
                                    label: format!("{}()", name),
                                    group: "functions".to_string(),
                                    language: "c".to_string(),
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
                    }
                    "struct" => {
                        if let Some(name_node) = node.child_by_field_name("name") {
                            let name = &source_code[name_node.start_byte()..name_node.end_byte()];
                            let id = format!("{}::struct::{}", full_path, name);
                            nodes.push(Node {
                                id: id.clone(),
                                label: name.to_string(),
                                group: "structs".to_string(),
                                language: "c".to_string(),
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
                    "typedef" => {
                        if let Some(decl_node) = node.child_by_field_name("declarator") {
                            let name = &source_code[decl_node.start_byte()..decl_node.end_byte()];
                            let id = format!("{}::type::{}", full_path, name);
                            nodes.push(Node {
                                id: id.clone(),
                                label: name.to_string(),
                                group: "types".to_string(),
                                language: "c".to_string(),
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
                    "include" => {
                        if let Some(path_node) = node.child_by_field_name("path") {
                            let specifier = &source_code[path_node.start_byte()..path_node.end_byte()];
                            if specifier.starts_with('"') && specifier.ends_with('"') {
                                let clean_spec = specifier.trim_matches('"');
                                let id = format!("{}::import::{}", full_path, path_node.start_byte());
                                nodes.push(Node {
                                    id: id.clone(),
                                    label: clean_spec.to_string(),
                                    group: "imports".to_string(),
                                    language: "c".to_string(),
                                    val: 5,
                                    code: Some(full_content.to_string()),
                                });
                                links.push(Link {
                                    source: full_path.clone(),
                                    target: id,
                                    link_type: "imports".to_string(),
                                });

                                let rel_spec = if !clean_spec.starts_with("./") && !clean_spec.starts_with("../") {
                                    format!("./{}", clean_spec)
                                } else {
                                    clean_spec.to_string()
                                };

                                if let Some(resolved) = import_resolver::resolve_relative(path, &rel_spec) {
                                    if let Ok(canonical) = std::fs::canonicalize(resolved) {
                                        links.push(Link {
                                            source: full_path.clone(),
                                            target: canonical.to_string_lossy().into_owned(),
                                            link_type: "imports_module".to_string(),
                                        });
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
