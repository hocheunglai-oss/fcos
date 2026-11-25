import { dashboardExportSelectionDigest } from '../shared/dashboardExportSelection.js';

export function dashboardExportScope(fields) {
  const revisionField = ['SystemModstamp', 'LastModifiedDate'].find(field => fields.has(field));
  if (!revisionField) {
    throw Object.assign(new Error('Dashboard export cannot verify the STEM modification date.'), {
      status: 503, code: 'DASHBOARD_EXPORT_REVISION_UNAVAILABLE', expose: true,
    });
  }
  const selection = [];
  return {
    revisionField,
    // On the first export page this compact read replaces COUNT(Id). Supplier
    // partitions use the exact same access, filter and search predicates.
    async count(where, queryAll) {
      const records = await queryAll(`SELECT Id, ${revisionField} FROM stem__c WHERE ${where}`);
      for (const record of records) selection.push({ id: record.Id, exportRevision: record[revisionField] });
      return records.length;
    },
    digest: () => dashboardExportSelectionDigest(selection),
  };
}
