import esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const VAULT1 = '/home/peter/FreeSyncUser1/.obsidian/plugins/freesync';
const VAULT2 = '/home/peter/FreeSyncUser2/.obsidian/plugins/freesync';
const VAULT3 = '/home/peter/FreeSyncTest3/.obsidian/plugins/freesync';
const isWatch = process.argv.includes('--watch');

const copyOutputs = () => {
  for (const dest of [VAULT1, VAULT2, VAULT3]) {
    if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
    copyFileSync('main.js', join(dest, 'main.js'));
    copyFileSync('manifest.json', join(dest, 'manifest.json'));
    copyFileSync('styles.css', join(dest, 'styles.css'));
  }
  console.log('Copied to all vaults');
};

const ctx = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'es2020',
  format: 'cjs',
  outfile: 'main.js',
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
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
