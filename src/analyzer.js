import { parser as python } from '@lezer/python';
import { parser as cpp } from '@lezer/cpp';
import { layoutFiles } from './layout.js';

export const languageOf = name => /\.py$/i.test(name) ? 'python' : /\.(c|h)$/i.test(name) ? 'c' : null;
const children = node => { const list = []; for (let c = node.firstChild; c; c = c.nextSibling) list.push(c); return list; };
const textOf = (node, text) => node ? text.slice(node.from, node.to) : '';
function walk(node, visit) { if (visit(node) === false) return; for (let c = node.firstChild; c; c = c.nextSibling) walk(c, visit); }
function find(node, name) { let result; walk(node, n => { if (result) return false; if (n.name === name) { result = n; return false; } }); return result; }
// Calls to these never resolve to an opened file; listing them as "unknown" buries the calls worth reading.
const PY_BUILTINS = new Set(('abs aiter all anext any ascii bin bool breakpoint bytearray bytes callable chr classmethod compile complex delattr dict dir divmod enumerate eval exec filter float format frozenset getattr globals hasattr hash help hex id input int isinstance issubclass iter len list locals map max memoryview min next object oct open ord pow print property range repr reversed round set setattr slice sorted staticmethod str sum tuple type vars zip ' +
  'ArithmeticError AssertionError AttributeError BaseException BlockingIOError BrokenPipeError BufferError BytesWarning ChildProcessError ConnectionError DeprecationWarning EOFError Exception FileExistsError FileNotFoundError FloatingPointError FutureWarning GeneratorExit ImportError IndentationError IndexError InterruptedError IsADirectoryError KeyError KeyboardInterrupt LookupError MemoryError ModuleNotFoundError NameError NotADirectoryError NotImplementedError OSError OverflowError PermissionError ProcessLookupError RecursionError ReferenceError RuntimeError RuntimeWarning StopAsyncIteration StopIteration SyntaxError SystemError SystemExit TabError TimeoutError TypeError UnboundLocalError UnicodeDecodeError UnicodeEncodeError UnicodeError UserWarning ValueError Warning ZeroDivisionError').split(' '));
// @lezer/python 1.1.19 reports `0.` — a valid float, common in sim code like gravity=(0., 0., -9.81) —
// as a syntax error. Parsing a copy where those are written `.0` keeps every byte offset, so all text,
// line numbers and code blocks still come from the file as the user wrote it.
const parseableText = (text, language) => language === 'python' ? text.replace(/(?<![\w.])(\d+)\.(?![\w.])/g, (_, digits) => '.' + digits) : text;
const DEFAULT_REASON = 'Chưa có định nghĩa hoặc chưa suy ra được đối tượng.';
const baseModule = path => path.replace(/\.(py|c|h)$/i, '').replace(/\/__init__$/, '').replaceAll('/', '.');
const basesOf = (argList, text) => {
  if (!argList) return [];
  const list = [], group = [];
  const flush = () => {
    if (group.length && !group.some(c => c.name === 'AssignOp')) {
      const first = group.find(c => c.name === 'VariableName' || c.name === 'MemberExpression');
      const raw = first ? textOf(first, text).replace(/\[[\s\S]*\]$/, '').trim() : '';
      if (/^[\w.]+$/.test(raw)) list.push(raw);
    }
    group.length = 0;
  };
  for (const c of children(argList)) { if (c.name === ',') flush(); else if (c.name !== '(' && c.name !== ')') group.push(c); }
  flush();
  return list;
};
const sameModule = (file, module) => { const name = baseModule(file); return name === module || name.endsWith('.' + module); };

export function analyze(files) {
  if (!Array.isArray(files) || !files.length) throw new Error('Hãy thêm ít nhất một file .py, .c hoặc .h.');
  if (files.length > 120) throw new Error('Bản đầu hỗ trợ tối đa 120 file mỗi bản đồ.');
  const names = new Set();
  for (const file of files) {
    if (!file || typeof file.name !== 'string' || typeof file.content !== 'string' || !languageOf(file.name)) throw new Error('Chỉ nhận file Python (.py) và C (.c, .h).');
    if (names.has(file.name)) throw new Error(`Trùng đường dẫn: ${file.name}`);
    if (file.content.length > 500000) throw new Error(`File ${file.name} quá lớn (giới hạn 500 KB).`);
    names.add(file.name);
  }
  if (files.reduce((n, f) => n + f.content.length, 0) > 3000000) throw new Error('Tổng code vượt quá 3 MB. Hãy chọn các module cần đọc.');
  const nodes = [], metadata = [], internals = new Map(), classRegistry = new Map();
  for (const file of files) {
    const language = languageOf(file.name), text = file.content;
    const tree = (language === 'python' ? python : cpp).parse(parseableText(text, language));
    const starts = [0]; for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
    const line = pos => { let lo = 0, hi = starts.length; while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid; } return lo + 1; };
    const imports = [], errors = [], classes = [], assignmentTypes = new Map();
    const meta = { name: file.name, language, lines: starts.length, imports, errors, classes };
    metadata.push(meta);
    walk(tree.topNode, n => {
      if (n.type.isError && errors.length < 12) errors.push(line(n.from));
      if (n.name === 'ImportStatement') {
        const raw = textOf(n, text).replace(/\s+/g, ' ').trim();
        const from = raw.match(/^from\s+([\w.]+)\s+import\s+(.+)$/);
        if (from) {
          for (const entry of from[2].replace(/[()]/g, '').split(',')) {
            const m = entry.trim().match(/^(\w+)(?:\s+as\s+(\w+))?$/);
            if (m) imports.push({ module: from[1], symbol: m[1], alias: m[2] || m[1], relative: from[1].startsWith('.') });
          }
        } else {
          for (const entry of raw.replace(/^import\s+/, '').split(',')) {
            const m = entry.trim().match(/^([\w.]+)(?:\s+as\s+(\w+))?$/);
            if (m) imports.push({ module: m[1], symbol: null, alias: m[2] || m[1] });
          }
        }
      }
      if (n.name === 'PreprocDirective') {
        const m = textOf(n, text).match(/^#\s*include\s*[<"]([^>"]+)/);
        if (m) imports.push({ module: m[1], alias: m[1], symbol: null });
      }
    });
    function collect(ast, parents = [], parentClass = null) {
      const isClass = ast.name === 'ClassDefinition';
      const isFunction = ast.name === 'FunctionDefinition';
      if (isClass) {
        const name = textOf(ast.getChild('VariableName'), text);
        const qname = [...parents, name].join('.');
        const bases = basesOf(ast.getChild('ArgList'), text);
        classes.push({ name: qname, bases, line: line(ast.from) });
        classRegistry.set(`${file.name}::${qname}`, { file: file.name, qname, name, bases });
        for (const c of children(ast)) collect(c, [...parents, name], qname);
        return;
      }
      if (isFunction) {
        const decl = language === 'c' ? find(ast, 'FunctionDeclarator') : null;
        const nameNode = language === 'python' ? ast.getChild('VariableName') : decl && find(decl, 'Identifier');
        if (!nameNode) return;
        const name = textOf(nameNode, text), qname = [...parents, name].join('.');
        const body = ast.getChild(language === 'python' ? 'Body' : 'CompoundStatement');
        if (!body) return;
        const id = `${file.name}::${qname}@${ast.from}`;
        const decorated = language === 'python' && ast.parent?.name === 'DecoratedStatement' ? ast.parent : null;
        const decorators = decorated ? children(decorated).filter(c => c.name === 'Decorator').map(c => textOf(c, text).trim().replace(/^@\s*/, '')) : [];
        const blockFrom = decorated ? decorated.from : ast.from;
        const node = { id, name, qualified: qname, className: parentClass, scope: parents.join('.'), file: file.name, language,
          kind: parentClass ? 'method' : 'function', start: line(blockFrom), end: line(Math.max(ast.from, ast.to - 1)),
          code: text.slice(blockFrom, ast.to), signature: text.slice(ast.from, body.from).trim(), calls: [], loops: 0, branches: 0,
          decorators, classBases: parentClass ? (classRegistry.get(`${file.name}::${parentClass}`)?.bases || []) : [],
          callback: language === 'c' && /(?:IRQHandler|Callback)$/.test(name), static: language === 'c' && /^\s*static\b/.test(textOf(ast, text)),
          doc: '', role: 'logic', x: 0, y: 0 };
        const firstStatement = children(body).find(c => c.name === 'ExpressionStatement');
        if (language === 'python' && firstStatement && children(body).filter(c => c.name !== ':')[0]?.from === firstStatement.from) {
          const str = firstStatement.getChild('String');
          if (str) node.doc = textOf(str, text).replace(/^[rRuUfF]*(?:"""|'''|"|')|(?:"""|'''|"|')$/g, '').trim();
        }
        const localTypes = new Map(), shadowed = new Set();
        const paramList = ast.getChild('ParamList');
        if (paramList) {
          for (const p of children(paramList)) {
            if (p.name === 'VariableName') {
              const annotation = p.nextSibling?.name === 'TypeDef' ? textOf(p.nextSibling, text).replace(/^:\s*/, '') : null;
              if (annotation) localTypes.set(textOf(p, text), annotation);
              shadowed.add(textOf(p, text));
            }
          }
        }
        walk(body, n => {
          if (n.name === 'FunctionDefinition' || n.name === 'ClassDefinition') return false;
          if (['ForStatement', 'WhileStatement', 'DoStatement'].includes(n.name)) node.loops++;
          if (['IfStatement', 'SwitchStatement', 'MatchStatement', 'ConditionalExpression'].includes(n.name)) node.branches++;
          if (language === 'python' && n.name === 'AssignStatement') {
            const parts = children(n), lhs = parts[0], rhs = parts.find(c => c.name === 'CallExpression');
            if (lhs?.name === 'VariableName') shadowed.add(textOf(lhs, text));
            if (rhs && lhs) {
              const variable = textOf(lhs, text), constructor = textOf(rhs.firstChild, text);
              if (/^[\w.]+$/.test(constructor)) {
                localTypes.set(variable, constructor);
                if (parentClass && variable.startsWith('self.')) assignmentTypes.set(`${parentClass}:${variable}`, constructor);
              }
            }
          }
          if (n.name === 'CallExpression') {
            const callee = textOf(n.firstChild, text);
            // `super()` only names the base class; the edge comes from the `super().method` call around it.
            if (language === 'python' && callee === 'super') return;
            node.calls.push({ name: callee, line: line(n.from), status: 'unresolved', target: null, reason: DEFAULT_REASON });
          }
        });
        node.role = roleOf(node);
        nodes.push(node); internals.set(id, { ast, localTypes, shadowed, assignmentTypes, imports });
        for (const c of children(body)) collect(c, [...parents, name], parentClass);
        return;
      }
      for (const c of children(ast)) collect(c, parents, parentClass);
    }
    collect(tree.topNode);
  }
  if (nodes.length > 900) throw new Error('Hơn 900 hàm. Hãy mở một nhóm module nhỏ hơn để bản đồ dễ đọc.');
  const edges = [], edgeMap = new Map();
  const pick = list => list.length === 1 ? list[0] : null;
  const moduleMatches = (file, imp, origin) => {
    if (!imp.relative) return sameModule(file, imp.module);
    const dots = imp.module.match(/^\.+/)[0].length;
    const parent = origin.split('/').slice(0, -dots).join('/');
    const name = [parent, imp.module.slice(dots).replaceAll('.', '/')].filter(Boolean).join('/');
    return file.replace(/\.py$/, '').replace(/\/__init__$/, '') === name;
  };
  const importsOf = file => metadata.find(m => m.name === file)?.imports || [];
  const symbolNodes = (file, symbol) => nodes.filter(n => n.language === 'python' && n.file === file &&
    ((!n.className && !n.scope && n.name === symbol) || (n.className === symbol && n.name === '__init__')));
  // `from pkg.mod import name` where pkg/mod.py only re-imports `name` from somewhere else.
  function importedSymbol(imp, fromFile, seen = new Set()) {
    if (!imp.symbol) return [];
    const mods = metadata.filter(m => m.language === 'python' && moduleMatches(m.name, imp, fromFile));
    for (const m of mods) { const hit = symbolNodes(m.name, imp.symbol); if (hit.length) return hit; }
    for (const m of mods) {
      const key = `${m.name}::${imp.symbol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const next = m.imports.find(i => i.alias === imp.symbol && i.symbol);
      const found = next ? importedSymbol(next, m.name, seen) : [];
      if (found.length) return found;
    }
    return [];
  }
  function classEntry(file, type) {
    if (!type || !/^[\w.]+$/.test(type)) return null;
    const direct = classRegistry.get(`${file}::${type}`);
    if (direct) return direct;
    const parts = type.split('.'), imp = importsOf(file).find(i => i.alias === parts[0]);
    if (!imp) return null;
    const qname = imp.symbol ? [imp.symbol, ...parts.slice(1)].join('.') : parts.slice(1).join('.');
    if (!qname) return null;
    for (const entry of classRegistry.values()) if (entry.qname === qname && moduleMatches(entry.file, imp, file)) return entry;
    return null;
  }
  // Leftmost depth-first walk of the base classes. Approximates Python's MRO; it does not run C3 linearisation.
  function methodInChain(entry, method, seen = new Set()) {
    if (!entry || seen.has(`${entry.file}::${entry.qname}`)) return null;
    seen.add(`${entry.file}::${entry.qname}`);
    const own = nodes.filter(n => n.language === 'python' && n.file === entry.file && n.className === entry.qname && n.name === method);
    if (own.length) return { candidates: own, owner: entry };
    for (const base of entry.bases) {
      const found = methodInChain(classEntry(entry.file, base), method, seen);
      if (found) return found;
    }
    return null;
  }
  function chainLookup(file, type, method, selfClass = null) {
    const entry = classEntry(file, type);
    const found = entry ? methodInChain(entry, method) : null;
    if (!found) return null;
    return { candidates: found.candidates, inherited: found.owner.qname === (selfClass || type) && found.owner.file === file ? null : found.owner };
  }
  const openModule = (imp, from) => metadata.some(m => m.language === 'python' && moduleMatches(m.name, imp, from));
  // Separates "outside the opened files" (library / builtin) from "we really could not tell" (unknown).
  function classify(call, source, info) {
    // Keeps a reason set by the resolver; only the generic one is replaced with something more specific.
    const explain = (kind, reason) => { call.kind = kind; if (reason && call.reason === DEFAULT_REASON) call.reason = reason; };
    if (source.language === 'c') { explain('unknown'); return; }
    const parts = call.name.split('.'), receiver = parts.slice(0, -1).join('.');
    if (receiver.includes('(') && receiver !== 'super()') { explain('chain', 'Gọi trên kết quả của một lời gọi khác; chưa suy ra được kiểu trung gian.'); return; }
    // A local variable as receiver is normal (`ap.add_argument`); only a bare call shadowed by a local is opaque.
    if (parts.length === 1 && info.shadowed.has(call.name)) { explain('unknown'); return; }
    if (parts.length === 1 && PY_BUILTINS.has(call.name)) { explain('builtin', 'Hàm/exception có sẵn của Python.'); return; }
    const type = receiver ? info.localTypes.get(receiver) || info.assignmentTypes.get(`${source.className}:${receiver}`) : null;
    for (const root of [parts[0], type ? type.split('.')[0] : null]) {
      const imp = root ? info.imports.find(i => i.alias === root) : null;
      if (imp && !openModule(imp, source.file)) {
        call.module = imp.relative ? imp.module : imp.module.split('.')[0];
        explain('library', `Thuộc module "${call.module}" chưa có trong các file đã mở.`);
        return;
      }
    }
    explain('unknown');
  }
  for (const source of nodes) {
    const info = internals.get(source.id);
    for (const call of source.calls) {
      let candidates = [], known = false, inherited = null;
      if (source.language === 'c') {
        if (/^\w+$/.test(call.name)) {
          const local = nodes.filter(n => n.language === 'c' && n.name === call.name && n.file === source.file);
          candidates = local.length ? local : nodes.filter(n => n.language === 'c' && n.name === call.name && !n.static);
        } else call.reason = 'Gọi gián tiếp qua con trỏ hoặc biểu thức; chưa phân giải.';
      } else {
        const parts = call.name.split('.'), method = parts.at(-1);
        if (parts.length === 1) {
          const imp = info.imports.find(i => i.alias === call.name && i.symbol);
          if (info.shadowed.has(call.name)) {
            call.reason = 'Tên bị che bởi tham số/biến cục bộ; không đoán đích gọi.';
          } else if (imp) {
            candidates = importedSymbol(imp, source.file);
            if (!candidates.length) { const hit = chainLookup(source.file, call.name, '__init__'); if (hit) ({ candidates, inherited } = hit); }
          } else if (!info.shadowed.has(call.name)) {
            const scopes = [source.qualified, source.scope, ''].filter((v, i, a) => a.indexOf(v) === i);
            for (const scope of scopes) {
              candidates = nodes.filter(n => n.language === 'python' && n.file === source.file && n.name === call.name && n.scope === scope && !n.className);
              if (candidates.length) break;
            }
            if (!candidates.length) { const hit = chainLookup(source.file, call.name, '__init__'); if (hit) ({ candidates, inherited } = hit); }
          } else call.reason = 'Tên bị che bởi tham số/biến cục bộ; không đoán đích gọi.';
        } else if (parts[0] === 'self' && parts.length === 2 && source.className) {
          const hit = chainLookup(source.file, source.className, method, source.className);
          if (hit) ({ candidates, inherited } = hit);
          else call.reason = 'Không thấy method này trong class hiện tại hoặc các class cha đã mở.';
        } else if (parts[0] === 'super()' && parts.length === 2 && source.className) {
          const entry = classEntry(source.file, source.className);
          for (const base of entry?.bases || []) {
            const found = methodInChain(classEntry(entry.file, base), method);
            if (found) { candidates = found.candidates; inherited = found.owner; break; }
          }
          if (!candidates.length) call.reason = entry?.bases.length ? 'Class cha chưa có trong các file đã mở hoặc không định nghĩa method này.' : 'Không xác định được class cha của class hiện tại.';
        } else {
          const receiver = parts.slice(0, -1).join('.');
          const type = info.localTypes.get(receiver) || info.assignmentTypes.get(`${source.className}:${receiver}`);
          if (type) { const hit = chainLookup(source.file, type, method); if (hit) ({ candidates, inherited } = hit); known = true; }
          else {
            const imp = info.imports.find(i => i.alias === receiver && !i.symbol);
            if (imp) candidates = nodes.filter(n => n.language === 'python' && !n.scope && n.name === method && moduleMatches(n.file, imp, source.file));
            else if (!info.shadowed.has(parts[0])) { const hit = chainLookup(source.file, receiver, method); if (hit) ({ candidates, inherited } = hit); }
          }
        }
      }
      const target = pick(candidates);
      if (target) {
        call.status = known ? 'inferred' : 'resolved'; call.target = target.id;
        call.reason = known ? 'Suy ra từ kiểu được chú thích hoặc phép gán constructor.' : 'Tìm thấy định nghĩa phù hợp trong các file đã mở.';
        if (inherited) {
          call.inheritedFrom = inherited.qname;
          call.reason += ` Kế thừa từ class ${inherited.qname}; chọn base trái→phải, chưa chạy MRO C3 đầy đủ.`;
        }
        const key = `${source.id}→${target.id}`;
        if (!edgeMap.has(key)) { const edge = { id: key, source: source.id, target: target.id, inferred: known, inherited: !!inherited, lines: [] }; edgeMap.set(key, edge); edges.push(edge); }
        edgeMap.get(key).lines.push(call.line);
      } else if (candidates.length > 1) call.reason = 'Nhiều định nghĩa trùng tên; chưa đủ thông tin để chọn.';
      else if (source.language === 'c' && /^(HAL_|__HAL_|MX_)/.test(call.name)) { call.reason = 'HAL / mã khởi tạo: định nghĩa chưa có trong các file đã mở.'; call.kind = 'library'; call.module = 'HAL'; }
      if (!target && !call.kind) classify(call, source, info);
    }
  }
  const open = nodes.flatMap(n => n.calls.filter(c => !c.target));
  return { nodes, edges, files: metadata, stats: { functions: nodes.length, calls: edges.length,
    unresolved: open.filter(c => c.kind === 'unknown').length, external: open.filter(c => c.kind !== 'unknown').length } };
}

export function roleOf(node) {
  const name = node.name.toLowerCase();
  if (node.callback) return 'interrupt';
  if (/^(main|control_loop|run|loop|control_step|step)$/.test(name)) return 'entry';
  if (/forward|infer|predict|policy|actor/.test(name)) return 'policy';
  if (/obs|sensor|imu|encoder|read|normalize/.test(name)) return 'sensing';
  if (/motor|pwm|pid|actuat|scale_action|clamp/.test(name)) return 'control';
  if (/uart|serial|packet|send|parse_command|transport|encode/.test(name)) return 'transport';
  return 'logic';
}

export function layoutGraph(graph) {
  return layoutFiles(graph.files, file => graph.nodes.filter(n => n.file === file.name));
}
