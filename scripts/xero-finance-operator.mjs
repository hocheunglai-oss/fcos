#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { runXeroFinanceOperator } from './lib/xero-finance-operator.mjs';

export async function main(argv = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr, fetchImpl = fetch } = {}) {
  try {
    const result = await runXeroFinanceOperator(argv, { fetchImpl });
    stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const code = error?.operatorSafe === true && /^[A-Z][A-Z0-9_]{1,80}$/.test(error?.code || '') ? error.code : 'OPERATOR_FAILED';
    const message = error?.operatorSafe === true && typeof error?.message === 'string' && error.message.length < 250 ? error.message : 'The operation failed.';
    stderr.write(`${JSON.stringify({ error: code, message })}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
