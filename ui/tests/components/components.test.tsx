// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import fixture from '../fixtures/graph.json';
import type { GraphData } from '../../src/types';
import { CommandPalette } from '../../src/components/CommandPalette';
import { NodePanel } from '../../src/components/NodePanel';
import { FileExplorer } from '../../src/components/FileExplorer';
import { Legend } from '../../src/components/graph/Legend';
import { buildGraphIndex, shortestPath } from '../../src/utils/graphIndex';
import { buildFileTree } from '../../src/utils/treeUtils';

afterEach(cleanup);
// jsdom has no layout, so scrolling is a no-op.
Element.prototype.scrollIntoView = () => {};

const graph = fixture as GraphData;
const nodes = graph.nodes.filter((n) => n.group !== 'imports');
const nodesById = new Map(nodes.map((n) => [n.id, n]));
const index = buildGraphIndex({ nodes, links: graph.links });
const MAIN = 'demo/src/app.ts::fn::main::34';

describe('CommandPalette', () => {
  test('filters, moves with arrows and selects with Enter', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette nodes={nodes} onSelect={onSelect} onClose={onClose} />);

    const input = screen.getByRole('combobox');
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'helper' } });
    const options = screen.getAllByRole('option');
    expect(options[0].textContent).toContain('helper');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ label: 'helper' }));
    expect(onClose).toHaveBeenCalled();
  });

  test('Escape closes and an empty result says so', () => {
    const onClose = vi.fn();
    render(<CommandPalette nodes={nodes} onSelect={vi.fn()} onClose={onClose} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzzzqqq' } });
    expect(screen.getByRole('status').textContent).toContain('No files or symbols match');
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  test('path mode names the start and excludes it from results', () => {
    const from = nodesById.get(MAIN)!;
    render(<CommandPalette nodes={nodes} onSelect={vi.fn()} onClose={vi.fn()} mode="path" from={from} />);
    expect(screen.getByRole('dialog', { name: 'Find a path from main' })).toBeTruthy();
    expect(screen.queryAllByRole('option').some((o) => o.textContent?.includes(MAIN.split('::')[0]) && o.textContent.startsWith('main'))).toBe(false);
  });
});

describe('NodePanel', () => {
  const baseProps = {
    nodesById,
    index,
    repo: 'owner/demo',
    theme: 'dark' as const,
    colorOf: () => '#999',
    focusDepth: 0,
    onFocusDepthChange: vi.fn(),
    path: null,
    onFindPath: vi.fn(),
    onClearPath: vi.fn(),
    onClose: vi.fn(),
    onNotify: vi.fn(),
    size: 'normal' as const,
    onSizeChange: vi.fn(),
    lineRange: null,
    onLineRangeChange: vi.fn(),
    readerSettings: { wrap: true, compact: false, fontSize: 13 },
    onReaderSettingsChange: vi.fn(),
    symbolNames: new Map<string, string>(),
    onSymbolClick: vi.fn(),
    searchFocusSignal: 0,
  };

  test('groups connections by relation and navigates on click', () => {
    const onSelect = vi.fn();
    render(<NodePanel {...baseProps} node={nodesById.get('demo/src/util.ts')!} onSelect={onSelect} />);
    expect(screen.getByRole('heading', { name: 'util.ts' })).toBeTruthy();
    // Files open on their code; connections live in their own tab.
    expect(screen.getByRole('tab', { name: 'Code' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: /Connections/ }));
    expect(screen.getByRole('heading', { name: /Contains/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Imports/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Imported by/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /math\.ts/ }));
    expect(onSelect).toHaveBeenCalledWith('demo/lib/math.ts');
  });

  test('shows the symbol line and links to it on GitHub', () => {
    render(<NodePanel {...baseProps} node={nodesById.get(MAIN)!} onSelect={vi.fn()} />);
    expect(screen.getByText('Line 3')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open on GitHub/ }).getAttribute('href')).toBe(
      'https://github.com/owner/demo/blob/HEAD/src/app.ts#L3-L5',
    );
  });

  test('lists path steps in order and clears them', () => {
    const onClearPath = vi.fn();
    const path = shortestPath(index, MAIN, 'demo/lib/math.ts::fn::add::0');
    render(<NodePanel {...baseProps} node={nodesById.get(MAIN)!} path={path} onClearPath={onClearPath} onSelect={vi.fn()} />);
    const section = screen.getByRole('heading', { name: /Path to add/ }).closest('section')!;
    const steps = within(section).getAllByRole('listitem').map((li) => li.textContent);
    expect(steps.map((s) => s?.replace(/(File|Function)$/, ''))).toEqual(['main', 'app.ts', 'util.ts', 'math.ts', 'add']);
    fireEvent.click(within(section).getByRole('button', { name: 'Clear path' }));
    expect(onClearPath).toHaveBeenCalled();
  });

  test('omits the GitHub link for local data', () => {
    render(<NodePanel {...baseProps} repo={null} node={nodesById.get(MAIN)!} onSelect={vi.fn()} />);
    expect(screen.queryByRole('link', { name: /Open on GitHub/ })).toBeNull();
  });
});

describe('NodePanel tabs', () => {
  test('arrow keys move between tabs and Details lists facts', () => {
    render(
      <NodePanel
        nodesById={nodesById}
        index={index}
        repo={null}
        colorOf={() => '#999'}
        focusDepth={0}
        onFocusDepthChange={vi.fn()}
        path={null}
        onFindPath={vi.fn()}
        onClearPath={vi.fn()}
        onClose={vi.fn()}
        onNotify={vi.fn()}
        size="normal"
        onSizeChange={vi.fn()}
        lineRange={null}
        onLineRangeChange={vi.fn()}
        readerSettings={{ wrap: true, compact: false, fontSize: 13 }}
        onReaderSettingsChange={vi.fn()}
        symbolNames={new Map()}
        onSymbolClick={vi.fn()}
        searchFocusSignal={0}
        node={nodesById.get(MAIN)!}
        onSelect={vi.fn()}
      />,
    );
    const code = screen.getByRole('tab', { name: 'Code' });
    fireEvent.keyDown(code, { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('tab', { name: /Connections/ }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Details' }).getAttribute('aria-selected')).toBe('true');
    const details = screen.getByRole('tabpanel');
    expect(details.textContent).toContain('Lines3–5 (3 lines)');
    expect(details.textContent).toContain('Nesting depth1');
  });
});

describe('FileExplorer', () => {
  const tree = buildFileTree(nodes);
  const props = {
    tree,
    sourceLabel: 'demo (local)',
    activeFolderPath: null,
    selectedId: null,
    onFolderSelect: vi.fn(),
    onFileSelect: vi.fn(),
    open: false,
    onRequestClose: vi.fn(),
  };

  test('exposes a tree and expands folders with the keyboard', () => {
    render(<FileExplorer {...props} />);
    const root = screen.getByRole('treeitem', { name: 'demo' });
    expect(root.getAttribute('aria-expanded')).toBe('false');
    root.focus();
    fireEvent.keyDown(root, { key: 'ArrowRight' });
    expect(screen.getByRole('treeitem', { name: 'demo' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('treeitem', { name: 'src' })).toBeTruthy();
  });

  test('reveals and marks the selected file', () => {
    const onFileSelect = vi.fn();
    render(<FileExplorer {...props} selectedId={MAIN} onFileSelect={onFileSelect} />);
    const file = screen.getByRole('treeitem', { name: 'app.ts' });
    expect(file.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('treeitem', { name: 'util.ts' }));
    expect(onFileSelect).toHaveBeenCalledWith('demo/src/util.ts');
  });
});

describe('Legend', () => {
  test('toggles a kind and Alt-click shows only that kind', () => {
    const onToggle = vi.fn();
    const onShowOnly = vi.fn();
    render(
      <Legend
        mode="kind"
        entries={[
          { key: 'files', count: 4 },
          { key: 'functions', count: 3 },
        ]}
        hidden={new Set(['functions'])}
        colorOf={() => '#999'}
        onToggle={onToggle}
        onShowOnly={onShowOnly}
        onShowAll={vi.fn()}
      />,
    );
    const functions = screen.getByRole('button', { name: /Functions/ });
    expect(functions.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(functions);
    expect(onToggle).toHaveBeenCalledWith('functions');
    fireEvent.click(screen.getByRole('button', { name: /Files/ }), { altKey: true });
    expect(onShowOnly).toHaveBeenCalledWith('files');
    expect(screen.getByText('1 hidden')).toBeTruthy();
  });
});
