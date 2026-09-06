import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
const typeScriptCli = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const buyerInvoiceDatesPath = fileURLToPath(new URL('../api/_buyerInvoiceDates.js', import.meta.url));

test('core JavaScript typecheck compiles buyer invoice date contracts', async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    typeScriptCli,
    '--project', 'jsconfig.core.json',
    '--listFiles',
    '--pretty', 'false',
  ], { cwd: workspaceRoot });

  assert.match(stdout, new RegExp(`${buyerInvoiceDatesPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
});
