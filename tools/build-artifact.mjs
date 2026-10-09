// Bundles the game into one self-contained HTML file (dist/aether-breaker.html).
// Three.js still loads from the CDN via the import map; everything else is inlined.
// The output works as a claude.ai Artifact and can also be opened directly from disk.
//
//   node tools/build-artifact.mjs        (needs npx / network for esbuild)

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const js = execFileSync('npx', [
  '-y', 'esbuild@0.23.1', 'src/main.js',
  '--bundle', '--format=esm', '--minify', '--target=es2020',
  '--external:three', '--external:three/addons/*',
], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

let html = read('index.html');
const css = read('style.css');

const replaceOnce = (from, to) => {
  if (!html.includes(from)) throw new Error(`build: marker not found: ${from}`);
  html = html.replace(from, () => to);
};

// The Artifact host wraps the page in its own document skeleton (doctype, charset, viewport).
html = html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<html[^>]*>\s*/i, '')
  .replace(/<\/html>\s*/i, '')
  .replace(/<\/?head>\s*/gi, '')
  .replace(/<\/?body>\s*/gi, '')
  .replace(/\s*<meta charset[^>]*>/i, '')
  .replace(/\s*<meta name="viewport"[^>]*>/i, '');

// <title> must come first so the gallery can find it.
const title = html.match(/<title>.*?<\/title>/)[0];
html = `${title}\n${html.replace(title, '').trimStart()}`;

replaceOnce('<link rel="stylesheet" href="style.css">', `<style>\n${css}</style>`);
replaceOnce('<script type="module" src="src/main.js"></script>',
  `<script type="module">\n${js.replace(/<\/script/gi, '<\\/script')}</script>`);

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/aether-breaker.html'), html);
console.log(`dist/aether-breaker.html  ${(html.length / 1024).toFixed(1)} KB`);
