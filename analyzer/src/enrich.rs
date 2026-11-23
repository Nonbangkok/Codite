//! Post-processing that every language gets for free: line ranges, an explicit `kind`,
//! call edges and the split-out source code. Runs on the parsers' output, so parsers stay simple.

use std::collections::{HashMap, HashSet};

use serde::Serialize;
use tree_sitter::{Language, Node as TsNode, Parser};

use crate::models::{Link, Node};

/// A node as written to the graph JSON.
#[derive(Serialize, Debug, Clone)]
pub struct OutputNode {
    pub id: String,
    pub label: String,
    pub group: String,
    pub language: String,
    pub val: usize,
    /// file, function, class, struct, interface, trait, enum, type or import.
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct OutputGraph {
    pub nodes: Vec<OutputNode>,
    pub links: Vec<Link>,
    /// When source is split out: the code file's name, next to the graph file.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code_file: Option<String>,
}

pub fn is_symbol(id: &str) -> bool {
    id.contains("::")
}

fn file_of(id: &str) -> &str {
    id.split("::").next().unwrap_or(id)
}

/// Singular kind derived from the parser's plural `group`.
pub fn kind_of(node: &Node) -> String {
    if !is_symbol(&node.id) {
        return "file".to_string();
    }
    match node.group.as_str() {
        "functions" => "function",
        "classes" => "class",
        "structs" => "struct",
        "interfaces" => "interface",
        "traits" => "trait",
        "enums" => "enum",
        "types" => "type",
        "imports" => "import",
        other => other,
    }
    .to_string()
}

/// Byte offsets where each line starts.
fn line_starts(text: &str) -> Vec<usize> {
    std::iter::once(0)
        .chain(text.match_indices('\n').map(|(i, _)| i + 1))
        .collect()
}

fn line_at(starts: &[usize], offset: usize) -> usize {
    match starts.binary_search(&offset) {
        Ok(i) => i + 1,
        Err(i) => i,
    }
}

/// 1-based inclusive line range of every node: files span their whole text; symbols are
/// located by the byte offset at the end of their id, or by searching for their code.
pub fn line_ranges(nodes: &[Node]) -> HashMap<String, (usize, usize)> {
    let files: HashMap<&str, &str> = nodes
        .iter()
        .filter(|n| !is_symbol(&n.id))
        .filter_map(|n| n.code.as_deref().map(|c| (n.id.as_str(), c)))
        .collect();
    let starts: HashMap<&str, Vec<usize>> = files
        .iter()
        .map(|(id, code)| (*id, line_starts(code)))
        .collect();

    let mut out = HashMap::new();
    for node in nodes {
        let Some(code) = node.code.as_deref() else {
            continue;
        };
        if !is_symbol(&node.id) {
            out.insert(node.id.clone(), (1, line_starts(code).len()));
            continue;
        }
        let file = file_of(&node.id);
        let (Some(text), Some(st)) = (files.get(file), starts.get(file)) else {
            continue;
        };
        let hinted = node
            .id
            .rsplit("::")
            .next()
            .and_then(|s| s.parse::<usize>().ok())
            .filter(|&o| text.get(o..).is_some_and(|rest| rest.starts_with(code)));
        let Some(offset) = hinted.or_else(|| text.find(code)) else {
            continue;
        };
        // Ignore trailing whitespace (some captures include the newline after them).
        let end = offset + code.trim_end().len().saturating_sub(1);
        out.insert(node.id.clone(), (line_at(st, offset), line_at(st, end)));
    }
    out
}

fn grammar(language: &str, file: &str) -> Option<Language> {
    Some(match language {
        "typescript" if file.ends_with(".tsx") => tree_sitter_typescript::LANGUAGE_TSX.into(),
        "typescript" => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
        "javascript" => tree_sitter_javascript::LANGUAGE.into(),
        "python" => tree_sitter_python::LANGUAGE.into(),
        "rust" => tree_sitter_rust::LANGUAGE.into(),
        "go" => tree_sitter_go::LANGUAGE.into(),
        "c" => tree_sitter_c::LANGUAGE.into(),
        "cpp" => tree_sitter_cpp::LANGUAGE.into(),
        _ => return None,
    })
}

/// A call found in source. `method` marks receiver calls (`obj.foo()`), which are weaker
/// evidence: `map.get()` must not resolve to some unrelated function named `get`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Call {
    pub line: usize,
    pub name: String,
    pub method: bool,
}

/// The called name: `foo()`, `obj.foo()`, `pkg.Foo()`, `Type::foo()` and `foo::<T>()` all give `foo`.
fn callee_name(node: TsNode, src: &str) -> Option<(String, bool)> {
    let text = |n: TsNode| src.get(n.start_byte()..n.end_byte()).map(str::to_string);
    let field = |name: &str| {
        node.child_by_field_name(name)
            .and_then(text)
            .map(|t| (t, true))
    };
    match node.kind() {
        "identifier" | "field_identifier" | "property_identifier" | "type_identifier" => {
            text(node).map(|t| (t, false))
        }
        "member_expression" => field("property"),
        "field_expression" | "selector_expression" => field("field"),
        "attribute" => field("attribute"),
        "scoped_identifier" | "qualified_identifier" => node
            .child_by_field_name("name")
            .and_then(|n| callee_name(n, src)),
        "generic_function" | "template_function" => node
            .child_by_field_name("function")
            .or_else(|| node.child_by_field_name("name"))
            .and_then(|n| callee_name(n, src)),
        _ => None,
    }
}

/// Languages whose functions call each other directly.
fn family(language: &str) -> &str {
    match language {
        "typescript" | "javascript" => "js",
        "c" | "cpp" => "c",
        other => other,
    }
}

/// Every call in a source file.
pub fn find_calls(language: &str, file: &str, code: &str) -> Vec<Call> {
    let Some(lang) = grammar(language, file) else {
        return Vec::new();
    };
    let mut parser = Parser::new();
    if parser.set_language(&lang).is_err() {
        return Vec::new();
    }
    let Some(tree) = parser.parse(code, None) else {
        return Vec::new();
    };
    let mut calls = Vec::new();
    let mut stack = vec![tree.root_node()];
    while let Some(node) = stack.pop() {
        if matches!(node.kind(), "call_expression" | "call")
            && let Some((name, method)) = node
                .child_by_field_name("function")
                .and_then(|f| callee_name(f, code))
        {
            calls.push(Call {
                line: node.start_position().row + 1,
                name,
                method,
            });
        }
        let mut cursor = node.walk();
        for child in node.named_children(&mut cursor) {
            stack.push(child);
        }
    }
    calls
}

/// `calls` links from the innermost enclosing function (or the file) to the called function.
/// A name resolves to a function in the same file, else in a file this one imports, else (for
/// plain calls only) to the only function with that name in the same language family.
/// Ambiguous names are skipped rather than guessed.
pub fn call_links(
    nodes: &[Node],
    links: &[Link],
    ranges: &HashMap<String, (usize, usize)>,
) -> Vec<Link> {
    let functions: Vec<&Node> = nodes.iter().filter(|n| n.group == "functions").collect();
    let mut by_name: HashMap<String, Vec<&Node>> = HashMap::new();
    for f in &functions {
        by_name
            .entry(f.label.trim_end_matches("()").to_string())
            .or_default()
            .push(f);
    }
    let mut imports: HashMap<&str, HashSet<&str>> = HashMap::new();
    for l in links.iter().filter(|l| l.link_type == "imports_module") {
        imports
            .entry(l.source.as_str())
            .or_default()
            .insert(l.target.as_str());
    }
    let mut in_file: HashMap<&str, Vec<(&str, usize, usize)>> = HashMap::new();
    for f in &functions {
        if let Some(&(s, e)) = ranges.get(&f.id) {
            in_file
                .entry(file_of(&f.id))
                .or_default()
                .push((&f.id, s, e));
        }
    }

    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for file in nodes.iter().filter(|n| !is_symbol(&n.id)) {
        let Some(code) = file.code.as_deref() else {
            continue;
        };
        let scopes = in_file.get(file.id.as_str());
        let lang = family(&file.language);
        let imported_files = imports.get(file.id.as_str());
        for Call { line, name, method } in find_calls(&file.language, &file.id, code) {
            let Some(all) = by_name.get(&name) else {
                continue;
            };
            let candidates: Vec<&str> = all
                .iter()
                .filter(|c| family(&c.language) == lang)
                .map(|c| c.id.as_str())
                .collect();
            let caller = scopes
                .and_then(|s| {
                    s.iter()
                        .filter(|(_, a, b)| *a <= line && line <= *b)
                        .min_by_key(|(_, a, b)| b - a)
                })
                .map(|(id, _, _)| *id)
                .unwrap_or(file.id.as_str());
            let same_file: Vec<&str> = candidates
                .iter()
                .copied()
                .filter(|c| file_of(c) == file.id)
                .collect();
            let imported: Vec<&str> = candidates
                .iter()
                .copied()
                .filter(|c| imported_files.is_some_and(|set| set.contains(file_of(c))))
                .collect();
            let target = match (
                same_file.as_slice(),
                imported.as_slice(),
                candidates.as_slice(),
            ) {
                ([one], _, _) => *one,
                ([], [one], _) => *one,
                ([], [], [one]) if !method => *one,
                _ => continue,
            };
            if target == caller || !seen.insert((caller.to_string(), target.to_string())) {
                continue;
            }
            out.push(Link {
                source: caller.to_string(),
                target: target.to_string(),
                link_type: "calls".to_string(),
            });
        }
    }
    out
}

/// Builds the output graph. With `split_code`, source is removed from nodes and returned as a
/// map of file id → code (symbols are recovered from their file by line range).
/// Parsers can emit the same id twice (a C forward declaration and its definition, two local Go
/// types with one name). Duplicate ids break graph layouts — links attach to one copy and the
/// other drifts loose — so keep one node per id (the one with the most code) and one copy of
/// each identical link.
pub fn dedupe(nodes: Vec<Node>, links: Vec<Link>) -> (Vec<Node>, Vec<Link>) {
    let mut best: HashMap<String, usize> = HashMap::new();
    for (i, n) in nodes.iter().enumerate() {
        let len = n.code.as_ref().map_or(0, String::len);
        match best.get(&n.id) {
            Some(&j) if nodes[j].code.as_ref().map_or(0, String::len) >= len => {}
            _ => {
                best.insert(n.id.clone(), i);
            }
        }
    }
    let keep: HashSet<usize> = best.into_values().collect();
    let nodes = nodes
        .into_iter()
        .enumerate()
        .filter(|(i, _)| keep.contains(i))
        .map(|(_, n)| n)
        .collect();
    let mut seen = HashSet::new();
    let links = links
        .into_iter()
        .filter(|l| seen.insert((l.source.clone(), l.target.clone(), l.link_type.clone())))
        .collect();
    (nodes, links)
}

pub fn build_output(
    nodes: Vec<Node>,
    links: Vec<Link>,
    split_code: bool,
) -> (OutputGraph, Option<HashMap<String, String>>) {
    let (nodes, mut links) = dedupe(nodes, links);
    let ranges = line_ranges(&nodes);
    links.extend(call_links(&nodes, &links, &ranges));
    let mut code_map = split_code.then(HashMap::new);
    let out_nodes = nodes
        .into_iter()
        .map(|n| {
            let kind = kind_of(&n);
            let range = ranges.get(&n.id).copied();
            let code = match (&mut code_map, is_symbol(&n.id)) {
                (Some(map), false) => {
                    if let Some(c) = n.code {
                        map.insert(n.id.clone(), c);
                    }
                    None
                }
                // Symbols with a line range are rebuilt from their file's code.
                (Some(_), true) if range.is_some() => None,
                _ => n.code,
            };
            OutputNode {
                id: n.id,
                label: n.label,
                group: n.group,
                language: n.language,
                val: n.val,
                kind,
                start_line: range.map(|r| r.0),
                end_line: range.map(|r| r.1),
                code,
            }
        })
        .collect();
    (
        OutputGraph {
            nodes: out_nodes,
            links,
            code_file: None,
        },
        code_map,
    )
}
