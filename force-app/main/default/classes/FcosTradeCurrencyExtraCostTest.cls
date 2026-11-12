@IsTest
private class FcosTradeCurrencyExtraCostTest {
    private static Id idFor(Schema.SObjectType objectType, Integer sequence) {
        String digits = String.valueOf(sequence);
        digits = '000000000000'.substring(0, 12 - digits.length()) + digits;
        return (Id)(objectType.getDescribe().getKeyPrefix() + digits);
    }
    private static Id bidId() { return idFor(Supplier_Bid__c.SObjectType, 41); }
    private static Id extraId() { return idFor(Supplier_Bid_Extra_Cost__c.SObjectType, 42); }
    private static Id quoteId() { return idFor(Schema.getGlobalDescribe().get('Quote'), 43); }
    private static Id portId() { return idFor(Port__c.SObjectType, 44); }
    private static Id supplierId() { return idFor(Account.SObjectType, 45); }
    private static Id buyerId() { return idFor(Account.SObjectType, 46); }
    private static Id sourceSideId() { return idFor(Trade_Currency_Side__c.SObjectType, 47); }
    private static Id destinationSideId() { return idFor(Trade_Currency_Side__c.SObjectType, 48); }
    private static Quote usdQuote(Id id, Id buyer) {
        Quote quote = new Quote(Id=id, Quote_Buyer__c=buyer);
        if (Schema.getGlobalDescribe().get('Quote').getDescribe().fields.getMap().containsKey('CurrencyIsoCode')) quote.put('CurrencyIsoCode', 'USD');
        return quote;
    }
    private static Trade_Currency_Side__c hkdSide(String key, Datetime confirmedAt) {
        return new Trade_Currency_Side__c(Id=sourceSideId(), External_Key__c=key, Currency__c='HKD', FX_Rate__c=Decimal.valueOf('7.8'),
            FX_Revision__c='immutable-rate', FX_Effective_At__c=Datetime.newInstanceGmt(2026,9,10,0,0,0), Confirmed_At__c=confirmedAt);
    }
    private static Supplier_Bid__c hkdBid(Id id, Id port, Id supplier, Id side, Datetime confirmedAt) {
        return new Supplier_Bid__c(Id=id, Port__c=port, Supplier__c=supplier, Buy_Currency__c='HKD',
            Buy_HKD_Unit_Price__c=Decimal.valueOf('7800'), Buy_FX_Rate__c=Decimal.valueOf('7.8'),
            Buy_FX_Revision__c='immutable-rate', Buy_FX_Confirmed_At__c=confirmedAt, Buy_FX_Side__c=side);
    }

    @IsTest
    static void bidExtraUsesParentDraftSideButItsOwnUsdAmounts() {
        Id bidRecordId=bidId(), portRecordId=portId(), supplierRecordId=supplierId();
        String key='Bid:'+bidRecordId+':'+portRecordId+':Buy:'+supplierRecordId;
        Trade_Currency_Side__c side=hkdSide(key, null);
        Supplier_Bid__c bid=hkdBid(bidRecordId, portRecordId, supplierRecordId, side.Id, null);
        Supplier_Bid_Extra_Cost__c extra=new Supplier_Bid_Extra_Cost__c(Supplier_Bid__c=bidRecordId,
            Unit_Cost__c=Decimal.valueOf('100'), Minimum__c=Decimal.valueOf('40'), Lumpsum_Cost__c=Decimal.valueOf('50'));
        FcosTradeCurrencyInheritance.Plan plan=FcosTradeCurrencyInheritance.planForTest(new List<SObject>{extra},
            new Map<Id,SObject>{bidRecordId=>bid}, new Map<Id,Quote>{}, new Map<Id,STEM__c>{},
            new Map<Id,Trade_Currency_Side__c>{side.Id=>side}, new Map<String,Trade_Currency_Side__c>{key=>side},
            new Map<Id,String>{portRecordId=>'Hong Kong'});
        System.assertEquals(0, plan.newSides.size());
        System.assertEquals(1, plan.rowsToStamp.size());
        FcosTradeCurrencyInheritance.apply(plan, new Map<String,Trade_Currency_Side__c>{key=>side});
        System.assertEquals('HKD', extra.Buy_Currency__c);
        System.assertEquals(Decimal.valueOf('780'), extra.Buy_HKD_Unit_Price__c);
        System.assertEquals(Decimal.valueOf('312'), extra.Buy_HKD_Minimum__c);
        System.assertEquals(Decimal.valueOf('390'), extra.Buy_HKD_Lumpsum__c);
        System.assertEquals(Decimal.valueOf('100'), extra.Unit_Cost__c);
        System.assertEquals(null, extra.Buy_FX_Confirmed_At__c);
    }

    @IsTest
    static void chargeOfferUsesLinkedExtraNativeValuesNotFuelBidValues() {
        Id bidRecordId=bidId(), extraRecordId=extraId(), quoteRecordId=quoteId(), portRecordId=portId(), supplierRecordId=supplierId(), buyerRecordId=buyerId();
        Datetime confirmedAt=Datetime.newInstanceGmt(2026,9,10,1,0,0);
        String bidKey='Bid:'+bidRecordId+':'+portRecordId+':Buy:'+supplierRecordId;
        Trade_Currency_Side__c source=hkdSide(bidKey, confirmedAt);
        Supplier_Bid__c fuelBid=hkdBid(bidRecordId, portRecordId, supplierRecordId, source.Id, confirmedAt);
        Supplier_Bid_Extra_Cost__c charge=new Supplier_Bid_Extra_Cost__c(Id=extraRecordId, Supplier_Bid__c=bidRecordId, Port__c=portRecordId, Supplier__c=supplierRecordId,
            Buy_Currency__c='HKD', Buy_HKD_Unit_Price__c=Decimal.valueOf('390'), Buy_HKD_Minimum__c=Decimal.valueOf('78'), Buy_HKD_Lumpsum__c=Decimal.valueOf('156'),
            Buy_FX_Rate__c=Decimal.valueOf('7.8'), Buy_FX_Revision__c='immutable-rate', Buy_FX_Confirmed_At__c=confirmedAt, Buy_FX_Side__c=source.Id);
        QuoteLineItem line=new QuoteLineItem(QuoteId=quoteRecordId, Port__c=portRecordId, Supplier__c=supplierRecordId,
            Supplier_Bid__c=bidRecordId, Supplier_Bid_Extra_Cost__c=extraRecordId);
        FcosTradeCurrencyInheritance.Plan plan=FcosTradeCurrencyInheritance.planForTest(new List<SObject>{line},
            new Map<Id,SObject>{bidRecordId=>fuelBid, extraRecordId=>charge}, new Map<Id,Quote>{quoteRecordId=>usdQuote(quoteRecordId,buyerRecordId)},
            new Map<Id,STEM__c>{}, new Map<Id,Trade_Currency_Side__c>{source.Id=>source}, new Map<String,Trade_Currency_Side__c>(),
            new Map<Id,String>{portRecordId=>'Hong Kong'});
        System.assertEquals(1, plan.newSides.size());
        Trade_Currency_Side__c offerSide=plan.newSides[0];
        offerSide.Id=destinationSideId();
        FcosTradeCurrencyInheritance.apply(plan, new Map<String,Trade_Currency_Side__c>{offerSide.External_Key__c=>offerSide});
        System.assertEquals(Decimal.valueOf('390'), line.Buy_HKD_Unit_Price__c);
        System.assertEquals(Decimal.valueOf('78'), line.Buy_HKD_Minimum__c);
        System.assertEquals(Decimal.valueOf('156'), line.Buy_HKD_Lumpsum__c);
        System.assertEquals(Decimal.valueOf('50'), line.Supplier_Unit_Price__c);
        System.assertEquals(Decimal.valueOf('10'), line.Minimum_Buy_At__c);
        System.assertEquals(Decimal.valueOf('20'), line.Lumpsum_Buy_At__c);
    }
}
