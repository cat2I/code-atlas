import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const dir = await mkdtemp(join(tmpdir(), 'code-atlas-vscode-e2e-'));
const workspace = join(dir, 'workspace'); await mkdir(workspace);
await writeFile(join(workspace, 'main.py'), 'from helper import sensor\n\nclass Bot:\n    def step(self):\n        return sensor()\n\ndef run():\n    return 1\n');
await writeFile(join(workspace, 'helper.py'), 'def sensor():\n    return 42\n');
await writeFile(join(workspace, 'main.c'), '#include <stdint.h>\nvoid motor_set_pwm(float duty) { (void)duty; }\nvoid HAL_TIM_PeriodElapsedCallback(void *htim) { motor_set_pwm(0.5f); }\nint main(void) { return 0; }\n');
const port = 20000 + Math.floor(Math.random() * 20000);
const args = ['--no-sandbox', '--disable-gpu', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--new-window',
  `--user-data-dir=${join(dir, 'user')}`, `--extensions-dir=${join(dir, 'extensions')}`,
  `--extensionDevelopmentPath=${resolve('vscode')}`, `--extensionTestsPath=${resolve('vscode/test/host.cjs')}`,
  `--remote-debugging-port=${port}`, workspace];
const proc = spawn('/usr/share/code/code', args, { env: { ...process.env, CODE_ATLAS_E2E_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; proc.stdout.on('data', data => output += String(data)); proc.stderr.on('data', data => output += String(data));
let exited = false, exitCode; proc.on('exit', code => { exited = true; exitCode = code; });
let browser;
async function stage(name, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const value = JSON.parse(await readFile(join(dir, 'stage.json'), 'utf8')); if (value.name === name) return value; if (value.name === 'failed') throw new Error(value.error); }
    catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    if (exited) throw new Error(`VS Code exited ${exitCode} before ${name}: ${output.slice(-5000)}`);
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Timeout for stage ${name}. VS Code output: ${output.slice(-5000)}`);
}
try {
  await stage('editorReady', 45000);
  for (let attempt = 0; attempt < 50 && !browser; attempt++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }); }
    catch { await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  if (!browser) throw new Error(`Could not connect Playwright to VS Code CDP on ${port}. ${output.slice(-3000)}`);
  const page = browser.contexts()[0].pages().find(p => p.url().includes('workbench')) || browser.contexts()[0].pages().find(p => !p.url().startsWith('devtools://')) || browser.contexts()[0].pages()[0];
  await page.bringToFront();
  // This is the actual user shortcut in the VS Code editor, not executeCommand from a unit test.
  await page.keyboard.press('Control+Shift+V');
  const initial = await stage('mapReady'); assert.equal(initial.initial.nodes, 2);
  let webview;
  for (let attempt = 0; attempt < 50 && !webview; attempt++) {
    for (const f of page.frames()) {
      if (await f.locator('#viewport').count().catch(() => 0)) { webview = f; break; }
    }
    if (!webview) await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!webview) throw new Error(`Map opened, but no DOM frame found: ${page.frames().map(f => f.url()).join(' | ')}`);
  await webview.locator('.code-node').first().waitFor();
  assert.equal(await webview.locator('.code-node').count(), 2);
  await webview.locator('[data-host-scope="workspace"]').click();
  const all = await stage('workspaceReady'); assert.equal(all.workspace.files.length, 3);
  assert.equal(await webview.locator('.code-node').count(), 6);
  if (!(await webview.locator('#sidebar').isVisible())) await webview.locator('#toggle-sidebar').click();
  const method = webview.locator('.tree-function').filter({ hasText: 'step' });
  await method.click();
  await webview.locator('#go-to-code').click();
  await stage('sourceJumpReady');
  await stage('updated');
  await webview.waitForFunction(() => document.querySelectorAll('.code-node').length === 7);
  const geometry = await webview.evaluate(() => {
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    return { viewport: rect(document.querySelector('#viewport')), world: document.querySelector('#world').style.transform,
      graph: window.codeAtlas.state().graph.nodes.map(n => ({ name: n.name, x: n.x, y: n.y })),
      nodes: [...document.querySelectorAll('.code-node')].map(el => ({ name: el.querySelector('.node-title')?.textContent, rect: rect(el), style: el.getAttribute('style'), opacity: getComputedStyle(el).opacity })) };
  });
  assert.ok(geometry.nodes.some(n => n.rect.x < geometry.viewport.x + geometry.viewport.width && n.rect.x + n.rect.width > geometry.viewport.x && n.rect.y < geometry.viewport.y + geometry.viewport.height && n.rect.y + n.rect.height > geometry.viewport.y), 'At least one node must be on-screen');
  await mkdir(resolve('artifacts'), { recursive: true });
  await page.screenshot({ path: resolve('artifacts/code-atlas-vscode-e2e.png'), fullPage: true });
  await writeFile(join(dir, 'release'), 'ok');
  const c = await stage('cReady'); assert.equal(c.c.languages.c, 3);
  await webview.waitForFunction(() => document.querySelectorAll('.code-node[data-node^="main.c::"]').length === 3);
  assert.equal(await webview.locator('.code-node.role-interrupt').count(), 1);
  const visibleCNodes = await webview.evaluate(() => {
    const viewport = document.querySelector('#viewport').getBoundingClientRect();
    return [...document.querySelectorAll('.code-node[data-node^="main.c::"]')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.x < viewport.right && r.right > viewport.left && r.y < viewport.bottom && r.bottom > viewport.top;
    }).length;
  });
  assert.ok(visibleCNodes > 0, 'C nodes must be visible when invoking shortcut on C file');
  const cZoom = Number.parseInt(await webview.locator('#zoom-label').textContent(), 10);
  assert.ok(cZoom >= 60, `C map should remain readable in a split editor, got ${cZoom}%`);
  await page.screenshot({ path: resolve('artifacts/code-atlas-vscode-c-e2e.png'), fullPage: true });
  await writeFile(join(dir, 'releaseC'), 'ok');
  console.log('E2E passed: real Ctrl+Shift+V, file/workspace map, node → source line, unsaved refresh, C/HAL callback.');
} finally {
  if (browser) await browser.close().catch(() => {});
  if (!exited) proc.kill('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 500));
  console.log(`VS Code test log tail:\n${output.slice(-2500)}`);
  await rm(dir, { recursive: true, force: true });
}
