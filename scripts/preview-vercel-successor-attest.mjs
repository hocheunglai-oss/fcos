import { constants, openSync, closeSync, fstatSync, readFileSync, lstatSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fcosConnectionIdentifier } from '../config/fcosConnections.js';
import { githubReleaseReads, RELEASE_REPOSITORY } from './lib/release-evidence.mjs';
import { collectSuccessorLiveOperationAdmission } from './lib/runtime-compatibility-successor-live.mjs';
import { ENROLLED_AUTHORITY_MODE } from './lib/preview-vercel-enrollment.mjs';
import { successorAttestationPlan, assertSuccessorAttestationApproval, runSuccessorAttestationAdmission } from './lib/preview-vercel-successor-attestation.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APPROVAL_DIRECTORY = '/Users/vincex/Documents/FCOS/.fcos-cli/preview-vercel-successor-attestation';
const ownPath = fileURLToPath(import.meta.url);
const fail = () => { throw new Error('Exact successor attestation failed; private diagnostics suppressed.'); };
const positive = value => Number.isSafeInteger(value) && value > 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function readApproval(nonce) {
  const info = lstatSync(APPROVAL_DIRECTORY);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(APPROVAL_DIRECTORY) !== APPROVAL_DIRECTORY
    || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o700) fail();
  const fd = openSync(join(APPROVAL_DIRECTORY, `approval-${nonce}.json`), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600 || stat.size > 32768) fail();
    return JSON.parse(readFileSync(fd, 'utf8'));
  } finally { closeSync(fd); }
}
async function publicPreflight(reads, a) {
  const base = `repos/${RELEASE_REPOSITORY}`, env = `${base}/environments/fcos-runtime-compatibility-release`;
  const user = await reads.json('user'), repository = await reads.json(base);
  if (user?.login !== fcosConnectionIdentifier('github', 'Required account') || !positive(user.id)
    || repository.full_name !== RELEASE_REPOSITORY || repository.owner?.login !== user.login
    || repository.owner?.id !== user.id || repository.default_branch !== 'main' || repository.permissions?.admin !== true) fail();
  const environment = await reads.json(env), rules = environment.protection_rules?.filter(row => row.type === 'required_reviewers');
  const reviewer = rules?.length === 1 && rules[0].reviewers?.length === 1 ? rules[0].reviewers[0] : null;
  if (environment.name !== 'fcos-runtime-compatibility-release' || !positive(environment.id) || environment.can_admins_bypass !== false
    || reviewer?.type !== 'User' || reviewer.reviewer?.login !== user.login || reviewer.reviewer.id !== user.id
    || rules[0].prevent_self_review !== false || environment.deployment_branch_policy?.protected_branches !== true
    || environment.deployment_branch_policy?.custom_branch_policies !== false) fail();
  const variables = await reads.json(`${env}/variables?per_page=100`), secrets = await reads.json(`${env}/secrets?per_page=100`);
  for (const [result, key] of [[variables, 'variables'], [secrets, 'secrets']]) {
    if (!Array.isArray(result[key]) || result.total_count !== result[key].length || result[key].length > 100) fail();
  }
  const pins = { FCOS_RUNTIME_COMPATIBILITY_RELEASE_ENABLED: 'false', FCOS_PREVIEW_VERCEL_ISSUANCE_AUTHORITY_ENABLED: 'true',
    FCOS_PREVIEW_VERCEL_AUTHORITY_MODE: ENROLLED_AUTHORITY_MODE,
    FCOS_PREVIEW_EMAIL_BUILD_ENABLED: a.operation === 'verify-authority' ? 'false' : 'true',
    ...(a.operation === 'verify-authority' ? { FCOS_PREVIEW_EMAIL_AUTHORITY_DIAGNOSTIC_ENABLED: 'true' } : {}),
    FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_SHA: a.candidateSha, FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_HARNESS_SHA: a.harnessSha,
    FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_CONTROL_SHA256: a.controlRevision, FCOS_PREVIEW_EMAIL_BUILD_REVIEWED_CONTRACT_SHA256: a.contractSha256,
    FCOS_RELEASE_VERCEL_TOKEN_ID: a.tokenId, FCOS_PREVIEW_VERCEL_ENROLLMENT_ID: a.enrollmentId };
  for (const [name, value] of Object.entries(pins)) {
    const rows = variables.variables.filter(row => row.name === name);
    if (rows.length !== 1 || rows[0].value !== value) fail();
  }
  const metadata = secrets.secrets.map(({ name, created_at, updated_at }) => ({ name, created_at, updated_at })).sort((a, b) => a.name.localeCompare(b.name));
  if (!same(metadata, [...a.secretMetadata].sort((a, b) => a.name.localeCompare(b.name)))) fail();
  const run = await reads.json(`${base}/actions/runs/${a.runId}`);
  if (run?.repository?.full_name !== RELEASE_REPOSITORY || run.head_repository?.full_name !== RELEASE_REPOSITORY
    || run.head_sha !== a.harnessSha || run.head_branch !== 'main' || run.run_attempt !== 1 || run.event !== 'workflow_dispatch'
    || run.path?.split('@')[0] !== '.github/workflows/preview-email-proof-build.yml' || run.status !== 'in_progress'
    || run.actor?.id !== user.id || run.triggering_actor?.id !== user.id || run.actor?.login !== user.login || run.triggering_actor?.login !== user.login
    || run.display_title !== `Review FCOS Preview email source ${a.candidateSha}`) fail();
  // Existing enrollment custody/provider metadata and retained Production must
  // be verified after actual canonical admission. No private adapter exists here.
}

export async function successorAttestationMain(args = process.argv.slice(2)) {
  if (!args.length || same(args, ['--plan'])) return successorAttestationPlan();
  if (args.length !== 2 || args[0] !== '--attest-approved' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(args[1])) fail();
  const nonce = args[1], approval = readApproval(nonce), scriptSha256 = createHash('sha256').update(readFileSync(ownPath)).digest('hex');
  assertSuccessorAttestationApproval({ approval, nonce, scriptSha256 });
  // Construction and all authenticated reads follow the complete pure check.
  const reads = githubReleaseReads({ command: 'gh', env: { PATH: process.env.PATH, HOME: process.env.HOME,
    GH_HOST: 'github.com', GH_REPO: RELEASE_REPOSITORY } }, { cwd: ROOT });
  return runSuccessorAttestationAdmission({ action: 'attest', approval, nonce, scriptSha256,
    collectAdmission: () => collectSuccessorLiveOperationAdmission({ reads, sourceCwd: ROOT, trustedCwd: ROOT, runId: approval.runId }),
    preflightFixedReads: value => publicPreflight(reads, value) });
}
if (process.argv[1] && resolve(process.argv[1]) === ownPath) {
  try { console.log(JSON.stringify(await successorAttestationMain())); }
  catch { console.error('Exact successor attestation failed; no private reads/publication installed.'); process.exitCode = 1; }
}
