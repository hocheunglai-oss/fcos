import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {bootstrapSql} from './lib/hosted-release/cutover-bootstrap.mjs';

// Root executes emitted SQL through the already verified privileged connector
// and its exact request through the existing native GitHub transport. This CLI
// intentionally neither discovers nor accepts another admin credential.
export function main([command,proofFile,extraFile]) {
  const proof=JSON.parse(readFileSync(proofFile,'utf8'));
  const extra=extraFile?JSON.parse(readFileSync(extraFile,'utf8')):{};
  return bootstrapSql(command,proof,extra);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{process.stdout.write(`${JSON.stringify(main(process.argv.slice(2)))}\n`);}
  catch{process.stderr.write('BOOTSTRAP_OPERATOR_INPUT_REFUSED\n');process.exitCode=1;}
}
