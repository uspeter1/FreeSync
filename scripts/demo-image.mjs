#!/usr/bin/env node
/**
 * Demo script: place FreeSync-demo.png into User1's vault and sync it to User2.
 *
 * Steps:
 *  1. Sign in as user1 to get a JWT
 *  2. Make vault-assets bucket public (service role — bypass RLS)
 *  3. Upload demo PNG to Supabase Storage (service role)
 *  4. Write PNG to User1's vault filesystem
 *  5. Connect to manifest room via y-websocket as user1
 *  6. Update manifest Y.Map → triggers User2's observer → downloads PNG
 */

import { createClient } from '@supabase/supabase-js';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';

// ─── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://awgcorggtvfcnmjdcljb.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3Z2NvcmdndHZmY25tamRjbGpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMTIwNjAsImV4cCI6MjA5MzU4ODA2MH0.Ymb_EpVaNxPZa4M-dgCIbw2t6taY8YEjA8pw9Q8n3cI';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3Z2NvcmdndHZmY25tamRjbGpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODAxMjA2MCwiZXhwIjoyMDkzNTg4MDYwfQ.VGMGUBla-x_wP_frykCOb4iHWK3REKpq1Sb2y4n56bw';

const VAULT_ID = 'e49ed7f7-6c8a-4329-b8e9-1bfaea4be449';
const RELAY_URL = 'ws://localhost:3001';
const USER1_EMAIL = 'user1@freesync.test';
const USER1_PASS = 'testpass123';
const STORAGE_BUCKET = 'vault-assets';
const FILE_NAME = 'FreeSync-demo.png';
const FILE_PATH_IN_VAULT = FILE_NAME;
const STORAGE_KEY = `${VAULT_ID}/${FILE_PATH_IN_VAULT}`;
const PNG_SOURCE = '/tmp/freesync-demo.png';
const USER1_VAULT = '/home/peter/FreeSyncUser1';

function log(msg) { console.log(`[demo] ${msg}`); }

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Sign in as user1
  log('Signing in as user1...');
  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: USER1_EMAIL,
    password: USER1_PASS,
  });
  if (authError || !authData.session) {
    console.error('Sign-in failed:', authError?.message);
    process.exit(1);
  }
  const userToken = authData.session.access_token;
  log(`Signed in as ${authData.user?.email}`);

  // 2. Make bucket public (service role)
  log('Making vault-assets bucket public...');
  const svcSupabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: bucketErr } = await svcSupabase.storage.updateBucket(STORAGE_BUCKET, { public: true });
  if (bucketErr) {
    console.warn('  updateBucket warning (may already be public):', bucketErr.message);
  } else {
    log('  Bucket is now public.');
  }

  // 3. Upload PNG to Supabase Storage using service role
  log(`Uploading ${FILE_NAME} to Storage (key: ${STORAGE_KEY})...`);
  const pngBuffer = fs.readFileSync(PNG_SOURCE);
  const { error: uploadErr } = await svcSupabase.storage
    .from(STORAGE_BUCKET)
    .upload(STORAGE_KEY, pngBuffer, { upsert: true, contentType: 'image/png' });
  if (uploadErr) {
    console.error('Upload failed:', uploadErr.message);
    process.exit(1);
  }
  log('  Upload OK.');

  // 4. Write PNG to User1's vault filesystem
  const destPath = path.join(USER1_VAULT, FILE_NAME);
  log(`Writing PNG to ${destPath}...`);
  fs.writeFileSync(destPath, pngBuffer);
  log('  File written to User1 vault.');

  // 5. Connect to manifest room via y-websocket as user1
  log('Connecting to manifest room...');
  const manifestDoc = new Y.Doc();
  const docName = `sync/${VAULT_ID}/__manifest__`;
  const wsUrl = `${RELAY_URL}/${docName}?token=${userToken}`;

  const provider = new WebsocketProvider(RELAY_URL, docName, manifestDoc, {
    params: { token: userToken },
    WebSocketPolyfill: WebSocket,
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout waiting for manifest sync'));
    }, 10_000);

    provider.on('sync', (synced) => {
      if (synced) {
        clearTimeout(timeout);
        resolve();
      }
    });
    provider.on('connection-error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`WS connection error: ${err.message}`));
    });
  });
  log('  Manifest synced.');

  // 6. Update manifest Y.Map entry
  log(`Setting manifest entry for ${FILE_PATH_IN_VAULT}...`);
  const fileMap = manifestDoc.getMap('files');
  manifestDoc.transact(() => {
    fileMap.set(FILE_PATH_IN_VAULT, {
      exists: true,
      binary: true,
      storageKey: STORAGE_KEY,
      binaryVersion: Date.now(),
    });
  });

  // Give the relay time to broadcast the update to connected peers
  await new Promise(r => setTimeout(r, 2000));
  log('  Manifest update broadcast — User2 should now download the image.');

  provider.destroy();
  manifestDoc.destroy();
  log('Done! Check User2 vault for FreeSync-demo.png');
}

main().catch(err => { console.error('[demo] Fatal:', err); process.exit(1); });
