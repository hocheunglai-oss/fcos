// Reviewed business rules shared by browser and server code. Changes require
// policy scenarios as well as the affected workflow's integration checks.
export const NOM_B_POLICY = Object.freeze({
  id: 'nom_b',
  cursorRevision: 'dated-delivery-v1',
  scanLagWarningSeconds: 900,
  deliveryFrom: '2026-09-01',
  deliveryFields: Object.freeze(['Delivery_Date__c', 'Expected_Delivery_Date__c']),
  maxDecodedBytes: 3 * 1024 * 1024,
  extensions: Object.freeze(['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx']),
});

export const BUSINESS_POLICIES = Object.freeze({ nomB: NOM_B_POLICY });
