import esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Load packages/plugin/.env into process.env if present. Tiny parser — no
// dotenv dep. Anything already on process.env wins (so an inline
// `WEB_APP_URL=... npm run build` still overrides the file).
const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

// Colon-separated list of Obsidian vault plugin dirs to copy the build into.
// Example:  FREESYNC_DEV_VAULTS=/path/to/vault1/.obsidian/plugins/freesync:/path/to/vault2/.obsidian/plugins/freesync
// If unset, the build lands in main.js next to esbuild.config.mjs — copy it
// wherever you need it manually. Add this to your shell profile for the
// standard multi-vault dev loop.
const devVaults = (process.env.FREESYNC_DEV_VAULTS ?? '')
  .split(':').map((s) => s.trim()).filter(Boolean);
const isWatch = process.argv.includes('--watch');

const copyOutputs = () => {
  if (devVaults.length === 0) return;
  for (const dest of devVaults) {
    if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
    copyFileSync('main.js', join(dest, 'main.js'));
    copyFileSync('manifest.json', join(dest, 'manifest.json'));
    copyFileSync('styles.css', join(dest, 'styles.css'));
  }
  console.log(`Copied to ${devVaults.length} dev vault${devVaults.length === 1 ? '' : 's'}`);
};

// Build-time constants. Set in packages/plugin/.env, or override inline:
//   WEB_APP_URL=https://vault.example.com npm run build --workspace=packages/plugin
// Self-hosters can rebuild with their own values, and end users can still
// override individually via the plugin's Advanced settings panel.
const WEB_APP_URL = process.env.WEB_APP_URL ?? 'https://freesync.app';
const RELAY_URL   = process.env.RELAY_URL   ?? 'ws://localhost:3001/sync';

const ctx = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  // Browser platform so packages like lib0 (Yjs dep) resolve their browser
  // variants — the node variants do `require("crypto")` which throws on
  // Obsidian mobile. Explicit mainFields order forces browser entry points.
  platform: 'browser',
  mainFields: ['browser', 'module', 'main'],
  conditions: ['browser', 'import'],
  target: 'es2020',
  format: 'cjs',
  outfile: 'main.js',
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  define: {
    __WEB_APP_URL__: JSON.stringify(WEB_APP_URL),
    __RELAY_URL__:   JSON.stringify(RELAY_URL),
  },
  plugins: [{
    name: 'copy-on-build',
    setup(build) {
      build.onEnd(result => {
        if (result.errors.length === 0) copyOutputs();
      });
    }
  }]
});

if (isWatch) {
  await ctx.watch();
  console.log('Watching...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
