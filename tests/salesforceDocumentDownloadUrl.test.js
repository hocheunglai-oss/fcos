import assert from 'node:assert/strict';
import test from 'node:test';
import { trustedSalesforceDocumentDownloadUrl } from '../src/lib/salesforceDocumentDownloadUrl.js';

const origin = 'https://fcos.fcuno.com';
const trustedPath = '/api/functions/salesforceDocumentDownload?kind=contentVersion&id=068000000000001AAA&stemId=a0H000000000001AAA#preview';

test('payment-advice download URLs retain only the same-origin Salesforce download endpoint', () => {
  assert.equal(trustedSalesforceDocumentDownloadUrl(trustedPath, origin), trustedPath);
  assert.equal(trustedSalesforceDocumentDownloadUrl(`${origin}${trustedPath}`, origin), trustedPath);
});

test('payment-advice download URLs reject arbitrary origins and routes before authentication is attached', () => {
  for (const url of [
    'https://untrusted.example/api/functions/salesforceDocumentDownload?stemId=a0H000000000001AAA',
    '/api/functions/otherDownload?stemId=a0H000000000001AAA',
    'javascript:alert(1)',
  ]) {
    assert.equal(trustedSalesforceDocumentDownloadUrl(url, origin), '');
  }
});
