// Placement shared by the worker (initial layout) and the app (arrange button).
// Methods of one class stay in a single block so a class frame can be drawn around them.
export const NODE_PITCH = 220, NODE_WIDTH = 310, NODE_HEIGHT = 195, CLASS_TOP = 40, CLASS_BOTTOM = 22;
export const COLUMN_WIDTH = 420, GROUP_WIDTH = 350, GROUP_HEAD = 60, GROUP_FOOT = 35, COLUMN_GAP = 60, TARGET_ASPECT = 1.7;
export function classBlocks(list) {
  const blocks = [];
  for (const n of list) {
    const key = n.className || '', block = blocks.find(b => b.key === key);
    if (block) block.nodes.push(n); else blocks.push({ key, nodes: [n] });
  }
  return blocks;
}
// Stacks one file's nodes, wrapping into side-by-side sub-columns once the stack passes maxHeight.
// A class that wraps still owns every node inside its bounding box, so its frame stays correct.
export function placeFile(list, x, top = 92, maxHeight = Infinity) {
  let column = 0, y = top;
  for (const block of classBlocks(list)) {
    const head = block.key ? CLASS_TOP : 0;
    const blockHeight = head + block.nodes.length * NODE_PITCH + (block.key ? CLASS_BOTTOM : 0);
    if (y > top && y - top + blockHeight > maxHeight) { column++; y = top; }
    y += head;
    for (const n of block.nodes) {
      if (y > top + head && y - top + NODE_HEIGHT > maxHeight) { column++; y = top + head; }
      n.x = x + column * COLUMN_WIDTH; n.y = y; y += NODE_PITCH;
    }
    if (block.key) y += CLASS_BOTTOM;
  }
  return { columns: column + 1, bottom: Math.max(...list.map(n => n.y + NODE_HEIGHT)) };
}

// Height of one file's stack, measured from the first node to the bottom of the last one.
export function fileBlockHeight(list) {
  let y = 0;
  for (const block of classBlocks(list)) {
    if (block.key) y += CLASS_TOP;
    y += block.nodes.length * NODE_PITCH;
    if (block.key) y += CLASS_BOTTOM;
  }
  return y - NODE_PITCH + NODE_HEIGHT;
}
// A single row of files, or a single 4000px-tall file, fits into a 1400px viewport at about 18% — far too
// small to read. Files are packed into columns and a tall file wraps into several, aiming at a screen shape.
export function layoutFiles(files, nodesOf, originX = 40, originY = 32, targetAspect = TARGET_ASPECT) {
  const blocks = [];
  for (const file of files) { const list = nodesOf(file); if (list.length) blocks.push({ file, list, height: fileBlockHeight(list) + GROUP_HEAD + GROUP_FOOT }); }
  if (!blocks.length) return [];
  const total = blocks.reduce((sum, b) => sum + b.height + COLUMN_GAP, 0);
  const pack = wrapHeight => {
    const groups = [];
    let column = 0, cursor = originY;
    for (const block of blocks) {
      const wraps = block.height > wrapHeight;
      if (wraps || cursor - originY + block.height > wrapHeight) { if (cursor > originY) column++; cursor = originY; }
      const x = originX + column * COLUMN_WIDTH;
      const placed = placeFile(block.list, x + 20, cursor + GROUP_HEAD, wraps ? wrapHeight - GROUP_HEAD - GROUP_FOOT : Infinity);
      const height = placed.bottom + GROUP_FOOT - cursor;
      groups.push({ id: block.file.name, x, y: cursor, width: GROUP_WIDTH + (placed.columns - 1) * COLUMN_WIDTH, height, label: block.file.name, language: block.file.language });
      if (wraps) { column += placed.columns; cursor = originY; } else cursor += height + COLUMN_GAP;
    }
    return groups;
  };
  const aspectOf = groups => (Math.max(...groups.map(g => g.x + g.width)) - originX) / Math.max(1, Math.max(...groups.map(g => g.y + g.height)) - originY);
  // Files that do not wrap leave their column part-empty, so the first guess comes out wider than asked.
  // Taller columns are tried until the whole map stops being too wide for a screen.
  let wrapHeight = Math.max(NODE_PITCH * 3, Math.ceil(total / Math.max(1, Math.round(Math.sqrt(targetAspect * total / COLUMN_WIDTH)))));
  let best = wrapHeight, bestGap = Math.abs(aspectOf(pack(wrapHeight)) - targetAspect);
  for (let step = 0; step < 6; step++) {
    wrapHeight = Math.ceil(wrapHeight * 1.3);
    const gap = Math.abs(aspectOf(pack(wrapHeight)) - targetAspect);
    if (gap < bestGap) { best = wrapHeight; bestGap = gap; } else break;
  }
  return pack(best);
}
