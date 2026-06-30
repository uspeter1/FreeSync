// Reproduce the empty-doc-after-relay-restart bug without Obsidian.
//
// Uses a per-file room with a synthetic name that no Obsidian client touches,
// so the relay's in-memory doc only exists while this script holds a
// connection. When we restart the relay between phases, the in-memory state
// is genuinely gone — the only place it could come back from is vault_docs.
//
// Phase 1: User1 connects, writes text into the file's yText, persists, exits.
// (CALLER restarts the relay between phases — simulating a Railway redeploy.)
// Phase 2: User2 connects fresh. Does User2 see the text?
//   - Original code (no bindState): NO → bug confirmed.
//   - Patched code (with bindState): YES → fix works.
//
// Usage:
//   FNAME=$(node scripts/repro-empty-manifest.mjs write <token1>)
//   <restart relay>
//   node scripts/repro-empty-manifest.mjs read <token2> $FNAME

import * as Y from '/home/peter/projects/FreeSync/node_modules/yjs/dist/yjs.mjs';
import { WebsocketProvider } from '/home/peter/projects/FreeSync/node_modules/y-websocket/src/y-websocket.js';
import WS from '/home/peter/projects/FreeSync/node_modules/ws/wrapper.mjs';

const RELAY = 'ws://localhost:3001';
const VAULT_ID = 'e49ed7f7-6c8a-4329-b8e9-1bfaea4be449';
const EXPECTED_TEXT = 'precalc-cheatsheet-content-' + Date.now();

function waitForSync(provider) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('sync timeout (10s)')), 10000);
    provider.on('sync', (isSynced) => { if (isSynced) { clearTimeout(t); resolve(); } });
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const [, , mode, token, fileArg] = process.argv;
if (!mode || !token) {
  console.error('Usage: node repro-empty-manifest.mjs <write|read> <token> [filename]');
  process.exit(2);
}

if (mode === 'write') {
  const fname = `__bug_repro_${Date.now()}.md`;
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(
    RELAY,
    `sync/${VAULT_ID}/${fname}`,
    doc,
    { params: { token }, WebSocketPolyfill: WS },
  );
  await waitForSync(provider);
  doc.getText('content').insert(0, EXPECTED_TEXT);
  await sleep(3000); // relay debounce is 2s on original
  provider.disconnect();
  provider.destroy();
  doc.destroy();
  // emit filename + expected text on separate lines so caller can capture both
  console.log(fname);
  console.log(EXPECTED_TEXT);
  process.exit(0);
}

if (mode === 'read') {
  const fname = fileArg;
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(
    RELAY,
    `sync/${VAULT_ID}/${fname}`,
    doc,
    { params: { token }, WebSocketPolyfill: WS },
  );
  await waitForSync(provider);
  await sleep(500);
  const text = doc.getText('content').toString();
  console.log('text length:', text.length);
  console.log('text preview:', JSON.stringify(text.slice(0, 80)));
  provider.disconnect();
  provider.destroy();
  doc.destroy();
  process.exit(text.length > 0 ? 0 : 1);
}

console.error('unknown mode:', mode);
process.exit(2);
