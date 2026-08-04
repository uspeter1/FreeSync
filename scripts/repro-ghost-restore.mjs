// Reproduce + verify fix for ghost-restoration of deleted files.
//
// Bug: when a file is deleted via the manifest, its per-file vault_docs row
// is left behind. A later create with the same path re-loads the orphan
// content into the new Y.Doc — the new file "ghost-restores" the old text.
//
// This script runs three end-to-end scenarios against a live relay. It does
// NOT require Obsidian. Run it once on the patched relay — all scenarios
// should pass. To prove the bug existed first, run against a relay built
// from a commit before this fix; scenario A and B should fail.
//
//   node scripts/repro-ghost-restore.mjs
//
// Requires:
//   - Relay running on ws://localhost:3001
//   - Supabase reachable, test users user1/user2@freesync.test exist
//   - Members of vault e49ed7f7-6c8a-4329-b8e9-1bfaea4be449

import * as Y from '/home/peter/projects/FreeSync/node_modules/yjs/dist/yjs.mjs';
import { WebsocketProvider } from '/home/peter/projects/FreeSync/node_modules/y-websocket/src/y-websocket.js';
import WS from '/home/peter/projects/FreeSync/node_modules/ws/wrapper.mjs';
import { execSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const RELAY = 'ws://localhost:3001';
const VAULT_ID = 'e49ed7f7-6c8a-4329-b8e9-1bfaea4be449';
const SUPABASE_URL = 'https://awgcorggtvfcnmjdcljb.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3Z2NvcmdndHZmY25tamRjbGpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMTIwNjAsImV4cCI6MjA5MzU4ODA2MH0.Ymb_EpVaNxPZa4M-dgCIbw2t6taY8YEjA8pw9Q8n3cI';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3Z2NvcmdndHZmY25tamRjbGpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODAxMjA2MCwiZXhwIjoyMDkzNTg4MDYwfQ.VGMGUBla-x_wP_frykCOb4iHWK3REKpq1Sb2y4n56bw';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function signIn(email, password) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await r.json();
  if (!data.access_token) throw new Error('sign-in failed: ' + JSON.stringify(data));
  return data.access_token;
}

async function vaultDocsRow(filePath) {
  const url = `${SUPABASE_URL}/rest/v1/vault_docs?vault_id=eq.${VAULT_ID}&file_path=eq.${encodeURIComponent(filePath)}&select=file_path,updated_at`;
  const r = await fetch(url, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  return r.json();
}

function connect(token, room, doc = new Y.Doc()) {
  const provider = new WebsocketProvider(RELAY, `sync/${VAULT_ID}/${room}`, doc, {
    params: { token }, WebSocketPolyfill: WS,
  });
  const synced = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`sync timeout: ${room}`)), 10000);
    provider.on('sync', (s) => { if (s) { clearTimeout(t); resolve(); } });
  });
  return { provider, doc, synced };
}

function close({ provider, doc }) {
  provider.disconnect();
  provider.destroy();
  doc.destroy();
}

async function restartRelay() {
  execSync('lsof -ti :3001 | xargs -r kill -9', { stdio: 'ignore' });
  await sleep(1000);
  const child = spawn('npm', ['run', 'dev', '--workspace=packages/server'], {
    cwd: '/home/peter/projects/FreeSync', detached: true, stdio: 'ignore',
  });
  child.unref();
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    try {
      const r = await fetch('http://localhost:3001/health');
      if (r.ok) { await sleep(800); return; }
    } catch { /* not up yet */ }
  }
  throw new Error('relay did not become healthy after restart');
}

let pass = 0, fail = 0;
function report(label, ok, detail = '') {
  if (ok) { console.log(`  ✅ ${label}${detail ? ' — ' + detail : ''}`); pass++; }
  else    { console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); fail++; }
}

// ──────────────────────────────────────────────────────────────────────────
// Scenario A: live cascade
// User1 adds file to manifest, writes content, deletes via manifest while
// connected. Verify the vault_docs row is purged by the cascade observer.
// Then User2 re-adds the same path + reads — must be empty.
// ──────────────────────────────────────────────────────────────────────────
async function scenarioA() {
  console.log('\n=== Scenario A: live cascade (manifest delete while connected) ===');
  const path = `__ghost_test_a_${randomUUID()}.md`;
  const expected = `ghost-A-${randomUUID()}`;
  const token1 = await signIn('user1@freesync.test', 'testpass123');
  const token2 = await signIn('user2@freesync.test', 'testpass123');

  // User1 sets manifest entry + writes per-file content
  const m1 = connect(token1, '__manifest__');
  await m1.synced;
  m1.doc.getMap('files').set(path, { exists: true });
  await sleep(500); // let manifest update reach the relay before per-file bindState
  const f1 = connect(token1, path);
  await f1.synced;
  f1.doc.getText('content').insert(0, expected);
  await sleep(4500); // persist debounce (2s) + DB round-trip + grace
  const rowBefore = await vaultDocsRow(path);
  report('per-file row persisted before delete', rowBefore.length === 1, `rows=${rowBefore.length}`);
  close(f1);
  await sleep(500); // let writeState's final persist complete

  // User1 deletes via manifest — live cascade should purge per-file row
  m1.doc.getMap('files').delete(path);
  await sleep(3000); // grace for cascade + DB delete
  const rowAfter = await vaultDocsRow(path);
  report('cascade purged vault_docs row', rowAfter.length === 0, `rows=${rowAfter.length}`);
  close(m1);

  // User2 re-adds the same path and reads
  const m2 = connect(token2, '__manifest__');
  await m2.synced;
  m2.doc.getMap('files').set(path, { exists: true });
  await sleep(250);
  const f2 = connect(token2, path);
  await f2.synced;
  await sleep(500);
  const text = f2.doc.getText('content').toString();
  report('re-created file is empty', text.length === 0, `text=${JSON.stringify(text.slice(0, 40))}`);
  close(f2);
  close(m2);
}

// ──────────────────────────────────────────────────────────────────────────
// Scenario B: cross-restart defensive check
// Old/orphan row exists in vault_docs but path is NOT in manifest. Simulates
// the case where a delete propagated before this fix existed, or the relay
// was restarted between delete and re-create. Re-binding the per-file doc
// must NOT load the stale content.
// ──────────────────────────────────────────────────────────────────────────
async function scenarioB() {
  console.log('\n=== Scenario B: cross-restart orphan row (defensive bindState) ===');
  const path = `__ghost_test_b_${randomUUID()}.md`;
  const expected = `ghost-B-${randomUUID()}`;
  const token1 = await signIn('user1@freesync.test', 'testpass123');
  const token2 = await signIn('user2@freesync.test', 'testpass123');

  // User1 writes content WITHOUT touching the manifest. Creates an orphan
  // row that simulates pre-fix state.
  const f1 = connect(token1, path);
  await f1.synced;
  f1.doc.getText('content').insert(0, expected);
  await sleep(3000);
  close(f1);

  const row = await vaultDocsRow(path);
  report('orphan row exists', row.length === 1, `rows=${row.length}`);

  // Restart relay to wipe in-memory state (forces bindState path)
  await restartRelay();

  // User2 connects fresh: the path was never added to the manifest, so the
  // defensive check in per-file bindState must skip loading the orphan.
  const f2 = connect(token2, path);
  await f2.synced;
  await sleep(500);
  const text = f2.doc.getText('content').toString();
  report('orphan content not loaded', text.length === 0, `text=${JSON.stringify(text.slice(0, 40))}`);

  // Orphan row is intentionally NOT cleaned in the defensive bindState path
  // (an opportunistic delete races with the next upsert and can wipe fresh
  // content). It's harmless — never loaded again — and gets overwritten the
  // next time someone writes content for this path. Verify the overwrite
  // semantic: User2 writes new content under the same path, then we add
  // the path to the manifest and confirm a fresh reader sees only the new
  // bytes (not the orphan, not a merge of both).
  f2.doc.getText('content').insert(0, 'new-content-after-orphan');
  await sleep(3000);
  close(f2);
  const rowAfter = await vaultDocsRow(path);
  report('write after orphan replaces (not merges) the row', rowAfter.length === 1, `rows=${rowAfter.length}`);

  // Add path to manifest so the defensive check passes for the next reader,
  // then confirm they see ONLY the new content. This is the "if a user
  // eventually creates a file at this path, they get the right state" case.
  const m3 = connect(token2, '__manifest__');
  await m3.synced;
  m3.doc.getMap('files').set(path, { exists: true });
  await sleep(500);
  const f3 = connect(token2, path);
  await f3.synced;
  await sleep(500);
  const text3 = f3.doc.getText('content').toString();
  report('next reader (with manifest entry) sees only the new content', text3 === 'new-content-after-orphan', `text=${JSON.stringify(text3.slice(0, 60))}`);
  close(f3);
  // cleanup: remove the path from manifest so cascade kills the row
  m3.doc.getMap('files').delete(path);
  await sleep(2500);
  close(m3);
}

// ──────────────────────────────────────────────────────────────────────────
// Scenario C: rename safety
// A rename arrives as `delete(oldPath) + set(newPath, {renamedFrom: oldPath})`
// in a single Yjs transaction. The cascade observer must SKIP cascading the
// delete in that batch, otherwise we'd lose the renamed file's persisted
// content on the relay side.
// ──────────────────────────────────────────────────────────────────────────
async function scenarioC() {
  console.log('\n=== Scenario C: rename does not trigger cascade ===');
  const oldPath = `__ghost_test_c_old_${randomUUID()}.md`;
  const newPath = `__ghost_test_c_new_${randomUUID()}.md`;
  const expected = `ghost-C-${randomUUID()}`;
  const token1 = await signIn('user1@freesync.test', 'testpass123');

  // Set up oldPath with content + manifest entry
  const m1 = connect(token1, '__manifest__');
  await m1.synced;
  m1.doc.getMap('files').set(oldPath, { exists: true });
  const f1 = connect(token1, oldPath);
  await f1.synced;
  f1.doc.getText('content').insert(0, expected);
  await sleep(3000);
  close(f1);

  // Rename: delete + set in the same transact, same shape the plugin uses
  m1.doc.transact(() => {
    m1.doc.getMap('files').delete(oldPath);
    m1.doc.getMap('files').set(newPath, { exists: true, renamedFrom: oldPath });
  });
  await sleep(2500);

  // The oldPath row should still exist because the cascade was skipped
  const row = await vaultDocsRow(oldPath);
  report('rename did not purge old path row', row.length === 1, `rows=${row.length}`);
  close(m1);

  // Cleanup: now actually delete the oldPath so we don't leave it lying around
  const m2 = connect(token1, '__manifest__');
  await m2.synced;
  m2.doc.getMap('files').delete(oldPath);
  m2.doc.getMap('files').delete(newPath);
  await sleep(2500);
  close(m2);
}

// ──────────────────────────────────────────────────────────────────────────

try {
  await scenarioA();
  await scenarioB();
  await scenarioC();
} catch (err) {
  console.error('\nFATAL:', err.message);
  process.exit(2);
}

console.log(`\n────────────────────────────────────────`);
console.log(`${pass} passed, ${fail} failed`);
console.log(`────────────────────────────────────────`);
process.exit(fail === 0 ? 0 : 1);
