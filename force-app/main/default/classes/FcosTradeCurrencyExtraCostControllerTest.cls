@IsTest
private class FcosTradeCurrencyExtraCostControllerTest {
    private static Id idFor(Schema.SObjectType objectType, Integer sequence) {
        String digits = String.valueOf(sequence);
        digits = '000000000000'.substring(0, 12 - digits.length()) + digits;
        return (Id)(objectType.getDescribe().getKeyPrefix() + digits);
    }

    @IsTest
    static void exposesOnlyParentCanonicalSideAndOwnNativeAmounts() {
        Id bidId = idFor(Supplier_Bid__c.SObjectType, 61);
        Id extraId = idFor(Supplier_Bid_Extra_Cost__c.SObjectType, 62);
        Id sideId = idFor(Trade_Currency_Side__c.SObjectType, 63);
        Supplier_Bid__c bid = new Supplier_Bid__c(Id=bidId,Buy_Currency__c='HKD',Buy_FX_Rate__c=Decimal.valueOf('7.8'),
            Buy_FX_Revision__c='locked-rate',Buy_FX_Confirmed_At__c=Datetime.newInstanceGmt(2026,9,10,0,0,0),Buy_FX_Side__c=sideId);
        Supplier_Bid_Extra_Cost__c extra = new Supplier_Bid_Extra_Cost__c(Id=extraId,Supplier_Bid__c=bidId,
            Buy_HKD_Unit_Price__c=Decimal.valueOf('780'),Buy_HKD_Minimum__c=Decimal.valueOf('78'),Buy_HKD_Lumpsum__c=Decimal.valueOf('156'));
        FcosTradeCurrencyExtraCostController.ContextResult result = FcosTradeCurrencyExtraCostController.buildContexts(
            new List<Supplier_Bid__c>{bid}, new List<Supplier_Bid_Extra_Cost__c>{extra});
        System.assertEquals(1, result.bids.size());
        System.assertEquals('HKD', result.bids[0].currencyCode);
        System.assertEquals(Decimal.valueOf('7.8'), result.bids[0].fxRate);
        System.assertEquals(sideId, result.bids[0].sideId);
        System.assertEquals(1, result.extraCosts.size());
        System.assertEquals(Decimal.valueOf('780'), result.extraCosts[0].nativeUnitPrice);
        System.assertEquals(Decimal.valueOf('78'), result.extraCosts[0].nativeMinimum);
        System.assertEquals(Decimal.valueOf('156'), result.extraCosts[0].nativeLumpsum);
    }
}
