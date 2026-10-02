import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCodexControls } from '../.codex/control-validation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export function checkDevelopmentControls() { return verifyCodexControls(root); }
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(checkDevelopmentControls())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
