import { samples } from './samples.js';
import { layoutFiles, NODE_WIDTH, NODE_HEIGHT } from './layout.js';
import { parse, acceptHostParse } from './parse.js';
import { inVSCode, postHost } from './vscode-bridge.js';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHTML = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const roleNames = { entry: 'Control loop', policy: 'Policy / inference', sensing: 'Observation / sensor', control: 'Motor / control', transport: 'Communication', interrupt: 'Callback / IRQ', logic: 'Logic' };
const STORAGE_KEY = 'code-atlas-python-c-v1';
let state = { files: [], title: '', graph: { nodes: [], edges: [], files: [], stats: {} }, groups: [], classFrames: [], notes: [], strokes: [], camera: { x: 0, y: 0, z: 1 } };
let selected = null, view = 'all', tool = 'select', query = '', drag = null, saveTimer, toastTimer, draft = [], draftIndex = 0;
const history = [];
const viewport = $('#viewport');

function highlight(code) {
  const pattern = /("""[\s\S]*?"""|'''[\s\S]*?'''|\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:async|await|def|class|from|import|as|return|if|elif|else|for|while|in|not|and|or|with|try|except|raise|pass|True|False|None|break|continue|void|int|float|double|char|static|const|volatile|unsigned|struct|typedef|uint\d+_t|switch|case|sizeof|extern)\b|\b\d+(?:\.\d+)?f?\b)/g;
  let html = '', previous = 0;
  for (const m of code.matchAll(pattern)) {
    html += escapeHTML(code.slice(previous, m.index)); const text = m[0];
    const type = /^(#|\/\/|\/\*)/.test(text) ? 'comment' : /^["']/.test(text) ? 'string' : /^\d/.test(text) ? 'number' : 'keyword';
    html += `<span class="token-${type}">${escapeHTML(text)}</span>`; previous = m.index + text.length;
  }
  return html + escapeHTML(code.slice(previous));
}
function toast(text) { $('#toast').textContent = text; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 4000); }
function snapshot() { return { version: 1, title: state.title, files: state.files, positions: Object.fromEntries(state.graph.nodes.map(n => [n.id, { x: n.x, y: n.y }])), notes: structuredClone(state.notes), strokes: structuredClone(state.strokes), camera: { ...state.camera } }; }
function checkpoint() { history.push(snapshot()); if (history.length > 15) history.shift(); $('#undo-button').disabled = false; }
function persist() {
  if (inVSCode) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => postHost({ type: 'saveLayout', scope: state.hostScope,
      positions: Object.fromEntries(state.graph.nodes.map(n => [`${n.file}::${n.qualified}`, { x: n.x, y: n.y }])),
      notes: state.notes, strokes: state.strokes, camera: state.camera }), 350);
    return;
  }
  $('#save-status').textContent = '◌ Đang lưu…'; clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot())); $('#save-status').textContent = '● Đã lưu trên máy'; } catch { $('#save-status').textContent = 'Chưa lưu · hãy xuất bản đồ'; } }, 250);
}
function validWorkspace(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.files) || !data.files.length || typeof data.title !== 'string') throw new Error('File này không phải bản đồ Code Atlas hợp lệ.');
  const bounded = n => Number.isFinite(n) && Math.abs(n) < 1000000;
  if (data.positions && Object.values(data.positions).some(p => !p || !bounded(p.x) || !bounded(p.y))) throw new Error('Bố cục bản đồ không hợp lệ.');
  if ((data.notes?.length || 0) > 200 || (data.strokes?.length || 0) > 1000) throw new Error('Bản đồ có quá nhiều ghi chú.');
  for (const n of data.notes || []) if (!n || typeof n.id !== 'string' || typeof n.text !== 'string' || n.text.length > 10000 || !bounded(n.x) || !bounded(n.y)) throw new Error('Ghi chú không hợp lệ.');
  let points = 0;
  for (const stroke of data.strokes || []) { if (!Array.isArray(stroke) || !stroke.length || stroke.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(bounded))) throw new Error('Nét vẽ không hợp lệ.'); points += stroke.length; }
  if (points > 150000) throw new Error('Bản đồ có quá nhiều nét vẽ.');
  return data;
}
async function loadFiles(files, title, saved = null, remember = true) {
  $('#loading').hidden = false;
  try {
    const result = await parse(files);
    if (remember && state.files.length) checkpoint();
    state = { files: structuredClone(files), title, graph: result.graph, groups: result.groups, notes: saved?.notes || [], strokes: saved?.strokes || [], camera: { x: 0, y: 0, z: 1 } };
    if (saved?.positions) for (const n of state.graph.nodes) if (saved.positions[n.id]) { n.x = saved.positions[n.id].x; n.y = saved.positions[n.id].y; }
    selected = null; view = 'all'; query = ''; $('#search').value = ''; $('#inspector').hidden = true;
    updateGroupBounds(); render();
    if (saved?.camera && [saved.camera.x, saved.camera.y, saved.camera.z].every(Number.isFinite) && saved.camera.z >= .1 && saved.camera.z <= 2.5) { state.camera = saved.camera; applyCamera(); }
    else fit();
    persist(); return true;
  } finally { $('#loading').hidden = true; }
}
function loadHostModel(message) {
  if (!inVSCode || !message?.graph || !Array.isArray(message.files)) return;
  const previous = state.hostScope === message.scope ? snapshot() : null;
  const saved = previous || message.layout || {};
  const savedByName = previous
    ? Object.fromEntries(state.graph.nodes.map(n => [`${n.file}::${n.qualified}`, { x: n.x, y: n.y }]))
    : (message.layout?.positions || {});
  state = { files: message.files, title: message.title, graph: message.graph, groups: message.groups || [], classFrames: [],
    notes: saved.notes || [], strokes: saved.strokes || [], camera: { x: 0, y: 0, z: 1 }, hostScope: message.scope };
  // A VS Code side panel is usually portrait-shaped. Lay out a new map for
  // that space so small C/Python files remain legible beside the editor.
  if (!Object.keys(savedByName).length && viewport.clientWidth < 750) {
    const aspect = Math.max(.55, Math.min(1.7, viewport.clientWidth / Math.max(1, viewport.clientHeight)));
    layoutFiles(state.graph.files, file => state.graph.nodes.filter(n => n.file === file.name), 40, 32, aspect);
  }
  for (const n of state.graph.nodes) {
    const p = savedByName[`${n.file}::${n.qualified}`];
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) { n.x = p.x; n.y = p.y; }
  }
  selected = null; view = 'all'; query = ''; $('#search').value = ''; $('#inspector').hidden = true;
  updateGroupBounds(); render();
  if (saved.camera && [saved.camera.x, saved.camera.y, saved.camera.z].every(Number.isFinite) && saved.camera.z >= .1 && saved.camera.z <= 2.5) {
    state.camera = saved.camera; applyCamera();
  } else fit();
  $('#save-status').textContent = '● VS Code workspace';
  if (message.focusLine) {
    const match = state.graph.nodes.find(n => n.file === message.focusFile && n.start <= message.focusLine && n.end >= message.focusLine);
    if (match) selectNode(match.id, true, message.focusLine);
  }
  postHost({ type: 'rendered', revision: message.revision, nodes: state.graph.nodes.length, edges: state.graph.edges.length });
}
async function undo() { if (!history.length) return; const saved = history.pop(); await loadFiles(saved.files, saved.title, saved, false); $('#undo-button').disabled = !history.length; toast('Đã hoàn tác thay đổi gần nhất'); }

function boxOf(list, padX, padTop, padBottom) {
  const x = Math.min(...list.map(n => n.x)) - padX, y = Math.min(...list.map(n => n.y)) - padTop;
  return { x, y, width: Math.max(...list.map(n => n.x + NODE_WIDTH)) - x + padX, height: Math.max(...list.map(n => n.y + NODE_HEIGHT)) - y + padBottom };
}
function updateGroupBounds() {
  state.groups = state.graph.files.flatMap(file => {
    const list = state.graph.nodes.filter(n => n.file === file.name); if (!list.length) return [];
    return [{ id: file.name, label: file.name, language: file.language, ...boxOf(list, 20, 60, 25) }];
  });
  state.classFrames = state.graph.files.flatMap(file => (file.classes || []).flatMap(cls => {
    const list = state.graph.nodes.filter(n => n.file === file.name && n.className === cls.name); if (!list.length) return [];
    const label = cls.bases.length ? `class ${cls.name}(${cls.bases.join(', ')})` : `class ${cls.name}`;
    return [{ id: `${file.name}::${cls.name}`, file: file.name, className: cls.name, label, language: file.language, count: list.length, ...boxOf(list, 11, 28, 14) }];
  }));
}
function relatedIds() {
  if (!selected) return new Set();
  return new Set([selected, ...state.graph.edges.filter(e => e.source === selected || e.target === selected).flatMap(e => [e.source, e.target])]);
}
function visibleIds() {
  const related = relatedIds();
  return new Set(state.graph.nodes.filter(n => {
    const matches = !query || `${n.qualified} ${n.file} ${n.code}`.toLowerCase().includes(query);
    return matches && (view === 'all' || (view === 'focus' ? !selected || related.has(n.id) : n.callback || n.role === 'entry'));
  }).map(n => n.id));
}
function render() {
  $('#project-title').textContent = state.title; $('#file-count').textContent = `${state.files.length} FILES`;
  $('#map-stats').textContent = `${state.graph.nodes.length} hàm · ${state.graph.edges.length} kết nối`;
  $('#empty-state').hidden = !!state.graph.nodes.length;
  $('#undo-button').disabled = !history.length;
  const errors = state.graph.files.reduce((sum, f) => sum + f.errors.length, 0);
  $('#status-detail').textContent = errors ? `${errors} vị trí cần kiểm tra cú pháp · xem ⓘ` : 'Python · C · không chạy code đầu vào';
  $$('[data-sample]').forEach(b => b.classList.toggle('active', state.title === samples[b.dataset.sample].title));
  renderTree(); renderGroups(); renderClassFrames(); renderNodes(); renderEdges(); renderNotes(); renderInk(); applyCamera(); updateHighlights();
}
function renderTree() {
  $('#file-tree').innerHTML = state.graph.files.map(file => {
    const list = state.graph.nodes.filter(n => n.file === file.name && (!query || `${n.qualified} ${n.file} ${n.code}`.toLowerCase().includes(query)));
    if (query && !list.length && !file.name.toLowerCase().includes(query)) return '';
    return `<div class="tree-file"><button class="tree-file-header" data-file="${escapeHTML(file.name)}" title="Mở ${escapeHTML(file.name)}"><span class="lang-icon ${file.language === 'c' ? 'c' : ''}">${file.language === 'c' ? 'C' : 'py'}</span><span class="filename">${escapeHTML(file.name.split('/').at(-1))}</span><span class="file-num">${list.length}</span></button>${list.map(n => `<button class="tree-function ${selected === n.id ? 'active' : ''}" data-node="${escapeHTML(n.id)}" title="${escapeHTML(n.qualified)}"><span class="fn-icon">${n.callback ? 'ϟ' : 'ƒ'}</span><span>${escapeHTML(n.name)}</span></button>`).join('')}</div>`;
  }).join('') || '<div class="list-empty">Không tìm thấy. Thử tên hàm hoặc module khác.</div>';
}
function renderClassFrames() { $('#class-layer').innerHTML = state.classFrames.map(f => `<div class="class-group ${f.language === 'c' ? 'c' : ''}" style="left:${f.x}px;top:${f.y}px;width:${f.width}px;height:${f.height}px"><div class="class-heading" data-class-group="${escapeHTML(f.id)}" title="Kéo để di chuyển cả class ${escapeHTML(f.className)}"><span>${escapeHTML(f.label)}</span><span class="class-count">${f.count}</span></div></div>`).join(''); }
function renderGroups() { $('#group-layer').innerHTML = state.groups.map(g => `<div class="file-group ${g.language === 'c' ? 'c' : ''}" style="left:${g.x}px;top:${g.y}px;width:${g.width}px;height:${g.height}px"><div class="group-heading" data-group="${escapeHTML(g.id)}"><span class="lang-icon ${g.language === 'c' ? 'c' : ''}">${g.language === 'c' ? 'C' : 'py'}</span><span>${escapeHTML(g.label)}</span></div></div>`).join(''); }
function renderNodes() {
  $('#node-layer').innerHTML = state.graph.nodes.map(n => {
    const preview = n.code.split('\n').slice(0, 5).join('\n');
    return `<article class="code-node role-${n.role}" data-node="${escapeHTML(n.id)}" tabindex="0" role="button" aria-label="Xem hàm ${escapeHTML(n.qualified)}" style="left:${n.x}px;top:${n.y}px"><span class="port in"></span><div class="node-header"><span class="fn-icon">${n.callback ? 'ϟ' : 'ƒ'}</span><span class="node-title">${escapeHTML(n.name)}<span style="color:#627687">()</span></span><span class="node-type">${n.callback ? 'IRQ' : n.kind === 'method' ? 'method' : 'function'}</span></div><div class="node-body"><div class="node-context">${escapeHTML(n.className || n.file.split('/').at(-1))}</div><pre class="node-code">${highlight(preview)}</pre></div><div class="node-footer"><span class="role-tag" title="Gợi ý vai trò theo tên hàm; không phải kết luận ngữ nghĩa"><i></i>${roleNames[n.role]}</span><span>L${n.start}–${n.end} <span style="padding-left:8px">↗ ${n.calls.length}</span></span></div><span class="port out"></span></article>`;
  }).join('');
}
function edgePath(a, b) {
  const sx = a.x + 310, sy = a.y + 98;
  if (b.x <= a.x + 80) { const reach = Math.max(sx, b.x + 310) + 40 + Math.min(70, Math.abs(sy - b.y) / 8); return `M${sx},${sy} C${reach},${sy} ${reach},${b.y + 98} ${b.x + 314},${b.y + 98}`; }
  const tx = b.x - 4, ty = b.y + 98, middle = (sx + tx) / 2;
  if (b.x - a.x > 500) {
    const corridor = a.y - 13, left = sx + 24, right = tx - 24;
    return `M${sx},${sy} C${left},${sy} ${left},${sy} ${left},${sy - 24} L${left},${corridor + 12} Q${left},${corridor} ${left + 12},${corridor} L${right - 12},${corridor} Q${right},${corridor} ${right},${corridor + 12} L${right},${ty - 24} C${right},${ty} ${right},${ty} ${tx},${ty}`;
  }
  return `M${sx},${sy} C${middle},${sy} ${middle},${ty} ${tx},${ty}`;
}
function renderEdges() {
  const nodes = new Map(state.graph.nodes.map(n => [n.id, n])); const related = relatedIds(), visible = visibleIds();
  $('#edge-layer').innerHTML = state.graph.edges.map(e => {
    const active = e.source === selected || e.target === selected;
    const dim = !visible.has(e.source) || !visible.has(e.target) || (selected && !active);
    return `<path d="${edgePath(nodes.get(e.source), nodes.get(e.target))}" class="edge${e.inferred ? ' inferred' : ''}${active ? ' active' : ''}${dim ? ' dim' : ''}" marker-end="url(#${active ? 'arrow-active' : 'arrow'})"/>`;
  }).join('');
}
function updateHighlights() {
  const related = relatedIds(), visible = visibleIds();
  $$('.code-node').forEach(el => { el.classList.toggle('selected', el.dataset.node === selected); el.classList.toggle('dim', !visible.has(el.dataset.node) || (selected && !related.has(el.dataset.node))); });
  $$('.tree-function').forEach(el => el.classList.toggle('active', el.dataset.node === selected));
  $$('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  $('#selection-hint').hidden = !!selected;
  renderEdges();
}
function selectNode(id, center = false, line = null) {
  const node = state.graph.nodes.find(n => n.id === id); if (!node) return;
  selected = id; $('#inspector').hidden = false; renderInspector(node, line); updateHighlights();
  if (center) { const r = viewport.getBoundingClientRect(); state.camera.z = Math.max(.8, state.camera.z); state.camera.x = r.width / 2 - (node.x + 155) * state.camera.z; state.camera.y = r.height / 2 - (node.y + 98) * state.camera.z; applyCamera(); persist(); }
  if (window.innerWidth < 801) $('#sidebar').classList.remove('open');
}
function closeInspector() { selected = null; $('#inspector').hidden = true; updateHighlights(); }
function callButton(n, caption, line) { return `<button class="call-item" data-jump="${escapeHTML(n.id)}"${line ? ` data-line="${line}"` : ''}><span>↗</span><span><strong>${escapeHTML(n.qualified)}</strong><small>${escapeHTML(n.file.split('/').at(-1))}</small></span><span>${escapeHTML(caption)}</span></button>`; }
function renderInspector(n, highlightLine) {
  const incoming = state.graph.edges.filter(e => e.target === n.id), outgoing = state.graph.edges.filter(e => e.source === n.id);
  const unresolved = [...new Map(n.calls.filter(c => !c.target && c.kind === 'unknown').map(c => [c.name, c])).values()];
  const outside = new Map();
  for (const c of n.calls.filter(c => !c.target && c.kind !== 'unknown')) {
    const key = c.kind === 'builtin' ? 'Python builtin' : c.kind === 'chain' ? 'chuỗi gọi trung gian' : c.module || 'chưa rõ module';
    outside.set(key, (outside.get(key) || new Set()).add(c.name));
  }
  const outsideGroups = [...outside].sort((a, b) => b[1].size - a[1].size);
  const outsideCount = outsideGroups.reduce((sum, [, set]) => sum + set.size, 0);
  $('#inspector').innerHTML = `<div class="inspector-header"><span class="eyebrow">FUNCTION INSPECTOR</span><button class="icon-button" id="close-inspector" aria-label="Đóng chi tiết">×</button><h2>${escapeHTML(n.qualified)}<span style="color:#6c8d7c">()</span></h2><div class="inspector-path">${escapeHTML(n.file)} : ${n.start}–${n.end}</div><div style="margin-top:12px"><span class="badge">${n.language === 'c' ? 'C' : 'PYTHON'}</span>${n.callback ? '<span class="badge">CALLBACK / IRQ</span>' : ''}${n.className ? `<span class="badge">${escapeHTML(n.className)}</span>` : ''}${n.classBases?.length ? `<span class="badge">KẾ THỪA: ${escapeHTML(n.classBases.join(', '))}</span>` : ''}${(n.decorators || []).map(d => `<span class="badge">@${escapeHTML(d)}</span>`).join('')}</div></div><section class="inspector-section"><h3>ĐỌC NHANH</h3>${n.doc ? `<p>${escapeHTML(n.doc)}</p>` : `<p>${escapeHTML(n.signature)}</p>`}<div class="metric-row"><span><strong>${n.end - n.start + 1}</strong><small>DÒNG CODE</small></span><span><strong>${n.branches}</strong><small>RẼ NHÁNH</small></span><span><strong>${n.loops}</strong><small>VÒNG LẶP</small></span></div>${n.callback ? '<p class="notice">Nhận diện theo tên hàm. Callback có thể được HAL/phần cứng kích hoạt; bản đồ không tự tạo một lời gọi từ main.</p>' : ''}</section><section class="inspector-section"><h3>ĐƯỢC GỌI BỞI <span>(${incoming.length})</span></h3>${incoming.map(e => callButton(state.graph.nodes.find(x => x.id === e.source), `L${e.lines[0]}`, e.lines[0])).join('') || '<p>Không thấy lời gọi trong các file đã mở.</p>'}</section><section class="inspector-section"><h3>GỌI TỚI <span>(${outgoing.length})</span></h3>${outgoing.map(e => callButton(state.graph.nodes.find(x => x.id === e.target), e.inferred ? 'suy ra kiểu' : e.inherited ? `kế thừa · L${e.lines[0]}` : `tại L${e.lines[0]}`)).join('') || '<p>Chưa có lời gọi được phân giải.</p>'}</section><section class="inspector-section"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="margin:0">CODE GỐC</h3><button class="button small subtle" data-read-file="${escapeHTML(n.file)}">Mở file ↗</button></div><pre class="inspector-code">${n.code.split('\n').map((line, i) => `<span class="code-line ${n.start + i === highlightLine ? 'highlight' : ''}"><span class="line-no">${n.start + i}</span><span>${highlight(line)}</span></span>`).join('')}</pre></section>${outsideCount ? `<section class="inspector-section"><h3>KHÔNG VẼ KẾT NỐI (${outsideCount})</h3><p>Module chưa mở, hàm có sẵn của Python, hoặc gọi trên kết quả trung gian. Mở thêm module tương ứng nếu muốn nối.</p><div class="chip-row">${outsideGroups.map(([name, set]) => `<span class="badge" title="${escapeHTML([...set].sort().join(', '))}">${escapeHTML(name)} · ${set.size}</span>`).join('')}</div></section>` : ''}${unresolved.length ? `<section class="inspector-section"><h3>CHƯA XÁC ĐỊNH (${unresolved.length})</h3><p>Có thể là đối tượng chưa suy ra được kiểu, dispatch động, hoặc định nghĩa nằm ngoài các file đã mở.</p><ul class="unresolved-list">${unresolved.map(c => `<li>${escapeHTML(c.name)}() <span style="color:#6d8394">L${c.line}</span><small>${escapeHTML(c.reason)}</small></li>`).join('')}</ul></section>` : ''}`;
  if (inVSCode) $('#inspector .inspector-header').insertAdjacentHTML('beforeend', '<button class="button primary inspector-jump" id="go-to-code">↩ Về code ở dòng này</button>');
  if (highlightLine) $('#inspector .code-line.highlight')?.scrollIntoView({ block: 'nearest' });
}
function renderNotes() { $('#note-layer').innerHTML = state.notes.map(n => `<div class="note-card" data-note="${escapeHTML(n.id)}" style="left:${n.x}px;top:${n.y}px"><div class="note-header">GHI CHÚ CỦA BẠN<button data-remove-note="${escapeHTML(n.id)}" aria-label="Xóa ghi chú">×</button></div><textarea aria-label="Nội dung ghi chú" placeholder="Viết điều bạn hiểu về đoạn code…" maxlength="10000">${escapeHTML(n.text)}</textarea></div>`).join(''); }
function renderInk() { $('#ink-layer').innerHTML = state.strokes.filter(s => s.length).map(stroke => `<path d="M${stroke.map(p => p.join(',')).join(' L')}" fill="none" stroke="#e1bd76" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`).join(''); }
function applyCamera() { const { x, y, z } = state.camera; $('#world').style.transform = `translate(${x}px,${y}px) scale(${z})`; $('#zoom-label').textContent = `${Math.round(z * 100)}%`; viewport.style.backgroundSize = `${22 * z}px ${22 * z}px`; viewport.style.backgroundPosition = `${x}px ${y}px`; }
function fit() {
  const items = [...state.groups, ...state.notes.map(n => ({ ...n, width: 225, height: 150 }))]; if (!items.length) return;
  const minX = Math.min(...items.map(n => n.x)) - 35, minY = Math.min(...items.map(n => n.y));
  const maxX = Math.max(...items.map(n => n.x + n.width)) + 70, maxY = Math.max(...items.map(n => n.y + n.height));
  const rect = viewport.getBoundingClientRect(), height = Math.max(100, rect.height - 180), width = Math.max(100, rect.width - 65);
  const z = Math.min(1.08, Math.max(.1, Math.min(width / (maxX - minX), height / (maxY - minY))));
  state.camera = { z, x: (rect.width - (maxX - minX) * z) / 2 - minX * z, y: 82 + (height - (maxY - minY) * z) / 2 - minY * z }; applyCamera(); persist();
}
function zoom(factor, clientX, clientY) { const r = viewport.getBoundingClientRect(), px = (clientX ?? (r.left + r.width / 2)) - r.left, py = (clientY ?? (r.top + r.height / 2)) - r.top; const c = state.camera, z = Math.min(2.5, Math.max(.1, c.z * factor)); state.camera = { x: px - (px - c.x) * z / c.z, y: py - (py - c.y) * z / c.z, z }; applyCamera(); persist(); }
function worldPoint(e) { const r = viewport.getBoundingClientRect(); return [(e.clientX - r.left - state.camera.x) / state.camera.z, (e.clientY - r.top - state.camera.y) / state.camera.z]; }
function setTool(next) { tool = next; viewport.classList.toggle('ink-mode', tool === 'ink'); $$('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool)); }

viewport.addEventListener('wheel', e => { if (e.target.closest('textarea')) return; e.preventDefault(); zoom(Math.exp(-e.deltaY * .0015), e.clientX, e.clientY); }, { passive: false });
viewport.addEventListener('pointerdown', e => {
  if (e.button !== 0 && e.button !== 1) return;
  if (e.target.closest('button,input,textarea,.canvas-top,.canvas-tools,.zoom-controls')) return;
  viewport.focus({ preventScroll: true }); const point = worldPoint(e);
  if (tool === 'note') { checkpoint(); const id = crypto.randomUUID(); state.notes.push({ id, x: point[0], y: point[1], text: '' }); renderNotes(); setTool('select'); $(`[data-note="${id}"] textarea`).focus(); persist(); return; }
  if (tool === 'ink') { checkpoint(); state.strokes.push([point]); drag = { type: 'ink', pointer: e.pointerId }; }
  else {
    const nodeEl = e.target.closest('.code-node'), groupEl = e.target.closest('[data-group]'), noteEl = e.target.closest('.note-card');
    const classEl = e.target.closest('[data-class-group]');
    if (nodeEl) { const node = state.graph.nodes.find(n => n.id === nodeEl.dataset.node); drag = { type: 'node', nodes: [node], orig: [{ x: node.x, y: node.y }], id: node.id }; }
    else if (classEl) { const [file, className] = classEl.dataset.classGroup.split('::'); const nodes = state.graph.nodes.filter(n => n.file === file && n.className === className); drag = { type: 'group', nodes, orig: nodes.map(n => ({ x: n.x, y: n.y })) }; }
    else if (groupEl) { const nodes = state.graph.nodes.filter(n => n.file === groupEl.dataset.group); drag = { type: 'group', nodes, orig: nodes.map(n => ({ x: n.x, y: n.y })) }; }
    else if (noteEl) { const note = state.notes.find(n => n.id === noteEl.dataset.note); drag = { type: 'note', note, orig: { x: note.x, y: note.y } }; }
    else drag = { type: 'pan', orig: { ...state.camera } };
    Object.assign(drag, { pointer: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false });
  }
  viewport.setPointerCapture(e.pointerId); viewport.classList.add('dragging'); e.preventDefault();
});
viewport.addEventListener('pointermove', e => {
  if (!drag || drag.pointer !== e.pointerId) return;
  if (drag.type === 'ink') { const p = worldPoint(e), stroke = state.strokes.at(-1), last = stroke.at(-1); if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 2 / state.camera.z && stroke.length < 10000) { stroke.push(p); renderInk(); } return; }
  const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
  if (!drag.moved && Math.hypot(dx, dy) > 4) { if (drag.type !== 'pan') checkpoint(); drag.moved = true; }
  if (!drag.moved) return;
  if (drag.type === 'pan') { state.camera.x = drag.orig.x + dx; state.camera.y = drag.orig.y + dy; applyCamera(); }
  else if (drag.type === 'note') { drag.note.x = drag.orig.x + dx / state.camera.z; drag.note.y = drag.orig.y + dy / state.camera.z; const el = $(`[data-note="${CSS.escape(drag.note.id)}"]`); el.style.left = `${drag.note.x}px`; el.style.top = `${drag.note.y}px`; }
  else { drag.nodes.forEach((n, i) => { n.x = drag.orig[i].x + dx / state.camera.z; n.y = drag.orig[i].y + dy / state.camera.z; const el = $(`.code-node[data-node="${CSS.escape(n.id)}"]`); el.style.left = `${n.x}px`; el.style.top = `${n.y}px`; }); updateGroupBounds(); renderGroups(); renderClassFrames(); renderEdges(); }
});
function endDrag(e) { if (!drag || drag.pointer !== e.pointerId) return; if (!drag.moved && drag.type === 'node') selectNode(drag.id); else if (!drag.moved && drag.type === 'pan') closeInspector(); if (viewport.hasPointerCapture(e.pointerId)) viewport.releasePointerCapture(e.pointerId); drag = null; viewport.classList.remove('dragging'); persist(); }
viewport.addEventListener('pointerup', endDrag); viewport.addEventListener('pointercancel', endDrag);
viewport.addEventListener('dblclick', e => { if (!inVSCode) return; const id = e.target.closest('.code-node')?.dataset.node; const n = state.graph.nodes.find(x => x.id === id); if (n) postHost({ type: 'openSource', file: n.file, line: n.start }); });

function commitDraft() { if (draft[draftIndex]) { draft[draftIndex].name = $('#filename').value.trim(); draft[draftIndex].content = $('#source-text').value; } }
function renderDraft() {
  $('#source-tabs').innerHTML = draft.map((f, i) => `<div class="source-tab ${i === draftIndex ? 'active' : ''}"><button class="tab-select" data-draft="${i}" title="${escapeHTML(f.name)}">${escapeHTML(f.name.split('/').at(-1) || 'untitled.py')}</button><button class="tab-remove" data-remove-draft="${i}" aria-label="Bỏ file ${escapeHTML(f.name)}">×</button></div>`).join('');
  $('#filename').value = draft[draftIndex]?.name || ''; $('#source-text').value = draft[draftIndex]?.content || '';
}
function openSource(file = null) {
  if (inVSCode) { const node = state.graph.nodes.find(n => n.id === selected); postHost({ type: 'openSource', file: file || node?.file || state.files[0]?.name, line: node?.start || 1 }); return; }
  draft = structuredClone(state.files.length ? state.files : [{ name: 'main.py', content: '' }]); draftIndex = Math.max(0, draft.findIndex(f => f.name === file)); $('#source-error').hidden = true; renderDraft(); $('#source-dialog').showModal();
}
async function importFiles(fileList) {
  const files = [...fileList]; if (!files.length) return;
  try {
    if (files.length === 1 && /\.json$/i.test(files[0].name)) {
      if (files[0].size > 10000000) throw new Error('Bản đồ vượt quá 10 MB.');
      const saved = validWorkspace(JSON.parse(await files[0].text())); await loadFiles(saved.files, saved.title, saved); $('#source-dialog').close(); toast('Đã khôi phục bản đồ'); return;
    }
    const supported = files.filter(f => /\.(py|c|h)$/i.test(f.name) && !/(^|\/)(node_modules|\.git|\.venv|venv|__pycache__|build|dist)\//.test(f.webkitRelativePath));
    if (!supported.length) throw new Error('Không thấy file .py, .c hoặc .h trong lựa chọn.');
    if (supported.length > 120 || supported.some(f => f.size > 500000) || supported.reduce((s, f) => s + f.size, 0) > 3000000) throw new Error('Hãy chọn nhóm module nhỏ hơn: tối đa 120 file, 500 KB/file, 3 MB tổng.');
    // Picking several files gives only basenames, so a package with many __init__.py would collide.
    const taken = new Set(), clashes = [];
    const imported = await Promise.all(supported.map(async f => {
      const original = f.webkitRelativePath || f.name;
      let name = original;
      for (let i = 2; taken.has(name); i++) name = original.replace(/(\.[^.]+)$/, `~${i}$1`);
      if (name !== original) clashes.push(name);
      taken.add(name);
      return { name, content: await f.text() };
    }));
    if (!$('#source-dialog').open) openSource();
    commitDraft(); draft = imported; draftIndex = 0; renderDraft();
    if (clashes.length) {
      $('#source-error').textContent = `${clashes.length} file trùng tên đã được đổi tên (${clashes.slice(0, 3).join(', ')}${clashes.length > 3 ? '…' : ''}). Trình duyệt không gửi đường dẫn khi chọn nhiều file, nên import tương đối giữa các file này có thể không nối được. Dùng “Mở thư mục” để giữ nguyên cấu trúc package.`;
      $('#source-error').hidden = false;
    } else $('#source-error').hidden = true;
    toast(`Đã mở ${imported.length} file. Bấm Phân tích để tạo bản đồ.`);
  } catch (error) { if ($('#source-dialog').open) { $('#source-error').textContent = error.message; $('#source-error').hidden = false; } else toast(error.message); }
  $('#file-input').value = ''; $('#folder-input').value = '';
}
function info(title, body) { $('#info-title').textContent = title; $('#info-content').innerHTML = body; $('#info-dialog').showModal(); }
function help() { info('Đọc code như một bản đồ', '<p>Chọn một hàm để xem code gốc và quan hệ gọi. Chọn <b>Liên quan</b> để tập trung vào các kết nối trực tiếp.</p><h3>Dùng với robotics</h3><ul><li><b>Python:</b> bắt đầu từ control loop hoặc <code>step()</code>, lần sang observation, policy, rồi action.</li><li><b>STM32:</b> bắt đầu từ <code>main()</code>, callback timer hoặc UART. Callback không có mũi tên từ main vẫn có thể là điểm vào quan trọng.</li><li><b>Đường liền:</b> tìm được định nghĩa. <b>Nét đứt:</b> suy ra đối tượng từ annotation hoặc constructor. Đây là quan hệ gọi, không phải thứ tự chạy.</li></ul><h3>Công cụ</h3><p>Kéo khối hoặc tên file để sắp xếp. Dùng bút để khoanh vùng, ghi chú để lưu điều bạn hiểu. ' + (inVSCode ? 'Dùng nút <b>Về code</b> để nhảy tới dòng trong editor. Chuyển giữa file hiện tại và thư mục bằng hai nút trên thanh trên.' : 'Xuất JSON để lưu và mở lại bằng “Chọn file”.') + '</p><h3>Phím tắt</h3>' + [['Mở bản đồ từ editor', 'Ctrl / ⌘ Shift V'], ['Tìm hàm', '/'], ['Vừa màn hình', 'F'], ['Chọn / vẽ / ghi chú', 'V / D / N'], ['Hoàn tác', 'Ctrl / ⌘ Z'], ['Bỏ chọn', 'Esc']].map(([label, key]) => `<div class="shortcut-row"><span>${label}</span><kbd>${key}</kbd></div>`).join('')); }
function diagnostics() {
  const errors = state.graph.files.filter(f => f.errors.length);
  info('Kết quả phân tích', `<p><b>${state.graph.nodes.length}</b> hàm · <b>${state.graph.edges.length}</b> kết nối · <b>${state.graph.stats.unresolved}</b> lời gọi chưa xác định · <b>${state.graph.stats.external}</b> lời gọi không vẽ kết nối (module chưa mở, builtin, chuỗi gọi trung gian).</p>${errors.length ? '<h3>Vị trí cần kiểm tra cú pháp</h3>' + errors.map(f => `<p><code>${escapeHTML(f.name)}</code>: dòng ${f.errors.join(', ')}. Cấu trúc được khôi phục một phần có thể thiếu chính xác.</p>`).join('') : '<p>Không phát hiện lỗi cú pháp trong các file đã mở.</p>'}<h3>Phạm vi bản đầu</h3><p>Phân tích cú pháp Python và C, lời gọi trực tiếp, import Python và một số đối tượng có annotation/constructor. Các hàm được nhóm theo file; method có nhãn class.</p><p>Kế thừa Python được dò theo thứ tự base trái→phải, chưa chạy MRO C3 đầy đủ. Chưa mô phỏng runtime, chưa mở rộng macro/preprocessor, chưa suy ra đầy đủ con trỏ hàm hoặc dynamic dispatch. Hai nhánh <code>#if</code> có thể cùng xuất hiện. Không tự nối Python ↔ C qua UART/CAN hoặc FFI.</p><p>Vai trò màu sắc (policy, sensor, motor…) là gợi ý theo tên hàm. Dùng code gốc để kiểm chứng. Ví dụ chỉ phục vụ đọc cấu trúc, không dùng trực tiếp để điều khiển phần cứng.</p>`);
}

document.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  try {
    if (b.dataset.node) selectNode(b.dataset.node, true);
    else if (b.dataset.jump) selectNode(b.dataset.jump, true, Number(b.dataset.line) || null);
    else if (b.dataset.file) openSource(b.dataset.file);
    else if (b.dataset.readFile) openSource(b.dataset.readFile);
    else if (b.id === 'go-to-code') { const n = state.graph.nodes.find(n => n.id === selected); if (n) postHost({ type: 'openSource', file: n.file, line: n.start }); }
    else if (b.dataset.hostScope) postHost({ type: 'scope', scope: b.dataset.hostScope });
    else if (b.dataset.close) document.getElementById(b.dataset.close).close();
    else if (b.dataset.sample) { const sample = samples[b.dataset.sample]; await loadFiles(sample.files, sample.title); toast('Đã mở ví dụ. Ctrl Z để quay lại bản đồ trước.'); }
    else if (b.dataset.view) { if (b.dataset.view === 'focus' && !selected) toast('Chọn một hàm để xem các kết nối trực tiếp'); view = b.dataset.view; updateHighlights(); }
    else if (b.dataset.tool) { setTool(b.dataset.tool); if (tool === 'note') toast('Bấm lên canvas để đặt ghi chú'); }
    else if (b.dataset.draft !== undefined) { commitDraft(); draftIndex = Number(b.dataset.draft); renderDraft(); }
    else if (b.dataset.removeDraft !== undefined) { commitDraft(); draft.splice(Number(b.dataset.removeDraft), 1); if (!draft.length) draft = [{ name: 'main.py', content: '' }]; draftIndex = Math.min(draftIndex, draft.length - 1); renderDraft(); }
    else if (b.dataset.removeNote) { checkpoint(); state.notes = state.notes.filter(n => n.id !== b.dataset.removeNote); renderNotes(); persist(); }
    else switch (b.id) {
      case 'open-source': case 'empty-open': openSource(); break;
      case 'close-inspector': closeInspector(); break;
      case 'fit-button': fit(); break;
      case 'zoom-in': zoom(1.2); break;
      case 'zoom-out': zoom(1 / 1.2); break;
      case 'toggle-sidebar': $('#sidebar').classList.toggle('open'); break;
      case 'upload-files': $('#file-input').click(); break;
      case 'upload-folder': $('#folder-input').click(); break;
      case 'new-file': commitDraft(); draft.push({ name: `module_${draft.length + 1}.py`, content: '' }); draftIndex = draft.length - 1; renderDraft(); $('#filename').focus(); break;
      case 'analyze-button': {
        commitDraft(); $('#source-error').hidden = true; b.disabled = true;
        try { const name = draft.length === 1 ? draft[0].name : `${draft[0].name.split('/')[0]} · ${draft.length} files`; await loadFiles(draft, name); $('#source-dialog').close(); toast('Bản đồ đã sẵn sàng — chọn một hàm để bắt đầu'); }
        catch (error) { $('#source-error').textContent = error.message; $('#source-error').hidden = false; }
        finally { b.disabled = false; } break;
      }
      case 'undo-button': if (inVSCode) { if (state.strokes.length) { state.strokes.pop(); renderInk(); persist(); } else toast('Không còn nét vẽ để hoàn tác'); } else await undo(); break;
      case 'arrange-button': { checkpoint(); layoutFiles(state.graph.files, file => state.graph.nodes.filter(n => n.file === file.name)); updateGroupBounds(); render(); fit(); break; }
      case 'help-button': case 'shortcuts-button': help(); break;
      case 'diagnostics-button': diagnostics(); break;
      case 'export-button': { const blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'code-atlas.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Đã xuất code, bố cục và ghi chú vào JSON'); break; }
    }
  } catch (error) { toast(error.message); }
});
$('#search').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); renderTree(); updateHighlights(); });
$('#file-input').addEventListener('change', e => importFiles(e.target.files)); $('#folder-input').addEventListener('change', e => importFiles(e.target.files));
$('#source-text').addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); const el = e.target; el.setRangeText('    ', el.selectionStart, el.selectionEnd, 'end'); } });
$('#note-layer').addEventListener('focusin', e => { if (e.target.matches('textarea')) checkpoint(); });
$('#note-layer').addEventListener('input', e => { const note = state.notes.find(n => n.id === e.target.closest('[data-note]')?.dataset.note); if (note) { note.text = e.target.value; persist(); } });
document.addEventListener('keydown', e => {
  if (e.target.matches('input,textarea,[contenteditable]')) return;
  if ($('dialog[open]')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSource(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo().catch(error => toast(error.message)); }
  else if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
  else if (e.key.toLowerCase() === 'f') fit();
  else if (e.key.toLowerCase() === 'v') setTool('select');
  else if (e.key.toLowerCase() === 'd') setTool('ink');
  else if (e.key.toLowerCase() === 'n') { setTool('note'); toast('Bấm lên canvas để đặt ghi chú'); }
  else if (e.key === 'Escape') { closeInspector(); setTool('select'); }
  else if (e.key === '?') help();
  else if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.code-node')) { e.preventDefault(); selectNode(e.target.dataset.node); }
});
viewport.addEventListener('dragover', e => { e.preventDefault(); }); viewport.addEventListener('drop', e => { e.preventDefault(); importFiles(e.dataTransfer.files); });
window.addEventListener('beforeunload', () => { if (!inVSCode) try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot())); } catch {} });
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(fit, 150); });
if (inVSCode) {
  $('#open-source').textContent = '↩ Về code';
  $('#export-button').remove();
  $('#open-source').insertAdjacentHTML('beforebegin', '<div class="host-scope"><button class="button small subtle" data-host-scope="file">File</button><button class="button small subtle" data-host-scope="workspace">Thư mục</button></div>');
  $$('.sample-card').forEach(el => el.remove());
  $('#sidebar .sidebar-bottom .section-heading').textContent = 'TỪ EDITOR → BẢN ĐỒ';
  $('#sidebar .sidebar-bottom').insertAdjacentHTML('afterbegin', '<p class="host-tip">Mở file Python/C và nhấn Ctrl+Shift+V. Bản đồ cập nhật khi code thay đổi.</p>');
  window.addEventListener('message', ({ data }) => {
    if (data?.type === 'model') { loadHostModel(data); $$('[data-host-scope]').forEach(b => b.classList.toggle('host-active', b.dataset.hostScope === data.mode)); }
    else if (data?.type === 'parseResult') acceptHostParse(data);
    else if (data?.type === 'error') { $('#loading').hidden = true; toast(data.message); $('#status-detail').textContent = data.message; }
  });
  postHost({ type: 'ready' });
} else try {
  let saved; try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) saved = validWorkspace(JSON.parse(raw)); } catch { toast('Không đọc được bản lưu; đang mở ví dụ.'); }
  if (saved) { try { await loadFiles(saved.files, saved.title, saved, false); } catch { await loadFiles(samples.locomotion.files, samples.locomotion.title, null, false); toast('Bản lưu không hợp lệ; đang mở ví dụ.'); } }
  else await loadFiles(samples.locomotion.files, samples.locomotion.title, null, false);
} catch (error) { $('#loading').hidden = true; toast(error.message); $('#empty-state').hidden = false; }

// Control surface for an embedding host (the VS Code extension drives the same UI through this).
window.codeAtlas = {
  loadFiles,
  state: () => state,
  select: (id, center = true, line = null) => selectNode(id, center, line),
  fit,
  node: id => state.graph.nodes.find(n => n.id === id)
};
