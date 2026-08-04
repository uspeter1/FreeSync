import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import http from 'http';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// y-websocket utils (CJS)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { setupWSConnection, docs, setPersistence } = require('y-websocket/bin/utils');

// ─── Environment ────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const PORT = parseInt(process.env.PORT ?? '3001', 10);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    '[warn] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — ' +
    'auth-gated endpoints will fail; /health will still work'
  );
}

// ─── Supabase client (service role — server-only) ───────────────────────────

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Auth helper ────────────────────────────────────────────────────────────

interface AuthResult {
  userId: string;
  error?: never;
}
interface AuthError {
  error: string;
  userId?: never;
}

async function authenticate(authHeader: string | undefined): Promise<AuthResult | AuthError> {
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: 'Missing Authorization header' };
  }
  const token = authHeader.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return { error: 'Invalid or expired token' };
  }
  return { userId: user.id };
}

// ─── Yjs persistence (debounced) ────────────────────────────────────────────

const DEBOUNCE_MS = 2000;
const pendingPersist = new Map<string, ReturnType<typeof setTimeout>>();
const BIND_STATE_ORIGIN = Symbol('freesync-bind-state-load');
// Tracks docNames whose cascade purge is in-flight or recently completed.
// Any persistNow call for a docName in this set is a no-op — prevents
// writeState (fired on the last client's disconnect) from resurrecting a
// row that the cascade just deleted, when both happen near-simultaneously.
// Entries are cleared when bindState runs for the same docName (a fresh
// re-creation of that path is intended to persist normally).
const purgedDocs = new Set<string>();

function parseDocName(docName: string): { vaultId: string; filePath: string } | null {
  const slashIdx = docName.indexOf('/');
  if (slashIdx === -1) return null;
  return { vaultId: docName.slice(0, slashIdx), filePath: docName.slice(slashIdx + 1) };
}

// vault_docs.yjs_state is BYTEA; supabase-js JSON-encodes Buffer on write, so
// stored bytes are `{"type":"Buffer","data":[...]}`. Read returns the BYTEA
// either as a hex string ("\x..."), a Buffer, or a {type,data} object. Handle
// every shape, then unwrap the double-encoded JSON if present.
function decodeYjsState(raw: unknown): Uint8Array | null {
  if (!raw) return null;
  let bytes: Buffer | null = null;
  if (typeof raw === 'string') {
    bytes = raw.startsWith('\\x')
      ? Buffer.from(raw.slice(2), 'hex')
      : Buffer.from(raw, 'base64');
  } else if (Buffer.isBuffer(raw)) {
    bytes = raw;
  } else if (raw instanceof Uint8Array) {
    bytes = Buffer.from(raw);
  } else if (typeof raw === 'object' && raw !== null) {
    const obj = raw as { type?: string; data?: number[] };
    if (obj.type === 'Buffer' && Array.isArray(obj.data)) bytes = Buffer.from(obj.data);
  }
  if (!bytes) return null;
  try {
    const wrapped = JSON.parse(bytes.toString('utf8'));
    if (wrapped?.type === 'Buffer' && Array.isArray(wrapped.data)) {
      return new Uint8Array(wrapped.data);
    }
  } catch { /* not JSON-wrapped — raw bytes */ }
  return new Uint8Array(bytes);
}

// Resolve whether a file is currently listed in the vault's manifest. Prefers
// the live in-memory manifest doc (free), falls back to decoding the persisted
// manifest row. Used to short-circuit per-file bindState so a fresh per-file
// Y.Doc never gets populated with content for a path the manifest no longer
// knows about — preventing "ghost restoration" when a new file is created
// with the same name as a previously-deleted one.
async function manifestHasFile(vaultId: string, filePath: string): Promise<boolean> {
  const live: Y.Doc | undefined = docs.get(`${vaultId}/__manifest__`);
  if (live) return live.getMap('files').has(filePath);

  try {
    const { data, error } = await supabase
      .from('vault_docs')
      .select('yjs_state')
      .eq('vault_id', vaultId)
      .eq('file_path', '__manifest__')
      .maybeSingle();
    if (error || !data?.yjs_state) return false;
    const state = decodeYjsState(data.yjs_state);
    if (!state || state.length === 0) return false;
    const tmp = new Y.Doc();
    Y.applyUpdate(tmp, state);
    const has = tmp.getMap('files').has(filePath);
    tmp.destroy();
    return has;
  } catch (err) {
    console.error(`[persist] manifestHasFile failed for "${vaultId}/${filePath}":`, err);
    // On lookup failure, fail open: assume the file exists so we don't
    // accidentally wipe legitimate content on a transient DB error.
    return true;
  }
}

// Destroy any in-memory Y.Doc for the given path and delete its vault_docs
// row. Used both by the live cascade (manifest observer) and by the
// defensive bindState orphan cleanup.
async function purgePersistedDoc(vaultId: string, filePath: string): Promise<void> {
  const docName = `${vaultId}/${filePath}`;
  // Mark synchronously BEFORE any await — any persistNow that runs after
  // this point (including a writeState in-flight from a near-simultaneous
  // disconnect) will skip its upsert and let the deletion stand.
  purgedDocs.add(docName);
  const live: Y.Doc | undefined = docs.get(docName);
  if (live) {
    docs.delete(docName);
    live.destroy();
  }
  // Note: purgedDocs marker is cleared when bindState runs again for the
  // same docName, so a legitimate re-creation of the path can persist.
  // Also cancel any pending debounced persist so the destroyed doc's last
  // state doesn't write back over the deletion.
  const key = `${vaultId}::${docName}`;
  const pending = pendingPersist.get(key);
  if (pending) { clearTimeout(pending); pendingPersist.delete(key); }
  const { error } = await supabase
    .from('vault_docs')
    .delete()
    .eq('vault_id', vaultId)
    .eq('file_path', filePath);
  if (error) console.error(`[persist] purge failed for "${docName}":`, error.message);
}

// Destroy every in-memory Y.Doc belonging to a vault. Used when the vault
// itself is being deleted — leaving live docs around would let connected
// clients keep syncing content into a vault that no longer exists.
function purgeAllVaultDocsInMemory(vaultId: string): void {
  const prefix = `${vaultId}/`;
  for (const docName of Array.from(docs.keys() as Iterable<string>)) {
    if (!docName.startsWith(prefix)) continue;
    purgedDocs.add(docName);
    const live: Y.Doc | undefined = docs.get(docName);
    if (live) { docs.delete(docName); live.destroy(); }
    const key = `${vaultId}::${docName}`;
    const pending = pendingPersist.get(key);
    if (pending) { clearTimeout(pending); pendingPersist.delete(key); }
  }
}

async function persistNow(vaultId: string, filePath: string, ydoc: Y.Doc): Promise<void> {
  const docName = `${vaultId}/${filePath}`;
  if (purgedDocs.has(docName)) return; // cascade already deleted this row
  const stateUpdate = Y.encodeStateAsUpdate(ydoc);
  const { error } = await supabase.from('vault_docs').upsert(
    {
      vault_id: vaultId,
      file_path: filePath,
      yjs_state: Buffer.from(stateUpdate),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'vault_id,file_path' }
  );
  if (error) console.error(`[persist] Failed to persist "${vaultId}/${filePath}":`, error.message);
}

function scheduleDocPersist(vaultId: string, docName: string): void {
  const key = `${vaultId}::${docName}`;
  const existing = pendingPersist.get(key);
  if (existing) clearTimeout(existing);

  const handle = setTimeout(async () => {
    pendingPersist.delete(key);
    const doc: Y.Doc | undefined = docs.get(docName);
    if (!doc) return;
    const parsed = parseDocName(docName);
    if (!parsed) return;
    await persistNow(parsed.vaultId, parsed.filePath, doc);
  }, DEBOUNCE_MS);

  pendingPersist.set(key, handle);
}

// CRITICAL: without bindState, y-websocket creates an empty doc on every
// connect-when-empty, silently losing any state that was only sync'd to a
// single client. bindState reads vault_docs and applies it to the fresh doc
// before the client's sync handshake completes — so a user connecting after
// everyone else disconnected still sees the persisted manifest + file content.
setPersistence({
  bindState: async (docName: string, ydoc: Y.Doc) => {
    const parsed = parseDocName(docName);
    if (!parsed) return;

    // A fresh bind for a docName means we want this doc's writes to
    // persist again, even if the path was previously cascaded.
    purgedDocs.delete(docName);

    // CRITICAL ORDERING: attach the update handler + manifest observer
    // BEFORE any async work. y-websocket does NOT await bindState before
    // serving sync — clients can send updates that fire ydoc events while
    // our DB load is still in flight. If the handler isn't attached yet,
    // those updates are silently lost (persist never schedules; cascade
    // never sees the delete). Both handlers skip BIND_STATE_ORIGIN so the
    // late-arriving DB load doesn't trigger spurious persists/cascades.
    ydoc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin === BIND_STATE_ORIGIN) return;
      scheduleDocPersist(parsed.vaultId, docName);
    });

    if (parsed.filePath === '__manifest__') {
      const files = ydoc.getMap<{ exists?: boolean; renamedFrom?: string }>('files');
      files.observe((event) => {
        // Ignore the bindState late-load. Loaded state can contain
        // tombstones for paths that the live doc considers absent;
        // reconciling them looks like a 'delete' but isn't a user action.
        if (event.transaction.origin === BIND_STATE_ORIGIN) return;

        // Mirror the plugin's rename-skip pattern: a rename arrives as a
        // delete of oldPath in the same batch as an add of newPath that
        // carries renamedFrom = oldPath. Don't cascade the old row's
        // content away — the new path will reuse it.
        const renamedFromPaths = new Set<string>();
        event.changes.keys.forEach((change, key) => {
          if (change.action === 'add' || change.action === 'update') {
            const val = files.get(key);
            if (val?.renamedFrom) renamedFromPaths.add(val.renamedFrom);
          }
        });
        event.changes.keys.forEach((change, key) => {
          if (change.action !== 'delete') return;
          if (renamedFromPaths.has(key)) return;
          void purgePersistedDoc(parsed.vaultId, key);
        });
      });
    }

    // Per-file docs: confirm the file is still in the manifest before
    // loading state. Catches orphan rows from deletes that propagated
    // while the relay was restarted (or before this safeguard existed) —
    // a re-created file with the same name must start empty.
    //
    // We deliberately do NOT purge the orphan row here. A naive
    // fire-and-forget DELETE can race with the next scheduled UPSERT and
    // wipe legitimate fresh content. The orphan is harmless (never
    // loaded again) and gets overwritten by the next user write via the
    // upsert in persistNow. Old orphans can be cleaned by a one-time GC
    // script; the live cascade observer above keeps new deletes tidy.
    if (parsed.filePath !== '__manifest__') {
      const exists = await manifestHasFile(parsed.vaultId, parsed.filePath);
      if (!exists) return;
    }

    try {
      const { data, error } = await supabase
        .from('vault_docs')
        .select('yjs_state')
        .eq('vault_id', parsed.vaultId)
        .eq('file_path', parsed.filePath)
        .maybeSingle();
      if (!error && data?.yjs_state) {
        const state = decodeYjsState(data.yjs_state);
        if (state && state.length > 0) Y.applyUpdate(ydoc, state, BIND_STATE_ORIGIN);
      }
    } catch (err) {
      console.error(`[persist] bindState failed for "${docName}":`, err);
    }
  },
  writeState: async (docName: string, ydoc: Y.Doc) => {
    const parsed = parseDocName(docName);
    if (!parsed) return;
    const key = `${parsed.vaultId}::${docName}`;
    const existing = pendingPersist.get(key);
    if (existing) { clearTimeout(existing); pendingPersist.delete(key); }
    await persistNow(parsed.vaultId, parsed.filePath, ydoc);
  },
});

// ─── Express app ────────────────────────────────────────────────────────────

const app = express();

// CORS — the Obsidian plugin uses `requestUrl` (native, bypasses browser CORS),
// but the web dashboard is a real browser and needs preflight support. Allow
// list is comma-separated via ALLOWED_ORIGINS; localhost:3002 is the default
// dev origin (see packages/web/package.json "dev" script).
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3002')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin / curl (no Origin header) and any listed origin.
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: false,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// GET /health
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ── POST /vaults ─────────────────────────────────────────────────────────────
app.post('/vaults', async (req: Request, res: Response) => {
  const auth = await authenticate(req.headers.authorization);
  if (auth.error) { res.status(401).json({ error: auth.error }); return; }
  const { userId } = auth;

  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }

  // Create vault
  const { data: vault, error: vaultErr } = await supabase
    .from('vaults')
    .insert({ name: name.trim(), owner_id: userId })
    .select()
    .single();

  if (vaultErr || !vault) {
    res.status(500).json({ error: vaultErr?.message ?? 'Failed to create vault' });
    return;
  }

  // Auto-add owner as active member
  const { error: memberErr } = await supabase
    .from('vault_members')
    .insert({ vault_id: vault.id, user_id: userId, status: 'active' });

  if (memberErr) {
    console.error('[vaults] Failed to add owner as member:', memberErr.message);
  }

  res.status(201).json(vault);
});

// ── GET /vaults ──────────────────────────────────────────────────────────────
app.get('/vaults', async (req: Request, res: Response) => {
  const auth = await authenticate(req.headers.authorization);
  if (auth.error) { res.status(401).json({ error: auth.error }); return; }
  const { userId } = auth;

  // Returns every vault the caller has any membership row for — both 'active'
  // (fully joined) and 'invited' (pending accept). The client renders them in
  // separate sections. WS auth still gates sync on status='active', so an
  // invited membership row doesn't grant content access.
  //
  // NOTE: the embedded vault_members is filtered to the caller only (see the
  // .eq below), so it holds a single row describing the caller's own status.
  // A separate lookup fills in `active_member_count` — the total count of
  // active members for each vault, for the dashboard's card meta.
  const { data, error } = await supabase
    .from('vaults')
    .select('*, vault_members!inner(user_id, status)')
    .eq('vault_members.user_id', userId)
    .in('vault_members.status', ['active', 'invited']);

  if (error) { res.status(500).json({ error: error.message }); return; }

  const vaultIds = (data ?? []).map((v) => v.id);
  if (vaultIds.length === 0) { res.json([]); return; }

  const { data: allActive, error: countErr } = await supabase
    .from('vault_members')
    .select('vault_id')
    .in('vault_id', vaultIds)
    .eq('status', 'active');
  if (countErr) { res.status(500).json({ error: countErr.message }); return; }

  const counts = new Map<string, number>();
  for (const row of allActive ?? []) {
    counts.set(row.vault_id, (counts.get(row.vault_id) ?? 0) + 1);
  }

  const enriched = (data ?? []).map((v) => ({
    ...v,
    active_member_count: counts.get(v.id) ?? 0,
  }));
  res.json(enriched);
});

// ── GET /vaults/:vaultId/files ────────────────────────────────────────────────
// List files in a vault's manifest. Used by the web browse page. Membership
// must be 'active' (invited-only can't see contents).
app.get('/vaults/:vaultId/files', async (req: Request, res: Response) => {
  const auth = await authenticate(req.headers.authorization);
  if (auth.error) { res.status(401).json({ error: auth.error }); return; }
  const { userId } = auth;
  const { vaultId } = req.params;

  const { data: self } = await supabase
    .from('vault_members')
    .select('status')
    .eq('vault_id', vaultId)
    .eq('user_id', userId)
    .maybeSingle();
  if (self?.status !== 'active') {
    res.status(403).json({ error: 'Not an active member of this vault' });
    return;
  }

  const manifestDoc = await loadManifest(vaultId);
  if (!manifestDoc) { res.json([]); return; }

  const files = manifestDoc.getMap<{
    exists?: boolean;
    binary?: boolean;
    storageKey?: string;
    lastEditedBy?: { userId: string; display_name: string; color: string };
    lastEditedAt?: number;
  }>('files');

  const out: Array<{
    path: string;
    kind: 'markdown' | 'canvas' | 'binary' | 'text';
    lastEditedBy: { userId: string; display_name: string; color: string } | null;
    lastEditedAt: number | null;
  }> = [];
  for (const [path, entry] of files.entries()) {
    if (!entry?.exists) continue;
    out.push({
      path,
      kind: kindFor(path, entry.binary === true),
      lastEditedBy: entry.lastEditedBy ?? null,
      lastEditedAt: entry.lastEditedAt ?? null,
    });
  }
  out.sort((a, b) => a.path.localeCompare(b.path));

  // Only destroy if we allocated it — the shared docs map's copy must persist.
  if (!(docs as Map<string, Y.Doc>).get(`${vaultId}/__manifest__`)) manifestDoc.destroy();
  res.json(out);
});

// ── GET /vaults/:vaultId/files/*  ─────────────────────────────────────────────
// Return the current content of a single file. Text/markdown/canvas are
// stitched from the file's Y.Doc; binary files return a metadata pointer.
app.get(/^\/vaults\/([^/]+)\/files\/(.+)$/, async (req: Request, res: Response) => {
  const auth = await authenticate(req.headers.authorization);
  if (auth.error) { res.status(401).json({ error: auth.error }); return; }
  const { userId } = auth;
  const vaultId = req.params[0];
  const filePath = decodeURIComponent(req.params[1]);

  const { data: self } = await supabase
    .from('vault_members')
    .select('status')
    .eq('vault_id', vaultId)
    .eq('user_id', userId)
    .maybeSingle();
  if (self?.status !== 'active') {
    res.status(403).json({ error: 'Not an active member of this vault' });
    return;
  }

  const manifestDoc = await loadManifest(vaultId);
  if (!manifestDoc) { res.status(404).json({ error: 'Vault has no manifest' }); return; }
  const entry = manifestDoc.getMap<{
    exists?: boolean;
    binary?: boolean;
    storageKey?: string;
  }>('files').get(filePath);
  // Note: manifestDoc is destroyed later (after rewriteEmbeds), not here — we
  // still need the files map to resolve ![[image]] references.
  if (!entry?.exists) {
    if (!(docs as Map<string, Y.Doc>).get(`${vaultId}/__manifest__`)) manifestDoc.destroy();
    res.status(404).json({ error: 'File not found' });
    return;
  }

  const kind = kindFor(filePath, entry.binary === true);
  if (kind === 'binary') {
    // Signed URL to Supabase Storage — expires in 5 min. Lets the browser
    // load an <img>/<embed> tag directly without proxying bytes through us.
    let signed_url: string | null = null;
    if (entry.storageKey) {
      const { data } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(entry.storageKey, 300);
      signed_url = data?.signedUrl ?? null;
    }
    if (!(docs as Map<string, Y.Doc>).get(`${vaultId}/__manifest__`)) manifestDoc.destroy();
    res.json({
      path: filePath,
      kind,
      storage_key: entry.storageKey ?? null,
      signed_url,
      image_kind: imageKindFor(filePath),
    });
    return;
  }

  // Load the file's Y.Doc (in-memory or from Postgres) and stringify.
  //
  // Historical wart: the plugin URL-encodes the file path when it connects
  // to the WebSocket, so y-websocket keeps the encoded form as the docs-map
  // key AND persists it that way in vault_docs.file_path. But the manifest
  // stores the raw path. This endpoint has to encode when hitting the doc
  // store even though the incoming request used the raw path.
  const encodedPath = encodeURIComponent(filePath);
  const docName = `${vaultId}/${encodedPath}`;
  const liveDoc = (docs as Map<string, Y.Doc>).get(docName);
  let fileDoc: Y.Doc | null = liveDoc ?? null;
  if (!fileDoc) {
    const { data } = await supabase
      .from('vault_docs')
      .select('yjs_state')
      .eq('vault_id', vaultId)
      .eq('file_path', encodedPath)
      .maybeSingle();
    if (data?.yjs_state) {
      const bytes = decodeYjsState(data.yjs_state);
      if (bytes) {
        fileDoc = new Y.Doc();
        Y.applyUpdate(fileDoc, bytes);
      }
    }
  }
  if (!fileDoc) {
    // Diagnostic: list keys that share the vault prefix so we can spot
    // subtle mismatches (encoding, casing, extra slashes).
    const prefix = `${vaultId}/`;
    const nearby = [...(docs as Map<string, Y.Doc>).keys()]
      .filter((k) => k.startsWith(prefix))
      .slice(0, 20);
    console.log('[activity/preview] no doc for', JSON.stringify(docName),
      'live keys in vault:', nearby.length ? nearby : '(none)');
    res.json({ path: filePath, kind, content: '', not_yet_synced: true });
    return;
  }

  let content = '';
  if (kind === 'canvas') {
    // Best-effort: read canvas-nodes / canvas-edges the plugin uses.
    const nodes = fileDoc.getMap<Y.Map<unknown>>('canvas-nodes');
    const edges = fileDoc.getMap<Y.Map<unknown>>('canvas-edges');
    const asArray = (m: Y.Map<Y.Map<unknown>>) =>
      [...m.entries()].map(([, e]) => (e as Y.Map<unknown>).toJSON())
        .sort((a: { id?: string }, b: { id?: string }) => (a.id ?? '').localeCompare(b.id ?? ''));
    content = JSON.stringify({ nodes: asArray(nodes), edges: asArray(edges) }, null, '\t') + '\n';
  } else {
    // Plugin stores text under the 'content' key; the default (empty) key
    // would always return empty. See packages/plugin/src/sync.ts.
    content = fileDoc.getText('content').toString();
  }

  if (!liveDoc) fileDoc.destroy();

  // For markdown: rewrite Obsidian ![[image]] wikilink-embeds and standard
  // ![alt](path) references to point at signed URLs of the referenced files.
  // Without this, react-markdown either renders the wikilink as raw text or
  // emits a broken <img> because the browser has no way to fetch the vault
  // binary directly.
  if (kind === 'markdown' && content) {
    content = await rewriteEmbeds(content, vaultId, manifestDoc);
  }

  const manifestFromLive = (docs as Map<string, Y.Doc>).get(`${vaultId}/__manifest__`);
  if (!manifestFromLive) manifestDoc.destroy();

  res.json({ path: filePath, kind, content });
});

// Rewrite Obsidian-style image embeds in markdown to standard markdown image
// syntax pointing at Supabase signed URLs. Two patterns:
//   ![[filename.png]]           → wikilink embed (with optional |alt)
//   ![alt](Attachments/foo.png) → standard markdown image
// For each match, resolve to a vault file (exact path first, then basename
// fallback because Obsidian wikilinks resolve by name, not path), fetch a
// signed URL, and emit ![alt](signed_url). Non-image / unresolved links are
// left untouched.
async function rewriteEmbeds(text: string, vaultId: string, manifestDoc: Y.Doc): Promise<string> {
  const files = manifestDoc.getMap<{ exists?: boolean; storageKey?: string }>('files');

  // Build (basename → full path) index; only include existing binaries with
  // an image kind so we don't accidentally rewrite non-images.
  const byBasename = new Map<string, { path: string; storageKey: string }>();
  const byPath = new Map<string, { storageKey: string }>();
  for (const [path, entry] of files.entries()) {
    if (!entry?.exists || !entry.storageKey) continue;
    if (!imageKindFor(path)) continue;
    const base = path.split('/').pop() ?? path;
    byPath.set(path, { storageKey: entry.storageKey });
    if (!byBasename.has(base)) byBasename.set(base, { path, storageKey: entry.storageKey });
  }

  if (byPath.size === 0) return text;

  // Sign URLs on demand and cache within this request so we don't hit
  // Supabase Storage multiple times for the same file.
  const signedCache = new Map<string, string>();
  const sign = async (storageKey: string): Promise<string | null> => {
    if (signedCache.has(storageKey)) return signedCache.get(storageKey)!;
    const { data } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(storageKey, 300);
    if (!data?.signedUrl) return null;
    signedCache.set(storageKey, data.signedUrl);
    return data.signedUrl;
  };

  // Collect all matches first, then replace with resolved URLs. Two passes
  // because the replacement is async.
  const wikilinkRe = /!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
  const mdImgRe = /!\[([^\]]*)\]\(([^)]+)\)/g;

  interface Rewrite { match: string; replacement: string; index: number }
  const rewrites: Rewrite[] = [];

  for (const m of text.matchAll(wikilinkRe)) {
    const target = m[1].trim();
    const alt = (m[2] ?? '').trim();
    const hit = byPath.get(target) ?? byBasename.get(target.split('/').pop() ?? target);
    if (!hit) continue;
    const url = await sign(hit.storageKey);
    if (!url) continue;
    rewrites.push({ match: m[0], replacement: `![${alt || target}](${url})`, index: m.index ?? 0 });
  }
  for (const m of text.matchAll(mdImgRe)) {
    const alt = m[1];
    const target = decodeURIComponent(m[2].trim());
    // Skip external URLs — leave those alone
    if (/^https?:\/\//i.test(target) || target.startsWith('data:')) continue;
    const hit = byPath.get(target) ?? byBasename.get(target.split('/').pop() ?? target);
    if (!hit) continue;
    const url = await sign(hit.storageKey);
    if (!url) continue;
    rewrites.push({ match: m[0], replacement: `![${alt}](${url})`, index: m.index ?? 0 });
  }

  // Sort by index descending so slicing later matches don't shift earlier ones.
  rewrites.sort((a, b) => b.index - a.index);
  let out = text;
  for (const r of rewrites) {
    out = out.slice(0, r.index) + r.replacement + out.slice(r.index + r.match.length);
  }
  return out;
}

// Shared helper: load a vault's manifest Y.Doc, preferring in-memory over DB.
async function loadManifest(vaultId: string): Promise<Y.Doc | null> {
  const docName = `${vaultId}/__manifest__`;
  const liveDoc = (docs as Map<string, Y.Doc>).get(docName);
  if (liveDoc) return liveDoc;
  const { data, error } = await supabase
    .from('vault_docs')
    .select('yjs_state')
    .eq('vault_id', vaultId)
    .eq('file_path', '__manifest__')
    .maybeSingle();
  if (error || !data?.yjs_state) return null;
  const bytes = decodeYjsState(data.yjs_state);
  if (!bytes) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, bytes);
  return doc;
}

function kindFor(filePath: string, isBinary: boolean): 'markdown' | 'canvas' | 'binary' | 'text' {
  if (isBinary) return 'binary';
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.canvas')) return 'canvas';
  return 'text';
}

// Sub-classify binary files so the client can pick <img> vs <embed> vs a
// plain download link. Null for anything we can't render inline.
function imageKindFor(filePath: string): 'image' | 'pdf' | 'audio' | 'video' | null {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (['mp3', 'wav', 'm4a', 'ogg'].includes(ext)) return 'audio';
  if (['mp4', 'mov', 'webm'].includes(ext)) return 'video';
  return null;
}

// ── GET /activity ─────────────────────────────────────────────────────────────
// Recent edits across every vault the user is an active member of. Reads each
// vault's manifest Y.Doc (in-memory if a client is connected, otherwise from
// vault_docs) and extracts files with lastEditedBy/lastEditedAt metadata.
app.get('/activity', async (req: Request, res: Response) => {
  const auth = await authenticate(req.headers.authorization);
  if (auth.error) { res.status(401).json({ error: auth.error }); return; }
  const { userId } = auth;
  const limit = Math.min(Number(req.query.limit ?? 20), 100);

  // Vaults the user actively belongs to
  const { data: memberRows, error: memberErr } = await supabase
    .from('vault_members')
    .select('vault_id, vaults!inner(id, name)')
    .eq('user_id', userId)
    .eq('status', 'active');
  if (memberErr) { res.status(500).json({ error: memberErr.message }); return; }

  type VaultRef = { id: string; name: string };
  const vaults: VaultRef[] = (memberRows ?? []).flatMap((r: unknown) => {
    const row = r as { vaults?: VaultRef | VaultRef[] };
    if (!row.vaults) return [];
    return Array.isArray(row.vaults) ? row.vaults : [row.vaults];
  });
  if (vaults.length === 0) { res.json([]); return; }

  interface ActivityEntry {
    vault_id: string;
    vault_name: string;
    file_path: string;
    last_edited_by: { userId: string; display_name: string; color: string };
    last_edited_at: number;
  }

  const activity: ActivityEntry[] = [];

  // For each vault, get its manifest. Prefer the in-memory copy (up-to-date)
  // and fall back to the persisted BYTEA. Skip vaults with neither.
  for (const vault of vaults) {
    const docName = `${vault.id}/__manifest__`;
    let manifestDoc: Y.Doc | null = null;

    const liveDoc = (docs as Map<string, Y.Doc>).get(docName);
    if (liveDoc) {
      manifestDoc = liveDoc;
    } else {
      const { data, error: docErr } = await supabase
        .from('vault_docs')
        .select('yjs_state')
        .eq('vault_id', vault.id)
        .eq('file_path', '__manifest__')
        .maybeSingle();
      if (docErr || !data?.yjs_state) continue;
      const bytes = decodeYjsState(data.yjs_state);
      if (!bytes) continue;
      manifestDoc = new Y.Doc();
      Y.applyUpdate(manifestDoc, bytes);
    }

    const files = manifestDoc.getMap<{
      exists?: boolean;
      lastEditedBy?: { userId: string; display_name: string; color: string };
      lastEditedAt?: number;
    }>('files');

    for (const [filePath, entry] of files.entries()) {
      if (!entry?.exists || !entry.lastEditedBy || !entry.lastEditedAt) continue;
      activity.push({
        vault_id: vault.id,
        vault_name: vault.name,
        file_path: filePath,
        last_edited_by: entry.lastEditedBy,
        last_edited_at: entry.lastEditedAt,
      });
    }

    if (!liveDoc) manifestDoc.destroy();
  }

  activity.sort((a, b) => b.last_edited_at - a.last_edited_at);
  res.json(activity.slice(0, limit));
});

// ── POST /vaults/:vaultId/join ────────────────────────────────────────────────
app.post('/vaults/:vaultId/join', async (req: Request, res: Response) => {
  const auth = await authenticate(req.headers.authorization);
  if (auth.error) { res.status(401).json({ error: auth.error }); return; }
  const { userId } = auth;

  const { vaultId } = req.params;
  const { invite_code } = req.body as { invite_code?: string };

  if (!invite_code) { res.status(400).json({ error: 'invite_code is required' }); return; }

  // Verify vault + invite code + open_invite flag
  const { data: vault, error: vaultErr } = await supabase
    .from('vaults')
    .select('id, invite_code, open_invite')
    .eq('id', vaultId)
    .single();

  if (vaultErr || !vault) { res.status(404).json({ error: 'Vault not found' }); return; }
  if (vault.invite_code !== invite_code) { res.status(403).json({ error: 'Invalid invite code' }); return; }
  if (!vault.open_invite) {
    res.status(403).json({ error: 'This vault is not accepting new members via invite code. Ask the owner to add you directly.' });
    return;
  }

  // Upsert membership (idempotent)
  const { error: memberErr } = await supabase
    .from('vault_members')
    .upsert({ vault_id: vaultId, user_id: userId, status: 'active' }, { onConflict: 'vault_id,user_id' });

  if (memberErr) { res.status(500).json({ error: memberErr.message }); return; }

  res.json({ joined: true, vault_id: vaultId });
});

// ── PATCH /vaults/:vaultId/open-invite ───────────────────────────────────────
app.patch('/vaults/:vaultId/open-invite', async (req: Request, res: Response) => {
  const auth = await authenticate(req.headers.authorization);
  if (auth.error) { res.status(401).json({ error: auth.error }); return; }
  const { userId } = auth;

  const { vaultId } = req.params;
  const { enabled } = req.body as { enabled?: boolean };

  if (typeof enabled !== 'boolean') { res.status(400).json({ error: 'enabled (boolean) is required' }); return; }

  // Only the vault owner can change this setting
  const { data: vault } = await supabase
    .from('vaults')
    .select('owner_id')
    .eq('id', vaultId)
    .single();

  if (!vault || vault.owner_id !== userId) {
    res.status(403).json({ error: 'Only the vault owner can change this setting' });
    return;
  }

  const { error: updateErr } = await supabase
    .from('vaults')
    .update({ open_invite: enabled })
    .eq('id', vaultId);

  if (updateErr) { res.status(500).json({ error: updateErr.message }); return; }

  res.json({ open_invite: enabled });
});

// ── POST /vaults/:vaultId/invite ─────────────────────────────────────────────
app.post('/vaults/:vaultId/invite', async (req: Request, res: Response) => {
  const auth = await authenticate(req.headers.authorization);
  if (auth.error) { res.status(401).json({ error: auth.error }); return; }
  const { userId } = auth;

  const { vaultId } = req.params;
  const { email } = req.body as { email?: string };

  if (!email) { res.status(400).json({ error: 'email is required' }); return; }

  // Verify requester owns this vault
  const { data: vault } = await supabase
    .from('vaults')
    .select('owner_id')
    .eq('id', vaultId)
    .single();

  if (!vault || vault.owner_id !== userId) {
    res.status(403).json({ error: 'Only the vault owner can invite members' });
    return;
  }

  // Look up target user by email via the admin API.
  //
  // Historical note: this used to use `.schema('auth').from('users')` but
  // the `auth` schema isn't exposed to PostgREST by default in Supabase,
  // so the query always failed and every existing user got treated as
  // "user doesn't exist" → routed to the pending_invites path. That masked
  // the real behavior until the dashboard exercised it end-to-end.
  //
  // listUsers with in-JS filter is fine at the scale FreeSync targets;
  // add proper pagination if/when we cross ~1k users per project.
  const normalized = email.trim().toLowerCase();
  const { data: userList, error: lookupErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const targetUser = userList?.users.find((u) => (u.email ?? '').toLowerCase() === normalized);

  if (lookupErr || !targetUser) {
    // No account — store a pending invite, then send a Supabase signup email.
    // A DB trigger (on_invite_confirmed) will auto-add them to vault_members
    // when they confirm their account.
    const { error: pendingErr } = await supabase
      .from('pending_invites')
      .upsert({ vault_id: vaultId, email }, { onConflict: 'vault_id,email' });

    if (pendingErr) {
      res.status(500).json({ error: `Could not store pending invite: ${pendingErr.message}` });
      return;
    }

    const { error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(email);
    if (inviteErr) {
      // Roll back the pending invite row if the email send failed
      await supabase.from('pending_invites').delete().eq('vault_id', vaultId).eq('email', email);
      res.status(500).json({ error: `Could not send invite email: ${inviteErr.message}` });
      return;
    }

    res.json({ invited: true, signup_required: true });
    return;
  }

  if (targetUser.id === userId) {
    res.status(400).json({ error: 'You cannot invite yourself' });
    return;
  }

  // Check current membership so we can respond meaningfully (and never
  // downgrade an active member to invited).
  const { data: existing } = await supabase
    .from('vault_members')
    .select('status')
    .eq('vault_id', vaultId)
    .eq('user_id', targetUser.id)
    .maybeSingle();

  if (existing?.status === 'active') {
    res.json({ invited: false, already: 'member', signup_required: false });
    return;
  }
  if (existing?.status === 'invited') {
    res.json({ invited: true, already: 'invited', signup_required: false });
    return;
  }

  const { error: memberErr } = await supabase
    .from('vault_members')
    .insert({ vault_id: vaultId, user_id: targetUser.id, status: 'invited' });

  if (memberErr) { res.status(500).json({ error: memberErr.message }); return; }

  res.json({ invited: true, signup_required: false });
});

// ── POST /vaults/:vaultId/accept ─────────────────────────────────────────────
// Called by the invitee to promote their invited membership to active. WS
// auth gates on status='active', so an invited row can't sync until this runs.
app.post('/vaults/:vaultId/accept', async (req: Request, res: Response) => {
  const auth = await authenticate(req.headers.authorization);
  if (auth.error) { res.status(401).json({ error: auth.error }); return; }
  const { userId } = auth;
  const { vaultId } = req.params;

  const { data: existing } = await supabase
    .from('vault_members')
    .select('status')
    .eq('vault_id', vaultId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!existing) { res.status(404).json({ error: 'No invitation found' }); return; }
  if (existing.status === 'active') {
    res.json({ accepted: true, already: 'member' });
    return;
  }
  if (existing.status !== 'invited') {
    res.status(400).json({ error: `Cannot accept from status "${existing.status}"` });
    return;
  }

  const { error } = await supabase
    .from('vault_members')
    .update({ status: 'active' })
    .eq('vault_id', vaultId)
    .eq('user_id', userId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ accepted: true });
});

// ── POST /vaults/:vaultId/decline ────────────────────────────────────────────
// Called by the invitee to reject an invitation. Deletes their row so the
// owner has to re-invite if they want to try again. Explicitly rejects
// declining if the caller is already an active member (they should /leave
// instead) so this endpoint can't accidentally kick someone off a vault
// they've already joined.
app.post('/vaults/:vaultId/decline', async (req: Request, res: Response) => {
  const auth = await authenticate(req.headers.authorization);
  if (auth.error) { res.status(401).json({ error: auth.error }); return; }
  const { userId } = auth;
  const { vaultId } = req.params;

  const { data: existing } = await supabase
    .from('vault_members')
    .select('status')
    .eq('vault_id', vaultId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!existing) { res.status(404).json({ error: 'No invitation found' }); return; }
  if (existing.status === 'active') {
    res.status(400).json({ error: 'You are already a member. Use leave instead.' });
    return;
  }

  const { error } = await supabase
    .from('vault_members')
    .delete()
    .eq('vault_id', vaultId)
    .eq('user_id', userId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ declined: true });
});

// ── GET /vaults/:vaultId/members ─────────────────────────────────────────────
app.get('/vaults/:vaultId/members', async (req: Request, res: Response) => {
  const auth = await authenticate(req.headers.authorization);
  if (auth.error) { res.status(401).json({ error: auth.error }); return; }
  const { userId } = auth;

  const { vaultId } = req.params;

  // Check requester is an active member
  const { data: self } = await supabase
    .from('vault_members')
    .select('status')
    .eq('vault_id', vaultId)
    .eq('user_id', userId)
    .single();

  if (!self || self.status !== 'active') {
    res.status(403).json({ error: 'Not a member of this vault' });
    return;
  }

  // Return both active members AND invited (pending) members. UI distinguishes
  // via the status field. Two queries + stitch in code: PostgREST can't embed
  // profiles because there's no declared FK between vault_members.user_id and
  // profiles.id. Adding the FK would be a schema change; two round-trips are
  // fine for the small member counts this returns.
  const { data: memberRows, error: memberErr } = await supabase
    .from('vault_members')
    .select('user_id, status, joined_at')
    .eq('vault_id', vaultId)
    .in('status', ['active', 'invited']);
  if (memberErr) { res.status(500).json({ error: memberErr.message }); return; }

  const userIds = (memberRows ?? []).map((m) => m.user_id);
  const { data: profileRows, error: profileErr } = userIds.length > 0
    ? await supabase.from('profiles').select('id, display_name, color').in('id', userIds)
    : { data: [] as Array<{ id: string; display_name: string | null; color: string | null }>, error: null };
  if (profileErr) { res.status(500).json({ error: profileErr.message }); return; }

  const profileMap = new Map((profileRows ?? []).map((p) => [p.id, { display_name: p.display_name, color: p.color }]));
  const stitched = (memberRows ?? []).map((m) => ({
    user_id: m.user_id,
    status: m.status,
    joined_at: m.joined_at,
    email: null as string | null,
    profiles: profileMap.get(m.user_id) ?? null,
  }));

  // Also include pending_invites — those are people invited by email who
  // haven't signed up yet. They exist as far as vault access is concerned
  // (an on_invite_confirmed trigger auto-adds them to vault_members when
  // they sign up), so the owner should see them here to manage/cancel.
  const { data: pendingRows } = await supabase
    .from('pending_invites')
    .select('email, created_at')
    .eq('vault_id', vaultId);

  for (const row of pendingRows ?? []) {
    stitched.push({
      user_id: null as unknown as string,     // no auth account yet
      status: 'pending_signup',
      joined_at: row.created_at,
      email: row.email,
      profiles: null,
    });
  }

  res.json(stitched);
});

// ── DELETE /vaults/:vaultId/pending-invites/:email ────────────────────────────
// Cancel a pending_invites entry (person hasn't signed up yet). Separate from
// the /members DELETE because pending_invites is keyed by email, not user_id.
app.delete('/vaults/:vaultId/pending-invites/:email', async (req: Request, res: Response) => {
  const auth = await authenticate(req.headers.authorization);
  if (auth.error) { res.status(401).json({ error: auth.error }); return; }
  const { userId } = auth;

  const { vaultId, email } = req.params;
  const decodedEmail = decodeURIComponent(email);

  // Only the vault owner may cancel pending invites
  const { data: vault } = await supabase
    .from('vaults')
    .select('owner_id')
    .eq('id', vaultId)
    .single();
  if (!vault || vault.owner_id !== userId) {
    res.status(403).json({ error: 'Only the vault owner can cancel pending invites' });
    return;
  }

  const { error } = await supabase
    .from('pending_invites')
    .delete()
    .eq('vault_id', vaultId)
    .eq('email', decodedEmail);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ cancelled: true });
});

// ── DELETE /vaults/:vaultId/members/:userId ───────────────────────────────────
app.delete('/vaults/:vaultId/members/:memberId', async (req: Request, res: Response) => {
  const auth = await authenticate(req.headers.authorization);
  if (auth.error) { res.status(401).json({ error: auth.error }); return; }
  const { userId } = auth;

  const { vaultId, memberId } = req.params;

  // Verify requester is the owner
  const { data: vault } = await supabase
    .from('vaults')
    .select('owner_id')
    .eq('id', vaultId)
    .single();

  if (!vault || vault.owner_id !== userId) {
    res.status(403).json({ error: 'Only the vault owner can remove members' });
    return;
  }

  if (memberId === userId) {
    res.status(400).json({ error: 'Owner cannot remove themselves' });
    return;
  }

  const { error } = await supabase
    .from('vault_members')
    .delete()
    .eq('vault_id', vaultId)
    .eq('user_id', memberId);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ removed: true });
});

// ── DELETE /vaults/:vaultId ───────────────────────────────────────────────────
// Owner-only. Explicit child cleanup (don't rely on FK cascades — makes the
// dependency list obvious and works even if a table was added without ON
// DELETE CASCADE). Also destroys any live in-memory Y.Docs so connected
// clients don't keep syncing into a vault that no longer exists.
app.delete('/vaults/:vaultId', async (req: Request, res: Response) => {
  const auth = await authenticate(req.headers.authorization);
  if (auth.error) { res.status(401).json({ error: auth.error }); return; }
  const { userId } = auth;
  const { vaultId } = req.params;

  const { data: vault } = await supabase
    .from('vaults')
    .select('owner_id')
    .eq('id', vaultId)
    .single();
  if (!vault) { res.status(404).json({ error: 'Vault not found' }); return; }
  if (vault.owner_id !== userId) {
    res.status(403).json({ error: 'Only the vault owner can delete this vault' });
    return;
  }

  // Free in-memory state FIRST so any late-arriving persist for this vault
  // no-ops (see purgedDocs guard in persistNow).
  purgeAllVaultDocsInMemory(vaultId);

  // Serialize child cleanup so a late failure doesn't leave the vault_docs
  // and vault_members rows already deleted while the vault row survives.
  // Tables that don't exist in this project (pending_invites is optional —
  // its migration may not have been applied) are treated as no-ops instead
  // of blocking the delete.
  const childTables = ['vault_docs', 'vault_members', 'pending_invites'];
  for (const table of childTables) {
    const { error } = await supabase.from(table).delete().eq('vault_id', vaultId);
    if (error) {
      const msg = error.message.toLowerCase();
      const missingTable = msg.includes('could not find the table') || msg.includes('does not exist');
      if (missingTable) continue;
      res.status(500).json({ error: `Failed to clean up ${table}: ${error.message}` });
      return;
    }
  }

  const { error: vaultErr } = await supabase.from('vaults').delete().eq('id', vaultId);
  if (vaultErr) { res.status(500).json({ error: vaultErr.message }); return; }

  res.json({ deleted: true });
});

// ── POST /vaults/:vaultId/leave ──────────────────────────────────────────────
// Any active member (except the owner) can remove themselves. Owners must
// either delete the vault or (eventually) transfer ownership. POST rather
// than DELETE to leave room for future side effects (email notification)
// and to mirror POST /join's shape.
app.post('/vaults/:vaultId/leave', async (req: Request, res: Response) => {
  const auth = await authenticate(req.headers.authorization);
  if (auth.error) { res.status(401).json({ error: auth.error }); return; }
  const { userId } = auth;
  const { vaultId } = req.params;

  const { data: vault } = await supabase
    .from('vaults')
    .select('owner_id')
    .eq('id', vaultId)
    .single();
  if (!vault) { res.status(404).json({ error: 'Vault not found' }); return; }
  if (vault.owner_id === userId) {
    res.status(400).json({ error: 'Owners cannot leave their own vault. Delete it or transfer ownership.' });
    return;
  }

  const { data: member } = await supabase
    .from('vault_members')
    .select('status')
    .eq('vault_id', vaultId)
    .eq('user_id', userId)
    .single();
  if (!member) { res.status(403).json({ error: 'You are not a member of this vault' }); return; }

  const { error } = await supabase
    .from('vault_members')
    .delete()
    .eq('vault_id', vaultId)
    .eq('user_id', userId);
  if (error) { res.status(500).json({ error: error.message }); return; }

  res.json({ left: true });
});

// ── PATCH /vaults/:vaultId ───────────────────────────────────────────────────
// Rename. Owner-only. Only name is editable for now.
app.patch('/vaults/:vaultId', async (req: Request, res: Response) => {
  const auth = await authenticate(req.headers.authorization);
  if (auth.error) { res.status(401).json({ error: auth.error }); return; }
  const { userId } = auth;
  const { vaultId } = req.params;
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }

  const { data: vault } = await supabase
    .from('vaults')
    .select('owner_id')
    .eq('id', vaultId)
    .single();
  if (!vault) { res.status(404).json({ error: 'Vault not found' }); return; }
  if (vault.owner_id !== userId) {
    res.status(403).json({ error: 'Only the vault owner can rename this vault' });
    return;
  }

  const { data, error } = await supabase
    .from('vaults')
    .update({ name: name.trim() })
    .eq('id', vaultId)
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// ── POST /vaults/:vaultId/rotate-invite-code ─────────────────────────────────
// Owner-only. Generates a new invite_code — old codes stop working
// immediately on POST /join. Use this after a code is shared to someone
// who shouldn't have it.
app.post('/vaults/:vaultId/rotate-invite-code', async (req: Request, res: Response) => {
  const auth = await authenticate(req.headers.authorization);
  if (auth.error) { res.status(401).json({ error: auth.error }); return; }
  const { userId } = auth;
  const { vaultId } = req.params;

  const { data: vault } = await supabase
    .from('vaults')
    .select('owner_id')
    .eq('id', vaultId)
    .single();
  if (!vault) { res.status(404).json({ error: 'Vault not found' }); return; }
  if (vault.owner_id !== userId) {
    res.status(403).json({ error: 'Only the vault owner can rotate the invite code' });
    return;
  }

  // 8 bytes → 11-char base64url. 64 bits of entropy, human-shareable length.
  const newCode = crypto.randomBytes(8).toString('base64url');
  const { data, error } = await supabase
    .from('vaults')
    .update({ invite_code: newCode })
    .eq('id', vaultId)
    .select('invite_code')
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ invite_code: data.invite_code });
});

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── HTTP + WebSocket server ─────────────────────────────────────────────────

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', async (req, socket, head) => {
  const rawUrl = req.url ?? '/';
  const url = new URL(rawUrl, `http://${req.headers.host ?? 'localhost'}`);

  // Expect path: /sync/<vaultId>/<room>  (room must be in path, not ?room= param)
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'sync' || !parts[1] || !parts[2]) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  const vaultId = parts[1];
  const token = url.searchParams.get('token');

  if (!token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  // Authenticate
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  // Check active membership
  const { data: member } = await supabase
    .from('vault_members')
    .select('status')
    .eq('vault_id', vaultId)
    .eq('user_id', user.id)
    .single();

  if (!member || member.status !== 'active') {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
  const rawUrl = req.url ?? '/';
  const url = new URL(rawUrl, `http://${req.headers.host ?? 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean);
  const vaultId = parts[1] ?? 'unknown';

  // Build docName from URL path: /sync/<vaultId>/<room...>
  // parts[2..] is the room (may be multi-segment for sub-folder files)
  const roomPath = parts.slice(2).join('/');
  const docName = `${vaultId}/${roomPath}`;

  setupWSConnection(ws, req, { docName });
  // Update handler + persisted-state load are wired in setPersistence's bindState.
});

// ─── Start ──────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[freesync] Relay server listening on port ${PORT}`);
  console.log(`[freesync] Health: http://localhost:${PORT}/health`);
  console.log(`[freesync] WebSocket: ws://localhost:${PORT}/sync/<vaultId>?token=<jwt>`);
});

export default app;
