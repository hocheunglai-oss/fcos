public without sharing class VariableChargeSupplierHandler {
    public static void beforeInsert(List<STEM_Variable_Charge_Supplier__c> rows) {
        for (STEM_Variable_Charge_Supplier__c row : rows) {
            if (row.STEM__c == null || row.Supplier__c == null) {
                row.addError('A STEM and exact Supplier Account are required.');
                continue;
            }
            row.External_Key__c = String.valueOf(row.STEM__c) + ':' + String.valueOf(row.Supplier__c);
            row.Supplier_Status__c = String.isBlank(row.Supplier_Status__c) ? 'Pending' : row.Supplier_Status__c;
            row.Buyer_Charge_Status__c = String.isBlank(row.Buyer_Charge_Status__c) ? 'Pending' : row.Buyer_Charge_Status__c;
            row.Revision__c = 0;
            row.Buyer_Charge_Revision__c = 0;
        }
    }

    public static void beforeUpdate(List<STEM_Variable_Charge_Supplier__c> rows, Map<Id, STEM_Variable_Charge_Supplier__c> oldMap) {
        for (STEM_Variable_Charge_Supplier__c row : rows) {
            STEM_Variable_Charge_Supplier__c before = oldMap.get(row.Id);
            if (row.STEM__c != before.STEM__c || row.Supplier__c != before.Supplier__c || row.External_Key__c != before.External_Key__c) {
                row.addError('The STEM and Supplier identity of a Variable Charge stage is immutable.');
            }
            row.Revision__c = (before.Revision__c == null ? 0 : before.Revision__c) + 1;
            Boolean buyerChanged = row.Buyer_Charge_Status__c != before.Buyer_Charge_Status__c
                || row.Buyer_Charge_Confirmed_At__c != before.Buyer_Charge_Confirmed_At__c
                || row.Buyer_Charge_Confirmed_By_Email__c != before.Buyer_Charge_Confirmed_By_Email__c
                || row.Buyer_Charge_Reviewed_Source_Fingerprint__c != before.Buyer_Charge_Reviewed_Source_Fingerprint__c;
            row.Buyer_Charge_Revision__c = buyerChanged
                ? (before.Buyer_Charge_Revision__c == null ? 0 : before.Buyer_Charge_Revision__c) + 1
                : before.Buyer_Charge_Revision__c;
        }
    }
}
