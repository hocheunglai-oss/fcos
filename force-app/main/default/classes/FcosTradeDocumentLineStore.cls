/**
 * Internal storage boundary for immutable document-line evidence. Every public
 * operation proves access to the business document through the with-sharing
 * service before using a system-mode query or DML for its private child rows.
 */
public without sharing class FcosTradeDocumentLineStore {
    private static final String EVIDENCE_FIELDS = 'Id,Source_Record_Id__c,Description__c,Unit__c,Quantity__c,'
        + 'Native_Unit_Price__c,Native_Amount__c,Pricing_Mode__c,Native_Minimum__c,Native_Lumpsum__c,'
        + 'Accounting_USD__c,Currency__c,FX_Rate__c,FX_Revision__c,Original_Line__c';

    public static List<Trade_Document_Line__c> readForAuthorizedDocuments(Set<Id> documentIds, Boolean lockRows) {
        FcosTradeDocumentLineService.assertDocumentReadAccess(documentIds);
        if (documentIds == null || documentIds.isEmpty()) return new List<Trade_Document_Line__c>();
        Schema.SObjectType documentType = documentType(documentIds);
        String parentField = FcosTradeDocumentLineService.parentField(documentType);
        String query = 'SELECT ' + EVIDENCE_FIELDS + ' FROM Trade_Document_Line__c WHERE ' + parentField
            + ' IN :documentIds' + (lockRows ? ' FOR UPDATE' : ' ORDER BY Id');
        List<Trade_Document_Line__c> results = new List<Trade_Document_Line__c>();
        for (SObject row : Database.queryWithBinds(query, new Map<String, Object>{'documentIds' => documentIds}, AccessLevel.SYSTEM_MODE)) {
            results.add((Trade_Document_Line__c)row);
        }
        return results;
    }

    public static Boolean hasEvidenceForAuthorizedDocument(Id documentId) {
        FcosTradeDocumentLineService.assertDocumentReadAccess(new Set<Id>{documentId});
        Schema.SObjectType documentType = documentId.getSObjectType();
        String parentField = FcosTradeDocumentLineService.parentField(documentType);
        List<SObject> rows = Database.queryWithBinds(
            'SELECT Id FROM Trade_Document_Line__c WHERE ' + parentField + ' = :documentId LIMIT 1',
            new Map<String, Object>{'documentId' => documentId}, AccessLevel.SYSTEM_MODE
        );
        return !rows.isEmpty();
    }

    public static void insertForAuthorizedDocument(Id documentId, List<Trade_Document_Line__c> rows) {
        FcosTradeDocumentLineService.assertDocumentReadAccess(new Set<Id>{documentId});
        if (rows == null || rows.isEmpty()) return;
        String parentField = FcosTradeDocumentLineService.parentField(documentId.getSObjectType());
        for (Trade_Document_Line__c row : rows) {
            if (row == null || row.get(parentField) != documentId) {
                throw new AuraHandledException('Immutable evidence must belong to the authorized business document.');
            }
        }
        Database.insert(rows, true, AccessLevel.SYSTEM_MODE);
    }

    private static Schema.SObjectType documentType(Set<Id> documentIds) {
        Schema.SObjectType type;
        for (Id documentId : documentIds) {
            if (documentId == null) throw new AuraHandledException('An issued business document is required.');
            if (type == null) type = documentId.getSObjectType();
            else if (type != documentId.getSObjectType()) throw new AuraHandledException('Immutable evidence must be read for one document type at a time.');
        }
        return type;
    }
}
