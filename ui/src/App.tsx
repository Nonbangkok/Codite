import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu } from 'lucide-react';
import type { GraphData, LinkData, NodeData } from './types';
import { GraphView, type ColorMode, type Emphasis, type FitRequest, type GraphHandle, type LayoutMode } from './components/graph/GraphView';
import { ViewMenu, type SizeBy } from './components/graph/ViewMenu';
import { interpolateRgbBasis, rgb as d3rgb } from 'd3';
import {
  applyLayout,
  collapseFolders,
  computeMetrics,
  folderAtDepth,
  folderGroups,
  groupDepth,
  impactOf,
  loadLayout,
  rankScale,
  saveLayout,
  unpinNodes,
  type Impact,
  type SizeMetric,
} from './utils/graphAnalysis';
import type { RGB } from './theme';
import { GraphToolbar, type ExportFormat } from './components/graph/GraphToolbar';
import { Legend } from './components/graph/Legend';
import { NodePanel, type PanelSize } from './components/NodePanel';
import type { ReaderSettings } from './components/code/CodeReader';
import type { LineRange } from './components/code/CodeView';
import { formatLineRange, parseLineRange } from './utils/codeAnalysis';
import { usePersistentState } from './hooks/usePersistentState';
import { CommandPalette, type PaletteCommand, type PaletteMode } from './components/CommandPalette';
import { DocTabs } from './components/DocTabs';
import { ComparePane } from './components/ComparePane';
import { EMPTY_HISTORY, canGoBack, canGoForward, closeTab, moveHistory, openTab, pruneTabs, pushHistory, recentIds, togglePin, type DocTab, type History } from './utils/workspace';
import { parseNotesImport, useNotes } from './hooks/useNotes';
import { useCodeSearch } from './hooks/useCodeSearch';
import { FileExplorer } from './components/FileExplorer';
import { ScanBar, type ScanStatus } from './components/ScanBar';
import { EmptyState, FilteredOutState, ScanningState } from './components/StageStates';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { buildFileTree, buildFolderNodes } from './utils/treeUtils';
import { buildGraphIndex, isInFolder, linkEndId, neighborhood, shortestPath, subgraph, type PathResult } from './utils/graphIndex';
import { countBy, fileIdOf, KIND_LABEL, nodeKind } from './utils/nodeKinds';
import { downloadBlob, graphToJson, graphToSvg, safeFilename } from './utils/exportGraph';
import { loadRecentScans, readRepoParam, rememberScan, repoToUrl, withParams, withRepoParam } from './utils/share';
import { PALETTES, rgba, useTheme } from './theme';
import { useMediaQuery } from './hooks/useMediaQuery';

type Source = { type: 'local' } | { type: 'remote'; repo: string };

interface ScanState {
  status: ScanStatus;
  repo: string | null;
  startedAt: number;
  message: string | null;
}

const EMPTY: GraphData = { nodes: [], links: [] };

/** Drops import placeholder nodes (they clutter the graph) and links that point at missing nodes. */
const prepareGraph = (data: GraphData): GraphData => {
  const nodes = data.nodes.filter((n) => n.group !== 'imports');
  const ids = new Set(nodes.map((n) => n.id));
  const links = data.links.filter((l: LinkData) => ids.has(linkEndId(l.source)) && ids.has(linkEndId(l.target)));
  return { nodes, links };
};

/** Accepts `owner/repo`, `github.com/owner/repo` or a full URL and returns `owner/repo` for display. */
const repoLabel = (input: string) =>
  input
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^(www\.)?github\.com\//, '')
    .replace(/\.git$/, '')
    .split('/')
    .slice(0, 2)
    .join('/');

const isTypingTarget = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

function App() {
  const { theme, toggleTheme } = useTheme();
  const palette = PALETTES[theme];
  const isNarrow = useMediaQuery('(max-width: 767px)');
  const graphRef = useRef<GraphHandle>(null);

  // Data
  const [graph, setGraph] = useState<GraphData>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [source, setSource] = useState<Source>({ type: 'local' });
  const [datasetKey, setDatasetKey] = useState('local');
  const lastLocalText = useRef<string | null>(null);

  // View state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>('kind');
  const [showNames, setShowNames] = useState(false);
  const [showFolders, setShowFolders] = useState(false);
  const [hiddenKinds, setHiddenKinds] = useState<ReadonlySet<string>>(new Set());
  const [hiddenLanguages, setHiddenLanguages] = useState<ReadonlySet<string>>(new Set());
  const [focusDepth, setFocusDepth] = useState(0);
  const [path, setPath] = useState<PathResult | null>(null);
  const [layout, setLayout] = usePersistentState<LayoutMode>('codite.layoutMode', 'force', (v) => v === 'force' || v === 'tree' || v === 'radial');
  const [groupByFolder, setGroupByFolder] = usePersistentState<boolean>('codite.groupByFolder', false, (v) => typeof v === 'boolean');
  const [collapsedFolders, setCollapsedFolders] = useState<ReadonlySet<string>>(new Set());
  const [sizeBy, setSizeBy] = usePersistentState<SizeBy>('codite.sizeBy', 'uniform', (v) => ['uniform', 'lines', 'connections', 'complexity'].includes(v as string));
  const [heatMetric, setHeatMetric] = usePersistentState<SizeMetric>('codite.heatMetric', 'complexity', (v) => ['lines', 'connections', 'complexity'].includes(v as string));
  const [hiddenLinkTypes, setHiddenLinkTypes] = useState<ReadonlySet<string>>(new Set());
  const [highlight, setHighlight] = useState('');
  const [highlightFit, setHighlightFit] = useState(0);
  const [multiSelected, setMultiSelected] = useState<ReadonlySet<string>>(new Set());
  const [selectionOnly, setSelectionOnly] = useState(false);
  const [lassoMode, setLassoMode] = useState(false);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [impactOnly, setImpactOnly] = useState(false);
  const [pinnedIds, setPinnedIds] = useState<ReadonlySet<string>>(new Set());

  // Chrome
  const [paletteState, setPalette] = useState<{ mode: PaletteMode; from: NodeData | null; query: string } | null>(null);
  const isPaletteOpen = paletteState !== null;
  const openPalette = useCallback((query = '') => setPalette({ mode: 'search', from: null, query }), []);
  const [history, setHistory] = useState<History>(EMPTY_HISTORY);
  const [tabs, setTabs] = useState<DocTab[]>([]);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = usePersistentState<number>('codite.sidebarWidth', 260, (v) => typeof v === 'number' && v >= 200 && v <= 480);
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistentState<boolean>('codite.sidebarCollapsed', false, (v) => typeof v === 'boolean');
  const importRef = useRef<HTMLInputElement>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(480);
  const [panelSize, setPanelSize] = usePersistentState<PanelSize>('codite.panelSize', 'normal', (v) =>
    v === 'normal' || v === 'wide' || v === 'full',
  );
  const [readerSettings, setReaderSettings] = usePersistentState<ReaderSettings>(
    'codite.reader',
    { wrap: true, compact: false, fontSize: 13 },
    (v) => typeof v === 'object' && v !== null && 'wrap' in v && 'fontSize' in v,
  );
  const [lineRange, setLineRange] = useState<LineRange | null>(null);
  const [searchFocusSignal, setSearchFocusSignal] = useState(0);
  // `?node=…&L=…` from a shared link, applied once the graph has loaded.
  const initialNode = useRef<{ id: string; range: LineRange | null } | null>(
    (() => {
      const params = new URLSearchParams(window.location.search);
      const id = params.get('node');
      return id ? { id, range: parseLineRange(params.get('L')) } : null;
    })(),
  );
  const [isResizing, setIsResizing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  // Scanning
  const [scanInput, setScanInput] = useState('');
  const [scan, setScan] = useState<ScanState>({ status: 'idle', repo: null, startedAt: 0, message: null });
  const [recent, setRecent] = useState<string[]>(() => loadRecentScans());
  const abortRef = useRef<AbortController | null>(null);
  const initialRepo = useRef(readRepoParam(window.location.search));

  const notify = useCallback((message: string) => setNotice(message), []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(timer);
  }, [notice]);

  const resetView = useCallback(() => {
    setSelectedId(null);
    setActiveFolder(null);
    setHiddenKinds(new Set());
    setHiddenLanguages(new Set());
    setFocusDepth(0);
    setPath(null);
    setCollapsedFolders(new Set());
    setHiddenLinkTypes(new Set());
    setHighlight('');
    setMultiSelected(new Set());
    setSelectionOnly(false);
    setImpact(null);
    setImpactOnly(false);
  }, []);

  // ── Local data: poll the data.json written by `cargo run` until a remote scan replaces it.
  useEffect(() => {
    if (source.type !== 'local' || initialRepo.current) return;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`/data.json?t=${Date.now()}`);
        if (!response.ok) return;
        const text = await response.text();
        if (cancelled || text === lastLocalText.current) return;
        lastLocalText.current = text;
        setGraph(prepareGraph(JSON.parse(text)));
        setDatasetKey(`local:${text.length}`);
      } catch (error) {
        console.error('Error loading graph data:', error);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    void load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [source.type]);

  // ── Remote scans
  const startScan = useCallback(
    async (input: string) => {
      const repo = repoLabel(input);
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setScanInput(`github.com/${repo}`);
      setScan({ status: 'scanning', repo, startedAt: Date.now(), message: null });

      try {
        const response = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: repoToUrl(repo) }),
          signal: controller.signal,
        });
        let body: { status?: string; repo?: string; graph?: GraphData; error?: string };
        try {
          body = await response.json();
        } catch {
          throw new Error(`The scan server sent an unexpected response (HTTP ${response.status}).`);
        }
        if (!response.ok || body.status !== 'success' || !body.graph) {
          throw new Error(body.error || `Scan failed (HTTP ${response.status}).`);
        }

        const scanned = body.repo ?? repo;
        const prepared = prepareGraph(body.graph);
        resetView();
        setGraph(prepared);
        setSource({ type: 'remote', repo: scanned });
        setDatasetKey(`remote:${scanned}:${Date.now()}`);
        setLoaded(true);
        setRecent(rememberScan(scanned));
        window.history.replaceState(null, '', withRepoParam(window.location.href, scanned));
        setScan({
          status: 'done',
          repo: scanned,
          startedAt: 0,
          message: `Scanned ${scanned}: ${prepared.nodes.length} files and symbols.`,
        });
        setAnnouncement(`Scan finished. ${prepared.nodes.length} nodes loaded from ${scanned}.`);
      } catch (error) {
        if (controller.signal.aborted) {
          setScan({ status: 'idle', repo: null, startedAt: 0, message: null });
          return;
        }
        const message = error instanceof Error ? error.message : 'Could not reach the scan server.';
        setScan({ status: 'error', repo, startedAt: 0, message: message === 'Failed to fetch' ? 'Could not reach the scan server.' : message });
        setLoaded(true);
      }
    },
    [resetView],
  );

  // Auto-scan `?repo=owner/name` once on load.
  const autoScanned = useRef(false);
  useEffect(() => {
    if (initialRepo.current && !autoScanned.current) {
      autoScanned.current = true;
      void startScan(initialRepo.current);
    }
  }, [startScan]);

  // Fade the success message after a few seconds.
  useEffect(() => {
    if (scan.status !== 'done' || !scan.message) return;
    const timer = setTimeout(() => setScan((s) => (s.status === 'done' ? { ...s, message: null } : s)), 4000);
    return () => clearTimeout(timer);
  }, [scan.status, scan.message]);

  const cancelScan = useCallback(() => abortRef.current?.abort(), []);

  // ── Derived graph pipeline: folders → filters (+path) → focus
  const withFolders = useMemo(() => {
    if (!showFolders) return graph;
    const fileNodes = graph.nodes.filter((n) => !n.id.includes('::'));
    const folders = buildFolderNodes(fileNodes);
    return { nodes: [...graph.nodes, ...folders.nodes], links: [...graph.links, ...folders.links] };
  }, [graph, showFolders]);

  const fullIndex = useMemo(() => buildGraphIndex(withFolders), [withFolders]);
  const nodesById = useMemo(() => new Map(withFolders.nodes.map((n) => [n.id, n])), [withFolders]);

  // Collapsed folders stand in for everything inside them.
  const viewGraph = useMemo(() => collapseFolders(withFolders, collapsedFolders), [withFolders, collapsedFolders]);
  const viewById = useMemo(() => new Map(viewGraph.nodes.map((n) => [n.id, n])), [viewGraph]);

  const scoped = useMemo(
    () => (activeFolder ? subgraph(viewGraph, (id) => isInFolder(id, activeFolder)) : viewGraph),
    [viewGraph, activeFolder],
  );

  const legendMode: ColorMode = colorMode === 'language' ? 'language' : 'kind';
  const legendEntries = useMemo(() => countBy(scoped.nodes, legendMode), [scoped.nodes, legendMode]);
  const hiddenSet = legendMode === 'kind' ? hiddenKinds : hiddenLanguages;

  const pathIds = useMemo(() => new Set(path?.nodeIds ?? []), [path]);

  const visible = useMemo(() => {
    const scopedIds = new Set(scoped.nodes.map((n) => n.id));
    const kept = subgraph(viewGraph, (id) => {
      if (pathIds.has(id)) return true;
      if (!scopedIds.has(id)) return false;
      const node = viewById.get(id)!;
      return !hiddenKinds.has(nodeKind(node)) && !hiddenLanguages.has(node.language || 'other');
    });
    return hiddenLinkTypes.size ? { nodes: kept.nodes, links: kept.links.filter((l) => !hiddenLinkTypes.has(l.type)) } : kept;
  }, [viewGraph, scoped, viewById, hiddenKinds, hiddenLanguages, pathIds, hiddenLinkTypes]);

  const selectedNode = selectedId ? (nodesById.get(selectedId) ?? null) : null;

  const displayed = useMemo(() => {
    let out = visible;
    if (selectionOnly && multiSelected.size) out = subgraph(out, (id) => multiSelected.has(id) || pathIds.has(id));
    if (impactOnly && impact) out = subgraph(out, (id) => impact.depth.has(id));
    if (focusDepth === 0 || !selectedId) return out;
    const near = neighborhood(buildGraphIndex(out), selectedId, focusDepth);
    for (const id of pathIds) near.add(id);
    return near.size > 0 ? subgraph(out, (id) => near.has(id)) : out;
  }, [visible, focusDepth, selectedId, pathIds, selectionOnly, multiSelected, impactOnly, impact]);

  // Highlight-as-you-type and impact both dim everything else.
  const highlightIds = useMemo(() => {
    const q = highlight.trim().toLowerCase();
    if (!q) return null;
    return new Set(displayed.nodes.filter((n) => n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)).map((n) => n.id));
  }, [highlight, displayed.nodes]);
  const emphasis = useMemo<Emphasis | null>(() => {
    if (impact) {
      const intensity = new Map([...impact.depth].map(([id, d]) => [id, 1 - d / (impact.maxDepth + 1)]));
      return { ids: new Set(impact.depth.keys()), intensity };
    }
    return highlightIds ? { ids: highlightIds } : null;
  }, [impact, highlightIds]);

  const displayedIndex = useMemo(() => buildGraphIndex(displayed), [displayed]);

  const fitRequest = useMemo<FitRequest>(
    () => ({
      key: [
        datasetKey,
        activeFolder,
        focusDepth ? `${selectedId}:${focusDepth}` : '',
        path?.nodeIds.join('>') ?? '',
        layout,
        collapsedFolders.size,
        selectionOnly,
        impactOnly ? impact?.root : '',
        highlightFit,
      ].join('|'),
      ids: path ? pathIds : highlightFit && highlightIds?.size ? highlightIds : undefined,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- highlightIds only matter when a fit is requested
    [datasetKey, activeFolder, focusDepth, selectedId, path, pathIds, layout, collapsedFolders.size, selectionOnly, impactOnly, impact?.root, highlightFit],
  );

  // Drop selection/path when the node no longer exists (e.g. folders toggled off).
  useEffect(() => {
    if (selectedId && !nodesById.has(selectedId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reconcile with new data
      setSelectedId(null);
      setFocusDepth(0);
    }
    if (path && path.nodeIds.some((id) => !nodesById.has(id))) setPath(null);
  }, [nodesById, selectedId, path]);

  const fileTree = useMemo(() => buildFileTree(graph.nodes), [graph.nodes]);

  // ── Metrics, colors and sizes
  const metrics = useMemo(() => computeMetrics(withFolders.nodes, fullIndex), [withFolders.nodes, fullIndex]);
  const scaleFor = useCallback(
    (metric: SizeMetric) => rankScale(new Map([...metrics].filter(([id]) => !nodesById.get(id) || nodesById.get(id)!.group !== 'folders').map(([id, m]) => [id, m[metric]]))),
    [metrics, nodesById],
  );
  const heatScale = useMemo(() => (colorMode === 'heat' ? scaleFor(heatMetric) : null), [colorMode, heatMetric, scaleFor]);
  const sizeScale = useMemo(() => (sizeBy === 'uniform' ? null : scaleFor(sizeBy)), [sizeBy, scaleFor]);
  const heatStops = theme === 'dark' ? ['#4f5f80', '#f4d676', '#ff6b5b'] : ['#a3aec4', '#c08a00', '#c0392b'];
  const heatInterp = useMemo(() => interpolateRgbBasis(heatStops), [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const nodeRGB = useCallback(
    (node: NodeData): RGB => {
      if (colorMode === 'heat' && heatScale && node.group !== 'folders') {
        const c = d3rgb(heatInterp(heatScale.get(node.id) ?? 0));
        return [Math.round(c.r), Math.round(c.g), Math.round(c.b)];
      }
      return colorMode === 'language'
        ? (palette.language[node.language] ?? palette.language.default)
        : (palette.kind[nodeKind(node)] ?? palette.kind.default);
    },
    [colorMode, heatScale, heatInterp, palette],
  );
  const nodeColor = useCallback((node: NodeData) => rgba(nodeRGB(node), 1), [nodeRGB]);
  const sizeOf = useCallback(
    (node: NodeData) => (sizeScale && node.group !== 'folders' ? 4 + 40 * (sizeScale.get(node.id) ?? 0) : node.val),
    [sizeScale],
  );

  const groupLevel = useMemo(() => groupDepth(graph.nodes), [graph.nodes]);
  const folders = useMemo(() => folderGroups(graph.nodes, groupLevel), [graph.nodes, groupLevel]);
  const hulls = useMemo(
    () =>
      groupByFolder
        ? {
            keyOf: (id: string) => folderAtDepth(id, groupLevel),
            labelOf: (key: string) => key.split('/').slice(1).join('/') || key,
          }
        : null,
    [groupByFolder, groupLevel],
  );
  const linkTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of viewGraph.links) counts.set(l.type, (counts.get(l.type) ?? 0) + 1);
    return [...counts].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);
  }, [viewGraph.links]);
  const legendColor = useCallback(
    (key: string) =>
      rgba(
        colorMode === 'language'
          ? (palette.language[key] ?? palette.language.default)
          : (palette.kind[key as keyof typeof palette.kind] ?? palette.kind.default),
        1,
      ),
    [colorMode, palette],
  );

  // ── Actions
  const selectNode = useCallback(
    (id: string | null, range: LineRange | null = null, record = true) => {
      setSelectedId(id);
      setLineRange(range);
      if (id) {
        if (record) setHistory((h) => pushHistory(h, { id, range }));
        setTabs((t) => openTab(t, selectedId, id));
        if (activeFolder && !isInFolder(id, activeFolder)) setActiveFolder(null);
        const node = nodesById.get(id);
        if (node) setAnnouncement(`Selected ${node.label}`);
      } else {
        setFocusDepth(0);
      }
    },
    [activeFolder, nodesById, selectedId],
  );

  const goHistory = useCallback(
    (delta: -1 | 1) => {
      const next = moveHistory(history, delta);
      if (next === history) return;
      setHistory(next);
      const entry = next.stack[next.index];
      if (nodesById.has(entry.id)) selectNode(entry.id, entry.range, false);
    },
    [history, nodesById, selectNode],
  );

  const closeDocTab = (id: string) => {
    const { tabs: next, nextActive } = closeTab(tabs, selectedId, id);
    setTabs(next);
    if (id === compareId) setCompareId(null);
    if (nextActive !== selectedId) selectNode(nextActive);
  };

  // A new dataset invalidates tabs, history and comparisons that point at missing nodes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reconcile with new data
    setTabs((t) => pruneTabs(t, (id) => nodesById.has(id)));
    setHistory((h) => (h.stack.every((e) => nodesById.has(e.id)) ? h : EMPTY_HISTORY));
    setCompareId((c) => (c && !nodesById.has(c) ? null : c));
  }, [nodesById]);

  // Bookmarks and notes are kept per project.
  const notesScope = source.type === 'remote' ? `repo:${source.repo}` : `local:${graph.nodes[0]?.id.split('/')[0] ?? 'project'}`;
  const { notes, toggleBookmark, setNote, importNotes } = useNotes(notesScope);

  // Saved layout: pinned nodes and starting positions, per project.
  useEffect(() => {
    const saved = loadLayout(notesScope);
    applyLayout(graph.nodes, saved);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync pins with the loaded data
    setPinnedIds(new Set(Object.keys(saved.pinned).filter((id) => graph.nodes.some((n) => n.id === id))));
    setCollapsedFolders(new Set());
  }, [graph, notesScope]);

  const onNodePinned = (node: NodeData) => {
    const saved = loadLayout(notesScope);
    saved.pinned[node.id] = [Math.round(node.x ?? 0), Math.round(node.y ?? 0)];
    saveLayout(notesScope, saved);
    setPinnedIds((p) => new Set(p).add(node.id));
  };
  const unpinAll = () => {
    unpinNodes(graph.nodes);
    saveLayout(notesScope, { ...loadLayout(notesScope), pinned: {} });
    setPinnedIds(new Set());
    notify('All nodes unpinned.');
  };
  const saveCurrentLayout = () => {
    saveLayout(notesScope, { ...loadLayout(notesScope), positions: graphRef.current?.positions() ?? {} });
    notify('Layout saved. It will be restored next time you open this project.');
  };
  const resetLayout = () => {
    unpinNodes(graph.nodes);
    saveLayout(notesScope, { pinned: {}, positions: {} });
    setPinnedIds(new Set());
    notify('Saved layout cleared.');
  };

  const showImpact = useCallback(
    (id: string | null) => {
      if (!id) return setImpact(null);
      const result = impactOf(withFolders, id, Infinity, fullIndex);
      setImpact(result);
      setImpactOnly(false);
      const dependents = result.depth.size - 1;
      setAnnouncement(`${dependents} nodes depend on ${nodesById.get(id)?.label ?? id}.`);
    },
    [withFolders, fullIndex, nodesById],
  );
  const bookmarkList = useMemo(
    () =>
      Object.entries(notes)
        .filter(([id]) => nodesById.has(id))
        .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
        .map(([id, n]) => ({ id, label: nodesById.get(id)!.label, color: '', hasNote: !!n.note.trim(), bookmarked: n.bookmarked })),
    [notes, nodesById],
  );

  // Full-text search over file contents (symbols repeat their file's code, so files only).
  const searchFiles = useMemo(
    () => graph.nodes.filter((n) => !n.id.includes('::') && n.code).map((n) => ({ id: n.id, code: n.code! })),
    [graph.nodes],
  );
  const searchText = useCodeSearch(searchFiles);

  // Identifiers in code that name a symbol in the graph (clickable in the reader).
  const symbolIndex = useMemo(() => {
    const ids = new Map<string, string[]>();
    for (const node of graph.nodes) {
      const kind = nodeKind(node);
      if (kind === 'files' || kind === 'folders' || kind === 'imports') continue;
      const name = node.label.replace(/\(\)$/, '');
      if (name.length < 3) continue;
      ids.set(name, [...(ids.get(name) ?? []), node.id]);
    }
    const titles = new Map<string, string>();
    for (const [name, list] of ids) {
      const first = nodesById.get(list[0]);
      titles.set(
        name,
        list.length > 1
          ? `${name}: ${list.length} definitions — click to open the nearest`
          : `${KIND_LABEL[nodeKind(first!)].one} ${name} in ${fileIdOf(list[0])}`,
      );
    }
    return { ids, titles };
  }, [graph.nodes, nodesById]);

  const openSymbol = useCallback(
    (name: string, fromId: string) => {
      const candidates = symbolIndex.ids.get(name) ?? [];
      if (candidates.length === 0) return;
      const sameFile = candidates.find((id) => fileIdOf(id) === fileIdOf(fromId) && id !== fromId);
      const target = sameFile ?? candidates.find((id) => id !== fromId) ?? candidates[0];
      selectNode(target);
    },
    [symbolIndex, selectNode],
  );

  // Open the node from a shared link once it exists.
  useEffect(() => {
    const wanted = initialNode.current;
    if (!wanted || !nodesById.has(wanted.id)) return;
    initialNode.current = null;
     
    selectNode(wanted.id, wanted.range);
  }, [nodesById, selectNode]);

  // Keep `?node=` and `?L=` in the address bar so the current view can be shared.
  useEffect(() => {
    if (initialNode.current) return;
    const href = withParams(window.location.href, {
      node: selectedId,
      L: selectedId && lineRange ? formatLineRange(lineRange) : null,
    });
    if (href !== window.location.href) window.history.replaceState(null, '', href);
  }, [selectedId, lineRange]);

  const setHidden = legendMode === 'kind' ? setHiddenKinds : setHiddenLanguages;
  const toggleHidden = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const showOnly = (key: string) => setHidden(new Set(legendEntries.map((e) => e.key).filter((k) => k !== key)));

  const openPathPicker = useCallback(() => {
    if (!selectedNode) {
      notify('Select a node first, then find a path from it.');
      return;
    }
    setPalette({ mode: 'path', from: selectedNode, query: '' });
  }, [selectedNode, notify]);

  const openComparePicker = useCallback(() => {
    if (!selectedNode) {
      notify('Select a node first, then compare it with another.');
      return;
    }
    setPalette({ mode: 'compare', from: selectedNode, query: '' });
  }, [selectedNode, notify]);

  const choosePathTarget = (from: NodeData, target: NodeData) => {
    const result = shortestPath(fullIndex, from.id, target.id);
    if (!result) {
      notify(`${from.label} and ${target.label} are not connected.`);
      return;
    }
    setPath(result);
    setSelectedId(from.id);
    setAnnouncement(`Path found with ${result.nodeIds.length - 1} steps from ${from.label} to ${target.label}.`);
  };

  const chooseCompare = (target: NodeData) => {
    setCompareId(target.id);
    setPanelSize((s) => (s === 'normal' ? 'wide' : s));
  };

  const exportName = safeFilename(source.type === 'remote' ? source.repo : (fileTree[0]?.name ?? 'codite'));
  const handleExport = async (format: ExportFormat) => {
    if (format === 'png') {
      const blob = await graphRef.current?.exportPng();
      if (blob) downloadBlob(blob, `${exportName}.png`);
      else notify('Could not capture the graph image.');
    } else if (format === 'svg') {
      const svg = graphToSvg(displayed, {
        background: palette.background,
        link: rgba(palette.link, 0.35),
        label: rgba(palette.label, 0.9),
        colorOf: nodeColor,
        showLabels: showNames || displayed.nodes.length <= 150,
      });
      downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${exportName}.svg`);
    } else {
      downloadBlob(new Blob([graphToJson(displayed)], { type: 'application/json' }), `${exportName}.json`);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      notify('Link copied. Anyone with it can rescan this repository.');
    } catch {
      notify('Could not copy the link.');
    }
  };

  // ── Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'p')) {
        e.preventDefault();
        setPalette((p) => (p ? null : { mode: 'search', from: null, query: e.shiftKey ? '>' : '' }));
        return;
      }
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !isPaletteOpen && !isTypingTarget(e.target)) {
        e.preventDefault();
        goHistory(e.key === 'ArrowLeft' ? -1 : 1);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'f' && selectedId && nodesById.get(selectedId)?.code && !isPaletteOpen) {
        e.preventDefault();
        setSearchFocusSignal((n) => n + 1);
        return;
      }
      if (e.defaultPrevented || isPaletteOpen || showShortcuts || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      switch (e.key) {
        case '/':
          e.preventDefault();
          openPalette();
          break;
        case '>':
        case '#':
          e.preventDefault();
          openPalette(e.key);
          break;
        case 'b':
          setSidebarCollapsed((c) => !c);
          break;
        case '?':
          setShowShortcuts(true);
          break;
        case 'i':
          if (selectedId) showImpact(impact?.root === selectedId ? null : selectedId);
          else notify('Select a node to see what depends on it.');
          break;
        case 'l':
          setLayout((m) => (m === 'force' ? 'tree' : m === 'tree' ? 'radial' : 'force'));
          break;
        case 'Escape':
          if (lassoMode) setLassoMode(false);
          else if (impact) setImpact(null);
          else if (multiSelected.size) setMultiSelected(new Set());
          else if (drawerOpen) setDrawerOpen(false);
          else if (path) setPath(null);
          else if (focusDepth) setFocusDepth(0);
          else if (panelSize === 'full' && selectedId) setPanelSize('normal');
          else if (selectedId) selectNode(null);
          break;
        case 'e':
          if (selectedId) setPanelSize((s) => (s === 'normal' ? 'wide' : s === 'wide' ? 'full' : 'normal'));
          break;
        case 'g':
          if (selectedId && nodesById.get(selectedId)?.code) {
            e.preventDefault(); // otherwise the "g" lands in the search box we just focused
            setSearchFocusSignal((n) => -(Math.abs(n) + 1));
          }
          break;
        case 'w':
          setReaderSettings((r) => ({ ...r, wrap: !r.wrap }));
          break;
        case 'f':
          graphRef.current?.fitView();
          break;
        case 'x':
          if (selectedId) setFocusDepth((d) => (d ? 0 : 1));
          else notify('Select a node to focus on it.');
          break;
        case 'p':
          openPathPicker();
          break;
        case 'n':
          setShowNames((v) => !v);
          break;
        case 'c':
          setColorMode((m) => (m === 'kind' ? 'language' : 'kind'));
          break;
        case 'd':
          setShowFolders((v) => !v);
          break;
        case 't':
          toggleTheme();
          break;
        case '+':
        case '=':
          graphRef.current?.zoomBy(1.4);
          break;
        case '-':
          graphRef.current?.zoomBy(1 / 1.4);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPaletteOpen, showShortcuts, drawerOpen, path, focusDepth, selectedId, selectNode, openPathPicker, toggleTheme, notify, nodesById, panelSize, setPanelSize, setReaderSettings, goHistory, openPalette, setSidebarCollapsed, showImpact, impact, lassoMode, multiSelected, setLayout]);

  // ── Sidebar resizing
  const startSidebarResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => setSidebarWidth(Math.round(Math.min(480, Math.max(200, ev.clientX))));
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  };

  // ── Commands for the palette (type ">")
  const exportNotes = () => {
    const blob = new Blob([JSON.stringify({ scope: notesScope, notes }, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${safeFilename(notesScope)}-notes.json`);
  };
  const onImportNotes = async (file: File | undefined) => {
    if (!file) return;
    const parsed = parseNotesImport(await file.text());
    if (!parsed) return notify('That file is not a Codite notes export.');
    importNotes(parsed);
    notify(`Imported ${Object.keys(parsed).length} bookmarks and notes.`);
  };
  const commands: PaletteCommand[] = [
    { id: 'theme', label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', shortcut: 'T', run: toggleTheme },
    { id: 'fit', label: 'Fit graph to screen', shortcut: 'F', run: () => graphRef.current?.fitView() },
    { id: 'names', label: showNames ? 'Hide node names' : 'Show all node names', shortcut: 'N', run: () => setShowNames((v) => !v) },
    { id: 'folders', label: showFolders ? 'Hide folder nodes' : 'Show folder nodes', shortcut: 'D', run: () => setShowFolders((v) => !v) },
    { id: 'color', label: colorMode === 'kind' ? 'Color nodes by language' : 'Color nodes by kind', shortcut: 'C', run: () => setColorMode((m) => (m === 'kind' ? 'language' : 'kind')) },
    { id: 'sidebar', label: sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar', shortcut: 'B', run: () => setSidebarCollapsed((c) => !c) },
    { id: 'wrap', label: readerSettings.wrap ? 'Stop wrapping long lines' : 'Wrap long lines', keywords: 'code reader', shortcut: 'W', run: () => setReaderSettings((r) => ({ ...r, wrap: !r.wrap })) },
    { id: 'compact', label: readerSettings.compact ? 'Use full indentation' : 'Use compact indentation', keywords: 'code reader indent', run: () => setReaderSettings((r) => ({ ...r, compact: !r.compact })) },
    { id: 'panel-side', label: 'Details panel: side', keywords: 'size', run: () => setPanelSize('normal') },
    { id: 'panel-half', label: 'Details panel: half screen', keywords: 'size wide', run: () => setPanelSize('wide') },
    { id: 'panel-full', label: 'Details panel: full screen', keywords: 'size reader', run: () => setPanelSize('full') },
    { id: 'path', label: 'Find path from the selected node', shortcut: 'P', run: openPathPicker },
    { id: 'compare', label: 'Compare the selected node with…', keywords: 'split side by side', run: openComparePicker },
    { id: 'reset', label: 'Reset filters and selection', keywords: 'clear show all', run: resetView },
    { id: 'close-tabs', label: 'Close all tabs', run: () => (setTabs([]), setCompareId(null), selectNode(null)) },
    { id: 'png', label: 'Export graph as PNG', keywords: 'image download', run: () => void handleExport('png') },
    { id: 'svg', label: 'Export graph as SVG', keywords: 'vector download', run: () => void handleExport('svg') },
    { id: 'json', label: 'Export graph data as JSON', keywords: 'download', run: () => void handleExport('json') },
    { id: 'notes-export', label: 'Export bookmarks and notes', keywords: 'backup download', run: exportNotes },
    { id: 'notes-import', label: 'Import bookmarks and notes', keywords: 'restore upload', run: () => importRef.current?.click() },
    { id: 'layout-force', label: 'Layout: force', keywords: 'physics', run: () => setLayout('force') },
    { id: 'layout-tree', label: 'Layout: tree', keywords: 'hierarchy dag', shortcut: 'L', run: () => setLayout('tree') },
    { id: 'layout-radial', label: 'Layout: radial', keywords: 'rings', run: () => setLayout('radial') },
    { id: 'groups', label: groupByFolder ? 'Hide folder groups' : 'Outline folder groups', keywords: 'hull cluster', run: () => setGroupByFolder((g) => !g) },
    { id: 'collapse-all', label: 'Collapse all top-level folders', run: () => setCollapsedFolders(new Set(folders.map((f) => f.key))) },
    { id: 'expand-all', label: 'Expand all folders', run: () => setCollapsedFolders(new Set()) },
    { id: 'heat', label: 'Color nodes by heat (metric)', keywords: 'complexity size', run: () => setColorMode('heat') },
    { id: 'size-lines', label: 'Size nodes by lines of code', run: () => setSizeBy('lines') },
    { id: 'size-complexity', label: 'Size nodes by complexity', run: () => setSizeBy('complexity') },
    { id: 'size-uniform', label: 'Size nodes by kind (default)', run: () => setSizeBy('uniform') },
    { id: 'impact', label: 'Show what depends on the selected node', keywords: 'impact dependents', shortcut: 'I', run: () => (selectedId ? showImpact(selectedId) : notify('Select a node first.')) },
    { id: 'lasso', label: 'Select an area of the graph', keywords: 'lasso multi', run: () => setLassoMode(true) },
    { id: 'save-layout', label: 'Save layout', keywords: 'positions', run: saveCurrentLayout },
    { id: 'unpin', label: 'Unpin all nodes', run: unpinAll },
    { id: 'reset-layout', label: 'Reset saved layout', run: resetLayout },
    { id: 'shortcuts', label: 'Show keyboard shortcuts', shortcut: '?', run: () => setShowShortcuts(true) },
    ...(source.type === 'remote' ? [{ id: 'link', label: 'Copy link to this view', run: () => void copyLink() }] : []),
  ];

  // ── Panel resizing
  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent) => {
      const width = document.body.clientWidth - e.clientX;
      if (width >= 320 && width <= 860) setPanelWidth(width);
    };
    const onUp = () => setIsResizing(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isResizing]);

  const onResizerKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') setPanelWidth((w) => Math.min(860, w + 24));
    if (e.key === 'ArrowRight') setPanelWidth((w) => Math.max(320, w - 24));
  };

  const sourceLabel = source.type === 'remote' ? source.repo : `${fileTree[0]?.name ?? 'local project'} (local)`;
  const hasData = graph.nodes.length > 0;
  const scanning = scan.status === 'scanning';

  return (
    <div
      className="app"
      data-sidebar={sidebarCollapsed ? 'collapsed' : 'open'}
      style={{ ['--sidebar-w' as string]: `${sidebarWidth}px` }}
    >
      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          void onImportNotes(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <FileExplorer
        tree={fileTree}
        sourceLabel={sourceLabel}
        activeFolderPath={activeFolder}
        selectedId={selectedId}
        onFolderSelect={(p) => {
          setActiveFolder(p);
          if (p && selectedId && !isInFolder(selectedId, p)) selectNode(null);
        }}
        onFileSelect={(id) => selectNode(id)}
        open={drawerOpen}
        onRequestClose={() => setDrawerOpen(false)}
        bookmarks={bookmarkList.map((b) => ({ ...b, color: nodeColor(nodesById.get(b.id)!) }))}
        onOpenBookmark={(id) => selectNode(id)}
        onResizeStart={isNarrow ? undefined : startSidebarResize}
      />

      <main className="stage" aria-label="Graph">
        <button
          type="button"
          className="icon-btn drawer-toggle"
          aria-label="Show files"
          aria-expanded={isNarrow ? drawerOpen : !sidebarCollapsed}
          onClick={() => (isNarrow ? setDrawerOpen(true) : setSidebarCollapsed(false))}
        >
          <Menu size={18} />
        </button>

        <GraphView
          ref={graphRef}
          data={displayed}
          index={displayedIndex}
          selectedId={selectedId}
          path={path}
          colorOf={nodeRGB}
          sizeOf={sizeOf}
          showNames={showNames}
          theme={theme}
          fitRequest={fitRequest}
          showMinimap={!isNarrow}
          layout={layout}
          groups={hulls}
          emphasis={emphasis}
          multiSelected={multiSelected}
          lassoMode={lassoMode}
          onLasso={(ids, additive) => {
            setMultiSelected((prev) => (additive ? new Set([...prev, ...ids]) : new Set(ids)));
            setLassoMode(false);
            setAnnouncement(`${ids.length} nodes selected.`);
          }}
          onNodeClick={(node, event) => {
            if (node.collapsedCount) {
              setCollapsedFolders((c) => {
                const next = new Set(c);
                next.delete(node.id);
                return next;
              });
            } else if (event.shiftKey) {
              setMultiSelected((prev) => {
                const next = new Set(prev);
                if (next.has(node.id)) next.delete(node.id);
                else next.add(node.id);
                return next;
              });
            } else if (node.group === 'folders') {
              setActiveFolder(node.id);
              selectNode(null);
            } else {
              selectNode(node.id);
            }
          }}
          onBackgroundClick={() => selectNode(null)}
          onNodePinned={onNodePinned}
        />

        <ScanBar
          value={scanInput}
          onChange={setScanInput}
          onSubmit={(url) => void startScan(url)}
          status={scan.status}
          message={scan.message}
          onDismissMessage={() => setScan((s) => ({ ...s, message: null }))}
          recent={recent}
        />

        {hasData && (
          <GraphToolbar
            colorMode={colorMode}
            onColorModeChange={setColorMode}
            showNames={showNames}
            onToggleNames={() => setShowNames((v) => !v)}
            showFolders={showFolders}
            onToggleFolders={() => setShowFolders((v) => !v)}
            theme={theme}
            onToggleTheme={toggleTheme}
            onFit={() => graphRef.current?.fitView()}
            onExport={(f) => void handleExport(f)}
            canShare={source.type === 'remote'}
            onCopyLink={() => void copyLink()}
            onShowShortcuts={() => setShowShortcuts(true)}
            highlight={highlight}
            onHighlightChange={setHighlight}
            highlightCount={highlightIds?.size ?? 0}
            onHighlightSubmit={() => setHighlightFit((n) => n + 1)}
            lassoMode={lassoMode}
            onToggleLasso={() => setLassoMode((m) => !m)}
            viewMenu={
              <ViewMenu
                layout={layout}
                onLayoutChange={setLayout}
                groupByFolder={groupByFolder}
                onToggleGroups={() => setGroupByFolder((g) => !g)}
                folders={folders}
                collapsed={collapsedFolders}
                onToggleCollapse={(key) =>
                  setCollapsedFolders((c) => {
                    const next = new Set(c);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
                onExpandAll={() => setCollapsedFolders(new Set())}
                sizeBy={sizeBy}
                onSizeByChange={setSizeBy}
                heatMetric={heatMetric}
                onHeatMetricChange={(m) => {
                  setHeatMetric(m);
                  setColorMode('heat');
                }}
                linkTypes={linkTypes}
                hiddenLinkTypes={hiddenLinkTypes}
                onToggleLinkType={(type) =>
                  setHiddenLinkTypes((h) => {
                    const next = new Set(h);
                    if (next.has(type)) next.delete(type);
                    else next.add(type);
                    return next;
                  })
                }
                pinnedCount={pinnedIds.size}
                onSaveLayout={saveCurrentLayout}
                onUnpinAll={unpinAll}
                onResetLayout={resetLayout}
              />
            }
          />
        )}

        {hasData && (
          <Legend
            key={`${colorMode}-${isNarrow}`}
            mode={legendMode}
            entries={legendEntries}
            hidden={hiddenSet}
            colorOf={legendColor}
            onToggle={toggleHidden}
            onShowOnly={showOnly}
            onShowAll={() => setHidden(new Set())}
            defaultOpen={!isNarrow}
            heat={
              colorMode === 'heat'
                ? {
                    label: `Heat: ${heatMetric === 'lines' ? 'lines of code' : heatMetric}`,
                    gradient: `linear-gradient(to right, ${heatStops.join(', ')})`,
                  }
                : undefined
            }
          />
        )}

        <div className="banners">
          {focusDepth > 0 && selectedNode && (
            <div className="floating focus-banner" role="status">
              <span>
                Showing {displayed.nodes.length} nodes within {focusDepth} {focusDepth === 1 ? 'step' : 'steps'} of{' '}
                <strong>{selectedNode.label}</strong>
              </span>
              <button type="button" className="btn" onClick={() => setFocusDepth(0)}>
                Show everything
              </button>
            </div>
          )}
          {impact && nodesById.get(impact.root) && (
            <div className="floating focus-banner" role="status">
              <span>
                <strong>{impact.depth.size - 1}</strong> {impact.depth.size - 1 === 1 ? 'node depends' : 'nodes depend'} on{' '}
                <strong>{nodesById.get(impact.root)!.label}</strong>, across{' '}
                {new Set([...impact.depth.keys()].map((id) => id.split('::')[0])).size} files
              </span>
              <button type="button" className="btn" aria-pressed={impactOnly} onClick={() => setImpactOnly((v) => !v)}>
                {impactOnly ? 'Show all nodes' : 'Show only these'}
              </button>
              <button type="button" className="btn btn--quiet" onClick={() => (setImpact(null), setImpactOnly(false))}>
                Clear
              </button>
            </div>
          )}
          {multiSelected.size > 0 && (
            <div className="floating focus-banner" role="status">
              <span>
                <strong>{multiSelected.size}</strong> selected
              </span>
              <button type="button" className="btn" aria-pressed={selectionOnly} onClick={() => setSelectionOnly((v) => !v)}>
                {selectionOnly ? 'Show all nodes' : 'Show only these'}
              </button>
              {multiSelected.size === 2 && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const [a, b] = [...multiSelected].map((id) => nodesById.get(id));
                    if (a && b) choosePathTarget(a, b);
                  }}
                >
                  Find path between
                </button>
              )}
              <button
                type="button"
                className="btn"
                onClick={() =>
                  downloadBlob(
                    new Blob([graphToJson(subgraph(viewGraph, (id) => multiSelected.has(id)))], { type: 'application/json' }),
                    `${exportName}-selection.json`,
                  )
                }
              >
                Export
              </button>
              <button type="button" className="btn btn--quiet" onClick={() => (setMultiSelected(new Set()), setSelectionOnly(false))}>
                Clear
              </button>
            </div>
          )}
        </div>

        {scanning && scan.repo && <ScanningState repo={scan.repo} startedAt={scan.startedAt} onCancel={cancelScan} />}
        {!scanning && loaded && !hasData && <EmptyState recent={recent} onScan={(repo) => void startScan(repo)} />}
        {!scanning && hasData && displayed.nodes.length === 0 && <FilteredOutState onReset={resetView} />}

        {notice && (
          <div className="floating toast" role="status">
            {notice}
          </div>
        )}
        <div className="visually-hidden" aria-live="polite">
          {announcement}
        </div>
      </main>

      {selectedNode && !isNarrow && panelSize === 'normal' && (
        <div
          className="resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize details panel"
          aria-valuenow={panelWidth}
          aria-valuemin={320}
          aria-valuemax={860}
          tabIndex={0}
          data-active={isResizing}
          onMouseDown={(e) => {
            e.preventDefault();
            setIsResizing(true);
          }}
          onKeyDown={onResizerKey}
        />
      )}

      <div
        className="panel-slot"
        data-open={!!selectedNode}
        data-resizing={isResizing}
        data-size={panelSize}
        style={{
          width: !selectedNode ? 0 : panelSize === 'wide' ? 'max(50vw, 360px)' : panelSize === 'full' ? undefined : panelWidth,
          opacity: selectedNode ? 1 : 0,
        }}
      >
        {selectedNode && (
          <DocTabs
            tabs={tabs}
            activeId={selectedId}
            nodesById={nodesById}
            colorOf={nodeColor}
            canBack={canGoBack(history)}
            canForward={canGoForward(history)}
            onBack={() => goHistory(-1)}
            onForward={() => goHistory(1)}
            onActivate={(id) => selectNode(id)}
            onClose={closeDocTab}
            onTogglePin={(id) => setTabs((t) => togglePin(t, id))}
          />
        )}
        {selectedNode && (
          <div className="panel-split" data-compare={!!compareId}>
          <NodePanel
            node={selectedNode}
            nodesById={nodesById}
            index={fullIndex}
            repo={source.type === 'remote' ? source.repo : null}
            colorOf={nodeColor}
            focusDepth={focusDepth}
            onFocusDepthChange={setFocusDepth}
            path={path}
            onFindPath={openPathPicker}
            onClearPath={() => setPath(null)}
            onSelect={(id, range) => selectNode(id, range ?? null)}
            onClose={() => selectNode(null)}
            onNotify={notify}
            size={panelSize}
            onSizeChange={setPanelSize}
            lineRange={lineRange}
            onLineRangeChange={setLineRange}
            readerSettings={readerSettings}
            onReaderSettingsChange={setReaderSettings}
            symbolNames={symbolIndex.titles}
            onSymbolClick={openSymbol}
            searchFocusSignal={searchFocusSignal}
            bookmarked={!!notes[selectedNode.id]?.bookmarked}
            onToggleBookmark={() => toggleBookmark(selectedNode.id)}
            note={notes[selectedNode.id]?.note ?? ''}
            onNoteChange={(text) => setNote(selectedNode.id, text)}
            onCompare={() => (compareId ? setCompareId(null) : openComparePicker())}
            comparing={!!compareId}
            impactActive={impact?.root === selectedNode.id}
            onImpact={() => showImpact(impact?.root === selectedNode.id ? null : selectedNode.id)}
          />
          {compareId && nodesById.get(compareId) && (
            <ComparePane
              node={nodesById.get(compareId)!}
              nodesById={nodesById}
              colorOf={nodeColor}
              readerSettings={readerSettings}
              onReaderSettingsChange={setReaderSettings}
              symbolNames={symbolIndex.titles}
              onSymbolClick={(name) => {
                const target = symbolIndex.ids.get(name)?.[0];
                if (target) setCompareId(target);
              }}
              onSwap={() => {
                const main = selectedId;
                selectNode(compareId);
                setCompareId(main);
              }}
              onClose={() => setCompareId(null)}
              onNotify={notify}
            />
          )}
          </div>
        )}
      </div>

      {paletteState && (
        <CommandPalette
          nodes={withFolders.nodes}
          mode={paletteState.mode}
          from={paletteState.from}
          initialQuery={paletteState.query}
          recent={recentIds(history)
            .filter((id) => id !== selectedId)
            .map((id) => nodesById.get(id))
            .filter((n): n is NodeData => !!n)}
          commands={commands}
          searchText={searchText}
          nodesById={nodesById}
          onClose={() => setPalette(null)}
          onOpenText={(hit) => selectNode(hit.nodeId, { from: hit.line, to: hit.line })}
          onSelect={(node) => {
            if (paletteState.mode === 'path' && paletteState.from) choosePathTarget(paletteState.from, node);
            else if (paletteState.mode === 'compare') chooseCompare(node);
            else selectNode(node.id);
          }}
        />
      )}
      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}

export default App;
