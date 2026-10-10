// Dev tool: run the analyzer over a real project folder without a browser, to see what resolves.
// Usage: node scripts/analyze-dir.mjs <folder> [path-filter]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { analyze } from '../src/analyzer.js';
const root = process.argv[2], filter = process.argv[3];
if (!root) { console.error('Usage: node scripts/analyze-dir.mjs <folder> [path-filter]'); process.exit(1); }
const SKIP = new Set(['.git', '__pycache__', 'node_modules', '.venv', 'venv', 'build', 'dist', '.vscode']);
const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(py|c|h)$/i.test(entry) && (!filter || full.includes(filter))) files.push({ name: relative(root, full), content: readFileSync(full, 'utf8') });
  }
})(root);
console.log(`${files.length} file, ${(files.reduce((n, f) => n + f.content.length, 0) / 1024).toFixed(0)} KB`);
const started = Date.now();
const g = analyze(files);
console.log(`phân tích ${Date.now() - started} ms →`, g.stats);
const count = (list, key) => [...list.reduce((m, x) => m.set(key(x), (m.get(key(x)) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);
const open = g.nodes.flatMap(n => n.calls.filter(c => !c.target));
console.log('\nloại lời gọi chưa nối:', count(open, c => c.kind).map(([k, v]) => `${k} ${v}`).join(', '));
console.log('module chưa mở:', count(open.filter(c => c.kind === 'library'), c => c.module).slice(0, 15).map(([k, v]) => `${k}(${v})`).join(', '));
console.log('\nchưa xác định, hay gặp nhất:');
console.log('  ' + count(open.filter(c => c.kind === 'unknown'), c => c.name).slice(0, 15).map(([k, v]) => `${v}×${k}`).join(', '));
const classes = g.files.flatMap(f => f.classes.map(c => ({ file: f.name, ...c })));
console.log(`\nclass: ${classes.length} (có base: ${classes.filter(c => c.bases.length).length}), decorator: ${g.nodes.filter(n => n.decorators.length).length}, lời gọi qua class cha: ${g.nodes.flatMap(n => n.calls.filter(c => c.inheritedFrom)).length}`);
for (const c of classes.filter(c => c.bases.length).slice(0, 15)) console.log(`  ${c.file}:${c.line} class ${c.name}(${c.bases.join(', ')})`);
const errors = g.files.filter(f => f.errors.length);
console.log(`\nfile có lỗi cú pháp: ${errors.length}` + (errors.length ? ' → ' + errors.slice(0, 5).map(f => `${f.name}:${f.errors[0]}`).join(', ') : ''));
const noCaller = g.nodes.filter(n => !g.edges.some(e => e.target === n.id));
console.log(`hàm không ai gọi trong phạm vi đã mở: ${noCaller.length}/${g.nodes.length}`);
