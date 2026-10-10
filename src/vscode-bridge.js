// VS Code injects this API into its webview. The ordinary browser has no host.
export const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
export const inVSCode = !!vscode;
export function postHost(message) { vscode?.postMessage(message); }
