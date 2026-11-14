import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertLegacySalesforceDocumentAdmission } from '../scripts/lib/salesforce-legacy-document-admission.mjs';

test('legacy document preflight catches the four direct read imports and permits the protected supplier write', t => {
  const root = mkdtempSync(join(tmpdir(), 'fcos-salesforce-apex-admission-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const metadataRoot = 'force-app/main/default';
  const cases = [
    ['fcbBuyerConfirmationForm', 'nomination', 'NominationController.previewTradingDocument'],
    ['fcbSupplierNominationForm', 'nomination', 'NominationController.previewTradingDocument'],
    ['fcbInvoiceForm', 'preview', 'InvoiceController.previewTradingDocument'],
    ['fcbSupplierInvoices', 'preview', 'VariableChargeInvoiceReadinessService.previewSupplierTradingDocument'],
  ];
  const retainedWrite = "import record from '@salesforce/apex/FcosTradeDocumentService.recordSupplierInvoice';";
  for (const [bundle, action, incumbent] of cases) {
    const folder = join(root, metadataRoot, 'lwc', bundle);
    mkdirSync(folder, { recursive: true });
    const source = join(folder, bundle + '.js');
    const plan = { review: { components: [{ id: 'LightningComponentBundle:' + bundle }] } };
    writeFileSync(source, `import read from "@salesforce/apex/FcosTradeDocumentService.${action}";`);
    assert.throws(() => assertLegacySalesforceDocumentAdmission(root, plan, metadataRoot),
      { code: 'SALESFORCE_LEGACY_DOCUMENT_APEX_ACCESS_REQUIRED' });
    assert.doesNotThrow(() => assertLegacySalesforceDocumentAdmission(root, { review: { components: [] } }, metadataRoot));
    writeFileSync(source, `import read from '@salesforce/apex/${incumbent}';\n${retainedWrite}`);
    assert.doesNotThrow(() => assertLegacySalesforceDocumentAdmission(root, plan, metadataRoot));
  }
});
