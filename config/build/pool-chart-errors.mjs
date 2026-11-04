// Babel repeats these primitive messages in the generated Recharts chunk.
// Pool the values after minification without changing constructors or handlers.
const MESSAGES = new Set([
  'Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.',
  'Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.',
]);

function visit(root, callback) {
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== 'object') continue;
    if (typeof node.type === 'string') callback(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) pending.push(...value);
      else if (value && typeof value === 'object') pending.push(value);
    }
  }
}

export function poolChartTypeErrorMessages(code, parse) {
  const identifiers = new Set();
  const groups = new Map();
  visit(parse(code), node => {
    if (node.type === 'Identifier') identifiers.add(node.name);
    if (node.type !== 'NewExpression' || node.callee.type !== 'Identifier'
      || node.callee.name !== 'TypeError' || node.arguments.length !== 1) return;
    const argument = node.arguments[0];
    if (argument.type !== 'Literal' || !MESSAGES.has(argument.value)) return;
    if (!groups.has(argument.value)) groups.set(argument.value, []);
    groups.get(argument.value).push(argument);
  });
  const declarations = [];
  const replacements = [];
  let index = 0;
  for (const occurrences of groups.values()) {
    if (occurrences.length < 2) continue;
    let name;
    do { name = `__fcE${index++}`; } while (identifiers.has(name));
    identifiers.add(name);
    const first = occurrences[0];
    declarations.push(`${name}=${code.slice(first.start, first.end)}`);
    for (const occurrence of occurrences) replacements.push({ ...occurrence, name });
  }
  if (!replacements.length) return null;
  let result = code;
  for (const { start, end, name } of replacements.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, start) + name + result.slice(end);
  }
  result = `const ${declarations.join(',')};\n${result}`;
  return Buffer.byteLength(result) < Buffer.byteLength(code) ? result : null;
}

export function poolChartErrors() {
  return {
    name: 'fcos-pool-chart-error-messages',
    renderChunk: {
      order: 'post',
      handler(code, chunk, outputOptions) {
        // Preserve an existing source-map chain rather than emitting stale maps.
        if (outputOptions.sourcemap || !Object.keys(chunk.modules).some(id =>
          /\/node_modules\/recharts\/.*\/generateCategoricalChart\.js$/.test(id.replaceAll('\\', '/')))) return null;
        const result = poolChartTypeErrorMessages(code, source => this.parse(source));
        return result === null ? null : { code: result, map: null };
      },
    },
  };
}
