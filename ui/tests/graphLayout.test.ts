import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCrossingReductionForce,
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
  assert.equal(getCollisionRadius({ ...file('large.rs'), val: 25 }), 18);
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
