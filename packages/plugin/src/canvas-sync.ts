// Schema-aware CRDT bridge for Obsidian .canvas files (JSON Canvas 1.0).
//
// Problem this solves: the default text-diff path from sync.ts diffs the whole
// canvas JSON as a string via minimalDiff(). Under concurrent edits, Yjs can
// splice characters mid-token and produce structurally invalid JSON that
// Obsidian's Canvas view refuses to open. This module holds nodes and edges
// as Yjs collections so concurrent moves / edits merge cleanly at the object
// level and the serialized JSON is always valid.
//
// Data model in the per-file Y.Doc:
//   yNodes: Y.Map<Y.Map<any>>   keyed by node.id (each entry is a nested map)
//   yEdges: Y.Map<Y.Map<any>>   keyed by edge.id
//
// Nested Y.Maps let two users modify different fields of the same node (one
// moves it, one resizes it) without clobbering each other.

import * as Y from 'yjs';

const LOCAL_ORIGIN = 'local';

export function isCanvasFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.canvas');
}

interface CanvasNode { id: string; [key: string]: unknown }
interface CanvasEdge { id: string; [key: string]: unknown }
interface CanvasJson { nodes?: CanvasNode[]; edges?: CanvasEdge[] }

export function getCanvasNodes(doc: Y.Doc): Y.Map<Y.Map<any>> {
  return doc.getMap<Y.Map<any>>('canvas-nodes');
}
export function getCanvasEdges(doc: Y.Doc): Y.Map<Y.Map<any>> {
  return doc.getMap<Y.Map<any>>('canvas-edges');
}

// Parse the JSON on disk and reconcile the doc's Y.Maps with it. Adds missing
// entries, updates changed fields on existing entries (leaves untouched fields
// alone so remote in-flight edits aren't clobbered), and removes entries that
// no longer exist. Wrapped in a single transaction with LOCAL_ORIGIN so the
// origin filter in sync.ts's remote-update handler skips this.
export function applyCanvasFromDisk(doc: Y.Doc, jsonText: string): void {
  let parsed: CanvasJson;
  try {
    parsed = jsonText.trim() ? JSON.parse(jsonText) : {};
  } catch {
    // Ignore bad JSON — leave the Y.Doc alone so remote edits don't get
    // clobbered by a local half-saved file. Obsidian will re-save shortly.
    return;
  }

  const yNodes = getCanvasNodes(doc);
  const yEdges = getCanvasEdges(doc);

  doc.transact(() => {
    reconcileCollection(yNodes, parsed.nodes ?? []);
    reconcileCollection(yEdges, parsed.edges ?? []);
  }, LOCAL_ORIGIN);
}

function reconcileCollection(
  yColl: Y.Map<Y.Map<any>>,
  arr: Array<{ id: string; [k: string]: unknown }>,
): void {
  const seenIds = new Set<string>();
  for (const item of arr) {
    if (!item || typeof item.id !== 'string') continue;
    seenIds.add(item.id);
    let entry = yColl.get(item.id);
    if (!entry) {
      entry = new Y.Map();
      yColl.set(item.id, entry);
    }
    // Only write fields whose value actually differs — avoids CRDT churn
    // and preserves any concurrent in-flight sub-field edits from remote.
    for (const [k, v] of Object.entries(item)) {
      const existing = entry.get(k);
      if (!deepEqual(existing, v)) entry.set(k, v);
    }
    // Remove fields present on the Y.Map but absent in the on-disk item.
    for (const k of entry.keys()) {
      if (!(k in item)) entry.delete(k);
    }
  }
  // Delete entries no longer in the on-disk file.
  for (const id of yColl.keys()) {
    if (!seenIds.has(id)) yColl.delete(id);
  }
}

// Serialize the Y.Doc canvas state back to the JSON Canvas 1.0 format on
// disk. Sorts by id for stable output (canvas visuals aren't order-dependent;
// stable order avoids gratuitous churn if the file is ever checked into git).
export function serializeCanvasToDisk(doc: Y.Doc): string {
  const yNodes = getCanvasNodes(doc);
  const yEdges = getCanvasEdges(doc);

  const nodes = [...yNodes.entries()]
    .map(([, entry]) => entry.toJSON())
    .sort(byId);
  const edges = [...yEdges.entries()]
    .map(([, entry]) => entry.toJSON())
    .sort(byId);

  // Obsidian writes canvases with 2-space indent and a trailing newline —
  // match that so we don't create noise when the app re-saves.
  return JSON.stringify({ nodes, edges }, null, '\t') + '\n';
}

function byId(a: { id?: string }, b: { id?: string }): number {
  return (a.id ?? '').localeCompare(b.id ?? '');
}

// Structural equality good enough for canvas primitive values (strings,
// numbers, booleans, null, plain arrays of primitives). Not general-purpose.
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    for (const k of ak) if (!deepEqual((a as any)[k], (b as any)[k])) return false;
    return true;
  }
  return false;
}
