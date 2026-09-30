import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import test from 'node:test';
import { xeroPortalReceiptCreate, xeroPortalReceiptUploadPrepare, signXeroOAuthState } from '../api/_xeroPortal.js';
import { saveReceiptWithDirectUpload } from '../src/lib/xeroReceiptUpload.js';
import { setClientSessionOwner } from '../src/lib/clientSessionState.js';
import { validateFunctionRequest } from '../shared/functionContracts.js';

const MAX = 10 * 1024 * 1024;
const NOW = Date.parse('2026-09-30T09:00:00Z');
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ENV = { XERO_OAUTH_STATE_SECRET: 'receipt-test-secret', FCOS_ENABLE_XERO_CONTACT_SYNC: 'false' };
const FIELDS = { merchant: 'Receipt supplier', date: '2026-09-30', total: 123.45, currency: 'HKD', note: 'Reviewed receipt' };
const pdf = (size = 64) => { const bytes = Buffer.alloc(size, 32); bytes.write('%PDF-1.7'); return bytes; };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const metadata = (bytes, overrides = {}) => ({ fileName: 'receipt.pdf', fileType: 'application/pdf', size: bytes.length, sha256: hash(bytes), ...overrides });
const options = (client, overrides = {}) => ({ client, accessContext: { profile: { id: OWNER, email: 'owner@example.test' } }, env: ENV, now: NOW, ...overrides });
const code = (expected) => (error) => error.code === expected;

function storageFixture() {
  const rows = new Map();
  const objects = new Map();
  const counts = { sign: 0, info: 0, download: 0, insert: 0, update: 0 };
  let signedPath;
  const fixture = {
    rows, objects, counts, bucket: { public: false, file_size_limit: MAX },
    storage: {
      async getBucket(bucket) { assert.equal(bucket, 'xero-portal-receipts'); return { data: fixture.bucket }; },
      from(bucket) {
        assert.equal(bucket, 'xero-portal-receipts');
        return {
          async createSignedUploadUrl(path, options) {
            counts.sign += 1;
            assert.deepEqual(options, { upsert: false });
            signedPath = path;
            return { data: { signedUrl: 'https://storage.example.test/object/upload/sign/' + path + '?token=upload-token', path } };
          },
          async info(path) {
            counts.info += 1;
            const object = objects.get(path);
            return object ? { data: { size: object.infoSize ?? object.bytes.length, contentType: object.type } } : { error: { status: 404 } };
          },
          async download(path) {
            counts.download += 1;
            const object = objects.get(path);
            return object ? { data: new Blob([object.bytes], { type: object.type }) } : { error: { status: 404 } };
          },
        };
      },
    },
    from(table) {
      assert.equal(table, 'xero_portal_receipts');
      let id;
      let inserted;
      const query = {
        select() { return query; },
        eq(column, value) { assert.equal(column, 'id'); id = value; return query; },
        insert(row) { inserted = structuredClone(row); return query; },
        async maybeSingle() { return { data: rows.get(id) || null }; },
        async single() {
          counts.insert += 1;
          if (rows.has(inserted.id)) return { error: { code: '23505' } };
          rows.set(inserted.id, inserted);
          return { data: inserted };
        },
      };
      return query;
    },
    put(bytes, type = 'application/pdf', infoSize) { objects.set(signedPath, { bytes, type, infoSize }); },
    get path() { return signedPath; },
  };
  return fixture;
}

async function prepare(client, bytes = pdf(), overrides = {}) {
  const result = await xeroPortalReceiptUploadPrepare({ fields: FIELDS, file: metadata(bytes), ...overrides }, options(client));
  return { uploadTicket: result.upload.uploadTicket, fields: result.upload.fields };
}

test('receipt contracts accept 10 MiB metadata and reject legacy bytes or arbitrary paths', () => {
  const request = { fields: FIELDS, file: metadata(pdf(MAX)) };
  assert.equal(validateFunctionRequest('xeroPortalReceiptUploadPrepare', request).ok, true);
  for (const size of [0, -1, MAX + 1, '100']) {
    assert.equal(validateFunctionRequest('xeroPortalReceiptUploadPrepare', { ...request, file: { ...request.file, size } }).ok, false);
  }
  assert.equal(validateFunctionRequest('xeroPortalReceiptUploadPrepare', { ...request, file: { ...request.file, base64: 'payload' } }).ok, false);
  assert.equal(validateFunctionRequest('xeroPortalReceiptCreate', { uploadTicket: 'ticket', fields: FIELDS }).ok, true);
  for (const property of ['file', 'id', 'bucket', 'path', 'autoSync']) {
    assert.equal(validateFunctionRequest('xeroPortalReceiptCreate', { uploadTicket: 'ticket', fields: FIELDS, [property]: 'tamper' }).ok, false);
  }
});

test('prepare binds exact owner, immutable path and content metadata without writing a receipt', async () => {
  const client = storageFixture();
  const body = await prepare(client);
  const ticket = JSON.parse(Buffer.from(body.uploadTicket.split('.')[0], 'base64url'));
  assert.equal(ticket.ownerId, OWNER);
  assert.equal(ticket.path, client.path);
  assert.match(ticket.path, new RegExp(`^direct/${OWNER}/[a-f0-9-]{36}/receipt.pdf$`));
  assert.equal(ticket.file.sha256, hash(pdf()));
  assert.equal(ticket.autoSync, false);
  assert.equal(ticket.expiresAt - ticket.issuedAt, 7200000);
  assert.equal(client.rows.size, 0);
});

test('prepare rejects missing identity, oversized/empty files, MIME and unsafe bucket drift', async () => {
  const client = storageFixture();
  const body = { fields: FIELDS, file: metadata(pdf()) };
  await assert.rejects(xeroPortalReceiptUploadPrepare(body, options(client, { accessContext: null })), code('XERO_PORTAL_RECEIPT_UPLOAD_OWNER_REQUIRED'));
  for (const size of [0, -1, 1.5, '64']) {
    await assert.rejects(xeroPortalReceiptUploadPrepare({ ...body, file: { ...body.file, size } }, options(client)), code('XERO_PORTAL_RECEIPT_FILE_INVALID'));
  }
  await assert.rejects(xeroPortalReceiptUploadPrepare({ ...body, file: { ...body.file, size: MAX + 1 } }, options(client)), code('XERO_PORTAL_RECEIPT_FILE_TOO_LARGE'));
  await assert.rejects(xeroPortalReceiptUploadPrepare({ ...body, file: { ...body.file, fileType: 'text/html' } }, options(client)), code('XERO_PORTAL_RECEIPT_FILE_TYPE_INVALID'));
  client.bucket.public = true;
  await assert.rejects(prepare(client), code('XERO_PORTAL_RECEIPT_STORAGE_INVALID'));
  client.bucket = { public: false, file_size_limit: MAX + 1 };
  await assert.rejects(prepare(client), code('XERO_PORTAL_RECEIPT_STORAGE_INVALID'));
  assert.equal(client.counts.sign, 0);
});

test('10 MiB receipt verifies actual bytes and saves exactly once across concurrent completion and replay', async () => {
  const client = storageFixture();
  const bytes = pdf(MAX);
  const body = await prepare(client, bytes);
  client.put(bytes);
  const results = await Promise.all([xeroPortalReceiptCreate(body, options(client)), xeroPortalReceiptCreate(body, options(client))]);
  assert.equal(client.rows.size, 1);
  assert.equal(results[0].receipt.id, results[1].receipt.id);
  assert.equal(results[0].receipt.fileSizeBytes, MAX);
  assert.equal(results.filter((r) => r.replayed).length, 1);
  const downloaded = client.counts.download;
  const replay = await xeroPortalReceiptCreate(body, options(client, { now: NOW + 7200000 }));
  assert.equal(replay.replayed, true);
  assert.equal(client.counts.download, downloaded);
  assert.equal(client.counts.update, 0);
});

test('completion rejects another owner, missing auth, ticket/path/financial intent tampering, and OAuth token confusion', async () => {
  const client = storageFixture();
  const body = await prepare(client);
  await assert.rejects(xeroPortalReceiptCreate(body, options(client, { accessContext: { profile: { id: OTHER } } })), code('XERO_PORTAL_RECEIPT_UPLOAD_INVALID'));
  await assert.rejects(xeroPortalReceiptCreate(body, options(client, { accessContext: null })), code('XERO_PORTAL_RECEIPT_UPLOAD_OWNER_REQUIRED'));
  const [encoded, signature] = body.uploadTicket.split('.');
  const ticket = JSON.parse(Buffer.from(encoded, 'base64url'));
  for (const patch of [{ path: 'another-user/receipt.pdf' }, { autoSync: true }, { ownerId: OTHER }, { expiresAt: NOW + 99999999 }]) {
    const altered = Buffer.from(JSON.stringify({ ...ticket, ...patch })).toString('base64url') + '.' + signature;
    await assert.rejects(xeroPortalReceiptCreate({ ...body, uploadTicket: altered }, options(client)), code('XERO_PORTAL_RECEIPT_UPLOAD_INVALID'));
  }
  await assert.rejects(xeroPortalReceiptCreate({ ...body, uploadTicket: signXeroOAuthState(ticket, ENV) }, options(client)), code('XERO_PORTAL_RECEIPT_UPLOAD_INVALID'));
  await assert.rejects(xeroPortalReceiptCreate({ ...body, fields: { ...body.fields, total: 999 } }, options(client)), code('XERO_PORTAL_RECEIPT_UPLOAD_CHANGED'));
  await assert.rejects(xeroPortalReceiptCreate({ ...body, autoSync: true }, options(client)), code('XERO_PORTAL_RECEIPT_DIRECT_UPLOAD_REQUIRED'));
  assert.equal(client.counts.info, 0);
  assert.equal(client.rows.size, 0);
});

test('expired or future tickets cannot create records and missing uploads cannot create draft bills', async () => {
  const client = storageFixture();
  const body = await prepare(client, pdf(), { autoSync: true });
  for (const now of [NOW - 1, NOW + 7200000]) {
    await assert.rejects(xeroPortalReceiptCreate(body, options(client, { now })), code('XERO_PORTAL_RECEIPT_UPLOAD_EXPIRED'));
  }
  await assert.rejects(xeroPortalReceiptCreate(body, options(client)), code('XERO_PORTAL_RECEIPT_UPLOAD_INCOMPLETE'));
  assert.equal(client.rows.size, 0);
});

test('completion checks actual length, stored MIME, file signature and SHA-256 before insert', async () => {
  const client = storageFixture();
  const bytes = pdf();
  const body = await prepare(client, bytes);
  for (const invalid of [
    { bytes: pdf(65), type: 'application/pdf' },
    { bytes, type: 'text/html' },
    { bytes: Buffer.alloc(64), type: 'application/pdf' },
    { bytes: Buffer.concat([bytes.subarray(0, 63), Buffer.from('x')]), type: 'application/pdf' },
    { bytes: pdf(65), type: 'application/pdf', infoSize: 64 },
  ]) {
    client.put(invalid.bytes, invalid.type, invalid.infoSize);
    await assert.rejects(xeroPortalReceiptCreate(body, options(client)), code('XERO_PORTAL_RECEIPT_UPLOAD_MISMATCH'));
  }
  assert.equal(client.rows.size, 0);
});

test('stored receipt identity/fields remain immutable on replay', async () => {
  const client = storageFixture();
  const body = await prepare(client);
  client.put(pdf());
  const first = await xeroPortalReceiptCreate(body, options(client));
  const row = client.rows.get(first.receipt.id);
  for (const key of ['storage_path', 'created_by', 'merchant', 'auto_synced']) {
    const original = row[key];
    row[key] = key === 'auto_synced' ? true : 'changed';
    await assert.rejects(xeroPortalReceiptCreate(body, options(client)), code('XERO_PORTAL_RECEIPT_UPLOAD_REPLAY_MISMATCH'));
    row[key] = original;
  }
});

test('original financial gate is enforced; a saved receipt replay never repeats auto-sync', async () => {
  const client = storageFixture();
  const body = await prepare(client, pdf(), { autoSync: true });
  client.put(pdf());
  await assert.rejects(xeroPortalReceiptCreate(body, options(client)), code('EXTERNAL_ACTION_GATE_DISABLED'));
  assert.equal(client.rows.size, 1);
  const replay = await xeroPortalReceiptCreate(body, options(client));
  assert.equal(replay.replayed, true);
  assert.equal(replay.receipt.status, 'draft');
  assert.equal(replay.receipt.autoSynced, true);
});

function clientTransport() {
  setClientSessionOwner(OWNER);
  const client = storageFixture();
  const calls = [];
  const uploads = [];
  const pending = { current: null };
  let loseCompletion = false;
  let loseUpload = false;
  return {
    client, calls, uploads, pending,
    loseNextCompletion() { loseCompletion = true; },
    loseNextUpload() { loseUpload = true; },
    deps: {
      cryptoImpl: webcrypto,
      now: () => NOW,
      async invoke(name, body) {
        calls.push({ name, body });
        if (name === 'xeroPortalReceiptUploadPrepare') return { data: await xeroPortalReceiptUploadPrepare(body, options(client)) };
        assert.equal(name, 'xeroPortalReceiptCreate');
        const data = await xeroPortalReceiptCreate(body, options(client));
        if (loseCompletion) { loseCompletion = false; throw new Error('Connection lost after saving'); }
        return { data };
      },
      async fetchImpl(url, init) {
        uploads.push({ url, init });
        if (client.objects.has(client.path)) return new Response(JSON.stringify({ error: 'Duplicate' }), { status: 400 });
        client.put(Buffer.from(await init.body.arrayBuffer()), init.headers['Content-Type']);
        if (loseUpload) { loseUpload = false; throw new Error('Connection lost after upload'); }
        return new Response('{}', { status: 200 });
      },
    },
  };
}

test('browser transport sends full 10 MiB only to Storage; JSON contains no receipt bytes', async () => {
  const fixture = clientTransport();
  const file = new File([pdf(MAX)], 'receipt.pdf', { type: 'application/pdf' });
  const result = await saveReceiptWithDirectUpload({ file, fields: FIELDS, pending: fixture.pending }, fixture.deps);
  assert.equal(result.data.receipt.fileSizeBytes, MAX);
  assert.equal(fixture.uploads.length, 1);
  assert.equal(fixture.uploads[0].init.body, file);
  assert.equal(fixture.uploads[0].init.credentials, 'omit');
  assert.equal(fixture.uploads[0].init.headers['x-upsert'], 'false');
  assert.ok(fixture.calls.every((call) => JSON.stringify(call.body).length < 4096));
  assert.ok(fixture.calls.every((call) => !JSON.stringify(call.body).includes('base64')));
  assert.equal(fixture.pending.current, null);
});

test('lost completion response retries same ticket and never reuploads or creates a second receipt', async () => {
  const fixture = clientTransport();
  const file = new File([pdf()], 'receipt.pdf', { type: 'application/pdf' });
  const request = { file, fields: FIELDS, pending: fixture.pending };
  fixture.loseNextCompletion();
  await assert.rejects(saveReceiptWithDirectUpload(request, fixture.deps), /Connection lost/);
  await assert.rejects(saveReceiptWithDirectUpload({ ...request, autoSync: true }, fixture.deps), /previous save may have completed/);
  const result = await saveReceiptWithDirectUpload(request, fixture.deps);
  assert.equal(result.data.replayed, true);
  assert.equal(fixture.calls.filter((c) => c.name === 'xeroPortalReceiptUploadPrepare').length, 1);
  const completions = fixture.calls.filter((c) => c.name === 'xeroPortalReceiptCreate');
  assert.equal(completions[0].body.uploadTicket, completions[1].body.uploadTicket);
  assert.equal(fixture.uploads.length, 1);
  assert.equal(fixture.client.rows.size, 1);
});

test('lost upload response accepts only an immutable duplicate then verifies bytes on completion', async () => {
  const fixture = clientTransport();
  const request = { file: new File([pdf()], 'receipt.pdf', { type: 'application/pdf' }), fields: FIELDS, pending: fixture.pending };
  fixture.loseNextUpload();
  await assert.rejects(saveReceiptWithDirectUpload(request, fixture.deps), /Connection lost/);
  const result = await saveReceiptWithDirectUpload(request, fixture.deps);
  assert.equal(result.data.receipt.status, 'draft');
  assert.equal(fixture.uploads.length, 2);
  assert.equal(fixture.calls.filter((c) => c.name === 'xeroPortalReceiptUploadPrepare').length, 1);
  assert.equal(fixture.client.counts.download, 1);
});

test('account change during upload prevents completion under a different session', async () => {
  const fixture = clientTransport();
  const fetchImpl = fixture.deps.fetchImpl;
  fixture.deps.fetchImpl = async (...args) => { const result = await fetchImpl(...args); setClientSessionOwner(OTHER); return result; };
  await assert.rejects(saveReceiptWithDirectUpload({ file: new File([pdf()], 'receipt.pdf', { type: 'application/pdf' }), fields: FIELDS, pending: fixture.pending }, fixture.deps), /account changed/);
  assert.equal(fixture.calls.filter((c) => c.name === 'xeroPortalReceiptCreate').length, 0);
  assert.equal(fixture.client.rows.size, 0);
});


test('all supported image signatures complete and path-only filenames remain safe basenames', async () => {
  const samples = [
    ['image/jpeg', Buffer.from([255, 216, 255, 224, 0, 16])],
    ['image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])],
    ['image/webp', Buffer.from('RIFF0000WEBPsample')],
  ];
  for (const [fileType, bytes] of samples) {
    const client = storageFixture();
    const body = await prepare(client, bytes, { file: metadata(bytes, { fileName: '..', fileType }) });
    assert.equal(client.path.split('/').at(-1), 'receipt');
    client.put(bytes, fileType);
    const result = await xeroPortalReceiptCreate(body, options(client));
    assert.equal(result.receipt.fileType, fileType);
  }
});

test('browser rejects unsupported and oversized files before preparing a capability', async () => {
  const fixture = clientTransport();
  for (const file of [new File(['<html>'], 'receipt.html', { type: 'text/html' }), new File([], 'receipt.pdf', { type: 'application/pdf' }), { size: MAX + 1 }]) {
    await assert.rejects(saveReceiptWithDirectUpload({ file, fields: FIELDS, pending: fixture.pending }, fixture.deps));
  }
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.uploads.length, 0);
});


test('an expired upload with no completion attempt can safely get a fresh capability', async () => {
  const fixture = clientTransport();
  const request = { file: new File([pdf()], 'receipt.pdf', { type: 'application/pdf' }), fields: FIELDS, pending: fixture.pending };
  fixture.loseNextUpload();
  await assert.rejects(saveReceiptWithDirectUpload(request, fixture.deps), /Connection lost/);
  const originalTicket = fixture.pending.current.uploadTicket;
  fixture.deps.now = () => NOW + 7200000;
  const result = await saveReceiptWithDirectUpload(request, fixture.deps);
  assert.equal(result.data.receipt.status, 'draft');
  const preparations = fixture.calls.filter((c) => c.name === 'xeroPortalReceiptUploadPrepare');
  const completion = fixture.calls.find((c) => c.name === 'xeroPortalReceiptCreate');
  assert.equal(preparations.length, 2);
  assert.notEqual(completion.body.uploadTicket, originalTicket);
  assert.equal(fixture.client.rows.size, 1);
});
