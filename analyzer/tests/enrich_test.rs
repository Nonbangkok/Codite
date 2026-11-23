use std::fs;
use std::path::{Path, PathBuf};

use analyzer::enrich::{build_output, call_links, dedupe, find_calls, kind_of, line_ranges};
use analyzer::models::{Link, Node};
use analyzer::parsers::{
    CParser, CppParser, GoParser, JavaScriptParser, LanguageParser, PythonParser, RustParser,
    TypeScriptParser,
};
use analyzer::scanner::find_source_files;

fn fixture(rel: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(rel)
}

fn parse(parser: &dyn LanguageParser, path: &Path) -> (Vec<Node>, Vec<Link>) {
    let mut nodes = Vec::new();
    let mut links = Vec::new();
    parser.parse(path, &mut nodes, &mut links);
    (nodes, links)
}

/// A fresh empty directory under the system temp dir.
fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("codite-test-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn every_symbol_line_range_covers_its_code_in_all_languages() {
    let cases: Vec<(Box<dyn LanguageParser>, &str)> = vec![
        (Box::new(TypeScriptParser), "typescript/sample.ts"),
        (Box::new(JavaScriptParser), "javascript/sample.js"),
        (Box::new(PythonParser), "python/sample.py"),
        (Box::new(GoParser), "go/sample.go"),
        (Box::new(CParser), "c/sample.c"),
        (Box::new(CppParser), "cpp/sample.cpp"),
        (Box::new(RustParser), "../../src/parsers/mod.rs"),
    ];
    for (parser, rel) in cases {
        let path = fixture(rel);
        let (nodes, _) = parse(parser.as_ref(), &path);
        let ranges = line_ranges(&nodes);
        let text = fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = text.split('\n').collect();
        let mut checked = 0;
        for node in nodes.iter().filter(|n| n.id.contains("::")) {
            let Some(code) = &node.code else { continue };
            let (start, end) = ranges
                .get(&node.id)
                .copied()
                .unwrap_or_else(|| panic!("no range for {}", node.id));
            assert!(
                start >= 1 && start <= end,
                "{}: bad range {start}-{end}",
                node.id
            );
            let slice = lines[start - 1..end].join("\n");
            assert!(
                slice.contains(code.trim_end()),
                "{}: lines {start}-{end} do not contain its code",
                node.id
            );
            checked += 1;
        }
        assert!(checked > 0, "{rel}: no symbols checked");
        let file = nodes.iter().find(|n| !n.id.contains("::")).unwrap();
        assert_eq!(
            ranges.get(&file.id),
            Some(&(1, lines.len())),
            "{rel}: file range"
        );
    }
}

#[test]
fn kinds_are_singular() {
    let (nodes, _) = parse(&TypeScriptParser, &fixture("typescript/sample.ts"));
    let mut kinds: Vec<String> = nodes.iter().map(kind_of).collect();
    kinds.sort();
    kinds.dedup();
    assert_eq!(
        kinds,
        [
            "class",
            "enum",
            "file",
            "function",
            "import",
            "interface",
            "type"
        ]
    );
}

#[test]
fn finds_calls_in_several_languages() {
    let names = |lang: &str, file: &str, code: &str| -> Vec<String> {
        let mut v: Vec<String> = find_calls(lang, file, code)
            .into_iter()
            .map(|c| c.name)
            .collect();
        v.sort();
        v
    };
    assert_eq!(
        names("python", "a.py", "def f():\n    g()\n    obj.h(1)\n"),
        ["g", "h"]
    );
    assert_eq!(
        names(
            "rust",
            "a.rs",
            "fn f() { g(); s.h(); Type::k(); m::<u8>(); }"
        ),
        ["g", "h", "k", "m"]
    );
    assert_eq!(
        names("go", "a.go", "package a\nfunc f() { g(); pkg.H() }"),
        ["H", "g"]
    );
    assert_eq!(
        names(
            "typescript",
            "a.tsx",
            "const x = () => <div>{run(a.b())}</div>;"
        ),
        ["b", "run"]
    );
    let calls = find_calls("c", "a.c", "int f() {\n  return g(1);\n}\n");
    assert_eq!((calls[0].line, calls[0].method), (2, false));
    assert!(find_calls("python", "a.py", "x.h()")[0].method);
}

#[test]
fn resolves_calls_by_file_then_imports_then_unique_name() {
    let dir = temp_dir("calls");
    fs::write(dir.join("b.ts"), "export function b() { return 1; }\n").unwrap();
    fs::write(
        dir.join("c.ts"),
        "export function b() { return 2; }\nexport function lonely() {}\n",
    )
    .unwrap();
    fs::write(
        dir.join("a.ts"),
        "import { b } from './b';\nexport function a() {\n  b();\n  helper();\n  lonely();\n  missing();\n}\nfunction helper() { return helper(); }\nb();\n",
    )
    .unwrap();
    let (mut nodes, mut links) = (Vec::new(), Vec::new());
    for f in ["a.ts", "b.ts", "c.ts"] {
        TypeScriptParser.parse(&dir.join(f), &mut nodes, &mut links);
    }
    let ranges = line_ranges(&nodes);
    let calls = call_links(&nodes, &links, &ranges);
    let pairs: Vec<(String, String)> = calls
        .iter()
        .map(|l| {
            let short = |id: &str| {
                id.rsplit('/')
                    .next()
                    .unwrap()
                    .split("::")
                    .filter(|s| !s.chars().all(|c| c.is_ascii_digit()))
                    .collect::<Vec<_>>()
                    .join(":")
            };
            (short(&l.source), short(&l.target))
        })
        .collect();
    assert!(
        pairs.contains(&("a.ts:fn:a".into(), "b.ts:fn:b".into())),
        "{pairs:?}"
    );
    assert!(
        pairs.contains(&("a.ts:fn:a".into(), "a.ts:fn:helper".into())),
        "{pairs:?}"
    );
    assert!(
        pairs.contains(&("a.ts:fn:a".into(), "c.ts:fn:lonely".into())),
        "{pairs:?}"
    );
    // Top-level call is attributed to the file; recursion is not a link.
    assert!(
        pairs.contains(&("a.ts".into(), "b.ts:fn:b".into())),
        "{pairs:?}"
    );
    assert!(!pairs.iter().any(|(s, t)| s == t));
    assert!(calls.iter().all(|l| l.link_type == "calls"));
    fs::remove_dir_all(dir).ok();
}

#[test]
fn split_code_keeps_one_copy_per_file() {
    let (nodes, links) = parse(&TypeScriptParser, &fixture("typescript/sample.ts"));
    let symbol_count = nodes.iter().filter(|n| n.id.contains("::")).count();
    let (graph, code) = build_output(nodes, links, true);
    let code = code.expect("code map");
    assert_eq!(code.len(), 1, "only the file's code is stored");
    assert!(graph.nodes.iter().all(|n| n.code.is_none()));
    assert_eq!(
        graph
            .nodes
            .iter()
            .filter(|n| n.start_line.is_some())
            .count(),
        symbol_count + 1
    );

    let (nodes, links) = parse(&TypeScriptParser, &fixture("typescript/sample.ts"));
    let (inline, none) = build_output(nodes, links, false);
    assert!(none.is_none());
    assert!(inline.nodes.iter().all(|n| n.code.is_some()));
}

#[test]
fn scanner_respects_gitignore_and_skips_build_output() {
    let dir = temp_dir("scan");
    for (path, body) in [
        ("src/keep.ts", "export const a = 1;"),
        ("generated/skip.ts", "export const b = 1;"),
        ("dist-server/skip.js", "x"),
        ("node_modules/pkg/skip.js", "x"),
        (".hidden/skip.ts", "x"),
        ("notes.md", "x"),
    ] {
        let p = dir.join(path);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, body).unwrap();
    }
    fs::write(dir.join(".gitignore"), "generated/\n").unwrap();
    let files = find_source_files(dir.to_str().unwrap(), &[".ts", ".js"]);
    let names: Vec<String> = files
        .iter()
        .map(|p| p.strip_prefix(&dir).unwrap().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, ["src/keep.ts"]);
    fs::remove_dir_all(dir).ok();
}

#[test]
fn method_calls_and_other_languages_do_not_resolve_by_name_alone() {
    let dir = temp_dir("calls-strict");
    fs::write(
        dir.join("cache.ts"),
        "export function get() { return 1; }\n",
    )
    .unwrap();
    fs::write(
        dir.join("main.ts"),
        "export function run(m) {\n  m.get();\n}\n",
    )
    .unwrap();
    fs::write(dir.join("lib.rs"), "fn work() {\n    get();\n}\n").unwrap();
    let (mut nodes, mut links) = (Vec::new(), Vec::new());
    TypeScriptParser.parse(&dir.join("cache.ts"), &mut nodes, &mut links);
    TypeScriptParser.parse(&dir.join("main.ts"), &mut nodes, &mut links);
    RustParser.parse(&dir.join("lib.rs"), &mut nodes, &mut links);
    let calls = call_links(&nodes, &links, &line_ranges(&nodes));
    assert!(calls.is_empty(), "unexpected calls: {calls:?}");
    fs::remove_dir_all(dir).ok();
}

#[test]
fn duplicate_ids_are_merged_keeping_the_fullest_declaration() {
    let dir = temp_dir("dupes");
    // Two local types with the same name in one Go file, and a C forward declaration + definition.
    fs::write(dir.join("a.go"), "package a\nfunc f() {\n\ttype key struct{}\n}\nfunc g() {\n\ttype key struct{ name string }\n}\n").unwrap();
    fs::write(dir.join("b.c"), "struct node;\nstruct node { int v; };\n").unwrap();
    let (mut nodes, mut links) = (Vec::new(), Vec::new());
    GoParser.parse(&dir.join("a.go"), &mut nodes, &mut links);
    CParser.parse(&dir.join("b.c"), &mut nodes, &mut links);
    let before = nodes
        .iter()
        .filter(|n| n.id.ends_with("::struct::key"))
        .count();
    let (nodes, links) = dedupe(nodes, links);
    let mut ids: Vec<&str> = nodes.iter().map(|n| n.id.as_str()).collect();
    let total = ids.len();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), total, "ids are unique after dedupe");
    if before > 1 {
        let key = nodes
            .iter()
            .find(|n| n.id.ends_with("::struct::key"))
            .unwrap();
        assert!(
            key.code.as_deref().unwrap_or("").contains("name string"),
            "kept the longer declaration"
        );
    }
    let mut keys: Vec<(String, String, String)> = links
        .iter()
        .map(|l| (l.source.clone(), l.target.clone(), l.link_type.clone()))
        .collect();
    let n = keys.len();
    keys.sort();
    keys.dedup();
    assert_eq!(keys.len(), n, "links are unique after dedupe");
    fs::remove_dir_all(dir).ok();
}
