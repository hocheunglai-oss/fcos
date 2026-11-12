/** Read-only native-price context for Supplier Bid extra-cost entry. */
public with sharing class FcosTradeCurrencyExtraCostController {
    public class BidContext {
        @AuraEnabled public Id supplierBidId;
        @AuraEnabled public String currencyCode;
        @AuraEnabled public Decimal fxRate;
        @AuraEnabled public String fxRevision;
        @AuraEnabled public Datetime confirmedAt;
        @AuraEnabled public Id sideId;
    }
    public class ExtraCostContext {
        @AuraEnabled public Id extraCostId;
        @AuraEnabled public Id supplierBidId;
        @AuraEnabled public Decimal nativeUnitPrice;
        @AuraEnabled public Decimal nativeMinimum;
        @AuraEnabled public Decimal nativeLumpsum;
    }
    public class ContextResult {
        @AuraEnabled public List<BidContext> bids = new List<BidContext>();
        @AuraEnabled public List<ExtraCostContext> extraCosts = new List<ExtraCostContext>();
    }

    @AuraEnabled(cacheable=true)
    public static ContextResult loadContexts(List<Id> supplierBidIds) {
        if (supplierBidIds == null || supplierBidIds.isEmpty()) return new ContextResult();
        List<Supplier_Bid__c> bids = [
            SELECT Id,Buy_Currency__c,Buy_FX_Rate__c,Buy_FX_Revision__c,Buy_FX_Confirmed_At__c,Buy_FX_Side__c
            FROM Supplier_Bid__c WHERE Id IN :supplierBidIds
        ];
        List<Supplier_Bid_Extra_Cost__c> extras = [
            SELECT Id,Supplier_Bid__c,Buy_HKD_Unit_Price__c,Buy_HKD_Minimum__c,Buy_HKD_Lumpsum__c
            FROM Supplier_Bid_Extra_Cost__c WHERE Supplier_Bid__c IN :supplierBidIds
        ];
        return buildContexts(bids, extras);
    }

    @TestVisible
    private static ContextResult buildContexts(List<Supplier_Bid__c> bids, List<Supplier_Bid_Extra_Cost__c> extras) {
        ContextResult result = new ContextResult();
        for (Supplier_Bid__c bid : bids == null ? new List<Supplier_Bid__c>() : bids) {
            BidContext context = new BidContext();
            context.supplierBidId = bid.Id;
            context.currencyCode = bid.Buy_Currency__c == 'HKD' ? 'HKD' : 'USD';
            if (context.currencyCode == 'HKD') {
                context.fxRate = bid.Buy_FX_Rate__c;
                context.fxRevision = bid.Buy_FX_Revision__c;
                context.confirmedAt = bid.Buy_FX_Confirmed_At__c;
                context.sideId = bid.Buy_FX_Side__c;
            }
            result.bids.add(context);
        }
        for (Supplier_Bid_Extra_Cost__c extra : extras == null ? new List<Supplier_Bid_Extra_Cost__c>() : extras) {
            ExtraCostContext context = new ExtraCostContext();
            context.extraCostId = extra.Id;
            context.supplierBidId = extra.Supplier_Bid__c;
            context.nativeUnitPrice = extra.Buy_HKD_Unit_Price__c;
            context.nativeMinimum = extra.Buy_HKD_Minimum__c;
            context.nativeLumpsum = extra.Buy_HKD_Lumpsum__c;
            result.extraCosts.add(context);
        }
        return result;
    }
}
