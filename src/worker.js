import { analyze, layoutGraph } from './analyzer.js';
self.onmessage = ({ data }) => {
  try { const graph = analyze(data.files); const groups = layoutGraph(graph); self.postMessage({ id: data.id, graph, groups }); }
  catch (error) { self.postMessage({ id: data.id, error: error.message }); }
};
