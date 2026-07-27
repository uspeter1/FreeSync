import esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

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

// Build-time constants. Override at build time via env, e.g.:
//   WEB_APP_URL=https://vault.example.com npm run build --workspace=packages/plugin
// Self-hosters can rebuild with their own values, and end users can still
// override individually via the plugin's Advanced settings panel.
const WEB_APP_URL = process.env.WEB_APP_URL ?? 'https://freesync.app';

const ctx = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'es2020',
  format: 'cjs',
  outfile: 'main.js',
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  define: {
    __WEB_APP_URL__: JSON.stringify(WEB_APP_URL),
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
