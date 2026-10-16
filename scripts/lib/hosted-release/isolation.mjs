import { spawnSync, execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fail } from './contract.mjs';

const imagePattern = /^ghcr\.io\/hocheunglai-oss\/fcos-release-checks@sha256:[a-f0-9]{64}$/;
export function candidateContainerArguments({ image, candidateDirectory, controllerDirectory, program, args, env = {} }) {
  if (!imagePattern.test(image || '') || !['node', 'python3', 'npm'].includes(program)) fail('CANDIDATE_IMAGE_NOT_ADMITTED');
  const candidate = realpathSync(resolve(candidateDirectory)), controller = realpathSync(resolve(controllerDirectory));
  if (candidate === controller || candidate.startsWith(`${controller}${sep}`) || controller.startsWith(`${candidate}${sep}`)
    || candidate.includes(',') || controller.includes(',')) fail('CANDIDATE_ISOLATION_PATH');
  const rewrite = value => value.replaceAll(candidate, '/candidate').replaceAll(controller, '/controller');
  const permitted = Object.entries(env).filter(([key]) => !['PATH', 'HOME', 'TMPDIR', 'PLAYWRIGHT_BROWSERS_PATH'].includes(key));
  if (permitted.some(([key]) => /TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTHORIZATION|GITHUB|ACTIONS|NODE_OPTIONS|PYTHONPATH/i.test(key))) fail('CANDIDATE_CREDENTIAL_ENVIRONMENT');
  return ['run', '--rm', '--init', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--user', '1001:1001', '--network=host', '--pids-limit=512', '--memory=6g', '--cpus=2',
    '--tmpfs', '/tmp:rw,nosuid,nodev,exec,size=1g', '--mount', `type=bind,src=${candidate},dst=/candidate`,
    '--mount', `type=bind,src=${controller},dst=/controller,readonly`, '--workdir', '/candidate',
    '--env', 'HOME=/tmp', '--env', 'TMPDIR=/tmp', '--env', 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
    ...permitted.flatMap(([key, value]) => ['--env', `${key}=${rewrite(value)}`]), image, program, ...args.map(rewrite)];
}
export function isolatedCandidateRunner({ image, candidateDirectory, controllerDirectory, spawn = spawnSync }) {
  return (program, args, options) => spawn('docker', candidateContainerArguments({ image, candidateDirectory, controllerDirectory,
    program: program.endsWith('python3') ? 'python3' : 'node', args, env: options.env }), {
    env: { PATH: process.env.PATH, HOME: process.env.HOME }, shell: false, stdio: options.stdio, timeout: options.timeout,
  });
}
export function inspectCandidateRuntime({ image, execute = execFileSync }) {
  if (!imagePattern.test(image || '')) fail('CANDIDATE_IMAGE_NOT_ADMITTED');
  const inspect = JSON.parse(execute('docker', ['image', 'inspect', image], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  if (inspect.length !== 1 || !inspect[0].RepoDigests?.includes(image)) fail('CANDIDATE_IMAGE_DIGEST_MISMATCH');
  const run = args => execute('docker', ['run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', image, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  return { ...JSON.parse(run(['node', '-e', 'console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch}))'])), python: run(['python3', '--version']), image };
}
