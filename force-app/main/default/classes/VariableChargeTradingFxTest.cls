@IsTest
private class VariableChargeTradingFxTest {
    @TestSetup static void fixtures() {TestDataFactory.prepareDataForNominationConfirmationFlow();}
    @IsTest static void legacyProjectionRemainsByteEquivalentAndNativeEvidenceIsDirectional() {
        Id supplier=[SELECT Original_Supplier__c FROM STEM_Line_Item__c LIMIT 1].Original_Supplier__c;
        STEM_Line_Item__c row=new STEM_Line_Item__c(Original_Supplier__c=supplier,Buy_Currency__c='USD',Sell_Currency__c='USD');
        List<String> parts=new List<String>{'unchanged-existing-fingerprint'};
        VariableChargeInvoiceReadinessService.appendFxFingerprintParts(parts,new List<SObject>{row},new List<SObject>(),supplier,'Buy');
        System.assertEquals(1,parts.size());
        row.Sell_Currency__c='HKD';row.Sell_HKD_Unit_Price__c=780.00000001;
        VariableChargeInvoiceReadinessService.appendFxFingerprintParts(parts,new List<SObject>{row},new List<SObject>(),supplier,'Buy');
        System.assertEquals(1,parts.size(),'Independent sell evidence cannot alter supplier-cost fingerprints.');
        VariableChargeInvoiceReadinessService.appendFxFingerprintParts(parts,new List<SObject>{row},new List<SObject>(),supplier,'Sell');
        System.assertEquals(2,parts.size());System.assert(parts[1].contains('780.00000001'));
        row.Buy_USD_Unit_Price_Precise__c=0.12820513;
        VariableChargeInvoiceReadinessService.appendFxFingerprintParts(parts,new List<SObject>{row},new List<SObject>(),supplier,'Buy');
        System.assertEquals(3,parts.size());System.assert(parts[2].contains('0.12820513'));
    }
    @IsTest static void sameRoundedPreciseBuyChangeInvalidatesOnlyCostApproval() {
        STEM_Line_Item__c oldLine=[SELECT Id,STEM__c,Original_Supplier__c,Cancelled__c,Quantity__c,Quantity_Delivered_Per_BDN__c,
            Unit_Buy_At__c,Unit_Sell_At__c,Buy_Currency__c,Buy_USD_Unit_Price_Precise__c FROM STEM_Line_Item__c LIMIT 1];
        STEM_Variable_Charge_Supplier__c stage=new STEM_Variable_Charge_Supplier__c(STEM__c=oldLine.STEM__c,Supplier__c=oldLine.Original_Supplier__c,
            Manual_Review_Required__c=true,Supplier_Status__c='Verified',Verified_At__c=System.now(),Reviewed_Source_Fingerprint__c='cost-reviewed',
            Buyer_Charge_Status__c='Verified',Buyer_Charge_Confirmed_At__c=System.now(),Buyer_Charge_Reviewed_Source_Fingerprint__c='buyer-reviewed');
        insert stage;
        oldLine.Buy_USD_Unit_Price_Precise__c=0.12820513;
        STEM_Line_Item__c changedLine=oldLine.clone(true,false,false,false);changedLine.Buy_USD_Unit_Price_Precise__c=0.12820514;
        System.assertEquals(oldLine.Unit_Buy_At__c,changedLine.Unit_Buy_At__c);
        Test.startTest();VariableChargeInvoiceReadinessService.invalidateForLineItemChanges(new List<STEM_Line_Item__c>{changedLine},new Map<Id,STEM_Line_Item__c>{oldLine.Id=>oldLine});Test.stopTest();
        stage=[SELECT Supplier_Status__c,Verified_At__c,Buyer_Charge_Status__c,Buyer_Charge_Confirmed_At__c FROM STEM_Variable_Charge_Supplier__c WHERE Id=:stage.Id];
        System.assertEquals('Invalidated',stage.Supplier_Status__c);System.assertEquals(null,stage.Verified_At__c);
        System.assertEquals('Verified',stage.Buyer_Charge_Status__c);System.assertNotEquals(null,stage.Buyer_Charge_Confirmed_At__c);
    }
    @IsTest static void nativeAmendmentEvenBelowPrincipalCentChangesSellEvidenceOnly() {
        STEM_Extra_Cost__c previous=new STEM_Extra_Cost__c(Sell_Currency__c='HKD',Sell_HKD_Unit_Price__c=780,Unit_Price__c=100);
        for(String field:new List<String>{'Sell_HKD_Unit_Price__c','Sell_HKD_Minimum__c','Sell_HKD_Lumpsum__c','Sell_FX_Rate__c'}) {
            STEM_Extra_Cost__c current=previous.clone(false,false,false,false);current.put(field,780.00000001);
            System.assertEquals(true,VariableChargeInvoiceReadinessService.tradeFxChanged(current,previous,'Sell'));
            System.assertEquals(false,VariableChargeInvoiceReadinessService.tradeFxChanged(current,previous,'Buy'));
            System.assertEquals(previous.Unit_Price__c,current.Unit_Price__c);
        }
    }
}
