// A serialized, fail-closed boundary for an already-authorized provider call.
// It owns coordination only; its caller retains provider and business authority.
export async function runGuardedProviderWrite({ expected, claim, assertLease, recordIntent, submit, recordOutcome, validateProviderResult }) {
  const fail = message => { throw new Error(`Guarded provider write refused: ${message}`); };
  const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
  const exactKeys = (value, keys) => plainObject(value) && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
  const nonEmpty = value => typeof value === 'string' && value.length > 0;
  const boundedIdentifier = value => nonEmpty(value) && value.length <= 128 && value.trim() === value && !/\s/.test(value);
  const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const uuid = value => typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
  const expectedKeys = ['epoch', 'objective', 'ownerThreadId', 'operationId', 'bindingSha256'];
  if (!exactKeys(expected, expectedKeys) || !boundedIdentifier(expected.epoch)
    || !nonEmpty(expected.objective) || !nonEmpty(expected.ownerThreadId) || !nonEmpty(expected.operationId)
    || !sha256(expected.bindingSha256)) fail('invalid expected lease binding');
  for (const callback of [claim, assertLease, recordIntent, submit, recordOutcome, validateProviderResult]) {
    if (typeof callback !== 'function') fail('missing required callback');
  }

  const copy = value => JSON.parse(JSON.stringify(value));
  const frozenExpected = Object.freeze(copy(expected));
  const leaseKeys = [...expectedKeys, 'leaseId', 'coordinationOnly', 'providerAuthorityGranted', 'uncertainOutcomeRequiresReadback'];
  const sameExpected = lease => expectedKeys.every(key => lease[key] === frozenExpected[key]);
  const sameLease = (left, right) => leaseKeys.every(key => left[key] === right[key]);
  const validLease = lease => exactKeys(lease, leaseKeys) && sameExpected(lease) && uuid(lease.leaseId)
    && lease.coordinationOnly === true && lease.providerAuthorityGranted === false
    && lease.uncertainOutcomeRequiresReadback === true;
  const completedCommand = result => plainObject(result) && result.exit_code === 0 && typeof result.output === 'string'
    && !Object.hasOwn(result, 'session_id') && !Object.hasOwn(result, 'isError')
    && (result.error === undefined || result.error === null || result.error === false)
    && (result.signal === undefined || result.signal === null || result.signal === false);
  const parsedCommand = (result, phase) => {
    if (!completedCommand(result)) fail(`${phase} command did not complete successfully`);
    try { return JSON.parse(result.output); } catch { fail(`${phase} command did not return JSON`); }
  };
  const claimLease = result => {
    const lease = parsedCommand(result, 'claim');
    if (!validLease(lease)) fail('claim returned a mismatched lease');
    return Object.freeze(copy(lease));
  };
  const assertSameLease = (result, phase, lease) => {
    const asserted = parsedCommand(result, phase);
    if (!validLease(asserted) || !sameLease(asserted, lease)) fail(`${phase} did not confirm the held lease`);
  };
  const receipt = (result, phase, lease, state) => {
    const value = parsedCommand(result, phase);
    if (!exactKeys(value, ['lease', 'state', 'durable']) || value.state !== state || value.durable !== true
      || !validLease(value.lease) || !sameLease(value.lease, lease)) fail(`${phase} did not record a durable ${state} receipt`);
    return Object.freeze(copy(value));
  };
  const commandSuccess = value => completedCommand(value);
  const mcpSuccess = value => plainObject(value) && value.isError === false && !Object.hasOwn(value, 'session_id')
    && (value.error === undefined || value.error === null || value.error === false)
    && (value.signal === undefined || value.signal === null || value.signal === false)
    && (value.exit_code === undefined || value.exit_code === 0) && Array.isArray(value.content)
    && value.content.length > 0 && value.content.every(item => plainObject(item))
    && value.content.some(item => (typeof item.text === 'string' && item.text.trim().length > 0)
      || (item.type === 'resource' && item.resource !== null && typeof item.resource === 'object'));
  const providerSucceeded = value => (commandSuccess(value) || mcpSuccess(value)) && validateProviderResult(value) === true;
  const callGuard = async (callback, input, phase) => {
    try { return await callback(input); } catch { fail(`${phase} callback failed`); }
  };

  const lease = claimLease(await callGuard(claim, frozenExpected, 'claim'));
  assertSameLease(await callGuard(assertLease, Object.freeze({ expected: frozenExpected, lease }), 'initial assertion'), 'initial assertion', lease);
  receipt(await callGuard(recordIntent, Object.freeze({ expected: frozenExpected, lease, phase: 'prepared' }), 'prepared intent'), 'prepared intent', lease, 'prepared');
  assertSameLease(await callGuard(assertLease, Object.freeze({ expected: frozenExpected, lease }), 'post-prepared assertion'), 'post-prepared assertion', lease);
  receipt(await callGuard(recordIntent, Object.freeze({ expected: frozenExpected, lease, phase: 'submitting' }), 'submitting intent'), 'submitting intent', lease, 'submitting');
  assertSameLease(await callGuard(assertLease, Object.freeze({ expected: frozenExpected, lease }), 'final assertion'), 'final assertion', lease);

  let providerResult;
  let outcomeReason;
  try {
    providerResult = await submit(Object.freeze({ expected: frozenExpected, lease }));
    if (providerSucceeded(providerResult)) {
      try {
        receipt(await recordOutcome(Object.freeze({ expected: frozenExpected, lease,
          outcome: Object.freeze({ state: 'submitted', reason: 'provider_acknowledged' }) })), 'submitted outcome', lease, 'submitted');
        return { status: 'submitted_acknowledged', providerResult, lease: copy(lease) };
      } catch {
        return { status: 'uncertain_outcome_recording_failed', providerResult, lease: copy(lease) };
      }
    }
    outcomeReason = 'provider_result_unconfirmed';
  } catch {
    providerResult = undefined;
    outcomeReason = 'provider_exception';
  }
  const outcome = Object.freeze({ state: 'uncertain', reason: outcomeReason });
  try {
    receipt(await recordOutcome(Object.freeze({ expected: frozenExpected, lease, outcome })), 'uncertain outcome', lease, 'uncertain');
    return { status: 'uncertain_outcome_recorded', providerResult, lease: copy(lease) };
  } catch {
    return { status: 'uncertain_outcome_recording_failed', providerResult, lease: copy(lease) };
  }
}
