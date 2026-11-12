@IsTest
private class FcosTradeFormulaRegressionTest {
    private static final String ACTOR_LAST_NAME='TradeFormulaRegression';

    @TestSetup static void legacyTrade() {
        User actor=new User(Alias='fxform',LastName=ACTOR_LAST_NAME,Email='fx-formula@example.invalid',
            Username='fx-formula.'+UserInfo.getOrganizationId()+'.'+System.now().getTime()+'@example.invalid',
            EmailEncodingKey='UTF-8',LanguageLocaleKey='en_US',LocaleSidKey='en_US',
            TimeZoneSidKey='Asia/Hong_Kong',ProfileId=UserInfo.getProfileId());
        insert actor;
        insert new PermissionSetAssignment(AssigneeId=actor.Id,
            PermissionSetId=[SELECT Id FROM PermissionSet WHERE Name='Fcos_Trading_FX_Access' LIMIT 1].Id);
        Test.startTest();
        try {
            System.runAs(actor) {
                System.assert(Limits.getQueries()<15,'The formula fixture must begin with a fresh query budget.');
                TestDataFactory.prepareDataForNominationConfirmationFlow();
                STEM_Line_Item__c line=[SELECT STEM__r.Port__c FROM STEM_Line_Item__c WHERE Cancelled__c=false LIMIT 1];
                update new Port__c(Id=line.STEM__r.Port__c,Name='Hong Kong',Port_Area__c='Hong Kong',Country__c='HONG KONG');
            }
        } finally {Test.stopTest();}
    }

    private static User actor() {return [SELECT Id FROM User WHERE LastName=:ACTOR_LAST_NAME LIMIT 1];}

    private static Decimal calculate(SObject row,String field) {
        Schema.DescribeFieldResult described=row.getSObjectType().getDescribe().fields.getMap().get(field).getDescribe();
        String expression=described.getCalculatedFormula();
        System.assertNotEquals(null,expression,field+' must remain a calculated formula.');
        return (Decimal)Formula.builder().withType(row.getSObjectType()).withReturnType(FormulaEval.FormulaReturnType.DECIMAL)
            .withFormula(expression).treatNumericNullAsZero(false).build().evaluate(row);
    }

    private static Decimal priceAcrossLegacyRoundingBoundary(Integer legacyScale) {
        if (legacyScale<=2) return Decimal.valueOf('100.00490000');
        Decimal legacyQuantum=1;
        for (Integer index=0;index<legacyScale;index++) legacyQuantum=legacyQuantum/10;
        return (Decimal.valueOf('100.015')-(Decimal.valueOf('0.4')*legacyQuantum))
            .setScale(8,RoundingMode.HALF_UP);
    }

    @IsTest static void existingUsdPricesRemainFinanciallyActive() {
        STEM_Line_Item__c line=[SELECT Id,Quantity__c,Unit_Sell_At__c,Unit_Buy_At__c,
            Total_Price__c,Total_Cost__c,Sell_USD_Unit_Price_Precise__c,Buy_USD_Unit_Price_Precise__c
            FROM STEM_Line_Item__c WHERE Cancelled__c=false LIMIT 1];
        System.assertEquals(null,line.Sell_USD_Unit_Price_Precise__c,'Existing sell USD evidence must remain unmodified.');
        System.assertEquals(null,line.Buy_USD_Unit_Price_Precise__c,'Existing buy USD evidence must remain unmodified.');
        System.assertEquals((line.Quantity__c*line.Unit_Sell_At__c).setScale(2,RoundingMode.HALF_UP),line.Total_Price__c);
        System.assertEquals((line.Quantity__c*line.Unit_Buy_At__c).setScale(2,RoundingMode.HALF_UP),line.Total_Cost__c);
        Test.startTest();
        line.Quantity_Delivered_Per_BDN__c=150;
        update line;
        Test.stopTest();
        STEM_Line_Item__c saved=[SELECT Total_Price__c,Total_Cost__c,Input__c FROM STEM_Line_Item__c WHERE Id=:line.Id];
        System.assertEquals((150*line.Unit_Sell_At__c).setScale(2,RoundingMode.HALF_UP),saved.Total_Price__c);
        System.assertEquals((150*line.Unit_Buy_At__c).setScale(2,RoundingMode.HALF_UP),saved.Total_Cost__c);
        System.assertEquals('🟡',saved.Input__c,'Changed delivered value must reopen invoice input.');
    }

    @IsTest static void exactFormulaMatrixPreservesLegacyAndNativeSemantics() {
        QuoteLineItem offer=new QuoteLineItem(Quantity=4,UnitPrice=6,Supplier_Unit_Price__c=5,
            Buyer_Broker_Commission__c=1,Supplier_Broker_Commission__c=-0.5,Unit_Transportation_Cost__c=2,
            Buy_Currency__c=null,Sell_Currency__c=null,Fixed__c=false);
        System.assertEquals(Decimal.valueOf('6.5'),calculate(offer,'Our_Cost__c'));
        System.assertEquals(Decimal.valueOf('0.5'),calculate(offer,'Internal_Margin__c'));
        System.assertEquals(4,calculate(offer,'Profit__c'));
        System.assertEquals(24,calculate(offer,'Total_Sell_At__c'));
        offer.Sell_USD_Unit_Price_Precise__c=0;offer.Buy_USD_Unit_Price_Precise__c=0;
        System.assertEquals(0,calculate(offer,'Total_Sell_At__c'),'Explicit precise zero must override legacy USD.');
        offer.Sell_USD_Unit_Price_Precise__c=null;offer.UnitPrice=-2;offer.Minimum_Sell_At__c=null;
        System.assertEquals(0,calculate(offer,'Total_Sell_At__c'),'Legacy blank minimum clamps a negative extended price at zero.');
        offer.Minimum_Sell_At__c=-10;
        System.assertEquals(-8,calculate(offer,'Total_Sell_At__c'));
        offer.Fixed__c=true;offer.Lumpsum_Sell_At__c=null;
        System.assertEquals(0,calculate(offer,'Total_Sell_At__c'));
        offer.Lumpsum_Sell_At__c=0;
        System.assertEquals(0,calculate(offer,'Total_Sell_At__c'));
        offer.Lumpsum_Sell_At__c=-4.25;
        System.assertEquals(Decimal.valueOf('-4.25'),calculate(offer,'Total_Sell_At__c'));

        STEM_Line_Item__c fuel=(STEM_Line_Item__c)JSON.deserialize(JSON.serialize(new Map<String,Object>{
            'Quantity__c'=>4,'Quantity_Delivered_Per_BDN__c'=>null,'QLIK_Quantity__c'=>4,
            'Unit_Sell_At__c'=>6,'Unit_Buy_At__c'=>5,'Sell_Currency__c'=>'USD','Buy_Currency__c'=>'USD',
            'Total_Consultation_Fee__c'=>2,'Buyers_Brokers_Commission_Per_Unit__c'=>1,
            'Suppliers_Brokers_Commission_Per_Unit__c'=>-0.5
        }),STEM_Line_Item__c.class);
        System.assertEquals(24,calculate(fuel,'Total_Price__c'));
        System.assertEquals(20,calculate(fuel,'Total_Cost__c'));
        System.assertEquals(24,calculate(fuel,'QLIK_Total_Price__c'));
        System.assertEquals(20,calculate(fuel,'QLIK_Total_Cost__c'));
        System.assertEquals(Decimal.valueOf('6.5'),calculate(fuel,'Unit_Cost__c'));
        fuel.Quantity_Delivered_Per_BDN__c=0;
        System.assertEquals(24,calculate(fuel,'Total_Price__c'));
        fuel.Quantity_Delivered_Per_BDN__c=-2;fuel.Sell_USD_Unit_Price_Precise__c=-6.125;
        fuel.Buy_USD_Unit_Price_Precise__c=0;
        System.assertEquals(Decimal.valueOf('12.25'),calculate(fuel,'Total_Price__c'));
        System.assertEquals(0,calculate(fuel,'Total_Cost__c'),'Buy precise zero must not fall back to legacy USD.');

        STEM_Extra_Cost__c extra=(STEM_Extra_Cost__c)JSON.deserialize(JSON.serialize(new Map<String,Object>{
            'Fixed__c'=>false,'Quantity__c'=>4,'QLIK_Quantity__c'=>4,'Unit_Cost__c'=>5,'Unit_Price__c'=>6,
            'Minimum_Buy_At__c'=>null,'Minimum_Sell_At__c'=>30,'Buy_Currency__c'=>'USD','Sell_Currency__c'=>'USD'
        }),STEM_Extra_Cost__c.class);
        System.assertEquals(20,calculate(extra,'QLIK_Total_Cost__c'));
        System.assertEquals(30,calculate(extra,'QLIK_Total_Price__c'));
        System.assertEquals(4,calculate(extra,'Spread_Margin__c'));
        extra.Fixed__c=true;extra.Lumpsum_Cost__c=null;extra.Lumpsum_Price__c=-4;
        System.assertEquals(0,calculate(extra,'QLIK_Total_Cost__c'));
        extra.Lumpsum_Cost__c=0;
        System.assertEquals(0,calculate(extra,'QLIK_Total_Cost__c'));
        System.assertEquals(-4,calculate(extra,'QLIK_Total_Price__c'));
        extra.Fixed__c=false;extra.Buy_Currency__c='HKD';extra.Buy_HKD_Unit_Price__c=39;
        extra.Buy_HKD_Minimum__c=78;extra.Buy_FX_Rate__c=7.8;
        System.assertEquals(20,calculate(extra,'QLIK_Total_Cost__c'));

        Supplier_Bid__c bid=new Supplier_Bid__c(Quantity__c=2,Supplier_Unit_Price__c=-5,Buy_Currency__c='USD');
        System.assertEquals(-10,calculate(bid,'Total_Supplier_Price__c'));
        bid.Buy_USD_Unit_Price_Precise__c=0;
        System.assertEquals(0,calculate(bid,'Total_Supplier_Price__c'));
        bid.Buy_Currency__c='HKD';bid.Buy_HKD_Unit_Price__c=39;bid.Buy_FX_Rate__c=7.8;
        System.assertEquals(10,calculate(bid,'Total_Supplier_Price__c'));
        bid.Quantity__c=null;
        System.assertEquals(0,calculate(bid,'Total_Supplier_Price__c'));
    }

    @IsTest static void invalidHkdRatesDoNotProduceAccountingValues() {
        QuoteLineItem offer = new QuoteLineItem(
            Quantity = 4,
            UnitPrice = 60,
            Supplier_Unit_Price__c = 5,
            Buy_Currency__c = 'USD',
            Sell_Currency__c = 'HKD',
            Sell_HKD_Unit_Price__c = 39,
            Fixed__c = false
        );
        for (Decimal invalidRate : new List<Decimal>{null, 0, -1}) {
            offer.Sell_FX_Rate__c = invalidRate;
            System.assertEquals(null, calculate(offer, 'Total_Sell_At__c'));
            System.assertEquals(null, calculate(offer, 'Profit__c'));
            System.assertEquals(5, calculate(offer, 'Our_Cost__c'));
        }
        offer.Sell_FX_Rate__c = 7.8;
        System.assertEquals(20, calculate(offer, 'Total_Sell_At__c'));
        offer.Buy_Currency__c = 'HKD';
        offer.Buy_HKD_Unit_Price__c = 31.2;
        offer.Buy_FX_Rate__c = 0;
        System.assertEquals(null, calculate(offer, 'Our_Cost__c'));
        System.assertEquals(null, calculate(offer, 'Profit__c'));
        System.assertEquals(20, calculate(offer, 'Total_Sell_At__c'));
        offer.Buy_FX_Rate__c = 7.8;
        System.assertEquals(4, calculate(offer, 'Profit__c'));
    }

    @IsTest static void reviewedUsdAndHkdSidesDriveStoredTwoDecimalTotals() {
        System.runAs(actor()) {
            STEM_Line_Item__c line=[SELECT Id FROM STEM_Line_Item__c WHERE Cancelled__c=false LIMIT 1];
            update new STEM_Line_Item__c(Id=line.Id,Quantity__c=3,Quantity_Delivered_Per_BDN__c=null);
            Integer buyLegacyScale=STEM_Line_Item__c.Unit_Buy_At__c.getDescribe().getScale();
            Integer sellLegacyScale=STEM_Line_Item__c.Unit_Sell_At__c.getDescribe().getScale();
            Decimal buyPrecise=priceAcrossLegacyRoundingBoundary(buyLegacyScale);
            Decimal sellUsdPrecise=priceAcrossLegacyRoundingBoundary(sellLegacyScale);
            FcosCompanyFxRateService.settingsOverride=new Fcos_Trading_FX_Setting__c(Enabled__c=true);
            FcosCompanyFxRateService.Snapshot rate=new FcosCompanyFxRateService.Snapshot();
            rate.rateId='formula-rounding-rate';rate.revision='1';rate.usdHkdRate=7.8;
            rate.effectiveAt=Datetime.newInstanceGmt(2026,9,1,0,0,0);
            Decimal sellHkd=(sellUsdPrecise*rate.usdHkdRate).setScale(8,RoundingMode.HALF_UP);
            Test.startTest();
            FcosTradeCurrencyService.Review buy=FcosTradeCurrencyService.review(line.Id,'Buy',null);
            FcosTradeCurrencyService.save(line.Id,'Buy','USD',buyPrecise,buy.fingerprint,null,true);
            FcosTradeCurrencyService.Review sell=FcosTradeCurrencyService.review(line.Id,'Sell',rate);
            FcosTradeCurrencyService.save(line.Id,'Sell','HKD',sellHkd,sell.fingerprint,rate,true);
            Test.stopTest();
            STEM_Line_Item__c stored=[SELECT Unit_Buy_At__c,Unit_Sell_At__c,Buy_USD_Unit_Price_Precise__c,
                Sell_HKD_Unit_Price__c,Total_Cost__c,Total_Price__c FROM STEM_Line_Item__c WHERE Id=:line.Id];
            Decimal buyTotal=(buyPrecise*3).setScale(2,RoundingMode.HALF_UP);
            Decimal sellTotal=(sellHkd/rate.usdHkdRate*3).setScale(2,RoundingMode.HALF_UP);
            System.assertEquals(buyPrecise,stored.Buy_USD_Unit_Price_Precise__c);
            System.assertEquals(sellHkd,stored.Sell_HKD_Unit_Price__c);
            System.assertEquals(buyTotal,stored.Total_Cost__c);
            System.assertEquals(sellTotal,stored.Total_Price__c);
            if (buyLegacyScale<8) {
                Decimal displayedLegacyBuy=stored.Unit_Buy_At__c.setScale(buyLegacyScale,RoundingMode.HALF_UP);
                System.assertNotEquals((displayedLegacyBuy*3).setScale(2,RoundingMode.HALF_UP),stored.Total_Cost__c,
                    'Accounting totals must multiply precise USD evidence, not the displayed rounded legacy unit.');
            }
            if (sellLegacyScale<8) {
                Decimal displayedLegacySell=stored.Unit_Sell_At__c.setScale(sellLegacyScale,RoundingMode.HALF_UP);
                System.assertNotEquals((displayedLegacySell*3).setScale(2,RoundingMode.HALF_UP),stored.Total_Price__c,
                    'Accounting totals must convert precise HKD evidence, not the displayed rounded legacy unit.');
            }
        }
    }
}
