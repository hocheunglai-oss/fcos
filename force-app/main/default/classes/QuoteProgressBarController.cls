public class QuoteProgressBarController {
    @AuraEnabled
    public static String getKoreaDeskChoices(Id recordId, String recordType) {
        return JSON.serialize(KoreaDeskCloseService.getChoices(recordId, recordType));
    }

    @AuraEnabled
    public static void closeKoreaDeskWon(Id recordId, String recordType, String choicesJson, String message) {
        KoreaDeskCloseService.closeWon(recordId, recordType, choicesJson, message);
    }
    @AuraEnabled
    public static List<QuoteLineItem> getWinningQuoteLineItems(String quoteId){
        return [SELECT Id, Supplier_Payment_Term__c, Supplier_Payment_Term__r.Name, Supplier__c, Supplier__r.Name, Supplier__r.BDN_Company__c, BDN_Company__c,
                Quantity, IsQuantityRange__c, Quantity_Range_Maximum__c, Port__c, Port__r.Name, Product2Id, Product2.Name,  ETA_ETB__c, Unit_of_Measure__c,
                ETA_Start_Date__c, ETA_Start_Time__c, ETA_End_Date__c, ETA_End_Time__c,
                ETB_Start_Date__c, ETB_Start_Time__c, ETB_End_Date__c, ETB_End_Time__c,
                ETD_Start_Date__c, ETD_Start_Time__c, ETD_End_Date__c, ETD_End_Time__c,
                ETCD_Start_Date__c, ETCD_Start_Time__c, ETCD_End_Date__c, ETCD_End_Time__c,
                Expected_Delivery_Date__c,
                (SELECT Id, Supplier_Payment_Term__c FROM Product_Extra_Charges__r)
                FROM QuoteLineItem
                WHERE QuoteId =: quoteId AND Winning__c = true AND (Product2.RecordTypeId = :FCBStatic.PETROLEUM_RT_ID  OR STEM_Extra_Charge__c = true)
                ORDER BY STEM_Extra_Charge__c, Opportunity_Line_Item__r.RefCode__c, CreatedDate];
    }
}
