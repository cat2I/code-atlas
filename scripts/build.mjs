import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/app.js'], bundle: true, minify: true, format: 'esm', target: 'es2022', outfile: 'dist/app.js', sourcemap: true });
await build({ entryPoints: ['src/worker.js'], bundle: true, minify: true, format: 'esm', target: 'es2022', outfile: 'dist/worker.js' });
await copyFile('src/index.html', 'dist/index.html');
await copyFile('src/style.css', 'dist/style.css');
console.log('Code Atlas built → dist/');
