import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  documentPreviewKind,
  fetchAuthenticatedDocument,
  isSalesforceDocumentDownloadUrl,
  salesforceDocumentDownloadUrl,
} from '../src/lib/authenticatedDownloadUrl.js';

const origin = 'https://fcos.example.test';
const downloadPath = '/api/functions/salesforceDocumentDownload?kind=contentVersion&id=068xx&filename=advice.pdf&access_token=retired-access-token&token=retired-token';

test('authenticated document requests use a same-origin header and never put the session in the URL', async () => {
  let request;
  const result = await fetchAuthenticatedDocument(downloadPath, {
    origin,
    stemId: 'a0Bxx',
    getAccessToken: async () => 'session-secret',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        url,
        redirected: false,
        headers: { get: () => 'application/pdf' },
        blob: async () => new Blob(['pdf']),
      };
    },
  });

  assert.equal(result.contentType, 'application/pdf');
  assert.equal(new URL(request.url).searchParams.get('stemId'), 'a0Bxx');
  assert.equal(new URL(request.url).searchParams.has('access_token'), false);
  assert.equal(new URL(request.url).searchParams.has('token'), false);
  assert.doesNotMatch(request.url, /retired-(?:access-)?token/);
  assert.deepEqual(request.options.headers, { Authorization: 'Bearer session-secret' });
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.credentials, 'same-origin');
});

test('document URL validation rejects foreign, lookalike, and redirect destinations before a request is made', async () => {
  assert.equal(isSalesforceDocumentDownloadUrl(downloadPath, { origin }), true);
  assert.equal(isSalesforceDocumentDownloadUrl('https://attacker.example/api/functions/salesforceDocumentDownload?id=068xx', { origin }), false);
  assert.equal(isSalesforceDocumentDownloadUrl('/api/functions/salesforceDocumentDownloadElse?id=068xx', { origin }), false);
  assert.throws(() => salesforceDocumentDownloadUrl('https://attacker.example/api/functions/salesforceDocumentDownload?id=068xx', 'a0Bxx', { origin }));

  let called = false;
  await assert.rejects(
    fetchAuthenticatedDocument('https://attacker.example/api/functions/salesforceDocumentDownload?id=068xx', {
      origin,
      stemId: 'a0Bxx',
      getAccessToken: async () => { called = true; return 'session-secret'; },
      fetchImpl: async () => { called = true; },
    }),
    /not valid/i,
  );
  assert.equal(called, false);

  await assert.rejects(
    fetchAuthenticatedDocument(downloadPath, {
      origin,
      stemId: 'a0Bxx',
      getAccessToken: async () => 'session-secret',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        redirected: true,
        url: 'https://attacker.example/redirected',
        headers: { get: () => 'application/pdf' },
        blob: async () => new Blob(['pdf']),
      }),
    }),
    /redirected/i,
  );
});

test('aborting a lazy document request reaches fetch and does not turn into a user-facing error', async () => {
  const controller = new AbortController();
  let receivedSignal;
  const request = fetchAuthenticatedDocument(downloadPath, {
    origin,
    stemId: 'a0Bxx',
    signal: controller.signal,
    getAccessToken: async () => 'session-secret',
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      receivedSignal = options.signal;
      options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
  assert.equal(receivedSignal, controller.signal);
  assert.equal(receivedSignal.aborted, true);
});

test('only inert image formats and PDFs qualify for preview, and all three UI surfaces use the lazy document components', async () => {
  assert.equal(documentPreviewKind({ fileName: 'proof.svg', contentType: 'image/svg+xml' }), null);
  assert.equal(documentPreviewKind({ fileName: 'proof.html', contentType: 'text/html' }), null);
  assert.equal(documentPreviewKind({ fileName: 'proof.pdf' }), 'pdf');
  assert.equal(documentPreviewKind({ fileName: 'proof.png' }), 'image');

  const [stem, dispute, buyer] = await Promise.all([
    readFile(new URL('../src/components/dashboard/StemDetailModal.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/DisputeWorkflow.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/BuyerInvoices.jsx', import.meta.url), 'utf8'),
  ]);
  for (const source of [stem, dispute, buyer]) {
    assert.match(source, /AuthenticatedDocument(?:DownloadButton|Preview)/);
    assert.doesNotMatch(source, /withDownloadAuth|useDownloadAuthToken/);
  }

  const preview = await readFile(new URL('../src/components/common/AuthenticatedDocumentPreview.jsx', import.meta.url), 'utf8');
  assert.match(preview, /requestRef\.current\?\.abort\(\)/);
  assert.match(preview, /signal: controller\.signal/);
  assert.match(preview, /aria-label="Close document preview"/);
});
