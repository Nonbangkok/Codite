import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  createCrossingReductionForce,
  MAX_CROSSING_PUSH,
  createDegreeMap,
  getCollisionRadius,
  getGraphChargeStrength,
  getGraphLinkDistance,
  getGraphLinkStrength,
  isLeafNode,
  type SimLink,
  type SimNode,
} from '../src/utils/graphLayout.ts';

const file = (id: string, group = 'src'): SimNode => ({
  id,
  label: id,
  group,
  val: 20,
});

const leaf = (id: string, group = 'functions'): SimNode => ({
  id,
  label: id,
  group,
  val: 8,
});

const segmentsCross = (first: SimLink, second: SimLink): boolean => {
  const a = first.source as SimNode;
  const b = first.target as SimNode;
  const c = second.source as SimNode;
  const d = second.target as SimNode;
  const ccw = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (
    (cy - ay) * (bx - ax) > (by - ay) * (cx - ax)
  );

  return ccw(a.x!, a.y!, c.x!, c.y!, d.x!, d.y!)
    !== ccw(b.x!, b.y!, c.x!, c.y!, d.x!, d.y!)
    && ccw(a.x!, a.y!, b.x!, b.y!, c.x!, c.y!)
    !== ccw(a.x!, a.y!, b.x!, b.y!, d.x!, d.y!);
};

const applyVelocity = (nodes: SimNode[], decay = 0.82) => {
  for (const node of nodes) {
    node.x = node.x! + (node.vx ?? 0);
    node.y = node.y! + (node.vy ?? 0);
    node.vx = (node.vx ?? 0) * decay;
    node.vy = (node.vy ?? 0) * decay;
  }
};

test('leaf links stay shorter and stronger than file-to-file structure links', () => {
  const fileNode = file('src/lib.rs');
  const functionNode = leaf('src/lib.rs::fn::run::10');
  const moduleNode = file('src/config/mod.rs', 'config');
  const sqrtNodeCount = 9;

  const leafLink: SimLink = { source: fileNode, target: functionNode, type: 'contains' };
  const moduleLink: SimLink = { source: fileNode, target: moduleNode, type: 'declares_module' };

  assert.equal(isLeafNode(functionNode), true);
  assert.equal(isLeafNode(fileNode), false);
  assert.ok(getGraphLinkDistance(leafLink, sqrtNodeCount) < getGraphLinkDistance(moduleLink, sqrtNodeCount));
  assert.ok(getGraphLinkStrength(leafLink) > getGraphLinkStrength(moduleLink));
});

test('degree-aware charge keeps hubs separated without over-repelling leaves', () => {
  const hub = file('src/lib.rs');
  const functionNode = leaf('src/lib.rs::fn::run::10');
  const degree = new Map([
    [hub.id, 12],
    [functionNode.id, 1],
  ]);

  const hubCharge = getGraphChargeStrength(hub, degree);
  const leafCharge = getGraphChargeStrength(functionNode, degree);

  assert.ok(hubCharge < leafCharge);
  assert.ok(leafCharge > -100);
  assert.ok(hubCharge < -200);
});

test('degree map accepts links after d3 has resolved endpoints to node objects', () => {
  const a = file('a.rs');
  const b = file('b.rs');
  const c = leaf('a.rs::fn::main::1');
  const degree = createDegreeMap([a, b, c], [
    { source: a, target: b, type: 'declares_module' },
    { source: a, target: c, type: 'contains' },
  ]);

  assert.equal(degree.get(a.id), 2);
  assert.equal(degree.get(b.id), 1);
  assert.equal(degree.get(c.id), 1);
});

test('collision radius includes node size and compact padding', () => {
  assert.equal(getCollisionRadius({ ...file('large.rs'), val: 25 }), 17.5);
});

test('crossing force nudges crossed segments without rank or tree assumptions', () => {
  const a = { ...file('a.rs'), x: -10, y: -10, vx: 0, vy: 0 };
  const b = { ...file('b.rs'), x: 10, y: 10, vx: 0, vy: 0 };
  const c = { ...file('c.rs'), x: -10, y: 10, vx: 0, vy: 0 };
  const d = { ...file('d.rs'), x: 10, y: -10, vx: 0, vy: 0 };
  const links: SimLink[] = [
    { source: a, target: b, type: 'declares_module' },
    { source: c, target: d, type: 'declares_module' },
  ];

  const force = createCrossingReductionForce(links, 10);
  force(1);

  for (const node of [a, b, c, d]) {
    assert.notEqual(node.vx, 0);
    assert.notEqual(node.vy, 0);
  }
});

test('crossing force separates a direct x crossing after repeated ticks', () => {
  const a = { ...file('a.rs'), x: -10, y: -10, vx: 0, vy: 0 };
  const b = { ...file('b.rs'), x: 10, y: 10, vx: 0, vy: 0 };
  const c = { ...file('c.rs'), x: -10, y: 10, vx: 0, vy: 0 };
  const d = { ...file('d.rs'), x: 10, y: -10, vx: 0, vy: 0 };
  const links: SimLink[] = [
    { source: a, target: b, type: 'declares_module' },
    { source: c, target: d, type: 'declares_module' },
  ];
  const nodes = [a, b, c, d];
  const force = createCrossingReductionForce(links, 10);

  assert.equal(segmentsCross(links[0], links[1]), true);

  for (let i = 0; i < 8; i++) {
    force(0.8);
    applyVelocity(nodes);
  }

  assert.equal(segmentsCross(links[0], links[1]), false);
});

test('crossing force does not starve later link pairs when sampling is limited', () => {
  const a = { ...file('a.rs'), x: -40, y: -40, vx: 0, vy: 0 };
  const b = { ...file('b.rs'), x: -30, y: -30, vx: 0, vy: 0 };
  const c = { ...file('c.rs'), x: -10, y: -10, vx: 0, vy: 0 };
  const d = { ...file('d.rs'), x: 10, y: 10, vx: 0, vy: 0 };
  const e = { ...file('e.rs'), x: -10, y: 10, vx: 0, vy: 0 };
  const f = { ...file('f.rs'), x: 10, y: -10, vx: 0, vy: 0 };
  const links: SimLink[] = [
    { source: a, target: b, type: 'declares_module' },
    { source: c, target: d, type: 'declares_module' },
    { source: e, target: f, type: 'declares_module' },
  ];
  const nodes = [a, b, c, d, e, f];
  const force = createCrossingReductionForce(links, 1);
  const originalRandom = Math.random;
  Math.random = () => 0;

  try {
    assert.equal(segmentsCross(links[1], links[2]), true);

    for (let i = 0; i < 8; i++) {
      force(0.8);
      applyVelocity(nodes);
    }

    assert.equal(segmentsCross(links[1], links[2]), false);
  } finally {
    Math.random = originalRandom;
  }
});

test('crossing force stays bounded for a hub caught in many crossings (no flinging)', () => {
  // A hub whose 40 spokes cross 40 parallel links: previously each crossing added a full kick,
  // so the hub gained hundreds of px of velocity in one tick and the layout exploded.
  const hub = { ...file('hub.rs'), x: 0, y: 0, vx: 0, vy: 0 };
  const links: SimLink[] = [];
  const nodes: SimNode[] = [hub];
  for (let i = 0; i < 40; i++) {
    const angle = (i / 40) * Math.PI * 2;
    const spoke = { ...leaf(`s${i}.rs`), x: Math.cos(angle) * 200, y: Math.sin(angle) * 200, vx: 0, vy: 0 };
    const left = { ...file(`l${i}.rs`), x: -250, y: -150 + i * 7.5, vx: 0, vy: 0 };
    const right = { ...file(`r${i}.rs`), x: 250, y: -150 + i * 7.5 + 3, vx: 0, vy: 0 };
    nodes.push(spoke, left, right);
    links.push({ source: hub, target: spoke, type: 'contains' }, { source: left, target: right, type: 'imports' });
  }
  const force = createCrossingReductionForce(links, 100_000);
  force(1);
  const fastest = Math.max(...nodes.map((n) => Math.hypot(n.vx ?? 0, n.vy ?? 0)));
  assert.ok(fastest > 0, 'some crossing was pushed');
  assert.ok(fastest <= MAX_CROSSING_PUSH + 1e-9, `fastest node moved ${fastest.toFixed(1)} px in one tick`);
});

test('speed limit caps every node velocity and keeps direction', async () => {
  const { createSpeedLimitForce, MAX_NODE_SPEED } = await import('../src/utils/graphLayout.ts');
  const fast = { ...file('a.rs'), x: 0, y: 0, vx: 300, vy: 400 };
  const slow = { ...file('b.rs'), x: 0, y: 0, vx: 3, vy: -4 };
  const force = createSpeedLimitForce();
  force.initialize([fast, slow]);
  force();
  assert.ok(Math.abs(Math.hypot(fast.vx, fast.vy) - MAX_NODE_SPEED) < 1e-9);
  assert.ok(Math.abs(fast.vx / fast.vy - 0.75) < 1e-9);
  assert.deepEqual([slow.vx, slow.vy], [3, -4]);
});
