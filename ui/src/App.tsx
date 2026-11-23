import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu } from 'lucide-react';
import type { GraphData, LinkData, NodeData } from './types';
import { GraphView, type ColorMode, type FitRequest, type GraphHandle } from './components/graph/GraphView';
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

  const scoped = useMemo(
    () => (activeFolder ? subgraph(withFolders, (id) => isInFolder(id, activeFolder)) : withFolders),
    [withFolders, activeFolder],
  );

  const legendMode = colorMode;
  const legendEntries = useMemo(() => countBy(scoped.nodes, legendMode), [scoped.nodes, legendMode]);
  const hiddenSet = legendMode === 'kind' ? hiddenKinds : hiddenLanguages;

  const pathIds = useMemo(() => new Set(path?.nodeIds ?? []), [path]);

  const visible = useMemo(() => {
    const scopedIds = new Set(scoped.nodes.map((n) => n.id));
    return subgraph(withFolders, (id) => {
      if (pathIds.has(id)) return true;
      if (!scopedIds.has(id)) return false;
      const node = nodesById.get(id)!;
      return !hiddenKinds.has(nodeKind(node)) && !hiddenLanguages.has(node.language || 'other');
    });
  }, [withFolders, scoped, nodesById, hiddenKinds, hiddenLanguages, pathIds]);

  const selectedNode = selectedId ? (nodesById.get(selectedId) ?? null) : null;

  const displayed = useMemo(() => {
    if (focusDepth === 0 || !selectedId) return visible;
    const near = neighborhood(buildGraphIndex(visible), selectedId, focusDepth);
    for (const id of pathIds) near.add(id);
    return near.size > 0 ? subgraph(visible, (id) => near.has(id)) : visible;
  }, [visible, focusDepth, selectedId, pathIds]);

  const displayedIndex = useMemo(() => buildGraphIndex(displayed), [displayed]);

  const fitRequest = useMemo<FitRequest>(
    () => ({
      key: [datasetKey, activeFolder, focusDepth ? `${selectedId}:${focusDepth}` : '', path?.nodeIds.join('>') ?? ''].join('|'),
      ids: path ? pathIds : undefined,
    }),
    [datasetKey, activeFolder, focusDepth, selectedId, path, pathIds],
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

  // ── Colors
  const nodeColor = useCallback(
    (node: NodeData) =>
      rgba(
        colorMode === 'language'
          ? (palette.language[node.language] ?? palette.language.default)
          : (palette.kind[nodeKind(node)] ?? palette.kind.default),
        1,
      ),
    [colorMode, palette],
  );
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
        case 'Escape':
          if (drawerOpen) setDrawerOpen(false);
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
  }, [isPaletteOpen, showShortcuts, drawerOpen, path, focusDepth, selectedId, selectNode, openPathPicker, toggleTheme, notify, nodesById, panelSize, setPanelSize, setReaderSettings, goHistory, openPalette, setSidebarCollapsed]);

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
          colorMode={colorMode}
          showNames={showNames}
          theme={theme}
          fitRequest={fitRequest}
          showMinimap={!isNarrow}
          onNodeClick={(node) => {
            if (node.group === 'folders') {
              setActiveFolder(node.id);
              selectNode(null);
            } else {
              selectNode(node.id);
            }
          }}
          onBackgroundClick={() => selectNode(null)}
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
          />
        )}

        {hasData && (
          <Legend
            key={`${legendMode}-${isNarrow}`}
            mode={legendMode}
            entries={legendEntries}
            hidden={hiddenSet}
            colorOf={legendColor}
            onToggle={toggleHidden}
            onShowOnly={showOnly}
            onShowAll={() => setHidden(new Set())}
            defaultOpen={!isNarrow}
          />
        )}

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
