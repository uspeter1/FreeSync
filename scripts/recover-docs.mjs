import { createClient } from '/home/peter/projects/FreeSync/node_modules/@supabase/supabase-js/dist/index.mjs';
import * as Y from '/home/peter/projects/FreeSync/node_modules/yjs/dist/yjs.mjs';

const SUPABASE_URL = 'https://awgcorggtvfcnmjdcljb.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3Z2NvcmdndHZmY25tamRjbGpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODAxMjA2MCwiZXhwIjoyMDkzNTg4MDYwfQ.VGMGUBla-x_wP_frykCOb4iHWK3REKpq1Sb2y4n56bw';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const VAULT_ID = '101ccbe9-e0ff-4255-bd8f-b27f495f9840';
const CUTOFF = '2026-05-08T00:00:00Z';

const { data, error } = await supabase
  .from('vault_docs')
  .select('file_path, yjs_state, updated_at')
  .eq('vault_id', VAULT_ID)
  .gte('updated_at', CUTOFF)
  .order('updated_at', { ascending: false });

if (error) {
  console.error('Query failed:', error.message);
  process.exit(1);
}

console.log(`Found ${data.length} docs updated after ${CUTOFF}:\n`);

for (const doc of data) {
  const decoded = decodeURIComponent(doc.file_path);
  console.log(`=== ${decoded} (updated: ${doc.updated_at}) ===`);

  try {
    const raw = doc.yjs_state;
    let bytes;
    if (typeof raw === 'string') {
      if (raw.startsWith('\\x')) {
        // PostgreSQL hex encoding: \xdeadbeef...
        bytes = Buffer.from(raw.slice(2), 'hex');
      } else {
        // base64
        bytes = Buffer.from(raw, 'base64');
      }
    } else if (raw && typeof raw === 'object') {
      if (raw.type === 'Buffer' && Array.isArray(raw.data)) {
        bytes = Buffer.from(raw.data);
      } else {
        bytes = Buffer.from(Object.values(raw));
      }
    } else {
      console.log('  [unknown state format]');
      continue;
    }

    // The stored value is JSON-encoded {type:"Buffer",data:[...]} wrapped in hex
    // Try parsing as JSON first
    let yjsBytes = bytes;
    try {
      const parsed = JSON.parse(bytes.toString('utf8'));
      if (parsed && parsed.type === 'Buffer' && Array.isArray(parsed.data)) {
        yjsBytes = Buffer.from(parsed.data);
      }
    } catch {}

    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, yjsBytes);
    const text = ydoc.getText('content').toString();
    if (text.trim()) {
      console.log(text.substring(0, 2000));
      if (text.length > 2000) console.log(`... [${text.length - 2000} more chars]`);
    } else {
      console.log('  [empty or no text content]');
    }
  } catch (e) {
    console.log(`  [decode error: ${e.message}]`);
  }
  console.log();
}
