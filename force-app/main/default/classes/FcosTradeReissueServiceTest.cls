@IsTest
private class FcosTradeReissueServiceTest {
    private static Id fakeId(Schema.SObjectType type) { return Id.valueOf(type.getDescribe().getKeyPrefix()+'000000000001'); }
    private static Trade_Document_Line__c originalLine() {
        return new Trade_Document_Line__c(Id=fakeId(Trade_Document_Line__c.SObjectType),Source_Record_Id__c=String.valueOf(fakeId(STEM_Line_Item__c.SObjectType)),
            Description__c='Fuel',Unit__c='MT',Quantity__c=10,Native_Unit_Price__c=780,Native_Amount__c=7800,Accounting_USD__c=1000,
            Currency__c='HKD',FX_Rate__c=7.8,FX_Revision__c='rate-1');
    }
    private static Trade_Document_Line__c inverse(Trade_Document_Line__c original) {
        return new Trade_Document_Line__c(Id=fakeId(Trade_Document_Line__c.SObjectType),Original_Line__c=original.Id,Source_Record_Id__c=original.Source_Record_Id__c,
            Description__c=original.Description__c,Unit__c=original.Unit__c,Quantity__c=original.Quantity__c,Native_Unit_Price__c=-780,Native_Amount__c=-7800,
            Accounting_USD__c=-1000,Currency__c='HKD',FX_Rate__c=7.8,FX_Revision__c='rate-1');
    }

    @IsTest static void fullCreditRequiresExactImmutableInverseLineage() {
        Trade_Document_Line__c original=originalLine();Trade_Document_Line__c credit=inverse(original);
        FcosTradeReissueService.assertInverseSnapshots(new List<Trade_Document_Line__c>{original},new List<Trade_Document_Line__c>{credit});
        credit.Native_Amount__c=-7799;
        Boolean rejected=false;
        try { FcosTradeReissueService.assertInverseSnapshots(new List<Trade_Document_Line__c>{original},new List<Trade_Document_Line__c>{credit}); }
        catch(AuraHandledException expected) { rejected=true; }
        System.assertEquals(true,rejected,'A non-inverse credit must reject release.');
    }

    @IsTest static void releaseAuthorizationPermitsOnlyTheCreditedSideDetachAndLineageStamp() {
        Id originalId=fakeId(Invoice__c.SObjectType),oppositeId=fakeId(Supplier_Invoice__c.SObjectType),lineId=fakeId(STEM_Line_Item__c.SObjectType);
        STEM_Line_Item__c oldRow=new STEM_Line_Item__c(Id=lineId,Buyer_Invoice__c=originalId,Supplier_Invoice__c=oppositeId);
        STEM_Line_Item__c released=oldRow.clone(true,false,false,false);
        released.Buyer_Invoice__c=null;released.Reissue_Of_Buyer_Invoice__c=originalId;
        FcosTradeReissueService.authorizeForTest(new List<SObject>{released},originalId,'Sell');
        System.assertEquals(true,FcosTradeReissueService.isAuthorizedRelease(released,oldRow));
        released.Supplier_Invoice__c=null;
        System.assertEquals(false,FcosTradeReissueService.isAuthorizedRelease(released,oldRow),'A buyer release cannot change the supplier-side link.');
        FcosTradeReissueService.clearAuthorizationForTest();
    }

    @IsTest static void originalReleaseAuditFieldsNeedScopedAuthorization() {
        Invoice__c oldRow=new Invoice__c(Id=fakeId(Invoice__c.SObjectType));
        Invoice__c released=oldRow.clone(true,false,false,false);
        released.Reissue_Released_At__c=System.now();released.Reissue_Released_By__c=UserInfo.getUserId();
        System.assertEquals(false,FcosTradeReissueService.isAuthorizedDocumentRelease(released,oldRow));
        FcosTradeReissueService.authorizeDocumentForTest(released.Id);
        System.assertEquals(true,FcosTradeReissueService.isAuthorizedDocumentRelease(released,oldRow));
        FcosTradeReissueService.clearAuthorizationForTest();
    }
}
