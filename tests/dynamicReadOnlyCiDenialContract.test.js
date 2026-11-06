import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { FCOS_CONNECTION_POLICY } from '../config/fcosConnections.js';

let networkCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  networkCalls += 1;
  throw new Error('Unexpected provider request in the local CI-denial fixture.');
};
after(() => { globalThis.fetch = originalFetch; });
const { default: handler } = await import('../api/functions/[name].js');
const canonicalHost = new URL(FCOS_CONNECTION_POLICY.attestation.endpoint).hostname;

async function invoke({ flag, host = 'fcos-ci-denial-fixture.vercel.app', name = 'adminUserSave', deployment = 'production' }) {
  const previous = { VERCEL: process.env.VERCEL, VERCEL_ENV: process.env.VERCEL_ENV, FCOS_ENABLE_READ_ONLY_CI: process.env.FCOS_ENABLE_READ_ONLY_CI };
  let bodyReads = 0;
  const headers = new Map();
  const req = {
    method: 'POST', url: `/api/functions/${name}`, headers: { host },
    get body() { bodyReads += 1; throw new Error('A pre-authentication refusal must not parse the body.'); },
    async *[Symbol.asyncIterator]() { bodyReads += 1; throw new Error('A pre-authentication refusal must not read the body stream.'); },
  };
  const res = { statusCode: 200, setHeader(key, value) { headers.set(key.toLowerCase(), value); }, end(value) { this.body = JSON.parse(value); } };
  try {
    process.env.VERCEL = '1'; process.env.VERCEL_ENV = deployment;
    if (flag === undefined) delete process.env.FCOS_ENABLE_READ_ONLY_CI;
    else process.env.FCOS_ENABLE_READ_ONLY_CI = flag;
    await handler(req, res);
    // No bearer is present: reaching the real authentication boundary yields
    // 401 (checked below), whereas fixed mutations must stop first with 403.
    assert.equal(bodyReads, 0);
    assert.equal(networkCalls, 0);
    return { res, headers };
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test('literal CI mode retains the denial contract on a Production-runtime staging hostname before authentication, parsing and handler execution', async () => {
  for (const name of ['adminUserSave', 'variableChargesBuyerConfirm', 'hedgePhysicalSalesforceApply', 'workspacePreferencesSave']) {
    const { res, headers } = await invoke({ flag: 'true', name });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'FCOS_CI_READ_ONLY');
    assert.equal(headers.get('x-fcos-handler-mutation'), '1');
  }
});

test('Preview retains the same literal-CI denial compatibility without permitting dispatch', async () => {
  for (const flag of [undefined, 'true']) {
    const { res } = await invoke({ flag, deployment: 'preview' });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, flag === 'true' ? 'FCOS_CI_READ_ONLY' : 'FCOS_DEPLOYMENT_READ_ONLY');
  }
});

test('nonliteral CI flags preserve the staged deployment denial code', async () => {
  for (const flag of [undefined, 'false', 'TRUE', ' true', 'true ']) {
    const { res } = await invoke({ flag });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'FCOS_DEPLOYMENT_READ_ONLY');
  }
});

test('explicit CI mode also preserves the denial in Production without changing ordinary Production authentication', async () => {
  const ci = await invoke({ flag: 'true', host: canonicalHost, deployment: 'production' });
  assert.equal(ci.res.statusCode, 403);
  assert.equal(ci.res.body.code, 'FCOS_CI_READ_ONLY');
  const ordinary = await invoke({ host: canonicalHost, deployment: 'production' });
  assert.equal(ordinary.res.statusCode, 401);
  assert.notEqual(ordinary.res.body.code, 'FCOS_CI_READ_ONLY');
});

test('the compatibility code does not replace authentication or identity checks on authContext', async () => {
  const { res, headers } = await invoke({ flag: 'true', name: 'authContext' });
  assert.equal(res.statusCode, 401);
  assert.notEqual(res.body.code, 'FCOS_CI_READ_ONLY');
  assert.equal(headers.get('x-fcos-handler-mutation'), '0');
});
