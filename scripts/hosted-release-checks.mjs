import { readFileSync, realpathSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReleaseChecks } from './lib/hosted-release/checks.mjs';
import { verifyCodexControls } from '../.codex/control-validation.mjs';

export async function hostedReleaseChecks(argv = process.argv.slice(2)) {
  const allowed = new Set(['--candidate-directory', '--controller-directory', '--controller-sha', '--candidate-sha', '--source-profile', '--group', '--phase', '--check', '--evidence', '--dependencies', '--cache', '--internal-check']);
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!allowed.has(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--') || args[argv[i]]) throw new Error('Unknown, duplicate or incomplete release check option.');
    args[argv[i]] = argv[i + 1];
  }
  if (args['--internal-check']) {
    if (args['--internal-check'] !== 'controls' || !args['--candidate-directory']) throw new Error('Unknown internal release check.');
    verifyCodexControls(resolve(args['--candidate-directory']));
    return { status: 'passed' };
  }
  for (const name of ['--candidate-directory', '--controller-directory', '--controller-sha', '--candidate-sha', '--source-profile', '--evidence']) if (!args[name]) throw new Error(`${name} is required.`);
  const read = file => JSON.parse(readFileSync(file, 'utf8'));
  const output = resolve(args['--evidence']);
  const persist = report => {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(`${output}.tmp`, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    renameSync(`${output}.tmp`, output);
  };
  const report = await runReleaseChecks({ candidateDirectory: resolve(args['--candidate-directory']), controllerDirectory: resolve(args['--controller-directory']),
    controllerSha: args['--controller-sha'], expectedCandidateSha: args['--candidate-sha'], sourceProfile: args['--source-profile'],
    group: args['--group'], phase: args['--phase'], checkIds: args['--check']?.split(','),
    dependencyReports: args['--dependencies'] ? args['--dependencies'].split(',').map(read) : [],
    cache: args['--cache'] ? read(args['--cache']).checks : [],
    environment: { ...process.env, ...(process.env.GITHUB_ACTIONS === 'true' ? { FCOS_HOSTED_CHECK_EXECUTION: '1' } : {}) },
    onRecord: (_, partial) => persist(partial) });
  persist(report);
  return report;
}
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) hostedReleaseChecks().then(report => {
  console.log(`Release checks: ${report.status}.`);
  process.exitCode = report.status === 'failed' ? 1 : report.status === 'waiting_dependency' ? 2 : 0;
}).catch(() => { console.error('Hosted release check command failed safely.'); process.exitCode = 1; });
