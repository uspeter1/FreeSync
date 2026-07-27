// Run with: npx tsx --test packages/plugin/src/canvas-sync.test.ts
//
// Verifies the canvas-sync module handles the concurrent-edit case that the
// old text-diff path was corrupting. Two Y.Docs simulate two devices; edits
// on one are transferred to the other via encodeStateAsUpdate + applyUpdate
// (same wire format y-websocket uses).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Y from 'yjs';
import {
  applyCanvasFromDisk,
  serializeCanvasToDisk,
  getCanvasNodes,
  getCanvasEdges,
  isCanvasFile,
} from './canvas-sync';

function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

const seedCanvas = () => JSON.stringify({
  nodes: [
    { id: 'n1', type: 'text', x: 0,   y: 0, width: 200, height: 100, text: 'A' },
    { id: 'n2', type: 'text', x: 400, y: 0, width: 200, height: 100, text: 'B' },
  ],
  edges: [
    { id: 'e1', fromNode: 'n1', toNode: 'n2' },
  ],
});

test('isCanvasFile matches .canvas extension case-insensitively', () => {
  assert.equal(isCanvasFile('foo.canvas'), true);
  assert.equal(isCanvasFile('FOO.CANVAS'), true);
  assert.equal(isCanvasFile('foo/bar.canvas'), true);
  assert.equal(isCanvasFile('foo.canvas.md'), false); // Excalidraw sidecar shape
  assert.equal(isCanvasFile('foo.md'), false);
});

test('round-trip: applyCanvasFromDisk → serializeCanvasToDisk is stable', () => {
  const doc = new Y.Doc();
  applyCanvasFromDisk(doc, seedCanvas());
  const out = serializeCanvasToDisk(doc);
  const parsed = JSON.parse(out);
  assert.equal(parsed.nodes.length, 2);
  assert.equal(parsed.edges.length, 1);
  const n1 = parsed.nodes.find((n: { id: string }) => n.id === 'n1');
  assert.equal(n1.text, 'A');
  assert.equal(n1.x, 0);
});

test('bad JSON on disk does not clobber existing doc state', () => {
  const doc = new Y.Doc();
  applyCanvasFromDisk(doc, seedCanvas());
  const before = serializeCanvasToDisk(doc);
  applyCanvasFromDisk(doc, '{ not valid json');
  const after = serializeCanvasToDisk(doc);
  assert.equal(before, after, 'doc should be untouched when disk JSON is malformed');
});

test('empty JSON on disk is treated as an empty canvas', () => {
  const doc = new Y.Doc();
  applyCanvasFromDisk(doc, '');
  assert.equal(getCanvasNodes(doc).size, 0);
  assert.equal(getCanvasEdges(doc).size, 0);
});

test('reconciling adds new nodes, updates changed fields, removes gone ones', () => {
  const doc = new Y.Doc();
  applyCanvasFromDisk(doc, seedCanvas());

  const modified = JSON.stringify({
    nodes: [
      // n1 kept but moved
      { id: 'n1', type: 'text', x: 100, y: 100, width: 200, height: 100, text: 'A' },
      // n2 removed
      // n3 added
      { id: 'n3', type: 'text', x: 200, y: 200, width: 200, height: 100, text: 'C' },
    ],
    edges: [], // e1 removed
  });
  applyCanvasFromDisk(doc, modified);

  const nodes = getCanvasNodes(doc);
  assert.equal(nodes.size, 2);
  assert.ok(nodes.get('n1'));
  assert.ok(nodes.get('n3'));
  assert.equal(nodes.get('n1')!.get('x'), 100);
  assert.equal(getCanvasEdges(doc).size, 0);
});

test('CONCURRENT EDIT (the whole point): two users move different nodes, both changes survive', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();

  // Both start from the same canvas
  applyCanvasFromDisk(docA, seedCanvas());
  sync(docA, docB);

  // Simulate A moving n1
  const a1 = getCanvasNodes(docA).get('n1')!;
  a1.set('x', 500);

  // Simulate B moving n2 (concurrently, before seeing A's update)
  const b2 = getCanvasNodes(docB).get('n2')!;
  b2.set('y', 500);

  // Sync
  sync(docA, docB);

  // Both should see both changes
  const jsonA = JSON.parse(serializeCanvasToDisk(docA));
  const jsonB = JSON.parse(serializeCanvasToDisk(docB));
  assert.deepEqual(jsonA, jsonB, 'A and B must converge to the same JSON');
  const n1 = jsonA.nodes.find((n: { id: string }) => n.id === 'n1');
  const n2 = jsonA.nodes.find((n: { id: string }) => n.id === 'n2');
  assert.equal(n1.x, 500, 'A\'s move of n1 preserved');
  assert.equal(n2.y, 500, 'B\'s move of n2 preserved');
});

test('CONCURRENT EDIT on the SAME node: different fields both survive', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  applyCanvasFromDisk(docA, seedCanvas());
  sync(docA, docB);

  // A moves n1's x; B changes n1's text — different fields on same node
  getCanvasNodes(docA).get('n1')!.set('x', 999);
  getCanvasNodes(docB).get('n1')!.set('text', 'Changed');

  sync(docA, docB);
  const n1 = JSON.parse(serializeCanvasToDisk(docA)).nodes[0];
  assert.equal(n1.x, 999);
  assert.equal(n1.text, 'Changed');
});

test('CONCURRENT CREATE: both users add a new node at the same moment', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  applyCanvasFromDisk(docA, seedCanvas());
  sync(docA, docB);

  // A adds n-alpha; B adds n-beta — different IDs
  const nAlpha = new Y.Map();
  nAlpha.set('id', 'n-alpha');
  nAlpha.set('type', 'text');
  nAlpha.set('x', 1000); nAlpha.set('y', 0);
  nAlpha.set('width', 100); nAlpha.set('height', 100);
  nAlpha.set('text', 'alpha');
  getCanvasNodes(docA).set('n-alpha', nAlpha);

  const nBeta = new Y.Map();
  nBeta.set('id', 'n-beta');
  nBeta.set('type', 'text');
  nBeta.set('x', 0); nBeta.set('y', 1000);
  nBeta.set('width', 100); nBeta.set('height', 100);
  nBeta.set('text', 'beta');
  getCanvasNodes(docB).set('n-beta', nBeta);

  sync(docA, docB);

  const ids = JSON.parse(serializeCanvasToDisk(docA)).nodes.map((n: { id: string }) => n.id);
  assert.ok(ids.includes('n-alpha'));
  assert.ok(ids.includes('n-beta'));
  assert.equal(JSON.parse(serializeCanvasToDisk(docA)).nodes.length, 4);
});

test('CONCURRENT DELETE + EDIT: delete wins over field edit (Yjs semantic)', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  applyCanvasFromDisk(docA, seedCanvas());
  sync(docA, docB);

  // A deletes n1; B edits n1's text
  getCanvasNodes(docA).delete('n1');
  getCanvasNodes(docB).get('n1')!.set('text', 'Doomed edit');

  sync(docA, docB);

  // Yjs semantic: the delete of the parent map removes it, edits to
  // sub-fields on a deleted node are silently dropped. Both docs converge.
  const a = JSON.parse(serializeCanvasToDisk(docA));
  const b = JSON.parse(serializeCanvasToDisk(docB));
  assert.deepEqual(a, b, 'concurrent delete+edit must still converge');
  assert.equal(a.nodes.length, 1, 'only n2 remains');
  assert.equal(a.nodes[0].id, 'n2');
});

test('serialized output is always parseable JSON, including after concurrent chaos', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  applyCanvasFromDisk(docA, seedCanvas());
  sync(docA, docB);

  // Do a bunch of concurrent edits
  for (let i = 0; i < 20; i++) {
    getCanvasNodes(docA).get('n1')!.set('x', i);
    getCanvasNodes(docB).get('n2')!.set('y', i * 2);
  }
  sync(docA, docB);

  // The disk JSON must always parse. This is the specific failure mode
  // the old text-diff path could produce.
  assert.doesNotThrow(() => JSON.parse(serializeCanvasToDisk(docA)));
  assert.doesNotThrow(() => JSON.parse(serializeCanvasToDisk(docB)));
});
