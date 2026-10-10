// Web build: the analyzer runs in a Web Worker so parsing never blocks the canvas.
// The VS Code build swaps this module for one that asks the extension host instead.
import { inVSCode, postHost } from './vscode-bridge.js';
const worker = inVSCode ? null : new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const pending = new Map(); let requestId = 0;
if (worker) {
  worker.onmessage = ({ data }) => { const promise = pending.get(data.id); if (!promise) return; pending.delete(data.id); data.error ? promise.reject(new Error(data.error)) : promise.resolve(data); };
  worker.onerror = () => { for (const promise of pending.values()) promise.reject(new Error('Không tải được bộ phân tích. Hãy tải lại trang.')); pending.clear(); };
}
export function parse(files) { return new Promise((resolve, reject) => { const id = ++requestId; pending.set(id, { resolve, reject }); if (worker) worker.postMessage({ id, files }); else postHost({ type: 'parse', id, files }); }); }
export function acceptHostParse(data) { const promise = pending.get(data.id); if (!promise) return; pending.delete(data.id); data.error ? promise.reject(new Error(data.error)) : promise.resolve(data); }
