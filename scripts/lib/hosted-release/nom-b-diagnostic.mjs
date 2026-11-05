// Closed scalar diagnostics only. Never retain exception messages, URLs, records,
// credentials, request options, or arbitrary provider error objects.
const stages = new Set(['RECIPE', 'LEGACY_ARTIFACTS', 'SOURCE_BINDING', 'READER_SETUP', 'READER_ADMISSION', 'FILES', 'METADATA_READ', 'METADATA_VALIDATION', 'OBSERVATION_FINGERPRINT', 'RECEIPT']);
const causes = new Set(['DEPENDENCY_SETUP_INVALID', 'DEPENDENCY_REVALIDATION_REQUIRED', 'NOM_B_READONLY_OBSERVATION_FAILED',
  'SALESFORCE_READ_UNAVAILABLE', 'SALESFORCE_READ_IDENTITY_OR_SCOPE_CHANGED', 'SALESFORCE_READ_EFFECTIVE_PERMISSIONS_CHANGED',
  'SALESFORCE_READ_RECIPE_BINDING', 'SALESFORCE_READ_CREDENTIAL_BINDING', 'SALESFORCE_READ_HOSTED_CONTEXT',
  'SALESFORCE_READ_PROVIDER_READ_ONLY_PROOF_REQUIRED', 'SALESFORCE_READ_FILE_VISIBILITY_REQUIRED', 'SALESFORCE_READ_SESSION_EXPIRED',
  'QUALIFICATION_SOURCE_CONTEXT', 'ADMITTED_SETUP_CHANGED', 'HOSTED_CONTROLLER_REQUIRED',
  'NOM_B_PRINCIPAL_CONTRACT_REQUIRED', 'NOM_B_PRINCIPAL_IDENTITY_REQUIRED', 'NOM_B_PRINCIPAL_RECIPE_BINDING_REQUIRED',
  'NOM_B_SCHEMA_DATA_LIMIT', 'NOM_B_SCHEMA_JSON_REQUIRED', 'NOM_B_SCHEMA_DESCRIPTOR_REQUIRED',
  'NOM_B_SCHEMA_STRUCTURE_CHANGED', 'NOM_B_SCHEMA_OBJECT_WRITES_FORBIDDEN', 'NOM_B_SCHEMA_CAPABILITY_CHANGE_FORBIDDEN']);
const objects = new Set(['ApexClass', 'ApexTrigger', 'ValidationRule', 'WorkflowRule', 'FlowDefinitionView', 'Nomination__c', 'STEM__c',
  'ContentVersion', 'Stem_Status__c', 'ContentDocument', 'ContentDocumentLink', 'User', 'Xero_Contact_Sync_Setting__c']);
export function safeNomBMeasurementDiagnostic(input = {}) {
  return { stage: stages.has(input.stage) ? input.stage : 'RECIPE',
    cause: causes.has(input.cause) ? input.cause : 'VALIDATION_REFUSED',
    ...(Number.isSafeInteger(input.readIndex) && input.readIndex >= 0 && input.readIndex < 16 ? { readIndex: input.readIndex } : {}),
    ...(objects.has(input.object) ? { object: input.object } : {}) };
}
