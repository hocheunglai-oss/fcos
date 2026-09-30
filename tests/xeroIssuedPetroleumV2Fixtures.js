import { issuedPetroleumFixture } from './xeroIssuedPetroleumPreservationFixtures.js';
import { evaluatePetroleumFinancialDocument } from '../api/_xeroIssuedPetroleumPreservationAdapter.js';
import { ISSUED_PETROLEUM_PRESERVATION_V2_POLICY as POLICY } from '../api/_xeroIssuedPetroleumPreservation.js';
import { issuedSupplierHash as hash } from '../api/_xeroIssuedSupplierPreservation.js';
import { buildFinancialClassifications, normalizeXeroInvoice } from '../api/_xeroFinancialSync.js';
import { buildGroupedPreservationContext } from '../api/_xeroGroupedPreservationAdapter.js';

export function issuedPetroleumV2Fixture() {
  const f = issuedPetroleumFixture();
  const file = f.fileEvidence;
  file.review.invoiceDate = null;
  file.review.dueDate = null;
  file.review.lines[0].unit = 'MTS';
  file.attachmentManifest = { complete: true, selectedDocumentId: file.documentId, selectedVersionId: file.versionId,
    entries: [{ linkId: file.link.id, documentId: file.documentId, versionId: file.versionId,
      sha256: file.sha256, checksum: file.checksum, contentSize: file.contentSize, fileType: 'PDF', fileExtension: 'pdf',
      role: 'issued_invoice', reviewRecordHash: file.review.reviewRecordHash },
    { linkId: '06A000000000002', documentId: '069000000000002', versionId: '068000000000002',
      sha256: hash('synthetic-reviewed-delivery-receipt'), checksum: '1'.repeat(32), contentSize: 5678,
      fileType: 'PDF', fileExtension: 'pdf', role: 'delivery_receipt', reviewRecordHash: hash('synthetic-support-review') }] };
  f.packet.policyVersion = POLICY;
  f.packet.records[0].attachments = structuredClone(file.attachmentManifest.entries);
  f.build = () => evaluatePetroleumFinancialDocument(f.source, f.candidate, f.context, file, { policyVersion: POLICY });
  f.rebuild = () => {
    Object.assign(f.candidate, normalizeXeroInvoice(f.raw));
    const built = buildFinancialClassifications(f.salesforce, f.xero, f.stored);
    Object.assign(f.source, built.sources[0]);
    Object.assign(f.context, buildGroupedPreservationContext(f.salesforce, f.xero, f.stored, built.sources));
    f.refreshScope();
  };
  return f;
}
