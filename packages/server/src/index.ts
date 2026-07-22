import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
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

  const { data, error } = await supabase
    .from('vaults')
    .select('*, vault_members!inner(user_id, status)')
    .eq('vault_members.user_id', userId)
    .eq('vault_members.status', 'active');

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
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

  // Look up target user by email (service role can read auth.users)
  const { data: targetUser, error: lookupErr } = await (supabase as any)
    .schema('auth')
    .from('users')
    .select('id')
    .eq('email', email)
    .single();

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

  // Add directly to vault_members — no code required
  const { error: memberErr } = await supabase
    .from('vault_members')
    .upsert({ vault_id: vaultId, user_id: targetUser.id, status: 'active' }, { onConflict: 'vault_id,user_id' });

  if (memberErr) { res.status(500).json({ error: memberErr.message }); return; }

  res.json({ invited: true, signup_required: false });
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

  const { data, error } = await supabase
    .from('vault_members')
    .select('user_id, status, joined_at, profiles(display_name, color)')
    .eq('vault_id', vaultId)
    .eq('status', 'active');

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
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
