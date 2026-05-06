import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// y-websocket utils (CJS)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { setupWSConnection, docs } = require('y-websocket/bin/utils');

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

function scheduleDocPersist(vaultId: string, docName: string): void {
  const key = `${vaultId}::${docName}`;
  const existing = pendingPersist.get(key);
  if (existing) clearTimeout(existing);

  const handle = setTimeout(async () => {
    pendingPersist.delete(key);
    const doc: Y.Doc | undefined = docs.get(docName);
    if (!doc) return;

    const stateUpdate = Y.encodeStateAsUpdate(doc);
    const { error } = await supabase.from('vault_docs').upsert(
      {
        vault_id: vaultId,
        file_path: docName.includes('/') ? docName.split('/').slice(1).join('/') : docName,
        yjs_state: Buffer.from(stateUpdate),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'vault_id,file_path' }
    );
    if (error) {
      console.error(`[persist] Failed to persist doc "${docName}":`, error.message);
    }
  }, DEBOUNCE_MS);

  pendingPersist.set(key, handle);
}

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

  // Verify vault + invite code
  const { data: vault, error: vaultErr } = await supabase
    .from('vaults')
    .select('id, invite_code')
    .eq('id', vaultId)
    .single();

  if (vaultErr || !vault) { res.status(404).json({ error: 'Vault not found' }); return; }
  if (vault.invite_code !== invite_code) { res.status(403).json({ error: 'Invalid invite code' }); return; }

  // Upsert membership (idempotent)
  const { error: memberErr } = await supabase
    .from('vault_members')
    .upsert({ vault_id: vaultId, user_id: userId, status: 'active' }, { onConflict: 'vault_id,user_id' });

  if (memberErr) { res.status(500).json({ error: memberErr.message }); return; }

  res.json({ joined: true, vault_id: vaultId });
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

  // Expect path: /sync/<vaultId>
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'sync' || !parts[1]) {
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

  // setupWSConnection uses the URL path as the doc name by default.
  // We pass docName = "<vaultId>/<room>" format. The room comes from the
  // query param ?room=<name> or falls back to the path fragment.
  const room = url.searchParams.get('room') ?? url.pathname.slice(1); // e.g. "sync/<vaultId>"

  // Build a unique doc name scoped to the vault
  const docName = `${vaultId}/${room.replace(/^sync\/[^/]+\/?/, '') || '__manifest__'}`;

  setupWSConnection(ws, req, { docName });

  // Hook into the doc for persistence — wait a tick so the doc is registered
  setImmediate(() => {
    const doc: Y.Doc | undefined = docs.get(docName);
    if (!doc) return;

    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      scheduleDocPersist(vaultId, docName);
      void origin; // used by y-websocket internally
    });
  });
});

// ─── Start ──────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[freesync] Relay server listening on port ${PORT}`);
  console.log(`[freesync] Health: http://localhost:${PORT}/health`);
  console.log(`[freesync] WebSocket: ws://localhost:${PORT}/sync/<vaultId>?token=<jwt>`);
});

export default app;
