use std::fs;
use toml::Value;

fn main() {
    // Tell Cargo to rerun this script if Cargo.toml changes
    println!("cargo:rerun-if-changed=Cargo.toml");

    let cargo_toml = fs::read_to_string("Cargo.toml").expect("Failed to read Cargo.toml");
    let value = cargo_toml.parse::<Value>().expect("Failed to parse Cargo.toml");
    
    let default_dir = value
        .get("package")
        .and_then(|v| v.get("metadata"))
        .and_then(|v| v.get("codite"))
        .and_then(|v| v.get("default_scan_dir"))
        .and_then(|v| v.as_str())
        .unwrap_or(".");

    println!("cargo:rustc-env=DEFAULT_SCAN_DIR={}", default_dir);
}
