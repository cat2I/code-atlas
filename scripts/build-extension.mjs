import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve('vscode');
await mkdir(resolve(root, 'out'), { recursive: true });
await mkdir(resolve(root, 'media'), { recursive: true });
await build({ entryPoints: ['vscode/src/extension.js'], bundle: true, platform: 'node', format: 'cjs', target: 'node20', outfile: 'vscode/out/extension.cjs', external: ['vscode'], minify: false, sourcemap: true });
await build({ entryPoints: ['src/app.js'], bundle: true, platform: 'browser', format: 'esm', target: 'es2022', outfile: 'vscode/media/app.js', minify: true, define: { 'process.env.CODE_ATLAS_VSCODE': '"1"' } });
await copyFile('src/style.css', 'vscode/media/style.css');
await writeFile('vscode/media/index.html', await readFile('src/index.html', 'utf8'));
const parsers = ['@lezer/common', '@lezer/lr', '@lezer/python', '@lezer/cpp'];
const notices = await Promise.all(parsers.map(async name =>
  `${name}\n${await readFile(resolve('node_modules', name, 'LICENSE'), 'utf8')}`));
await writeFile('vscode/THIRD_PARTY_NOTICES.txt', notices.join('\n'));
console.log('VS Code extension built → vscode/out + vscode/media');
