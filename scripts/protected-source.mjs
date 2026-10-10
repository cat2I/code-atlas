// Read-only audit of the user's protected project. Snapshots live in Code Atlas, never in that project.
import { readdir, readFile, writeFile, mkdir, lstat, readlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
const root = '/home/cat21/Documents/projects/Transformer/Transform_bipedal_todai';
const output = new URL('../artifacts/todai-source-baseline.json', import.meta.url);
const mode = process.argv[2] || 'verify';
const files = {};
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, e.name), name = relative(root, path);
    if (e.isDirectory()) { if (!['.git', 'node_modules', '.venv', 'venv', '__pycache__'].includes(e.name)) await walk(path); }
    else if (/\.(py|pyi|c|h|cpp|hpp|cc|cxx|cu|cuh|s|S|asm|sh|bash|js|ts|json|ya?ml|toml|ini|cfg|xml|launch|md|txt|cmake|mk)$/i.test(e.name) || /^(Makefile|CMakeLists.txt|Dockerfile)$/.test(e.name)) {
      const stat = await lstat(path);
      const data = e.isSymbolicLink() ? Buffer.from(await readlink(path)) : await readFile(path);
      files[name] = { sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length, mode: stat.mode };
    }
  }
}
await walk(root);
if (mode === 'snapshot') {
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  try { await writeFile(output, JSON.stringify({ root, recordedAt: new Date().toISOString(), files }, null, 2), { flag: 'wx' }); }
  catch (e) { if (e.code !== 'EEXIST') throw e; throw new Error('Baseline already exists; refusing to overwrite it. Run verify.'); }
  console.log(`Saved baseline for ${Object.keys(files).length} protected source/config/doc files. No writes to todai.`);
} else {
  const baseline = JSON.parse(await readFile(output, 'utf8'));
  const changed = [...new Set([...Object.keys(files), ...Object.keys(baseline.files)])].filter(name => JSON.stringify(files[name]) !== JSON.stringify(baseline.files[name]));
  if (changed.length) { console.error('Protected files changed:', changed); process.exitCode = 1; }
  else console.log(`Verified ${Object.keys(files).length} protected files: hashes, sizes and modes unchanged.`);
}
