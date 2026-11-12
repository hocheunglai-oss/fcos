@IsTest
private class FcosTradeCurrencyInheritanceTest {
    private static Id idFor(Schema.SObjectType objectType, Integer sequence) {
        String digits = String.valueOf(sequence);
        digits = '000000000000'.substring(0, 12 - digits.length()) + digits;
        return (Id)(objectType.getDescribe().getKeyPrefix() + digits);
    }
    private static Id quoteId() { return idFor(Schema.getGlobalDescribe().get('Quote'), 1); }
    private static Boolean hasField(Schema.SObjectType objectType, String field) {
        return objectType.getDescribe().fields.getMap().containsKey(field);
    }
    private static Quote usdQuote(Id id, Id buyer) {
        Quote quote = new Quote(Id=id,Quote_Buyer__c=buyer);
        if (hasField(Schema.getGlobalDescribe().get('Quote'), 'CurrencyIsoCode')) quote.put('CurrencyIsoCode', 'USD');
        return quote;
    }
    private static STEM__c usdStem(Id id,Id buyer,Id port) {
        STEM__c stem=new STEM__c(Id=id,Account__c=buyer,Port__c=port);
        if(hasField(STEM__c.SObjectType,'CurrencyIsoCode')) stem.put('CurrencyIsoCode','USD');
        return stem;
    }
    private static Id stemId() { return idFor(STEM__c.SObjectType, 1); }
    private static Id portId() { return idFor(Port__c.SObjectType, 1); }
    private static Id supplierId() { return idFor(Account.SObjectType, 1); }
    private static Id buyerId() { return idFor(Account.SObjectType, 2); }
    private static Id sourceSideId() { return idFor(Trade_Currency_Side__c.SObjectType, 1); }
    private static Id destinationSideId() { return idFor(Trade_Currency_Side__c.SObjectType, 2); }

    private static Trade_Currency_Side__c confirmedSource() {
        return new Trade_Currency_Side__c(Id=sourceSideId(),Currency__c='HKD',FX_Rate__c=Decimal.valueOf('7.8'),
            FX_Revision__c='rate-immutable',FX_Effective_At__c=Datetime.newInstanceGmt(2026,9,10,0,0,0),Confirmed_At__c=Datetime.newInstanceGmt(2026,9,10,1,0,0));
    }
    private static Trade_Currency_Side__c usdSide(String key,Integer sequence,Boolean confirmed) {
        return new Trade_Currency_Side__c(Id=idFor(Trade_Currency_Side__c.SObjectType,sequence),External_Key__c=key,Currency__c='USD',
            Confirmed_At__c=confirmed?Datetime.newInstanceGmt(2026,9,10,2,0,0):null);
    }

    @IsTest
    static void quoteLineCopiesVerifiedBidIntoDraftOfferSide() {
        Id bidId = idFor(Supplier_Bid__c.SObjectType, 1), quoteRecordId = quoteId(), portRecordId = portId(), supplierRecordId = supplierId(), buyerRecordId = buyerId();
        Supplier_Bid__c bid = new Supplier_Bid__c(Id=bidId,Port__c=portRecordId,Supplier__c=supplierRecordId,
            Buy_Currency__c='HKD',Buy_HKD_Unit_Price__c=Decimal.valueOf('7800'),Buy_HKD_Minimum__c=Decimal.valueOf('100'),
            Buy_HKD_Lumpsum__c=Decimal.valueOf('10'),Buy_FX_Rate__c=Decimal.valueOf('7.8'),Buy_FX_Revision__c='rate-immutable',
            Buy_FX_Confirmed_At__c=Datetime.newInstanceGmt(2026,9,10,1,0,0),Buy_FX_Side__c=sourceSideId());
        QuoteLineItem line = new QuoteLineItem(QuoteId=quoteRecordId,Port__c=portRecordId,Supplier__c=supplierRecordId,Supplier_Bid__c=bidId);
        FcosTradeCurrencyInheritance.Plan plan = FcosTradeCurrencyInheritance.planForTest(new List<SObject>{line},
            new Map<Id,SObject>{bidId=>bid},new Map<Id,Quote>{quoteRecordId=>usdQuote(quoteRecordId,buyerRecordId)},
            new Map<Id,STEM__c>(),new Map<Id,Trade_Currency_Side__c>{sourceSideId()=>confirmedSource()},
            new Map<String,Trade_Currency_Side__c>(),new Map<Id,String>{portRecordId=>'Hong Kong'});
        System.assertEquals(1,plan.newSides.size());
        Trade_Currency_Side__c side=plan.newSides[0];
        System.assertEquals('Offer:'+quoteRecordId+':'+portRecordId+':Buy:'+supplierRecordId,side.External_Key__c);
        System.assertEquals(null,side.Confirmed_At__c);
        side.Id=destinationSideId();
        FcosTradeCurrencyInheritance.apply(plan,new Map<String,Trade_Currency_Side__c>{side.External_Key__c=>side});
        System.assertEquals('HKD',line.Buy_Currency__c);
        System.assertEquals(Decimal.valueOf('7800'),line.Buy_HKD_Unit_Price__c);
        System.assertEquals(Decimal.valueOf('1000'),line.Supplier_Unit_Price__c);
        System.assertEquals(null,line.Buy_FX_Confirmed_At__c);
    }

    @IsTest
    static void lockedStemSideConvertsOnlyNewLegacyUsdExtraCost() {
        Trade_Currency_Side__c locked = confirmedSource();
        Id stemRecordId=stemId(), portRecordId=portId(), buyerRecordId=buyerId(), supplierRecordId=supplierId();
        locked.Id=destinationSideId(); locked.External_Key__c='STEM:'+stemRecordId+':'+portRecordId+':Sell:'+buyerRecordId;
        STEM_Extra_Cost__c extra = new STEM_Extra_Cost__c(STEM__c=stemRecordId,Supplier__c=supplierRecordId,Unit_Price__c=Decimal.valueOf('100'));
        if(hasField(STEM_Extra_Cost__c.SObjectType,'CurrencyIsoCode')) extra.put('CurrencyIsoCode','HKD');
        FcosTradeCurrencyInheritance.Plan plan = FcosTradeCurrencyInheritance.planForTest(new List<SObject>{extra},
            new Map<Id,SObject>(),new Map<Id,Quote>{},new Map<Id,STEM__c>{stemRecordId=>usdStem(stemRecordId,buyerRecordId,portRecordId)},
            new Map<Id,Trade_Currency_Side__c>(),new Map<String,Trade_Currency_Side__c>{locked.External_Key__c=>locked},
            new Map<Id,String>{portRecordId=>'Hong Kong'});
        System.assertEquals(1,plan.rowsToStamp.size());
        FcosTradeCurrencyInheritance.apply(plan,new Map<String,Trade_Currency_Side__c>{locked.External_Key__c=>locked});
        System.assertEquals('HKD',extra.Sell_Currency__c);
        System.assertEquals(Decimal.valueOf('780'),extra.Sell_HKD_Unit_Price__c);
        System.assertEquals(Decimal.valueOf('100'),extra.Unit_Price__c);
        System.assertEquals(locked.Confirmed_At__c,extra.Sell_FX_Confirmed_At__c);
        if(hasField(STEM_Extra_Cost__c.SObjectType,'CurrencyIsoCode')) System.assertEquals('USD',extra.get('CurrencyIsoCode'));
    }

    @IsTest
    static void canonicalUsdOfferSideConvertsVerifiedBidNativeAmount() {
        Id bidId=idFor(Supplier_Bid__c.SObjectType, 3), quoteRecordId=quoteId(), portRecordId=portId(), supplierRecordId=supplierId(), buyerRecordId=buyerId();
        Supplier_Bid__c bid=new Supplier_Bid__c(Id=bidId,Port__c=portRecordId,Supplier__c=supplierRecordId,Buy_Currency__c='HKD',
            Buy_HKD_Unit_Price__c=Decimal.valueOf('7800'),Buy_FX_Rate__c=Decimal.valueOf('7.8'),Buy_FX_Revision__c='rate-immutable',
            Buy_FX_Confirmed_At__c=Datetime.newInstanceGmt(2026,9,10,1,0,0),Buy_FX_Side__c=sourceSideId());
        QuoteLineItem line=new QuoteLineItem(QuoteId=quoteRecordId,Port__c=portRecordId,Supplier__c=supplierRecordId,Supplier_Bid__c=bidId);
        String key='Offer:'+quoteRecordId+':'+portRecordId+':Buy:'+supplierRecordId;
        Trade_Currency_Side__c usdSide=new Trade_Currency_Side__c(Id=destinationSideId(),External_Key__c=key,Currency__c='USD');
        FcosTradeCurrencyInheritance.Plan plan=FcosTradeCurrencyInheritance.planForTest(new List<SObject>{line},
            new Map<Id,SObject>{bidId=>bid},new Map<Id,Quote>{quoteRecordId=>usdQuote(quoteRecordId,buyerRecordId)},
            new Map<Id,STEM__c>(),new Map<Id,Trade_Currency_Side__c>{sourceSideId()=>confirmedSource()},
            new Map<String,Trade_Currency_Side__c>{key=>usdSide},new Map<Id,String>{portRecordId=>'Hong Kong'});
        System.assertEquals(0,plan.newSides.size());
        FcosTradeCurrencyInheritance.apply(plan,new Map<String,Trade_Currency_Side__c>{key=>usdSide});
        System.assertEquals('USD',line.Buy_Currency__c);
        System.assertEquals(Decimal.valueOf('1000'),line.Supplier_Unit_Price__c);
        System.assertEquals(null,line.Buy_HKD_Unit_Price__c);
        System.assertEquals(null,line.Buy_FX_Rate__c);
        System.assertEquals(Decimal.valueOf('1000.00000000'),line.Buy_USD_Unit_Price_Precise__c);
    }

    @IsTest
    static void explicitUsdPrecisionFlowsFromBidToOfferToStem() {
        Id bidRecordId=idFor(Supplier_Bid__c.SObjectType, 31), quoteRecordId=quoteId(), portRecordId=portId(),
            supplierRecordId=supplierId(), buyerRecordId=buyerId(), offerRecordId=idFor(QuoteLineItem.SObjectType, 31), stemRecordId=stemId();
        Trade_Currency_Side__c bidSide=new Trade_Currency_Side__c(Id=sourceSideId(),Currency__c='USD',
            Confirmed_At__c=Datetime.newInstanceGmt(2026,9,10,1,0,0));
        Supplier_Bid__c bid=new Supplier_Bid__c(Id=bidRecordId,Port__c=portRecordId,Supplier__c=supplierRecordId,
            Buy_Currency__c='USD',Buy_USD_Unit_Price_Precise__c=Decimal.valueOf('123.45678901'),
            Buy_FX_Confirmed_At__c=bidSide.Confirmed_At__c,Buy_FX_Side__c=bidSide.Id);
        QuoteLineItem offer=new QuoteLineItem(QuoteId=quoteRecordId,Port__c=portRecordId,Supplier__c=supplierRecordId,Supplier_Bid__c=bidRecordId);
        FcosTradeCurrencyInheritance.Plan offerPlan=FcosTradeCurrencyInheritance.planForTest(new List<SObject>{offer},
            new Map<Id,SObject>{bidRecordId=>bid},new Map<Id,Quote>{quoteRecordId=>usdQuote(quoteRecordId,buyerRecordId)},
            new Map<Id,STEM__c>{},new Map<Id,Trade_Currency_Side__c>{bidSide.Id=>bidSide},new Map<String,Trade_Currency_Side__c>(),
            new Map<Id,String>{portRecordId=>'Hong Kong'});
        System.assertEquals(1,offerPlan.newSides.size());
        Trade_Currency_Side__c offerSide=offerPlan.newSides[0];
        System.assertEquals('USD',offerSide.Currency__c);
        offerSide.Id=destinationSideId();
        FcosTradeCurrencyInheritance.apply(offerPlan,new Map<String,Trade_Currency_Side__c>{offerSide.External_Key__c=>offerSide});
        System.assertEquals('USD',offer.Buy_Currency__c);
        System.assertEquals(Decimal.valueOf('123.45678901'),offer.Buy_USD_Unit_Price_Precise__c);
        System.assertEquals(Decimal.valueOf('123.45678901'),offer.Supplier_Unit_Price__c);
        System.assertEquals(null,offer.Buy_FX_Rate__c);
        offer.Id=offerRecordId;
        STEM_Line_Item__c stemLine=new STEM_Line_Item__c(STEM__c=stemRecordId,Original_Supplier__c=supplierRecordId,Offer_Line_Item__c=offerRecordId);
        if(hasField(STEM_Line_Item__c.SObjectType,'CurrencyIsoCode')) stemLine.put('CurrencyIsoCode','HKD');
        FcosTradeCurrencyInheritance.Plan stemPlan=FcosTradeCurrencyInheritance.planForTest(new List<SObject>{stemLine},
            new Map<Id,SObject>{offerRecordId=>offer},new Map<Id,Quote>{},
            new Map<Id,STEM__c>{stemRecordId=>usdStem(stemRecordId,buyerRecordId,portRecordId)},
            new Map<Id,Trade_Currency_Side__c>{offerSide.Id=>offerSide},new Map<String,Trade_Currency_Side__c>(),
            new Map<Id,String>{portRecordId=>'Hong Kong'});
        System.assertEquals(1,stemPlan.newSides.size());
        Trade_Currency_Side__c stemSide=stemPlan.newSides[0]; stemSide.Id=idFor(Trade_Currency_Side__c.SObjectType, 32);
        FcosTradeCurrencyInheritance.apply(stemPlan,new Map<String,Trade_Currency_Side__c>{stemSide.External_Key__c=>stemSide});
        System.assertEquals('USD',stemLine.Buy_Currency__c);
        System.assertEquals(Decimal.valueOf('123.45678901'),stemLine.Buy_USD_Unit_Price_Precise__c);
        System.assertEquals(Decimal.valueOf('123.45678901'),stemLine.Unit_Buy_At__c);
        System.assertEquals(null,stemLine.Buy_FX_Rate__c);
        if(hasField(STEM_Line_Item__c.SObjectType,'CurrencyIsoCode')) System.assertEquals('USD',stemLine.get('CurrencyIsoCode'));
    }

    @IsTest
    static void legacyUsdSourceDoesNotInventPrecision() {
        Id bidRecordId=idFor(Supplier_Bid__c.SObjectType, 33), quoteRecordId=quoteId(), portRecordId=portId(), supplierRecordId=supplierId(), buyerRecordId=buyerId();
        Trade_Currency_Side__c bidSide=new Trade_Currency_Side__c(Id=sourceSideId(),Currency__c='USD');
        Supplier_Bid__c bid=new Supplier_Bid__c(Id=bidRecordId,Port__c=portRecordId,Supplier__c=supplierRecordId,
            Buy_Currency__c='USD',Supplier_Unit_Price__c=Decimal.valueOf('123.45'),Buy_FX_Side__c=bidSide.Id);
        QuoteLineItem offer=new QuoteLineItem(QuoteId=quoteRecordId,Port__c=portRecordId,Supplier__c=supplierRecordId,Supplier_Bid__c=bidRecordId);
        FcosTradeCurrencyInheritance.Plan plan=FcosTradeCurrencyInheritance.planForTest(new List<SObject>{offer},
            new Map<Id,SObject>{bidRecordId=>bid},new Map<Id,Quote>{quoteRecordId=>usdQuote(quoteRecordId,buyerRecordId)},
            new Map<Id,STEM__c>{},new Map<Id,Trade_Currency_Side__c>{bidSide.Id=>bidSide},new Map<String,Trade_Currency_Side__c>(),
            new Map<Id,String>{portRecordId=>'Hong Kong'});
        System.assertEquals(0,plan.rowsToStamp.size());
        System.assertEquals(0,plan.newSides.size());
        System.assertEquals(null,offer.Buy_USD_Unit_Price_Precise__c);
    }

    @IsTest
    static void wrongPortCannotInheritHkd() {
        Id bidId=idFor(Supplier_Bid__c.SObjectType, 2), sourcePortId=portId(), wrongPortId=idFor(Port__c.SObjectType, 2), quoteRecordId=quoteId(), supplierRecordId=supplierId(), buyerRecordId=buyerId();
        Supplier_Bid__c bid=new Supplier_Bid__c(Id=bidId,Port__c=sourcePortId,Supplier__c=supplierRecordId,Buy_Currency__c='HKD',
            Buy_HKD_Unit_Price__c=Decimal.valueOf('7800'),Buy_FX_Rate__c=Decimal.valueOf('7.8'),Buy_FX_Revision__c='rate-immutable',
            Buy_FX_Confirmed_At__c=Datetime.newInstanceGmt(2026,9,10,1,0,0),Buy_FX_Side__c=sourceSideId());
        QuoteLineItem wrongPort=new QuoteLineItem(QuoteId=quoteRecordId,Port__c=wrongPortId,Supplier__c=supplierRecordId,Supplier_Bid__c=bidId);
        FcosTradeCurrencyInheritance.Plan plan=FcosTradeCurrencyInheritance.planForTest(new List<SObject>{wrongPort},
            new Map<Id,SObject>{bidId=>bid},new Map<Id,Quote>{quoteRecordId=>usdQuote(quoteRecordId,buyerRecordId)},
            new Map<Id,STEM__c>(),new Map<Id,Trade_Currency_Side__c>{sourceSideId()=>confirmedSource()},
            new Map<String,Trade_Currency_Side__c>(),new Map<Id,String>{sourcePortId=>'Hong Kong',wrongPortId=>'Hong Kong'});
        System.assertEquals(0,plan.rowsToStamp.size());
        System.assertEquals(0,plan.newSides.size());
        System.assertEquals(1,wrongPort.getErrors().size());
    }

    @IsTest
    static void masterContractRowCannotInheritHkd() {
        Id offerId=idFor(QuoteLineItem.SObjectType, 1), quoteRecordId=quoteId(), portRecordId=portId(), stemRecordId=stemId(), supplierRecordId=supplierId(), buyerRecordId=buyerId();
        QuoteLineItem offer=new QuoteLineItem(Id=offerId,QuoteId=quoteRecordId,Port__c=portRecordId,Supplier__c=supplierRecordId,
            Buy_Currency__c='HKD',Buy_HKD_Unit_Price__c=Decimal.valueOf('7800'),Buy_FX_Rate__c=Decimal.valueOf('7.8'),
            Buy_FX_Revision__c='rate-immutable',Buy_FX_Confirmed_At__c=Datetime.newInstanceGmt(2026,9,10,1,0,0),Buy_FX_Side__c=sourceSideId());
        STEM_Line_Item__c line=new STEM_Line_Item__c(STEM__c=stemRecordId,Original_Supplier__c=supplierRecordId,
            Offer_Line_Item__c=offerId,Master_Contract_Source__c=true);
        FcosTradeCurrencyInheritance.Plan plan=FcosTradeCurrencyInheritance.planForTest(new List<SObject>{line},
            new Map<Id,SObject>{offerId=>offer},new Map<Id,Quote>{},new Map<Id,STEM__c>{stemRecordId=>usdStem(stemRecordId,buyerRecordId,portRecordId)},
            new Map<Id,Trade_Currency_Side__c>{sourceSideId()=>confirmedSource()},new Map<String,Trade_Currency_Side__c>(),
            new Map<Id,String>{portRecordId=>'Hong Kong'});
        System.assertEquals(0,plan.rowsToStamp.size());
        System.assertEquals(1,line.getErrors().size());
    }

    @IsTest static void managedStemInheritanceRejectsNonUsdParent() {
        if(!hasField(STEM__c.SObjectType,'CurrencyIsoCode')) return;
        Id stemRecordId=stemId(),portRecordId=portId(),buyerRecordId=buyerId(),supplierRecordId=supplierId();
        String key='STEM:'+stemRecordId+':'+portRecordId+':Buy:'+supplierRecordId;
        Trade_Currency_Side__c locked=usdSide(key,32,true);
        STEM__c stem=usdStem(stemRecordId,buyerRecordId,portRecordId);stem.put('CurrencyIsoCode','HKD');
        STEM_Extra_Cost__c extra=new STEM_Extra_Cost__c(STEM__c=stemRecordId,Supplier__c=supplierRecordId,Unit_Cost__c=100);
        FcosTradeCurrencyInheritance.Plan plan=FcosTradeCurrencyInheritance.planForTest(new List<SObject>{extra},
            new Map<Id,SObject>(),new Map<Id,Quote>(),new Map<Id,STEM__c>{stemRecordId=>stem},
            new Map<Id,Trade_Currency_Side__c>(),new Map<String,Trade_Currency_Side__c>{locked.External_Key__c=>locked},
            new Map<Id,String>{portRecordId=>'Hong Kong'});
        System.assertEquals(0,plan.rowsToStamp.size());
        System.assert(extra.hasErrors(),'Managed inherited evidence cannot enter a non-USD STEM parent.');
    }

    private static void sourceLessExtraUsesExistingUsdSide(Boolean confirmed) {
        Id stemRecordId=stemId(),portRecordId=portId(),buyerRecordId=buyerId(),supplierRecordId=supplierId();
        String key='STEM:'+stemRecordId+':'+portRecordId+':Buy:'+supplierRecordId;
        Trade_Currency_Side__c side=usdSide(key,confirmed?33:34,confirmed);
        STEM_Extra_Cost__c extra=new STEM_Extra_Cost__c(STEM__c=stemRecordId,Supplier__c=supplierRecordId,
            Unit_Cost__c=Decimal.valueOf('123.45678901'),Buy_USD_Unit_Price_Precise__c=Decimal.valueOf('123.45678901'),
            Minimum_Buy_At__c=250,Lumpsum_Cost__c=500);
        if(hasField(STEM_Extra_Cost__c.SObjectType,'CurrencyIsoCode')) extra.put('CurrencyIsoCode','HKD');
        FcosTradeCurrencyInheritance.Plan plan=FcosTradeCurrencyInheritance.planForTest(new List<SObject>{extra},
            new Map<Id,SObject>(),new Map<Id,Quote>(),new Map<Id,STEM__c>{stemRecordId=>usdStem(stemRecordId,buyerRecordId,portRecordId)},
            new Map<Id,Trade_Currency_Side__c>(),new Map<String,Trade_Currency_Side__c>{key=>side},new Map<Id,String>{portRecordId=>'Hong Kong'});
        System.assertEquals(1,plan.rowsToStamp.size());
        FcosTradeCurrencyInheritance.apply(plan,new Map<String,Trade_Currency_Side__c>{key=>side});
        System.assertEquals(false,extra.hasErrors());
        System.assertEquals('USD',extra.Buy_Currency__c);
        System.assertEquals(side.Id,extra.Buy_FX_Side__c);
        System.assertEquals(side.Confirmed_At__c,extra.Buy_FX_Confirmed_At__c);
        System.assertEquals(Decimal.valueOf('123.45678901'),extra.Unit_Cost__c);
        System.assertEquals(Decimal.valueOf('123.45678901'),extra.Buy_USD_Unit_Price_Precise__c);
        System.assertEquals(Decimal.valueOf('250'),extra.Minimum_Buy_At__c);
        System.assertEquals(Decimal.valueOf('500'),extra.Lumpsum_Cost__c);
        if(hasField(STEM_Extra_Cost__c.SObjectType,'CurrencyIsoCode')) System.assertEquals('USD',extra.get('CurrencyIsoCode'));
    }
    @IsTest static void sourceLessExtraUsesExistingDraftUsdSide() {sourceLessExtraUsesExistingUsdSide(false);}
    @IsTest static void sourceLessExtraUsesExistingConfirmedUsdSide() {sourceLessExtraUsesExistingUsdSide(true);}

    @IsTest static void sourceLessFixedLumpUsesZeroUnitAndRetainsOwnLump() {
        Id stemRecordId=stemId(),portRecordId=portId(),buyerRecordId=buyerId(),supplierRecordId=supplierId();
        String key='STEM:'+stemRecordId+':'+portRecordId+':Buy:'+supplierRecordId;
        Trade_Currency_Side__c side=usdSide(key,36,false);
        STEM_Extra_Cost__c extra=new STEM_Extra_Cost__c(STEM__c=stemRecordId,Supplier__c=supplierRecordId,
            Fixed__c=true,Unit_Cost__c=null,Lumpsum_Cost__c=500);
        FcosTradeCurrencyInheritance.Plan plan=FcosTradeCurrencyInheritance.planForTest(new List<SObject>{extra},
            new Map<Id,SObject>(),new Map<Id,Quote>(),new Map<Id,STEM__c>{stemRecordId=>usdStem(stemRecordId,buyerRecordId,portRecordId)},
            new Map<Id,Trade_Currency_Side__c>(),new Map<String,Trade_Currency_Side__c>{key=>side},new Map<Id,String>{portRecordId=>'Hong Kong'});
        System.assertEquals(1,plan.rowsToStamp.size());
        FcosTradeCurrencyInheritance.apply(plan,new Map<String,Trade_Currency_Side__c>{key=>side});
        System.assertEquals(Decimal.valueOf('0'),extra.Unit_Cost__c);
        System.assertEquals(Decimal.valueOf('0'),extra.Buy_USD_Unit_Price_Precise__c);
        System.assertEquals(Decimal.valueOf('500'),extra.Lumpsum_Cost__c);
        System.assertEquals('USD',extra.Buy_Currency__c);
    }

    @IsTest static void sourceLessHkdMasterContractRemainsRejected() {
        Id stemRecordId=stemId(),portRecordId=portId(),buyerRecordId=buyerId(),supplierRecordId=supplierId();
        String key='STEM:'+stemRecordId+':'+portRecordId+':Buy:'+supplierRecordId;
        Trade_Currency_Side__c side=confirmedSource();side.Id=idFor(Trade_Currency_Side__c.SObjectType,38);side.External_Key__c=key;
        STEM_Line_Item__c line=new STEM_Line_Item__c(STEM__c=stemRecordId,Original_Supplier__c=supplierRecordId,
            Master_Contract_Source__c=true,Unit_Buy_At__c=100);
        FcosTradeCurrencyInheritance.Plan plan=FcosTradeCurrencyInheritance.planForTest(new List<SObject>{line},
            new Map<Id,SObject>(),new Map<Id,Quote>(),new Map<Id,STEM__c>{stemRecordId=>usdStem(stemRecordId,buyerRecordId,portRecordId)},
            new Map<Id,Trade_Currency_Side__c>(),new Map<String,Trade_Currency_Side__c>{key=>side},new Map<Id,String>{portRecordId=>'Hong Kong'});
        System.assertEquals(0,plan.rowsToStamp.size());
        System.assert(line.hasErrors(),'A source-less HKD side cannot convert formula-linked principal values.');

        Trade_Currency_Side__c usd=usdSide(key,39,false);
        STEM_Line_Item__c usdLine=new STEM_Line_Item__c(STEM__c=stemRecordId,Original_Supplier__c=supplierRecordId,
            Master_Contract_Source__c=true,Unit_Buy_At__c=100);
        FcosTradeCurrencyInheritance.Plan usdPlan=FcosTradeCurrencyInheritance.planForTest(new List<SObject>{usdLine},
            new Map<Id,SObject>(),new Map<Id,Quote>(),new Map<Id,STEM__c>{stemRecordId=>usdStem(stemRecordId,buyerRecordId,portRecordId)},
            new Map<Id,Trade_Currency_Side__c>(),new Map<String,Trade_Currency_Side__c>{key=>usd},new Map<Id,String>{portRecordId=>'Hong Kong'});
        System.assertEquals(1,usdPlan.rowsToStamp.size(),'The same formula-linked row may remain on its canonical USD side.');
        FcosTradeCurrencyInheritance.apply(usdPlan,new Map<String,Trade_Currency_Side__c>{key=>usd});
        System.assertEquals('USD',usdLine.Buy_Currency__c);
        System.assertEquals(false,usdLine.hasErrors());
    }

    @IsTest static void supplierBidExtraKeepsOwnPriceUnderExistingUsdSide() {
        Id bidRecordId=idFor(Supplier_Bid__c.SObjectType,37),portRecordId=portId(),supplierRecordId=supplierId();
        String key='Bid:'+bidRecordId+':'+portRecordId+':Buy:'+supplierRecordId;
        Trade_Currency_Side__c side=usdSide(key,37,true);
        Supplier_Bid__c bid=new Supplier_Bid__c(Id=bidRecordId,Port__c=portRecordId,Supplier__c=supplierRecordId,
            Buy_Currency__c='USD',Buy_USD_Unit_Price_Precise__c=1000,Buy_FX_Confirmed_At__c=side.Confirmed_At__c,Buy_FX_Side__c=side.Id);
        Supplier_Bid_Extra_Cost__c extra=new Supplier_Bid_Extra_Cost__c(Supplier_Bid__c=bidRecordId,
            Unit_Cost__c=50,Minimum__c=10,Lumpsum_Cost__c=20);
        FcosTradeCurrencyInheritance.Plan plan=FcosTradeCurrencyInheritance.planForTest(new List<SObject>{extra},
            new Map<Id,SObject>{bidRecordId=>bid},new Map<Id,Quote>(),new Map<Id,STEM__c>(),
            new Map<Id,Trade_Currency_Side__c>{side.Id=>side},new Map<String,Trade_Currency_Side__c>{key=>side},
            new Map<Id,String>{portRecordId=>'Hong Kong'});
        System.assertEquals(1,plan.rowsToStamp.size());
        FcosTradeCurrencyInheritance.apply(plan,new Map<String,Trade_Currency_Side__c>{key=>side});
        System.assertEquals(Decimal.valueOf('50'),extra.Unit_Cost__c);
        System.assertEquals(Decimal.valueOf('50'),extra.Buy_USD_Unit_Price_Precise__c);
        System.assertEquals(Decimal.valueOf('10'),extra.Minimum__c);
        System.assertEquals(Decimal.valueOf('20'),extra.Lumpsum_Cost__c);
        System.assertNotEquals(bid.Buy_USD_Unit_Price_Precise__c,extra.Unit_Cost__c,'A bid extra cost never copies its parent fuel price.');
        System.assertEquals(side.Id,extra.Buy_FX_Side__c);
    }

    @IsTest static void sourceLessUsdSideRejectsNativeEvidence() {
        Id stemRecordId=stemId(),portRecordId=portId(),buyerRecordId=buyerId(),supplierRecordId=supplierId();
        String key='STEM:'+stemRecordId+':'+portRecordId+':Buy:'+supplierRecordId;
        Trade_Currency_Side__c side=usdSide(key,35,false);
        STEM_Extra_Cost__c extra=new STEM_Extra_Cost__c(STEM__c=stemRecordId,Supplier__c=supplierRecordId,Unit_Cost__c=100,
            Buy_Currency__c='HKD',Buy_HKD_Unit_Price__c=780);
        FcosTradeCurrencyInheritance.Plan plan=FcosTradeCurrencyInheritance.planForTest(new List<SObject>{extra},
            new Map<Id,SObject>(),new Map<Id,Quote>(),new Map<Id,STEM__c>{stemRecordId=>usdStem(stemRecordId,buyerRecordId,portRecordId)},
            new Map<Id,Trade_Currency_Side__c>(),new Map<String,Trade_Currency_Side__c>{key=>side},new Map<Id,String>{portRecordId=>'Hong Kong'});
        System.assertEquals(0,plan.rowsToStamp.size());
        System.assert(extra.hasErrors(),'Native amounts cannot be silently cleared while inheriting a USD side.');
    }
}
