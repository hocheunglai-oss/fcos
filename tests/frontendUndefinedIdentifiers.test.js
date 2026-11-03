import test from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
test('the actual frontend lint configuration catches undefined render fields before deployment', async () => {
  const eslint = new ESLint({ cwd: root });
  for (const source of [
    'export default function Probe({row}) { return <div>{row[BUYER_FIELD]}</div>; }',
    'export default function Probe() { return <textarea aria-required={costNoteRequired}/>; }',
  ]) {
    const [result] = await eslint.lintText(source, { filePath: 'src/pages/LocalUndefinedNameProbe.jsx' });
    assert.equal(result.messages.some(row => row.ruleId === 'no-undef' && row.severity === 2), true);
  }
  const [valid] = await eslint.lintText('export default function Probe({row}) { const required = Boolean(row.note); return <textarea aria-required={required} title={window.location.hostname}/>; }',
    { filePath: 'src/pages/LocalUndefinedNameProbe.jsx' });
  assert.equal(valid.errorCount, 0);
});
