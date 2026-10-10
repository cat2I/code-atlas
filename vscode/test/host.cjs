const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const dir = process.env.CODE_ATLAS_E2E_DIR;
if (!dir) throw new Error('CODE_ATLAS_E2E_DIR is required');
const marker = path.join(dir, 'stage.json');
const stage = (name, extra = {}) => fs.writeFileSync(marker, JSON.stringify({ name, ...extra }));
async function waitFor(predicate, label, ms = 40000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const value = predicate(); if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}. State: ${JSON.stringify(getState())}`);
}
function getState() { try { return vscode.extensions.getExtension('cat21.code-atlas')?.exports?.getState?.(); } catch { return null; } }
exports.run = async function run() {
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(dir, 'workspace', 'main.py')));
    const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
    editor.selection = new vscode.Selection(2, 4, 2, 4);
    await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
    stage('editorReady');
    await waitFor(() => getState()?.rendered > 0 && getState()?.nodes === 2, 'keyboard shortcut → 2-node map');
    const initial = getState();
    assert.equal(initial.mode, 'file'); assert.equal(initial.files.length, 1);
    stage('mapReady', { initial });
    await waitFor(() => getState()?.mode === 'workspace' && getState()?.rendered >= 2 && getState()?.nodes === 6, 'workspace scope');
    const workspace = getState();
    assert.equal(workspace.files.length, 3);
    assert.ok(workspace.edges >= 1);
    stage('workspaceReady', { workspace });
    await waitFor(() => getState()?.lastOpen?.line === 4, 'node → source line 4');
    assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), doc.uri.toString());
    assert.equal(vscode.window.activeTextEditor?.selection.active.line, 3);
    stage('sourceJumpReady', { jump: getState().lastOpen });
    await editor.edit(edit => edit.insert(new vscode.Position(doc.lineCount, 0), '\ndef added_after_edit():\n    return 2\n'));
    await waitFor(() => getState()?.nodes === 7 && getState()?.rendered > workspace.rendered, 'unsaved edit refresh');
    assert.equal(doc.isDirty, true);
    stage('updated', { afterEdit: getState(), dirty: doc.isDirty });
    await waitFor(() => fs.existsSync(path.join(dir, 'release')), 'screenshot/release from outer E2E driver');
    const cdoc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(dir, 'workspace', 'main.c')));
    await vscode.window.showTextDocument(cdoc, { viewColumn: vscode.ViewColumn.One, preview: false });
    await vscode.commands.executeCommand('codeAtlas.openMap');
    await waitFor(() => getState()?.rendered === getState()?.revision && getState()?.mode === 'file' && getState()?.nodes === 3 && getState()?.languages?.c === 3, 'C file map');
    stage('cReady', { c: getState() });
    await waitFor(() => fs.existsSync(path.join(dir, 'releaseC')), 'C screenshot/release from outer E2E driver');
  } catch (error) { stage('failed', { error: error.stack || String(error) }); throw error; }
};
