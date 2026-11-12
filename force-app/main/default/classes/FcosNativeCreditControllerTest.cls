@IsTest
private class FcosNativeCreditControllerTest {
    @IsTest static void managedUsdCreditUsesOriginalLineageWithoutFx() {
        Id side=(Id)(Trade_Currency_Side__c.SObjectType.getDescribe().getKeyPrefix()+'000000000001');
        Invoice__c original=new Invoice__c(Document_Currency__c='USD',
            Reissue_Of_Invoice__c=(Id)(Invoice__c.SObjectType.getDescribe().getKeyPrefix()+'000000000001'),
            Document_FX_Side__c=side,Document_FX_Fingerprint__c='usd-review',Document_FX_Confirmed_At__c=System.now());
        Invoice__c credit=new Invoice__c(Document_Currency__c='USD',Amount__c=-100.12,Document_FX_Side__c=side,Document_FX_Confirmed_At__c=System.now());
        Trade_Document_Line__c detail=new Trade_Document_Line__c(Currency__c='USD',Pricing_Mode__c='Lumpsum',Native_Lumpsum__c=100.12,Native_Amount__c=-100.12,Accounting_USD__c=-100.12);
        FcosNativeCreditController.validateProjection(credit,original,new List<Trade_Document_Line__c>{detail});
        for(String drift:new List<String>{'legacy','creditSide','originalRate','creditRate','lineCurrency','lineRate','accounting','total'}) {
            Invoice__c source=original.clone(false,false,false,false);Invoice__c saved=credit.clone(false,false,false,false);
            Trade_Document_Line__c line=detail.clone(false,false,false,false);
            if(drift=='legacy') {source.Reissue_Of_Invoice__c=null;source.Document_FX_Side__c=null;source.Document_FX_Confirmed_At__c=null;source.Document_FX_Fingerprint__c=null;}
            if(drift=='creditSide') saved.Document_FX_Side__c=(Id)(Trade_Currency_Side__c.SObjectType.getDescribe().getKeyPrefix()+'000000000002');
            if(drift=='originalRate') source.Document_FX_Rate__c=1;
            if(drift=='creditRate') saved.Document_FX_Rate__c=1;
            if(drift=='lineCurrency') line.Currency__c='HKD';
            if(drift=='lineRate') line.FX_Rate__c=1;
            if(drift=='accounting') line.Accounting_USD__c=-99;
            if(drift=='total') saved.Amount__c=-99;
            Boolean rejected=false;
            try {FcosNativeCreditController.validateProjection(saved,source,new List<Trade_Document_Line__c>{line});}
            catch(FcosNativeCreditController.NativeCreditException expected) {rejected=true;}
            System.assert(rejected,drift+' must fail closed.');
        }
    }
    @IsTest static void hkdCreditRetainsOriginalRateAndFinalRoundedTotal() {
        Invoice__c original=new Invoice__c(Document_Currency__c='HKD',Document_FX_Rate__c=7.8,Document_FX_Revision__c='original');
        Invoice__c credit=new Invoice__c(Document_Currency__c='HKD',Amount__c=-0.01,Document_HKD_Amount__c=-0.04,Document_FX_Rate__c=7.8,Document_FX_Revision__c='original',Document_FX_Confirmed_At__c=System.now());
        Trade_Document_Line__c line=new Trade_Document_Line__c(Currency__c='HKD',Pricing_Mode__c='Unit',Quantity__c=1,Native_Unit_Price__c=-0.0389,Native_Amount__c=-0.0389,FX_Rate__c=7.8,FX_Revision__c='original');
        FcosNativeCreditController.validateProjection(credit,original,new List<Trade_Document_Line__c>{line});
        line.FX_Revision__c='new';Boolean rejected=false;
        try {FcosNativeCreditController.validateProjection(credit,original,new List<Trade_Document_Line__c>{line});}
        catch(FcosNativeCreditController.NativeCreditException expected) {rejected=true;}
        System.assert(rejected);
    }
    @IsTest static void creditReversesExactPricesAcrossSixDecimalRoundingBoundary() {
        Invoice__c original=new Invoice__c(Document_Currency__c='HKD',Document_FX_Rate__c=7.8,Document_FX_Revision__c='original');
        Invoice__c credit=new Invoice__c(Document_Currency__c='HKD',Amount__c=-0.13,Document_HKD_Amount__c=-1,
            Document_FX_Rate__c=7.8,Document_FX_Revision__c='original',Document_FX_Confirmed_At__c=System.now());
        Trade_Document_Line__c line=new Trade_Document_Line__c(Currency__c='HKD',Pricing_Mode__c='Unit',Quantity__c=1,
            Native_Unit_Price__c=-1.00499960,Native_Amount__c=-1.005000,FX_Rate__c=7.8,FX_Revision__c='original');
        FcosNativeCreditController.validateProjection(credit,original,new List<Trade_Document_Line__c>{line});
    }
    @IsTest static void presentationRequiresFrozenCounterparty() {
        String snapshot=JSON.serialize(new Map<String,String>{'version'=>'1','legalEntity'=>'Saved seller','supplierName'=>'Saved supplier','companyContact'=>'Saved contact'});
        System.assertEquals('Saved supplier',FcosNativeCreditController.readPresentation(snapshot,false).get('supplierName'));
        Boolean rejected=false;
        try {FcosNativeCreditController.readPresentation(null,false);}
        catch(FcosNativeCreditController.NativeCreditException expected) {rejected=true;}
        System.assert(rejected);
    }
}
