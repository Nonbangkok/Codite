# Folder Nodes Feature Design

**Date:** 2026-05-08  
**Status:** Approved

## Overview

Add folder nodes to the force-directed graph so users can see directory structure as part of the visualization. A toggle lets users opt in. Clicking a folder node in the graph filters the graph to that folder's scope, identical to clicking a folder in the sidebar.

## Approach

UI-only synthesis (Option A). Folder nodes are generated from existing file node IDs in the UI — no changes to the Rust analyzer or `data.json` format.

## Data Flow

1. `App.tsx` gains `showFolderNodes: boolean` state (default `false`).
2. A `graphDataWithFolders` memo runs `buildFolderNodes` against the file nodes from `graphData` when the toggle is on, merging the result into a new graph data object. When off, it equals `graphData` unchanged.
3. `filteredData` and `selectedNode` both consume `graphDataWithFolders` instead of `graphData`.

## Folder Node Synthesis (`treeUtils.ts`)

New export: `buildFolderNodes(fileNodes: NodeData[]): { nodes: NodeData[], links: LinkData[] }`

- Extracts all unique folder paths by splitting each file node ID on `/` and collecting every prefix except the full path.
- Produces one `NodeData` per unique folder:
  - `id`: the folder path string
  - `label`: last path segment
  - `group`: `'folders'`
  - `language`: `''`
  - `val`: `4`
- Produces one `LinkData` per direct parent→child relationship:
  - Folder→file: direct parent folder to each file node (`type: 'contains'`)
  - Folder→folder: parent folder to immediate sub-folder (`type: 'contains'`)

## Visual Appearance (`GraphView.tsx`)

- Add `folders` entry to `TYPE_RGB`: `[244, 214, 118]` (gold, matching sidebar folder highlight `#f4d676`)
- Add `folders` entry to `TYPE_RGB_BRIGHT`: `[255, 235, 150]`
- `val: 4` makes folder nodes render slightly larger than file nodes in the force layout.

## Toggle Control (`GraphView.tsx`)

Two new props on `GraphView`:
- `showFolderNodes: boolean`
- `onFolderNodesToggle: () => void`

A "Folders" toggle button is added to the existing toolbar alongside the color mode toggle, using the same visual style.

## Click Behavior

`GraphView` gains a new prop: `onFolderSelect: (path: string) => void`

In the node click handler:
- If `node.group === 'folders'`: call `onFolderSelect(node.id)` and clear `selectedNodeId` (closes the code panel). Does NOT call `onNodeSelect`.
- All other nodes: existing behavior unchanged.

In `App.tsx`, `onFolderSelect` is wired to `setActiveFolderPath` — same handler used by the sidebar.

## Filtering Compatibility

The existing `filteredData` memo filters by `n.id.startsWith(activeFolderPath)`. Folder node IDs are path strings, so:
- The active folder node itself passes (its ID equals `activeFolderPath`, and a string startsWith itself).
- Sub-folder nodes pass (their IDs start with the active path).
- File nodes within the folder pass as today.
- Folder→file and folder→folder links pass because both endpoints are in the filtered node set.

No changes required to the filtering logic.

## Files Changed

| File | Change |
|---|---|
| `ui/src/utils/treeUtils.ts` | Add `buildFolderNodes` function |
| `ui/src/App.tsx` | Add `showFolderNodes` state, `graphDataWithFolders` memo, wire new props |
| `ui/src/components/GraphView.tsx` | Add `TYPE_RGB` entry, toggle button, folder click handler, new props |
