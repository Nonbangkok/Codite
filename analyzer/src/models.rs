use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
pub struct Node {
    pub id: String,
    pub label: String,
    pub group: String,
    pub val: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Link {
    pub source: String,
    pub target: String,
    #[serde(rename = "type")]
    pub link_type: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct GraphData {
    pub nodes: Vec<Node>,
    pub links: Vec<Link>,
}
