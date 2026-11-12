import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { salesforcePromotionHash as hash, assertSuccessfulSalesforceReport } from './salesforce-promotion-journal.mjs';

export const REVIEWED_SALESFORCE_MODE = 'reviewed-manifest-incremental-v1';
export const INVENTORY_BASELINE_MODE = 'read-only-owned-tree-inventory';
export const COMPLETE_DEPLOYMENT_BASELINE_MODE = 'verified-complete-owned-tree-deployment';
export const COMPLETE_TREE_FALLBACK = 'Use salesforce:complete:deploy with separate complete-tree state/proof; do not relabel an incremental job as a complete-tree deployment.';
const ENVIRONMENTS = ['devee', 'qat', 'production'];
const JOB_ID = /^0Af[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/u;
const HASH = /^[a-f0-9]{64}$/u;
const ACTIVE = new Set(['Submitted', 'Queued', 'Pending', 'InProgress', 'Canceling']);
const TERMINAL = new Set(['Failed', 'Canceled', 'Expired']);
const failCoverage = message => { throw new Error(`${message} ${COMPLETE_TREE_FALLBACK}`); };
const sorted = values => [...new Set(values)].sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function safeProjectFile(cwd, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.split('/').some(part => part === '..' || !part)) throw new Error('Reviewed Salesforce paths must be safe project-relative paths.');
  const absolute = path.resolve(cwd, relative);
  if (path.relative(cwd, absolute).startsWith('..') || path.isAbsolute(relative)) throw new Error('Reviewed Salesforce path escapes the project.');
  let current = cwd;
  for (const part of relative.split('/')) { current = path.join(current, part); if (lstatSync(current).isSymbolicLink()) throw new Error('Reviewed Salesforce inputs cannot be symbolic links.'); }
  return absolute;
}

export function inventoryFromFiles(files) {
  const ordered = Object.entries(files).sort(([a], [b]) => a.localeCompare(b, 'en'));
  // Match the authoritative mirror algorithm's lexical file order, without locale ordering.
  ordered.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const inventory = Object.fromEntries(ordered.map(([name, bytes]) => [name, { sha256: hash(bytes), size: bytes.length }]));
  const treeParts = [];
  for (const [name, bytes] of ordered) treeParts.push(Buffer.from(`${name}\0${bytes.length}\0`), bytes, Buffer.from('\0'));
  return { sourceTreeHash: hash(Buffer.concat(treeParts)), inventoryHash: hash(inventory), files: inventory };
}

export function readReviewedInventory(root) {
  const files = {};
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name), stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error('Salesforce metadata cannot contain symlinks.');
      if (stat.isDirectory()) visit(absolute);
      else {
        const bytes = readFileSync(absolute);
        if (bytes.includes(Buffer.from('\r\n'))) throw new Error('Salesforce source must use LF line endings.');
        files[path.relative(root, absolute).split(path.sep).join('/')] = bytes;
      }
    }
  }
  visit(root);
  return inventoryFromFiles(files);
}

export function parseReviewedPackage(xml) {
  if (typeof xml !== 'string' || /<!|&|<\s*destructiveChanges\b/iu.test(xml)) failCoverage('Unsupported Salesforce package XML.');
  const members = [];
  for (const [, body] of xml.matchAll(/<types>([\s\S]*?)<\/types>/gu)) {
    const names = [...body.matchAll(/<name>([^<]+)<\/name>/gu)].map(([, name]) => name.trim());
    const values = [...body.matchAll(/<members>([^<]+)<\/members>/gu)].map(([, name]) => name.trim());
    if (names.length !== 1 || !values.length) failCoverage('Each reviewed package type must have exact members.');
    for (const member of values) {
      if (!/^[A-Za-z0-9_.$-]+$/u.test(member) || member.includes('*')) failCoverage('Wildcards and unsupported Salesforce members are prohibited.');
      members.push(`${names[0]}:${member}`);
    }
  }
  if (!members.length || members.length !== new Set(members).size) failCoverage('The reviewed package must contain unique explicit components.');
  // Reject unparsed types rather than accepting a partial parser's interpretation.
  if ((xml.match(/<types\b/gu) || []).length !== (xml.match(/<types>/gu) || []).length) failCoverage('Unsupported package type syntax.');
  return sorted(members);
}

function componentFiles(id, inventory) {
  const [type, member, extra] = id.split(':');
  if (extra || !member) failCoverage('Invalid reviewed component identifier.');
  const direct = {
    ApexClass: [`classes/${member}.cls`, `classes/${member}.cls-meta.xml`],
    ApexTrigger: [`triggers/${member}.trigger`, `triggers/${member}.trigger-meta.xml`],
    PermissionSet: [`permissionsets/${member}.permissionset-meta.xml`],
    CustomObject: [`objects/${member}/${member}.object-meta.xml`],
  };
  let result = direct[type];
  if (type === 'CustomField') {
    const parts = member.split('.');
    if (parts.length !== 2) failCoverage('CustomField members must name Object.Field.');
    result = [`objects/${parts[0]}/fields/${parts[1]}.field-meta.xml`];
  }
  const directory = { LightningComponentBundle: 'lwc', AuraDefinitionBundle: 'aura' }[type];
  if (directory) result = Object.keys(inventory.files).filter(name => name.startsWith(`${directory}/${member}/`));
  if (!result?.length || result.some(name => !inventory.files[name])) failCoverage(`Unsupported or missing Salesforce component ${id}.`);
  return sorted(result);
}

/** Baselines bind a Git tree; native inventory or complete v2 deployment evidence establishes org state. */
export function createReviewedSalesforcePlan({ review, manifestBytes, bootstrapBytes = null, baselineWorkflow, baselineInventory, finalInventory, policy }) {
  if (policy.environments.map(({ key }) => key).join(',') !== ENVIRONMENTS.join(',')) throw new Error('Salesforce order must be DEVEE → shared mirror → QAT → Production.');
  if (review?.schemaVersion !== 1 || review?.releaseMode !== REVIEWED_SALESFORCE_MODE || !HASH.test(review?.sourceTreeHash || '')
    || review.sourceTreeHash !== finalInventory.sourceTreeHash || review.manifestSha256 !== hash(manifestBytes)
    || !/^[a-f0-9]{40}$/u.test(review.baselineCommit || '')) failCoverage('Reviewed manifest/source/baseline binding is invalid.');
  const baselineMode = review.baselineMode || COMPLETE_DEPLOYMENT_BASELINE_MODE;
  if (![INVENTORY_BASELINE_MODE, COMPLETE_DEPLOYMENT_BASELINE_MODE].includes(baselineMode)
    || review.baselineSourceTreeHash !== baselineInventory.sourceTreeHash || review.baselineInventoryHash !== baselineInventory.inventoryHash) failCoverage('Unknown or mismatched baseline Git tree/inventory.');
  if (baselineMode === COMPLETE_DEPLOYMENT_BASELINE_MODE && (baselineWorkflow?.schemaVersion !== 2 || baselineWorkflow?.releaseMode !== 'schema-free-complete-owned-tree'
    || baselineWorkflow.sourceScope !== 'force-app/main/default' || baselineWorkflow.sourceTreeHash !== baselineInventory.sourceTreeHash)) failCoverage('Unknown or unverified complete-tree baseline.');
  if (baselineMode === INVENTORY_BASELINE_MODE && (baselineWorkflow || review.baselineWorkflowPath)) failCoverage('Read-only inventory baselines cannot claim complete-tree deployment proof.');
  const manifest = parseReviewedPackage(manifestBytes.toString('utf8'));
  const components = review.components;
  if (!Array.isArray(components) || !same(sorted(components.map(({ id }) => id)), manifest) || components.length !== manifest.length) failCoverage('Manifest component/dependency coverage is incomplete.');
  const coveredFiles = new Set();
  for (const component of components) {
    if (!same(sorted(component.files || []), componentFiles(component.id, finalInventory)) || !Array.isArray(component.dependsOn)) failCoverage(`Incorrect component file/dependency coverage for ${component.id}.`);
    for (const file of component.files) coveredFiles.add(file);
    for (const dependency of component.dependsOn) if (!manifest.includes(dependency)) failCoverage(`Dependency ${dependency} is absent from the reviewed manifest.`);
  }
  if (review.dependencyReview?.complete !== true || !String(review.dependencyReview.reviewer || '').trim()
    || !String(review.dependencyReview.evidence || '').trim()) failCoverage('An explicit complete dependency review is required.');
  const removed = Object.keys(baselineInventory.files).filter(name => !finalInventory.files[name]);
  if (removed.length || review.destructiveChanges?.length) failCoverage('Destructive metadata changes are unsupported by the incremental route.');
  const changed = Object.keys(finalInventory.files).filter(name => !same(finalInventory.files[name], baselineInventory.files[name]));
  if (!changed.length || changed.some(name => !coveredFiles.has(name))) failCoverage('Changed Salesforce files are missing manifest coverage.');
  const testPlan = review.testPlan;
  if (!['RunLocalTests', 'RunSpecifiedTests', 'RunRelevantTests'].includes(testPlan?.level)
    || !Number.isSafeInteger(testPlan.minimumTests) || testPlan.minimumTests < 1
    || !Array.isArray(testPlan.tests) || (testPlan.level === 'RunSpecifiedTests' && !testPlan.tests.length)
    || testPlan.tests.some(name => !/^[A-Za-z][A-Za-z0-9_]*$/u.test(name))) throw new Error('A reviewed positive test execution plan is required.');
  const permissions = review.permissionSets || [];
  if (!Array.isArray(permissions) || permissions.some(name => !manifest.includes(`PermissionSet:${name}`)) || permissions.length !== new Set(permissions).size) throw new Error('Permissions must be explicitly scoped to PermissionSet components in the manifest.');
  const bootstrap = review.bootstrap || null;
  if (bootstrap) {
    if (!bootstrapBytes || hash(bootstrapBytes) !== bootstrap.sha256 || !same(parseReviewedPackage(bootstrapBytes.toString('utf8')), sorted(bootstrap.components || []))
      || bootstrap.components.some(id => !manifest.includes(id) || !/^(CustomObject|CustomField|PermissionSet):/u.test(id))
      || !same(sorted(bootstrap.permissionSets || []), sorted(permissions.filter(name => bootstrap.components.includes(`PermissionSet:${name}`))))) throw new Error('Bootstrap must contain only reviewed schema/permission components from the main manifest.');
    if (testPlan.level !== 'RunLocalTests') throw new Error('A schema bootstrap requires one complete RunLocalTests validation per environment.');
  } else if (bootstrapBytes) throw new Error('Unreviewed bootstrap bytes supplied.');
  const baselineJobs = baselineMode === COMPLETE_DEPLOYMENT_BASELINE_MODE ? {} : null;
  for (const environment of baselineJobs ? policy.environments : []) {
    const record = baselineWorkflow.environments?.[environment.key];
    if (record?.orgId !== environment.orgId || record?.alias !== environment.alias || record?.isSandbox !== environment.isSandbox
      || record?.username !== (environment.username || null)) failCoverage(`Baseline ${environment.key} identity mismatch.`);
    for (const [operation, checkOnly] of [['validation', true], ['deployment', false]]) {
      const job = record[operation];
      if (!JOB_ID.test(job?.jobId || '') || job.status !== 'Succeeded' || job.checkOnly !== checkOnly || job.testLevel !== 'RunLocalTests'
        || job.sourceTreeHash !== baselineInventory.sourceTreeHash || job.releaseMode !== baselineWorkflow.releaseMode
        || job.deploymentScope !== baselineWorkflow.sourceScope || !Number.isFinite(Date.parse(job.completedAt))) failCoverage(`Baseline ${environment.key} ${operation} is not verified complete-tree evidence.`);
    }
    if (record.deployment.validationJobId !== record.validation.jobId) failCoverage(`Baseline ${environment.key} deployment is not bound to its validation.`);
    baselineJobs[environment.key] = { validationJobId: record.validation.jobId, deploymentJobId: record.deployment.jobId };
  }
  const binding = {
    releaseMode: REVIEWED_SALESFORCE_MODE, manifestSha256: hash(manifestBytes), reviewSha256: hash(review),
    bootstrapSha256: bootstrap ? hash(bootstrapBytes) : null, sourceTreeHash: finalInventory.sourceTreeHash,
    finalInventoryHash: finalInventory.inventoryHash, baselineSourceTreeHash: baselineInventory.sourceTreeHash,
    baselineInventoryHash: baselineInventory.inventoryHash, baselineCommit: review.baselineCommit,
    baselineMode, baselineJobs, configurationSha256: hash(policy), testPlan, permissionSets: permissions,
    orgIds: Object.fromEntries(policy.environments.map(({ key, orgId }) => [key, orgId])),
  };
  return { fingerprint: hash(binding), binding, review, manifest, changedFiles: changed, finalInventory, baselineInventory, baselineWorkflow };
}

export function assertReviewedJobReport(report, { environment, jobId, validation = false, testPlan, bootstrap = false, expectedComponents = [] }) {
  const proof = assertSuccessfulSalesforceReport(report, { environment, jobId, validation });
  if (!JOB_ID.test(jobId) || Number(report.numberComponentsDeployed) !== Number(report.numberComponentsTotal) || Number(report.numberComponentsTotal) < 1) throw new Error('Salesforce report did not prove all reviewed components deployed.');
  if (expectedComponents.length) {
    const successes = report.details?.componentSuccesses;
    const actual = new Set((Array.isArray(successes) ? successes : successes ? [successes] : []).filter(entry => entry.success === true)
      .map(entry => `${entry.componentType}:${entry.fullName}`));
    if (expectedComponents.some(id => !actual.has(id))) throw new Error('Actual Salesforce report is missing reviewed manifest component coverage.');
  }
  const total = Number(report.numberTestsTotal), completed = Number(report.numberTestsCompleted);
  const schemaBootstrap = bootstrap && !validation && expectedComponents.length > 0
    && expectedComponents.every(id => /^(CustomObject|CustomField|PermissionSet):/u.test(id))
    && testPlan.level === (environment.isSandbox ? 'NoTestRun' : 'RunRelevantTests');
  if (bootstrap && !schemaBootstrap) throw new Error('Zero-test bootstrap evidence requires the exact reviewed schema/permission intent and environment test level.');
  if (schemaBootstrap) {
    const successes = report.details?.componentSuccesses;
    if ((Array.isArray(successes) ? successes : [successes]).some(entry => !['CustomObject', 'CustomField', 'PermissionSet', 'Package'].includes(entry?.componentType))) throw new Error('Schema-only bootstrap report contains an unexpected non-schema component.');
    if (!Number.isSafeInteger(total) || total < 0 || completed !== total || (environment.isSandbox && total !== 0)) throw new Error('Schema bootstrap test counts do not match its reviewed test intent.');
  } else {
    if (!['RunLocalTests', 'RunSpecifiedTests', 'RunRelevantTests'].includes(testPlan.level)) throw new Error('NoTestRun is confined to reviewed sandbox schema bootstrap.');
    if (total < testPlan.minimumTests || completed !== total || !Number.isFinite(total)) throw new Error('Salesforce report did not prove the requested positive test execution.');
    if (testPlan.level === 'RunSpecifiedTests') {
      const successes = report.details?.runTestResult?.successes;
      const names = new Set((Array.isArray(successes) ? successes : successes ? [successes] : []).map(entry => entry.name));
      if (testPlan.tests.some(name => !names.has(name))) throw new Error('Specified Salesforce tests are absent from the actual successful report.');
    }
    if (report.details?.runTestResult?.codeCoverageWarnings?.length) throw new Error('Salesforce coverage warnings require review before promotion.');
  }
  return { ...proof, testPlan, apexTestProof: !schemaBootstrap, testExecution: schemaBootstrap ? 'schema-only-bootstrap' : 'verified-positive-apex-tests',
    reportSha256: hash(report), completedAt: report.completedDate || null };
}

export async function verifyReviewedOrgInventory({ provider, environment, plan, expected, now = () => new Date() }) {
  if (typeof provider.verifyInventory !== 'function') throw new Error('Current Salesforce org inventory verification is required; a historical successful deployment is not current baseline proof.');
  const receipt = await provider.verifyInventory(environment, { plan, expectedInventory: expected.files,
    expectedSourceTreeHash: expected.sourceTreeHash || null, expectedInventoryHash: expected.inventoryHash });
  const verifiedAt = Date.parse(receipt?.verifiedAt);
  if (receipt?.orgId !== environment.orgId || receipt?.sourceTreeHash !== (expected.sourceTreeHash || null)
    || receipt?.inventoryHash !== expected.inventoryHash || !HASH.test(receipt?.evidenceSha256 || '')
    || !(verifiedAt >= now().getTime() - 300000 && verifiedAt <= now().getTime() + 30000)) throw new Error('Current Salesforce org inventory receipt is absent, stale, or differs from the verified baseline/derived tree.');
  if (plan.binding.baselineMode === INVENTORY_BASELINE_MODE) {
    const identity = receipt.identity, files = receipt.observedInventory;
    const observed = files && typeof files === 'object' && !Array.isArray(files) ? Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([name, value]) => [name, { sha256: value?.sha256, size: value?.size }])) : null;
    if (receipt.verificationMethod !== 'metadata-api-owned-tree-inventory' || receipt.scope !== 'force-app/main/default'
      || identity?.alias !== environment.alias || identity?.orgId !== environment.orgId || identity?.isSandbox !== environment.isSandbox
      || identity?.connectedStatus !== 'Connected' || !String(identity?.username || '').trim() || (environment.username && identity.username !== environment.username)
      || !observed
      || !same(observed, expected.files) || hash(observed) !== expected.inventoryHash) throw new Error('Inventory baseline requires current native owned-tree file evidence and the pinned org identity; hashes or caller booleans alone are insufficient.');
  }
  return receipt;
}

export function reviewedCheckpointInventory(plan, stage = {}) {
  if (stage.deployment?.status === 'Succeeded') return plan.finalInventory;
  if (!plan.review.bootstrap || stage.bootstrap?.status !== 'Succeeded') return plan.baselineInventory;
  const files = new Set(plan.review.components.filter(({ id }) => plan.review.bootstrap.components.includes(id)).flatMap(({ files }) => files));
  const inventory = Object.fromEntries(Object.entries({ ...plan.baselineInventory.files,
    ...Object.fromEntries([...files].map(name => [name, plan.finalInventory.files[name]])) }).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  return { files: inventory, inventoryHash: hash(inventory) };
}

export function assertProductionAuthorization(authorization, plan, now = new Date()) {
  if (authorization?.productionMutation !== true || authorization.fingerprint !== plan.fingerprint
    || authorization.manifestSha256 !== plan.binding.manifestSha256 || authorization.sourceTreeHash !== plan.binding.sourceTreeHash
    || !same(authorization.orgIds, plan.binding.orgIds) || !String(authorization.authorizedBy || '').trim()
    || !String(authorization.evidence || '').trim() || !(Date.parse(authorization.expiresAt) > now.getTime())) throw new Error('Production mutation requires unexpired exact fingerprint/manifest/source/org authorization.');
  return hash(authorization);
}

function assertMirror(result, plan, policy, deploymentJobId) {
  const pr = result?.pullRequest;
  if (result?.releaseMode !== REVIEWED_SALESFORCE_MODE || result?.sourceTreeHash !== plan.binding.sourceTreeHash
    || result?.sourceEnvironment !== 'devee' || result?.sourceDeploymentJobId !== deploymentJobId
    || result?.repository !== policy.publication.repository || result?.account !== policy.publication.requiredAccount
    || pr?.state !== 'OPEN' || pr?.isDraft !== true || !Number.isSafeInteger(pr?.number) || pr.number < 1
    || pr.baseRefName !== policy.publication.defaultBranch || pr.headRefName !== result.branch
    || pr.headRefOid !== result.commit || !/^[a-f0-9]{40}$/u.test(result.commit || '')) throw new Error('Shared mirror must be byte-verified at the exact open draft PR head for the derived DEVEE source proof.');
  return result;
}

/**
 * Provider interface is intentionally injected for offline qualification. Each write requires
 * ownership.assert({fingerprint,stage,orgId,operation}) -> an unexpired concrete receipt;
 * journal.checkpoint({fingerprint,stage,operation,record}) is awaited after the fsynced local
 * journal and before submission. Local locks serialize this host only, never other machines.
 * An uncertain submission is reconciled by an owner-supplied job ID, never blind resubmission.
 */
export async function runReviewedSalesforceRelease({ plan, mode, policy, journal, provider, ownership, externalJournal,
  authorization = null, now = () => new Date(), assertUnchanged, replaceValidation = [], reconcile = {} }) {
  if (!['prepare', 'apply'].includes(mode)) throw new Error('Choose prepare or apply.');
  if (journal.state.fingerprint !== plan.fingerprint || !same(journal.state.binding, plan.binding)) throw new Error('Reviewed workflow fingerprint changed; prepare a new release from DEVEE.');
  const preparation = journal.state.stages.production?.preparation;
  if (mode === 'apply' && (preparation?.fingerprint !== plan.fingerprint || !['ready', 'awaiting-authorized-bootstrap'].includes(preparation?.status))) {
    throw new Error('Apply requires a successful prepare checkpoint for this exact unchanged reviewed fingerprint.');
  }
  if (typeof ownership?.assert !== 'function' || typeof externalJournal?.checkpoint !== 'function') throw new Error('Salesforce writes require external release ownership and a durable checkpoint adapter; a local lock is not global serialization.');
  const timestamp = () => now().toISOString();
  const persist = async (stage, operation, record) => {
    const saved = journal.update(stage, operation, record);
    await externalJournal.checkpoint({ fingerprint: plan.fingerprint, stage, operation, record: saved });
    return saved;
  };
  const get = (stage, operation) => journal.state.stages[stage]?.[operation];
  const unchanged = async () => { await assertUnchanged(); };
  const writeGate = async (environment, operation) => {
    await unchanged(); await provider.verifyIdentity(environment);
    const authHash = environment.key === 'production' && operation !== 'validation' ? assertProductionAuthorization(authorization, plan, now()) : null;
    const receipt = await ownership.assert({ fingerprint: plan.fingerprint, stage: environment.key, orgId: environment.orgId, operation });
    if (!receipt?.receiptId || receipt.fingerprint !== plan.fingerprint || receipt.orgId !== environment.orgId
      || receipt.stage !== environment.key || receipt.operation !== operation || !(Date.parse(receipt.expiresAt) > now().getTime())) throw new Error('External Salesforce release ownership receipt is absent, expired, or mismatched.');
    return { receiptId: receipt.receiptId, receiptExpiresAt: receipt.expiresAt, authorizationSha256: authHash };
  };
  const reportJob = async (environment, operation, record) => {
    await unchanged(); await provider.verifyIdentity(environment);
    const report = await provider.report(environment, record.jobId);
    const status = String(report?.status || 'Unknown');
    if (status !== 'Succeeded') {
      await persist(environment.key, operation, { ...record, status, verifiedAt: timestamp(), actualReportSha256: hash(report) });
      throw new Error(`${environment.label} ${operation} is ${status}; saved job must be reconciled before progression.`);
    }
    const proof = assertReviewedJobReport(report, {
      environment, jobId: record.jobId, validation: operation === 'validation',
      testPlan: operation === 'bootstrap' ? { level: environment.isSandbox ? 'NoTestRun' : 'RunRelevantTests', tests: [], minimumTests: 1 } : plan.binding.testPlan,
      bootstrap: operation === 'bootstrap', expectedComponents: operation === 'bootstrap' ? plan.review.bootstrap.components : plan.manifest,
    });
    await unchanged();
    return persist(environment.key, operation, { ...record, ...proof, status: 'Succeeded',
      completedAt: record.completedAt || proof.completedAt || timestamp(), verifiedAt: timestamp() });
  };
  async function job(environment, operation, submit, { validationJobId = null } = {}) {
    await unchanged();
    let record = get(environment.key, operation);
    if (record?.status === 'submitting' && !record.jobId) {
      const recoveredId = reconcile[`${environment.key}.${operation}`];
      if (!JOB_ID.test(recoveredId || '')) throw new Error(`${environment.label} ${operation} has an uncertain submission without an ID; owner readback/reconciliation is required. No duplicate was submitted.`);
      if (typeof provider.reconcile !== 'function') throw new Error('A recovered job requires provider source/test-plan readback before adoption.');
      const adoption = await provider.reconcile(environment, recoveredId, { plan, operation, submittedAt: record.submittedAt, validationJobId });
      if (adoption?.fingerprint !== plan.fingerprint || adoption?.orgId !== environment.orgId || adoption?.jobId !== recoveredId
        || adoption?.operation !== operation || adoption?.sourceTreeHash !== plan.binding.sourceTreeHash || adoption?.manifestSha256 !== plan.binding.manifestSha256
        || !HASH.test(adoption?.evidenceSha256 || '') || !(Date.parse(adoption?.verifiedAt) >= now().getTime() - 300000)) throw new Error('Recovered Salesforce job readback does not bind the reviewed source, org, operation, and manifest.');
      record = await persist(environment.key, operation, { ...record, jobId: recoveredId, status: 'Submitted', reconciledAt: timestamp() });
    }
    if (record?.jobId) {
      if (record.fingerprint !== plan.fingerprint || record.orgId !== environment.orgId || record.validationJobId !== validationJobId) throw new Error('Saved Salesforce job binding changed.');
      const replacement = operation === 'validation' && replaceValidation.includes(environment.key);
      if (replacement) {
        if (get(environment.key, 'deployment')) throw new Error('Cannot replace a validation after deployment submission.');
        const downstream = policy.environments.slice(policy.environments.indexOf(environment) + 1);
        if (downstream.some(next => Object.values(journal.state.stages[next.key] || {}).some(saved => saved?.jobId))) throw new Error('Validation replacement is permitted only at the current unfinished stage.');
        await provider.verifyIdentity(environment);
        const actual = await provider.report(environment, record.jobId);
        const expiredSuccess = actual.status === 'Succeeded' && Date.parse(actual.completedDate) + 10 * 86400000 <= now().getTime();
        if (!TERMINAL.has(actual.status) && !expiredSuccess) throw new Error('Replacement requires a confirmed failed/canceled/expired current-stage validation.');
        await persist(environment.key, operation, { ...record, status: expiredSuccess ? 'Expired' : actual.status, verifiedAt: timestamp(), actualReportSha256: hash(actual) });
      } else return reportJob(environment, operation, record);
    }
    const gate = await writeGate(environment, operation);
    const previous = get(environment.key, operation);
    const attempts = previous ? [...(previous.attempts || []), { ...previous, attempts: undefined }] : [];
    record = await persist(environment.key, operation, { fingerprint: plan.fingerprint, orgId: environment.orgId,
      status: 'submitting', jobId: null, validationJobId, submittedAt: timestamp(), attempts, ...gate });
    await unchanged();
    if (!(Date.parse(gate.receiptExpiresAt) > now().getTime())) throw new Error('Salesforce ownership expired while saving intent; reconcile the saved intent before retry.');
    if (environment.key === 'production' && operation !== 'validation') assertProductionAuthorization(authorization, plan, now());
    // Persist intent before calling the provider. A thrown/invalid response stays uncertain.
    const submitted = await submit();
    if (!JOB_ID.test(submitted?.id || '')) throw new Error('Salesforce submission returned no reusable job ID; owner readback/reconciliation is required.');
    record = await persist(environment.key, operation, { ...record, jobId: submitted.id, status: ACTIVE.has(submitted.status) ? submitted.status : 'Submitted' });
    return reportJob(environment, operation, record);
  }
  async function permissions(environment, names) {
    for (const name of names) {
      const operation = `permission:${name}`;
      let record = get(environment.key, operation);
      await unchanged(); await provider.verifyIdentity(environment);
      const assigned = await provider.permissionAssigned(environment, name);
      if (record?.status === 'Succeeded') {
        if (!assigned) throw new Error('A previously verified permission assignment drifted.');
        continue;
      }
      if (!record) record = await persist(environment.key, operation, { name, prestate: assigned, status: 'observed', orgId: environment.orgId });
      if (!assigned) {
        const gate = await writeGate(environment, operation);
        await persist(environment.key, operation, { ...record, status: 'submitting', ...gate });
        await unchanged();
        if (!(Date.parse(gate.receiptExpiresAt) > now().getTime())) throw new Error('Salesforce ownership expired before permission assignment.');
        if (environment.key === 'production') assertProductionAuthorization(authorization, plan, now());
        await provider.assignPermission(environment, name);
        if (!await provider.permissionAssigned(environment, name)) throw new Error('Permission assignment outcome is uncertain; reconcile before progression.');
      }
      await persist(environment.key, operation, { ...record, status: 'Succeeded', addedByRelease: !record.prestate, verifiedAt: timestamp() });
    }
  }
  async function mirror() {
    await unchanged();
    const deployment = get('devee', 'deployment');
    if (deployment?.status !== 'Succeeded') throw new Error('Verified DEVEE deployment is required before the complete derived source mirror.');
    const saved = get('shared_mirror', 'publication');
    const action = saved ? 'check' : 'publish';
    if (!saved) {
      const gate = await writeGate(policy.environments[0], 'shared-publication');
      await persist('shared_mirror', 'publication', { status: 'submitting', ...gate });
    }
    const result = assertMirror(await provider.mirror(action, { plan, journalFile: journal.file, deveeDeployment: deployment }), plan, policy, deployment.jobId);
    await unchanged();
    await persist('shared_mirror', 'publication', { ...saved, status: 'Succeeded', result, verifiedAt: timestamp() });
    return result;
  }
  try {
    // Complete deployment evidence remains distinct. Inventory baselines never reread historical jobs.
    for (const environment of policy.environments) {
      await provider.verifyIdentity(environment);
      const baseline = plan.binding.baselineJobs?.[environment.key];
      if (!baseline) continue;
      for (const [operation, id] of [['validation', baseline.validationJobId], ['deployment', baseline.deploymentJobId]]) {
        assertReviewedJobReport(await provider.report(environment, id), { environment, jobId: id, validation: operation === 'validation', testPlan: { level: 'RunLocalTests', tests: [], minimumTests: 1 } });
      }
    }
    if (plan.binding.baselineMode === INVENTORY_BASELINE_MODE) {
      // Verify EVERY org's actual current checkpoint before the first metadata/permission write.
      for (const environment of policy.environments) {
        const saved = journal.state.stages[environment.key] || {};
        for (const operation of ['bootstrap', 'deployment']) if (saved[operation] && saved[operation].status !== 'Succeeded') {
          await job(environment, operation, () => { throw new Error('Inventory preflight cannot submit an unresolved operation.'); },
            { validationJobId: operation === 'deployment' ? saved.validation?.jobId || null : null });
        }
        const receipt = await verifyReviewedOrgInventory({ provider, environment, plan, expected: reviewedCheckpointInventory(plan, journal.state.stages[environment.key]), now });
        await persist(environment.key, 'inventory-checkpoint', { baselineMode: INVENTORY_BASELINE_MODE, orgId: environment.orgId,
          inventoryHash: receipt.inventoryHash, sourceTreeHash: receipt.sourceTreeHash, verifiedAt: receipt.verifiedAt, evidenceSha256: receipt.evidenceSha256 });
      }
    }
    for (const environment of policy.environments) {
      if (environment.key !== 'devee') await mirror();
      const stage = journal.state.stages[environment.key] || {};
      // Successful upstream jobs are reattested, preserving original completedAt and IDs.
      if (stage.deployment) {
        if (!stage.validation) throw new Error('Deployment lacks its saved successful validation.');
        const validation = await job(environment, 'validation', () => provider.validate(environment, plan));
        await job(environment, 'deployment', () => provider.deploy(environment, validation.jobId, plan), { validationJobId: validation.jobId });
        await verifyReviewedOrgInventory({ provider, environment, plan, expected: plan.finalInventory, now });
        await permissions(environment, plan.binding.permissionSets);
        continue;
      }
      if (environment.key === 'production' && mode === 'prepare' && plan.review.bootstrap && stage.bootstrap?.status !== 'Succeeded') {
        await verifyReviewedOrgInventory({ provider, environment, plan, expected: plan.baselineInventory, now });
        await persist('production', 'preparation', { status: 'awaiting-authorized-bootstrap', fingerprint: plan.fingerprint });
        return { mode: 'prepared', productionValidation: 'deferred-until-authorized-bootstrap', fingerprint: plan.fingerprint, journal: journal.file };
      }
      let predeploymentInventory = plan.baselineInventory;
      if (plan.review.bootstrap) {
        if (!stage.bootstrap) await verifyReviewedOrgInventory({ provider, environment, plan, expected: plan.baselineInventory, now });
        await job(environment, 'bootstrap', () => provider.bootstrap(environment, plan));
        predeploymentInventory = reviewedCheckpointInventory(plan, journal.state.stages[environment.key]);
        await verifyReviewedOrgInventory({ provider, environment, plan, expected: predeploymentInventory, now });
        await permissions(environment, plan.review.bootstrap.permissionSets || []);
      } else await verifyReviewedOrgInventory({ provider, environment, plan, expected: plan.baselineInventory, now });
      const validation = await job(environment, 'validation', () => provider.validate(environment, plan));
      if (environment.key === 'production' && mode === 'prepare') {
        await persist('production', 'preparation', { status: 'ready', fingerprint: plan.fingerprint, validationJobId: validation.jobId });
        return { mode: 'prepared', productionValidation: 'Succeeded', fingerprint: plan.fingerprint, journal: journal.file };
      }
      // Validation may run for hours; refresh unchanged metadata before consuming its job.
      await verifyReviewedOrgInventory({ provider, environment, plan, expected: predeploymentInventory, now });
      await job(environment, 'deployment', () => provider.deploy(environment, validation.jobId, plan), { validationJobId: validation.jobId });
      await verifyReviewedOrgInventory({ provider, environment, plan, expected: plan.finalInventory, now });
      await permissions(environment, plan.binding.permissionSets);
    }
    await mirror();
    return { mode: 'applied', fingerprint: plan.fingerprint, journal: journal.file };
  } catch (error) {
    // This is a reviewable restoration checkpoint, not a destructive automatic rollback.
    const restoration = [...policy.environments].reverse().filter(environment => get(environment.key, 'deployment') || get(environment.key, 'bootstrap'))
      .map(environment => ({ environment: environment.key, orgId: environment.orgId, baseline: plan.binding.baselineJobs?.[environment.key]
        || { mode: INVENTORY_BASELINE_MODE, commit: plan.binding.baselineCommit, sourceTreeHash: plan.binding.baselineSourceTreeHash, inventoryHash: plan.binding.baselineInventoryHash },
        metadata: 'Stop promotion; review all-or-none restoration of the known baseline through the required DEVEE/shared/QAT/Production controls.',
        permissions: plan.binding.permissionSets.filter(name => get(environment.key, `permission:${name}`)?.prestate === false) }));
    try { await persist('production', 'restoration-checkpoint', { status: 'review-required', fingerprint: plan.fingerprint, reverseOrder: restoration }); }
    catch { /* The already-fsynced local state remains authoritative if external journaling failed. */ }
    throw error;
  }
}
