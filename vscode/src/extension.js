const vscode = require('vscode');
const path = require('node:path');
const crypto = require('node:crypto');
const { analyze, layoutGraph } = require('../../src/analyzer.js');

const MAX_FILES = 120;
const MAX_FILE_CHARS = 500000;
const MAX_TOTAL_CHARS = 3000000;
const EXT = /\.(py|c|h)$/i;
const EXCLUDE = '**/{.git,node_modules,.venv,venv,__pycache__,build,dist,.tox,.mypy_cache,.pytest_cache}/**';

function supported(doc) {
  return !!doc && (EXT.test(doc.uri.path) || (doc.uri.scheme === 'untitled' && (doc.languageId === 'python' || doc.languageId === 'c')));
}
function safeLayout(value) {
  if (!value || typeof value !== 'object') return {};
  const bounded = n => Number.isFinite(n) && Math.abs(n) < 1000000;
  const positions = {};
  for (const [key, p] of Object.entries(value.positions || {})) if (key.length < 500 && p && bounded(p.x) && bounded(p.y)) positions[key] = { x: p.x, y: p.y };
  const notes = Array.isArray(value.notes) ? value.notes.filter(n => n && typeof n.id === 'string' && typeof n.text === 'string' && n.text.length <= 10000 && bounded(n.x) && bounded(n.y)).slice(0, 200) : [];
  const strokes = Array.isArray(value.strokes) ? value.strokes.filter(s => Array.isArray(s) && s.length <= 10000 && s.every(p => Array.isArray(p) && p.length === 2 && p.every(bounded))).slice(0, 1000) : [];
  const camera = value.camera && [value.camera.x, value.camera.y, value.camera.z].every(bounded) && value.camera.z >= .1 && value.camera.z <= 2.5 ? value.camera : undefined;
  return { positions, notes, strokes, camera };
}
function webviewHTML(webview, extensionUri) {
  const media = vscode.Uri.joinPath(extensionUri, 'media');
  const css = webview.asWebviewUri(vscode.Uri.joinPath(media, 'style.css'));
  const js = webview.asWebviewUri(vscode.Uri.joinPath(media, 'app.js'));
  const nonce = crypto.randomBytes(18).toString('base64');
  const html = require('node:fs').readFileSync(path.join(extensionUri.fsPath, 'media', 'index.html'), 'utf8');
  // Canvas coordinates are emitted as inline style attributes by the shared renderer.
  // Scripts remain nonce-only; only style attributes need the inline allowance.
  const csp = `default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; connect-src 'none';`;
  return html.replace('</head>', `  <meta http-equiv="Content-Security-Policy" content="${csp}">\n</head>`)
    .replace('href="./style.css"', `href="${css}"`)
    .replace('<script type="module" src="./app.js"></script>', `<script nonce="${nonce}" type="module" src="${js}"></script>`);
}

class MapController {
  constructor(context, sourceDocument, sourceViewColumn) {
    this.context = context;
    this.sourceUri = sourceDocument.uri;
    this.lastInvokedSourceUri = sourceDocument.uri;
    this.sourceViewColumn = sourceViewColumn || vscode.ViewColumn.One;
    this.mode = 'file';
    this.ready = false;
    this.revision = 0;
    this.rendered = 0;
    this.filesByName = new Map();
    this.pendingFocusLine = vscode.window.activeTextEditor?.document.uri.toString() === sourceDocument.uri.toString()
      ? vscode.window.activeTextEditor.selection.active.line + 1 : 0;
    this.timer = undefined;
    this.panel = vscode.window.createWebviewPanel('codeAtlas.map', 'Code Atlas · Bản đồ code', vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] });
    this.panel.iconPath = new vscode.ThemeIcon('type-hierarchy');
    this.disposables = [
      this.panel.onDidDispose(() => { this.disposed = true; clearTimeout(this.timer); controllers.delete(this); for (const d of this.disposables) d.dispose(); }),
      this.panel.webview.onDidReceiveMessage(message => { void this.message(message).catch(error => this.fail(error)); })
    ];
    this.panel.webview.html = webviewHTML(this.panel.webview, context.extensionUri);
  }
  get scopeKey() {
    const root = vscode.workspace.getWorkspaceFolder(this.sourceUri);
    return `${this.mode}:${root?.uri.toString() || this.sourceUri.toString()}:${this.mode === 'file' ? this.sourceUri.toString() : ''}`;
  }
  get debug() { return { mode: this.mode, ready: this.ready, revision: this.revision, rendered: this.rendered,
    files: [...this.filesByName.keys()], nodes: this.graph?.nodes.length || 0, edges: this.graph?.edges.length || 0,
    languages: { python: this.graph?.nodes.filter(n => n.language === 'python').length || 0, c: this.graph?.nodes.filter(n => n.language === 'c').length || 0 },
    source: this.sourceUri.toString(), panelVisible: this.panel.visible, lastOpen: this.lastOpen || null, error: this.error || null }; }
  schedule(delay = 350) { if (this.disposed) return; clearTimeout(this.timer); this.timer = setTimeout(() => { void this.refresh().catch(error => this.fail(error)); }, delay); }
  fail(error) {
    this.error = error.message || String(error);
    this.panel.webview.postMessage({ type: 'error', message: this.error });
    vscode.window.showWarningMessage(`Code Atlas: ${this.error}`);
  }
  async readFiles() {
    const doc = await vscode.workspace.openTextDocument(this.sourceUri);
    if (!supported(doc)) throw new Error('Hãy mở file Python (.py) hoặc C (.c, .h).');
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    if (this.mode === 'workspace' && !folder) throw new Error('File chưa nằm trong thư mục VS Code. Dùng chế độ File.');
    const uris = this.mode === 'workspace'
      ? await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.{py,c,h}'), EXCLUDE, MAX_FILES + 1)
      : [doc.uri];
    if (uris.length > MAX_FILES) throw new Error(`Thư mục có hơn ${MAX_FILES} file Python/C. Hãy chọn File hoặc mở một thư mục nhỏ hơn.`);
    const ordered = uris.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
    if (!ordered.some(uri => uri.toString() === doc.uri.toString())) ordered.unshift(doc.uri);
    const files = [], lookup = new Map(); let total = 0;
    for (const uri of ordered) {
      const open = uri.toString() === doc.uri.toString() ? doc : await vscode.workspace.openTextDocument(uri);
      const content = open.getText();
      if (content.length > MAX_FILE_CHARS) throw new Error(`${path.basename(uri.path)} vượt giới hạn 500 KB của bản đồ.`);
      total += content.length;
      if (total > MAX_TOTAL_CHARS) throw new Error('Tổng code vượt 3 MB. Chọn File hoặc mở một thư mục nhỏ hơn.');
      const name = folder ? path.relative(folder.uri.fsPath, uri.fsPath).replaceAll(path.sep, '/') : path.basename(uri.path || 'untitled.py');
      files.push({ name, content }); lookup.set(name, uri);
    }
    return { files, lookup, title: this.mode === 'file' ? path.basename(doc.uri.path || 'untitled.py') : `Thư mục · ${folder.name}`,
      focusFile: [...lookup].find(([, uri]) => uri.toString() === doc.uri.toString())?.[0] };
  }
  async refresh() {
    if (this.disposed || !this.ready) return;
    const revision = ++this.revision;
    const { files, lookup, title, focusFile } = await this.readFiles();
    const graph = analyze(files);
    const groups = layoutGraph(graph);
    if (this.disposed || revision !== this.revision) return;
    this.filesByName = lookup;
    this.graph = graph;
    this.error = null;
    const layout = safeLayout(this.context.workspaceState.get(`codeAtlas.layout.${this.scopeKey}`));
    await this.panel.webview.postMessage({ type: 'model', revision, mode: this.mode, scope: this.scopeKey, title,
      files, graph, groups, layout, focusFile, focusLine: this.pendingFocusLine });
    this.pendingFocusLine = 0;
  }
  async openSource(file, requestedLine) {
    const uri = this.filesByName.get(file);
    if (!uri) throw new Error('File không còn trong bản đồ hiện tại. Hãy cập nhật bản đồ.');
    const doc = await vscode.workspace.openTextDocument(uri);
    const line = Math.max(0, Math.min(doc.lineCount - 1, (Number.isFinite(requestedLine) ? requestedLine : 1) - 1));
    const editor = await vscode.window.showTextDocument(doc, { viewColumn: this.sourceViewColumn,
      selection: new vscode.Range(line, 0, line, 0), preserveFocus: false, preview: false });
    editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    this.lastOpen = { file, line: line + 1, uri: uri.toString() };
  }
  async message(message) {
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'ready') { this.ready = true; await this.refresh(); }
    else if (message.type === 'rendered') { this.rendered = message.revision; }
    else if (message.type === 'scope' && ['file', 'workspace'].includes(message.scope)) {
      this.mode = message.scope; await this.refresh();
    }
    else if (message.type === 'openSource' && typeof message.file === 'string') await this.openSource(message.file, message.line);
    else if (message.type === 'saveLayout' && message.scope === this.scopeKey) {
      await this.context.workspaceState.update(`codeAtlas.layout.${this.scopeKey}`, safeLayout(message));
    }
    else if (message.type === 'parse' && Array.isArray(message.files)) {
      // The embedded UI currently receives ready-made graphs. Keep its shared parse API functional.
      try { const graph = analyze(message.files); await this.panel.webview.postMessage({ type: 'parseResult', id: message.id, graph, groups: layoutGraph(graph) }); }
      catch (error) { await this.panel.webview.postMessage({ type: 'parseResult', id: message.id, error: error.message }); }
    }
  }
  async rebase(editor) {
    if (!editor || !supported(editor.document)) return;
    if (this.sourceUri.toString() === editor.document.uri.toString()) return;
    this.sourceUri = editor.document.uri;
    this.sourceViewColumn = editor.viewColumn || vscode.ViewColumn.One;
    if (this.mode === 'file') this.schedule(50);
  }
}

const controllers = new Set();
let activeController;
function activate(context) {
  const command = vscode.commands.registerCommand('codeAtlas.openMap', async uri => {
    try {
      const editor = vscode.window.activeTextEditor;
      const doc = uri instanceof vscode.Uri ? await vscode.workspace.openTextDocument(uri) : editor?.document;
      if (!supported(doc)) { vscode.window.showInformationMessage('Code Atlas: mở file .py, .c hoặc .h trước khi dùng Ctrl+Shift+V.'); return; }
      if (activeController && !activeController.disposed) {
        // Invoking the shortcut on a different editor should preview that file,
        // even when the previous map was in workspace scope.
        if (activeController.lastInvokedSourceUri.toString() !== doc.uri.toString()) activeController.mode = 'file';
        activeController.lastInvokedSourceUri = doc.uri;
        activeController.sourceUri = doc.uri;
        activeController.sourceViewColumn = editor?.viewColumn || vscode.ViewColumn.One;
        activeController.pendingFocusLine = editor?.document.uri.toString() === doc.uri.toString() ? editor.selection.active.line + 1 : 0;
        activeController.panel.reveal(vscode.ViewColumn.Beside);
        await activeController.refresh();
      } else {
        activeController = new MapController(context, doc, editor?.viewColumn);
        controllers.add(activeController);
      }
    } catch (error) { vscode.window.showErrorMessage(`Code Atlas: ${error.message}`); }
  });
  const changed = vscode.workspace.onDidChangeTextDocument(event => {
    if (!vscode.workspace.getConfiguration('codeAtlas').get('autoRefresh', true)) return;
    for (const map of controllers) if (map.mode === 'workspace' ? map.filesByName.size && [...map.filesByName.values()].some(uri => uri.toString() === event.document.uri.toString()) : map.sourceUri.toString() === event.document.uri.toString()) map.schedule();
  });
  const saved = vscode.workspace.onDidSaveTextDocument(doc => {
    for (const map of controllers) if ([...map.filesByName.values()].some(uri => uri.toString() === doc.uri.toString())) map.schedule(50);
  });
  const switched = vscode.window.onDidChangeActiveTextEditor(editor => { if (activeController && !activeController.disposed) void activeController.rebase(editor); });
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{py,c,h}');
  const fileEvent = () => { for (const map of controllers) if (map.mode === 'workspace') map.schedule(450); };
  context.subscriptions.push(command, changed, saved, switched, watcher,
    watcher.onDidCreate(fileEvent), watcher.onDidDelete(fileEvent), watcher.onDidChange(fileEvent));
  return { getState: () => activeController?.debug || null };
}
function deactivate() { for (const map of controllers) map.panel.dispose(); }
module.exports = { activate, deactivate };
