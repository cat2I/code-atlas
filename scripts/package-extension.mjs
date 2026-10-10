import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
await mkdir('artifacts', { recursive: true });
const result = spawnSync(resolve('node_modules/.bin/vsce'), ['package', '--no-dependencies', '--allow-missing-repository', '--out', '../artifacts/code-atlas-0.1.0.vsix'], {
  cwd: 'vscode', stdio: 'inherit', shell: false
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
console.log('Packaged → artifacts/code-atlas-0.1.0.vsix');
