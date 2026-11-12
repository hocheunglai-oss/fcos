@IsTest
private class FcosTradeProformaServiceTest {
    private static final String ACTOR_LAST_NAME='NativeProformaActor';
    private static final Decimal RATE=Decimal.valueOf('7.800000');
    private static final String RATE_ID='native-proforma-rate';
    private static final String BUYER_PROFORMA_OP='11111111-1111-4111-8111-111111111111';
    private static final String BUYER_FINAL_OP='22222222-2222-4222-8222-222222222222';
    private static final String SUPPLIER_PROFORMA_OP='33333333-3333-4333-8333-333333333333';

    private class RateMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest request) {
            Map<String,Object> payload=(Map<String,Object>)JSON.deserializeUntyped(request.getBody());
            HttpResponse response=new HttpResponse();response.setStatusCode(200);
            response.setBody(JSON.serialize(new Map<String,Object>{'ok'=>true,'purpose'=>payload.get('purpose'),'requestId'=>request.getHeader('x-salesforce-event-id'),
                'rate'=>new Map<String,Object>{'rateId'=>RATE_ID,'revision'=>1,'usdHkdRate'=>String.valueOf(RATE),'effectiveAt'=>'2026-09-10T00:00:00.000Z'}}));
            return response;
        }
    }
    @TestSetup static void fixture() {
        User actor=new User(Alias='natprof',LastName=ACTOR_LAST_NAME,Email='native-proforma@example.invalid',
            Username='native-proforma.'+UserInfo.getOrganizationId()+'.'+System.now().getTime()+'@example.invalid',EmailEncodingKey='UTF-8',
            LanguageLocaleKey='en_US',LocaleSidKey='en_US',TimeZoneSidKey='Asia/Hong_Kong',ProfileId=UserInfo.getProfileId());
        insert actor;insert new PermissionSetAssignment(AssigneeId=actor.Id,PermissionSetId=[SELECT Id FROM PermissionSet WHERE Name='Fcos_Trading_FX_Access' LIMIT 1].Id);
        Test.startTest();
        try {System.runAs(actor) {
            System.assert(Limits.getQueries()<15,'The proforma fixture must start with a fresh query budget.');
            TestDataFactory.prepareDataForNominationConfirmationFlow();
            STEM_Line_Item__c line=[SELECT Id,STEM__c,STEM__r.Port__c,STEM__r.Account__c FROM STEM_Line_Item__c WHERE Cancelled__c=false LIMIT 1];
            update new Port__c(Id=line.STEM__r.Port__c,Country__c='HONG KONG');update new Account(Id=line.STEM__r.Account__c,Banking_Preference__c='DBS');
            update new STEM__c(Id=line.STEM__c,Partial_CIA__c=true);
            DBS_Bank__c bank=DBS_Bank__c.getOrgDefaults();bank.SetupOwnerId=UserInfo.getOrganizationId();bank.Beneficiary_Bank__c='Synthetic test bank';
            bank.Beneficiary__c='FRATELLI COSULICH BUNKERS (HK) LTD';bank.Account_No__c='SYNTHETIC-NOT-A-BANK-ACCOUNT';upsert bank;
            Fcos_Trading_FX_Setting__c setting=Fcos_Trading_FX_Setting__c.getOrgDefaults();setting.SetupOwnerId=UserInfo.getOrganizationId();setting.Enabled__c=true;
            setting.Cash_Enabled__c=true;setting.Endpoint__c='https://fcos.example.invalid/api/salesforce/company-fx';setting.Signing_Secret__c='native-proforma-test-secret';upsert setting;
            System.enqueueJob(new SeedBuyerProforma(line.Id));
        }} finally {Test.stopTest();}
    }
    private static User actor(){return [SELECT Id FROM User WHERE LastName=:ACTOR_LAST_NAME LIMIT 1];}
    private static STEM_Line_Item__c line(){return [SELECT Id,STEM__c,Original_Supplier__c,Buyer_Invoice__c,Supplier_Invoice__c,Issued__c,Supplier_Issued__c FROM STEM_Line_Item__c WHERE Cancelled__c=false LIMIT 1];}
    private static void configure(){FcosCompanyFxRateService.settingsOverride=new Fcos_Trading_FX_Setting__c(Enabled__c=true,Cash_Enabled__c=true,Endpoint__c='https://fcos.example.invalid/api/salesforce/company-fx',Signing_Secret__c='native-proforma-test-secret');Test.setMock(HttpCalloutMock.class,new RateMock());}
    private static void confirm(Id lineId,String direction){
        FcosTradeCurrencyService.Review review=FcosTradeCurrencyController.previewCurrency(lineId,direction,'HKD');
        FcosTradeCurrencyController.saveDraft(lineId,direction,'HKD',Decimal.valueOf('780.00000000'),review.fingerprint,review.rateId,true);
    }
    private static Invoice__c buyerProforma(){return [SELECT Id FROM Invoice__c WHERE Document_Operation_Id__c=:BUYER_PROFORMA_OP LIMIT 1];}
    private class SeedBuyerProforma implements Queueable,Database.AllowsCallouts {
        private final Id lineId;
        SeedBuyerProforma(Id lineId){this.lineId=lineId;}
        public void execute(QueueableContext context) {
            configure();STEM_Line_Item__c source=[SELECT Id,STEM__c,Buyer_Invoice__c,Issued__c FROM STEM_Line_Item__c WHERE Id=:lineId];
            confirm(source.Id,'Sell');List<Id> ids=new List<Id>{source.Id};
            FcosTradeProformaService.Review review=FcosTradeProformaService.previewProforma(source.STEM__c,'Sell',null,ids,'PF-BUYER-1',Date.newInstance(2026,9,10),Date.newInstance(2026,9,10),Date.newInstance(2026,9,20),Decimal.valueOf('7800'),Date.newInstance(2026,9,12));
            try{FcosTradeProformaService.recordProforma(source.STEM__c,'Sell',null,ids,'PF-BUYER-1',Date.newInstance(2026,9,10),Date.newInstance(2026,9,10),Date.newInstance(2026,9,20),Decimal.valueOf('7800'),Date.newInstance(2026,9,12),'stale',BUYER_PROFORMA_OP);System.assert(false,'Stale review must fail.');}catch(AuraHandledException expected){System.assertNotEquals(null,expected.getMessage());}
            Id proformaId=FcosTradeProformaService.recordProforma(source.STEM__c,'Sell',null,ids,'PF-BUYER-1',Date.newInstance(2026,9,10),Date.newInstance(2026,9,10),Date.newInstance(2026,9,20),Decimal.valueOf('7800'),Date.newInstance(2026,9,12),review.fingerprint,BUYER_PROFORMA_OP);
            Invoice__c proforma=[SELECT Proforma__c,Final_Of_Proforma__c,Deposit_Requested_HKD__c,Deposit_Requested_USD__c,Deposit_Due_Date__c,Document_Request_Fingerprint__c FROM Invoice__c WHERE Id=:proformaId];
            System.assertEquals(true,proforma.Proforma__c);System.assertEquals(null,proforma.Final_Of_Proforma__c);System.assertEquals(Decimal.valueOf('7800'),proforma.Deposit_Requested_HKD__c);
            System.assertEquals(Decimal.valueOf('1000'),proforma.Deposit_Requested_USD__c);System.assertNotEquals(review.fingerprint,proforma.Document_Request_Fingerprint__c,'The persisted operation request binds the reviewed token and every normalized API argument.');
            System.assertEquals(proformaId,FcosTradeProformaService.recordProforma(source.STEM__c,'Sell',null,ids,'PF-BUYER-1',Date.newInstance(2026,9,10),Date.newInstance(2026,9,10),Date.newInstance(2026,9,20),Decimal.valueOf('7800'),Date.newInstance(2026,9,12),review.fingerprint,BUYER_PROFORMA_OP));
            try{FcosTradeProformaService.recordProforma(source.STEM__c,'Sell',null,ids,'PF-BUYER-1',Date.newInstance(2026,9,10),Date.newInstance(2026,9,10),Date.newInstance(2026,9,20),Decimal.valueOf('7800.01'),Date.newInstance(2026,9,12),review.fingerprint,BUYER_PROFORMA_OP);System.assert(false,'Changed input with an old review and UUID must not return the old document.');}catch(AuraHandledException expected){System.assertNotEquals(null,expected.getMessage());}
            source=line();System.assertEquals(null,source.Buyer_Invoice__c);System.assertNotEquals(true,source.Issued__c,'A proforma never issues its source line.');
            String pdf=FcosTradeProformaService.generateDocument(proformaId);System.assertNotEquals(null,pdf);source=line();System.assertEquals(null,source.Buyer_Invoice__c);
        }
    }
    private class FinalizeBuyerProforma implements Queueable,Database.AllowsCallouts {
        private final Id proformaId;
        FinalizeBuyerProforma(Id proformaId){this.proformaId=proformaId;}
        public void execute(QueueableContext context) {
            configure();STEM_Line_Item__c source=line();
            update new STEM_Line_Item__c(Id=source.Id,Quantity__c=5,Quantity_Delivered_Per_BDN__c=5);
            FcosTradeCurrencyService.Review amended=FcosTradeCurrencyService.review(source.Id,'Sell',null);System.assertEquals(true,amended.needsConfirmation);
            FcosTradeCurrencyService.save(source.Id,'Sell','HKD',Decimal.valueOf('780.00000000'),amended.fingerprint,null,true);
            FcosTradeProformaService.Review finalReview=FcosTradeProformaService.previewFinal(proformaId,'INV-BUYER-1',Date.newInstance(2026,9,13),Date.newInstance(2026,9,10),Date.newInstance(2026,9,23));
            System.assert(finalReview.nativeTotal<Decimal.valueOf('7800'),'A lower reconfirmed gross keeps the historical proforma deposit request for later refund or reallocation.');
            Id finalId=FcosTradeProformaService.recordFinal(proformaId,'INV-BUYER-1',Date.newInstance(2026,9,13),Date.newInstance(2026,9,10),Date.newInstance(2026,9,23),finalReview.fingerprint,BUYER_FINAL_OP);
            System.assertEquals(finalId,FcosTradeProformaService.recordFinal(proformaId,'INV-BUYER-1',Date.newInstance(2026,9,13),Date.newInstance(2026,9,10),Date.newInstance(2026,9,23),finalReview.fingerprint,BUYER_FINAL_OP));
            try{FcosTradeProformaService.recordFinal(proformaId,'INV-BUYER-CHANGED',Date.newInstance(2026,9,13),Date.newInstance(2026,9,10),Date.newInstance(2026,9,23),finalReview.fingerprint,BUYER_FINAL_OP);System.assert(false,'Changed final arguments cannot reuse an earlier operation UUID.');}catch(AuraHandledException expected){System.assertNotEquals(null,expected.getMessage());}
            Invoice__c finalDocument=[SELECT Proforma__c,Final_Of_Proforma__c,Document_FX_Rate__c,Deposit_Requested_HKD__c FROM Invoice__c WHERE Id=:finalId];
            System.assertEquals(false,finalDocument.Proforma__c);System.assertEquals(proformaId,finalDocument.Final_Of_Proforma__c);System.assertEquals(RATE,finalDocument.Document_FX_Rate__c);System.assertEquals(Decimal.valueOf('7800'),finalDocument.Deposit_Requested_HKD__c);
            source=line();System.assertEquals(finalId,source.Buyer_Invoice__c);System.assertEquals(true,source.Issued__c);
            Trade_Document_Line__c finalLine=[SELECT Original_Line__c FROM Trade_Document_Line__c WHERE Buyer_Invoice__c=:finalId LIMIT 1];System.assertNotEquals(null,finalLine.Original_Line__c,'Final evidence must trace to the immutable proforma line.');
            try{FcosTradeProformaService.recordFinal(proformaId,'INV-BUYER-1',Date.newInstance(2026,9,13),Date.newInstance(2026,9,10),Date.newInstance(2026,9,23),finalReview.fingerprint,'44444444-4444-4444-8444-444444444444');System.assert(false,'A proforma permits one economic final.');}catch(AuraHandledException expected){System.assertNotEquals(null,expected.getMessage());}
            try{update new Invoice__c(Id=proformaId,Deposit_Requested_HKD__c=Decimal.valueOf('1'));System.assert(false,'Reviewed deposit terms must be immutable.');}catch(DmlException expected){System.assert(expected.getMessage().contains('immutable')||expected.getMessage().contains('workflow'));}
        }
    }
    @IsTest static void subCentDepositCannotBeSilentlyRounded(){System.runAs(actor()){configure();STEM_Line_Item__c source=line();Test.startTest();System.enqueueJob(new RejectSubCent(source.Id));Test.stopTest();}}
    private class RejectSubCent implements Queueable,Database.AllowsCallouts {private Id lineId;RejectSubCent(Id value){lineId=value;}public void execute(QueueableContext context){configure();STEM_Line_Item__c source=[SELECT Id,STEM__c,Original_Supplier__c FROM STEM_Line_Item__c WHERE Id=:lineId];confirm(source.Id,'Buy');Boolean rejected=false;try{FcosTradeProformaService.previewProforma(source.STEM__c,'Buy',source.Original_Supplier__c,new List<Id>{source.Id},'PF-SUBCENT',Date.today(),Date.today(),Date.today().addDays(10),Decimal.valueOf('1.001'),Date.today().addDays(1));}catch(AuraHandledException expected){rejected=true;}System.assert(rejected,'Sub-cent deposit input must be rejected instead of rounded.');}}
    private class SupplierFlow implements Queueable,Database.AllowsCallouts {
        public void execute(QueueableContext context) {
            configure();STEM_Line_Item__c source=line();confirm(source.Id,'Buy');List<Id> ids=new List<Id>{source.Id};
            FcosTradeProformaService.Review review=FcosTradeProformaService.previewProforma(source.STEM__c,'Buy',source.Original_Supplier__c,ids,'PF-SUPPLIER-1',Date.newInstance(2026,9,10),Date.newInstance(2026,9,10),Date.newInstance(2026,9,20),Decimal.valueOf('3900'),Date.newInstance(2026,9,12));
            Id proformaId=FcosTradeProformaService.recordProforma(source.STEM__c,'Buy',source.Original_Supplier__c,ids,'PF-SUPPLIER-1',Date.newInstance(2026,9,10),Date.newInstance(2026,9,10),Date.newInstance(2026,9,20),Decimal.valueOf('3900'),Date.newInstance(2026,9,12),review.fingerprint,SUPPLIER_PROFORMA_OP);
            Supplier_Invoice__c proforma=[SELECT Proforma__c,Deposit_Requested_HKD__c,Deposit_Requested_USD__c,Document_FX_Side__c FROM Supplier_Invoice__c WHERE Id=:proformaId];
            System.assertEquals(true,proforma.Proforma__c);System.assertEquals(Decimal.valueOf('3900'),proforma.Deposit_Requested_HKD__c);System.assertEquals(Decimal.valueOf('500'),proforma.Deposit_Requested_USD__c);System.assertNotEquals(null,proforma.Document_FX_Side__c);
            source=line();System.assertEquals(null,source.Supplier_Invoice__c);System.assertNotEquals(true,source.Supplier_Issued__c);System.assertNotEquals(null,FcosTradeProformaService.generateDocument(proformaId));
        }
    }
    @IsTest static void buyerProformaRemainsNonpostingAndFinalIsIdempotent(){System.runAs(actor()){Invoice__c proforma=buyerProforma();Test.startTest();System.enqueueJob(new FinalizeBuyerProforma(proforma.Id));Test.stopTest();}}
    @IsTest static void supplierProformaPreservesEvidenceWithoutClaimingLines(){System.runAs(actor()){Test.startTest();System.enqueueJob(new SupplierFlow());Test.stopTest();}}
}
