@IsTest
private class FcosTradeCurrencyGuardTest {
    private static Id fakeId(Schema.SObjectType type, Integer sequence) {
        String value = String.valueOf(sequence);
        return Id.valueOf(type.getDescribe().getKeyPrefix() + '000000000000'.substring(0, 12 - value.length()) + value);
    }
    private static STEM__c usdStem(Id id,Id port,Id buyer) {
        STEM__c stem=new STEM__c(Id=id,Port__c=port,Account__c=buyer);
        if(STEM__c.SObjectType.getDescribe().fields.getMap().containsKey('CurrencyIsoCode')) stem.put('CurrencyIsoCode','USD');
        return stem;
    }

    private static STEM_Line_Item__c issuedReissueLine() {
        return new STEM_Line_Item__c(
            Id = fakeId(STEM_Line_Item__c.SObjectType, 1),
            STEM__c = fakeId(STEM__c.SObjectType, 1),
            Original_Supplier__c = fakeId(Account.SObjectType, 1),
            Buyer_Invoice__c = fakeId(Invoice__c.SObjectType, 1),
            Reissue_Of_Buyer_Invoice__c = fakeId(Invoice__c.SObjectType, 2),
            Quantity__c = 10,
            Unit_Sell_At__c = 100
        );
    }

    @IsTest
    static void issuedUsdReissueLineRejectsFinancialEditsAndKeepsExactReleaseAllowance() {
        STEM_Line_Item__c original = issuedReissueLine();
        STEM_Line_Item__c repriced = original.clone(true, false, false, false);
        repriced.Unit_Sell_At__c = 101;

        FcosTradeCurrencyGuard.validateReissueLineageImmutability(repriced, original, 'Sell');
        System.assert(repriced.hasErrors(), 'An issued USD reissue line cannot be repriced outside the reissue workflow.');

        STEM_Line_Item__c changedQuantity = original.clone(true, false, false, false);
        changedQuantity.Quantity__c = 11;
        FcosTradeCurrencyGuard.validateReissueLineageImmutability(changedQuantity, original, 'Sell');
        System.assert(changedQuantity.hasErrors(), 'Shared issued quantity remains immutable for USD reissues.');

        STEM_Line_Item__c released = original.clone(true, false, false, false);
        released.Buyer_Invoice__c = null;
        released.Reissue_Of_Buyer_Invoice__c = original.Buyer_Invoice__c;
        FcosTradeReissueService.authorizeForTest(new List<SObject>{released}, original.Buyer_Invoice__c, 'Sell');
        try {
            FcosTradeCurrencyGuard.validateReissueLineageImmutability(released, original, 'Sell');
            System.assertEquals(false, released.hasErrors(), 'Only the authorized credited-side detach may pass the USD reissue guard.');
        } finally {
            FcosTradeReissueService.clearAuthorizationForTest();
        }
    }

    @IsTest
    static void usdReviewedSideMustMatchPartyButDoesNotRequireHongKong() {
        Id stemId = fakeId(STEM__c.SObjectType, 3);
        Id portId = fakeId(Port__c.SObjectType, 3);
        Id supplierId = fakeId(Account.SObjectType, 3);
        Id anotherSupplierId = fakeId(Account.SObjectType, 4);
        STEM__c stem = usdStem(stemId,portId,fakeId(Account.SObjectType,5));
        STEM_Line_Item__c line = new STEM_Line_Item__c(Id = fakeId(STEM_Line_Item__c.SObjectType, 3), STEM__c = stemId,
            Original_Supplier__c = supplierId);
        Map<Id, STEM__c> stems = new Map<Id, STEM__c>{stemId => stem};

        Trade_Currency_Side__c wrongParty = new Trade_Currency_Side__c(Id = fakeId(Trade_Currency_Side__c.SObjectType, 3), Currency__c = 'USD',
            External_Key__c = 'STEM:' + stemId + ':' + portId + ':Buy:' + anotherSupplierId);
        System.assertEquals(false, FcosTradeCurrencyGuard.matchesContext(line, 'Buy', wrongParty, stems,
            new Map<Id, Quote>(), new Map<Id, Supplier_Bid__c>()));
        System.assert(line.hasErrors(), 'A reviewed USD side from another supplier cannot be reused.');

        STEM_Line_Item__c matchingLine = new STEM_Line_Item__c(Id = fakeId(STEM_Line_Item__c.SObjectType, 4), STEM__c = stemId,
            Original_Supplier__c = supplierId);
        Trade_Currency_Side__c matchingParty = new Trade_Currency_Side__c(Id = fakeId(Trade_Currency_Side__c.SObjectType, 4), Currency__c = 'USD',
            External_Key__c = 'STEM:' + stemId + ':' + portId + ':Buy:' + supplierId);
        System.assertEquals(true, FcosTradeCurrencyGuard.matchesContext(matchingLine, 'Buy', matchingParty, stems,
            new Map<Id, Quote>(), new Map<Id, Supplier_Bid__c>()));
        System.assertEquals(false, matchingLine.hasErrors(), 'USD context remains valid outside Hong Kong when its reviewed side matches.');
    }
    @IsTest static void managedStemContextRequiresUsdParent() {
        if(!STEM__c.SObjectType.getDescribe().fields.getMap().containsKey('CurrencyIsoCode')) return;
        Id stemId=fakeId(STEM__c.SObjectType,6),portId=fakeId(Port__c.SObjectType,6),supplierId=fakeId(Account.SObjectType,6);
        STEM__c stem=usdStem(stemId,portId,fakeId(Account.SObjectType,7));stem.put('CurrencyIsoCode','HKD');
        STEM_Line_Item__c line=new STEM_Line_Item__c(Id=fakeId(STEM_Line_Item__c.SObjectType,6),STEM__c=stemId,Original_Supplier__c=supplierId);
        Trade_Currency_Side__c side=new Trade_Currency_Side__c(Id=fakeId(Trade_Currency_Side__c.SObjectType,6),Currency__c='USD',
            External_Key__c='STEM:'+stemId+':'+portId+':Buy:'+supplierId);
        System.assertEquals(false,FcosTradeCurrencyGuard.matchesContext(line,'Buy',side,new Map<Id,STEM__c>{stemId=>stem},
            new Map<Id,Quote>(),new Map<Id,Supplier_Bid__c>()));
        System.assert(line.hasErrors(),'A managed direct write cannot enter a non-USD STEM parent.');
    }
    @IsTest static void preciseUsdChargeAmendmentCanChangeWithinSamePrincipalCent() {
        STEM_Extra_Cost__c oldRow=new STEM_Extra_Cost__c(Unit_Cost__c=100.02,Buy_USD_Unit_Price_Precise__c=100.01582779,Buy_Currency__c='USD');
        STEM_Extra_Cost__c amended=oldRow.clone(false,false,false,false);
        amended.Buy_USD_Unit_Price_Precise__c=100.02;
        FcosTradeCurrencyGuard.guardPreciseUsdCharge(amended,oldRow,'Buy',true);
        System.assertEquals(false,amended.hasErrors());
        System.assertNotEquals(oldRow.Buy_USD_Unit_Price_Precise__c,amended.Buy_USD_Unit_Price_Precise__c);
        STEM_Extra_Cost__c denied=amended.clone(false,false,false,false);
        FcosTradeCurrencyGuard.guardPreciseUsdCharge(denied,oldRow,'Buy',false);
        System.assert(denied.hasErrors(),'A trader without the integration permission cannot write the explicit field.');
        STEM_Extra_Cost__c mismatched=amended.clone(false,false,false,false);mismatched.Unit_Cost__c=999;
        FcosTradeCurrencyGuard.guardPreciseUsdCharge(mismatched,oldRow,'Buy',true);
        System.assert(mismatched.hasErrors(),'Precise and principal evidence must reconcile.');
        STEM_Extra_Cost__c nativeRow=amended.clone(false,false,false,false);nativeRow.Buy_Currency__c='HKD';
        FcosTradeCurrencyGuard.guardPreciseUsdCharge(nativeRow,oldRow,'Buy',true);
        System.assert(nativeRow.hasErrors(),'An HKD row cannot gain a competing precise USD price.');
        STEM_Line_Item__c oldFuel=new STEM_Line_Item__c(Unit_Buy_At__c=100.02,Buy_Currency__c='USD');
        STEM_Line_Item__c fuel=oldFuel.clone(false,false,false,false);fuel.Buy_USD_Unit_Price_Precise__c=100.02;
        FcosTradeCurrencyGuard.guardPreciseUsdCharge(fuel,oldFuel,'Buy',true);
        System.assert(fuel.hasErrors(),'FCOS extra-charge integration cannot edit fuel prices.');
    }
    @IsTest static void usdReissueSourceCannotBeDeleted() {
        STEM_Line_Item__c row=issuedReissueLine();
        row.Sell_Currency__c='USD';
        FcosTradeCurrencyGuard.beforeDelete(new List<SObject>{row},new List<String>{'Buy','Sell'});
        System.assert(row.hasErrors(),'USD reissue must retain its original document source lineage.');
        STEM_Line_Item__c legacy=new STEM_Line_Item__c(Sell_Currency__c='USD');
        FcosTradeCurrencyGuard.beforeDelete(new List<SObject>{legacy},new List<String>{'Buy','Sell'});
        System.assertEquals(false,legacy.hasErrors(),'Historical USD deletion behavior is unchanged without managed evidence.');
    }
}
