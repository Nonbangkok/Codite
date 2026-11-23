import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu } from 'lucide-react';
import type { GraphData, LinkData, NodeData } from './types';
import { GraphView, type ColorMode, type FitRequest, type GraphHandle } from './components/graph/GraphView';
import { GraphToolbar, type ExportFormat } from './components/graph/GraphToolbar';
import { Legend } from './components/graph/Legend';
import { NodePanel } from './components/NodePanel';
import { CommandPalette } from './components/CommandPalette';
import { FileExplorer } from './components/FileExplorer';
import { ScanBar, type ScanStatus } from './components/ScanBar';
import { EmptyState, FilteredOutState, ScanningState } from './components/StageStates';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { buildFileTree, buildFolderNodes } from './utils/treeUtils';
import { buildGraphIndex, isInFolder, linkEndId, neighborhood, shortestPath, subgraph, type PathResult } from './utils/graphIndex';
import { countBy, nodeKind } from './utils/nodeKinds';
import { downloadBlob, graphToJson, graphToSvg, safeFilename } from './utils/exportGraph';
import { loadRecentScans, readRepoParam, rememberScan, repoToUrl, withRepoParam } from './utils/share';
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
  const [palettePathFrom, setPalettePathFrom] = useState<NodeData | null>(null);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(480);
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
    (id: string | null) => {
      setSelectedId(id);
      if (id) {
        if (activeFolder && !isInFolder(id, activeFolder)) setActiveFolder(null);
        const node = nodesById.get(id);
        if (node) setAnnouncement(`Selected ${node.label}`);
      } else {
        setFocusDepth(0);
      }
    },
    [activeFolder, nodesById],
  );

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
    setPalettePathFrom(selectedNode);
    setIsPaletteOpen(true);
  }, [selectedNode, notify]);

  const choosePathTarget = (target: NodeData) => {
    if (!palettePathFrom) return;
    const result = shortestPath(fullIndex, palettePathFrom.id, target.id);
    if (!result) {
      notify(`${palettePathFrom.label} and ${target.label} are not connected.`);
      return;
    }
    setPath(result);
    setSelectedId(palettePathFrom.id);
    setAnnouncement(`Path found with ${result.nodeIds.length - 1} steps from ${palettePathFrom.label} to ${target.label}.`);
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
        setPalettePathFrom(null);
        setIsPaletteOpen((open) => !open);
        return;
      }
      if (e.defaultPrevented || isPaletteOpen || showShortcuts || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      switch (e.key) {
        case '/':
          e.preventDefault();
          setPalettePathFrom(null);
          setIsPaletteOpen(true);
          break;
        case '?':
          setShowShortcuts(true);
          break;
        case 'Escape':
          if (drawerOpen) setDrawerOpen(false);
          else if (path) setPath(null);
          else if (focusDepth) setFocusDepth(0);
          else if (selectedId) selectNode(null);
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
  }, [isPaletteOpen, showShortcuts, drawerOpen, path, focusDepth, selectedId, selectNode, openPathPicker, toggleTheme, notify]);

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
    <div className="app">
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
      />

      <main className="stage" aria-label="Graph">
        <button
          type="button"
          className="icon-btn drawer-toggle"
          aria-label="Show files"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
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

      {selectedNode && !isNarrow && (
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
        style={{ width: selectedNode ? panelWidth : 0, opacity: selectedNode ? 1 : 0 }}
      >
        {selectedNode && (
          <NodePanel
            node={selectedNode}
            nodesById={nodesById}
            index={fullIndex}
            repo={source.type === 'remote' ? source.repo : null}
            theme={theme}
            colorOf={nodeColor}
            focusDepth={focusDepth}
            onFocusDepthChange={setFocusDepth}
            path={path}
            onFindPath={openPathPicker}
            onClearPath={() => setPath(null)}
            onSelect={(id) => selectNode(id)}
            onClose={() => selectNode(null)}
            onNotify={notify}
          />
        )}
      </div>

      {isPaletteOpen && (
        <CommandPalette
          nodes={withFolders.nodes}
          pathFrom={palettePathFrom}
          onClose={() => {
            setIsPaletteOpen(false);
            setPalettePathFrom(null);
          }}
          onSelect={(node) => (palettePathFrom ? choosePathTarget(node) : selectNode(node.id))}
        />
      )}
      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}

export default App;
