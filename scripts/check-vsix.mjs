import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const dir = await mkdtemp(join(tmpdir(), 'code-atlas-vsix-check-'));
const shared = [`--user-data-dir=${join(dir, 'user')}`, `--extensions-dir=${join(dir, 'extensions')}`];
const code = (args) => {
  const result = spawnSync('/usr/bin/code', ['--no-sandbox', ...shared, ...args], { encoding: 'utf8', timeout: 60000 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
};
try {
  const vsix = resolve('artifacts/code-atlas-0.1.0.vsix');
  code(['--install-extension', vsix, '--force']);
  const installed = code(['--list-extensions', '--show-versions']);
  assert.match(installed, /^cat21\.code-atlas@0\.1\.0$/m);
  console.log(`VSIX install passed in isolated VS Code profile: ${vsix}`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
