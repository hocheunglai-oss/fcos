/** Private cash ledger access always rechecks the sharing-visible business STEM. */
public without sharing class FcosTradeCashStore {
    private static final String EVENT_FIELDS='Id,Name,STEM__c,Party__c,Direction__c,Currency__c,Kind__c,Cash_HKD_Amount__c,Cash_USD_Amount__c,FX_Rate__c,FX_Revision__c,FX_Effective_At__c,Payment_Date__c,Bank__c,Bank_Currency__c,Bank_Native_Amount__c,Bank_Evidence__c,Reference__c,Trade_FX_Side__c,Buyer_Proforma__c,Supplier_Proforma__c,Original_Cash_Event__c,Original_Carrying_USD__c,Original_Bank_Allocation__c,Settlement_FX_USD__c,Operation_Id__c,Request_Fingerprint__c';
    private static final String ALLOCATION_FIELDS='Id,Name,Cash_Event__c,Buyer_Invoice__c,Supplier_Invoice__c,Payment__c,Currency__c,Kind__c,Reverses_Allocation__c,Allocation_Date__c,Allocated_HKD__c,Allocated_Cash_USD__c,Invoice_Carrying_USD__c,Bank_Native_Allocation__c,Settlement_FX_USD__c,Operation_Id__c,Request_Fingerprint__c';
    public static Trade_Cash_Event__c event(Id eventId,Boolean lockRow) {
        List<Trade_Cash_Event__c> rows=Database.query('SELECT '+EVENT_FIELDS+' FROM Trade_Cash_Event__c WHERE Id=:eventId'+(lockRow?' FOR UPDATE':''));
        if(rows.isEmpty()) throw new AuraHandledException('The cash record is unavailable.');
        FcosTradeCashService.assertStemAccess(rows[0].STEM__c);return rows[0];
    }
    public static List<Trade_Cash_Event__c> events(Id stemId) {
        FcosTradeCashService.assertStemAccess(stemId);
        return Database.query('SELECT '+EVENT_FIELDS+' FROM Trade_Cash_Event__c WHERE STEM__c=:stemId ORDER BY CreatedDate,Id');
    }
    public static List<Trade_Cash_Allocation__c> allocations(Id eventId) {
        event(eventId,false);
        return Database.query('SELECT '+ALLOCATION_FIELDS+' FROM Trade_Cash_Allocation__c WHERE Cash_Event__c=:eventId ORDER BY CreatedDate,Id');
    }
    public static Trade_Cash_Allocation__c allocation(Id allocationId) {
        List<Trade_Cash_Allocation__c> rows=Database.query('SELECT '+ALLOCATION_FIELDS+' FROM Trade_Cash_Allocation__c WHERE Id=:allocationId');
        if(rows.isEmpty()) throw new AuraHandledException('The allocation is unavailable.');
        event(rows[0].Cash_Event__c,false);return rows[0];
    }
    public static SObject operation(String objectName,String operationId,String fingerprint) {
        if(objectName!='Trade_Cash_Event__c' && objectName!='Trade_Cash_Allocation__c') throw new AuraHandledException('Unsupported cash evidence.');
        List<SObject> rows=Database.query('SELECT Id,Request_Fingerprint__c,'+(objectName=='Trade_Cash_Event__c'?'STEM__c':'Cash_Event__c')+' FROM '+objectName+' WHERE Operation_Id__c=:operationId LIMIT 1');
        if(rows.isEmpty()) return null;
        if(objectName=='Trade_Cash_Event__c') FcosTradeCashService.assertStemAccess((Id)rows[0].get('STEM__c'));
        else event((Id)rows[0].get('Cash_Event__c'),false);
        if(rows[0].get('Request_Fingerprint__c')!=fingerprint) throw new AuraHandledException('This operation ID was already used for different cash details.');
        return rows[0];
    }
}
