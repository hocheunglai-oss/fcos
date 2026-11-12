@IsTest
private class FcosTradePaymentIntegrationTest {
    private class RateMock implements HttpCalloutMock {
        private final Boolean available;
        RateMock(Boolean available) { this.available = available; }
        public HttpResponse respond(HttpRequest request) {
            Map<String,Object> body=(Map<String,Object>)JSON.deserializeUntyped(request.getBody());
            System.assertEquals('payment',body.get('purpose'));
            System.assertEquals('2026-09-10',body.get('paymentDate'));
            HttpResponse response=new HttpResponse();response.setStatusCode(available?200:404);
            response.setBody(available?JSON.serialize(new Map<String,Object>{'ok'=>true,'purpose'=>'payment',
                'requestId'=>request.getHeader('x-salesforce-event-id'),'rate'=>new Map<String,Object>{
                    'rateId'=>'payment-day-rate','revision'=>2,'usdHkdRate'=>'8.000000','effectiveAt'=>'2026-09-09T16:00:00.000Z'}}):'{"ok":false}');
            return response;
        }
    }
    private static void configure(Boolean available) {
        FcosCompanyFxRateService.settingsOverride=new Fcos_Trading_FX_Setting__c(Enabled__c=true,
            Endpoint__c='https://fcos.example.invalid/api/salesforce/company-fx',Signing_Secret__c='dedicated-payment-integration-test-secret');
        Test.setMock(HttpCalloutMock.class,new RateMock(available));
    }
    @TestSetup static void fixtures() {
        User actor=new User(Alias='fxpay',LastName='FxPaymentIntegration',Email='fxpay@example.invalid',
            Username='fxpay.'+UserInfo.getOrganizationId()+'.'+System.now().getTime()+'@example.invalid',
            EmailEncodingKey='UTF-8',LanguageLocaleKey='en_US',LocaleSidKey='en_US',TimeZoneSidKey='Asia/Hong_Kong',ProfileId=UserInfo.getProfileId());
        insert actor;
        List<PermissionSetAssignment> assignments=new List<PermissionSetAssignment>();
        for(PermissionSet permission:[SELECT Id FROM PermissionSet WHERE Name IN ('Fcos_Trading_FX_Access','FCOS_Variable_Charges_User')])
            assignments.add(new PermissionSetAssignment(AssigneeId=actor.Id,PermissionSetId=permission.Id));
        insert assignments;
        System.runAs(actor) {
            TestDataFactory.prepareDataForNominationConfirmationFlow();
            STEM_Line_Item__c line=[SELECT Id,STEM__c,STEM__r.Port__c,STEM__r.Account__c FROM STEM_Line_Item__c WHERE Cancelled__c=false LIMIT 1];
            ContextManager.skipTriggers=true;
            try {
                update new Port__c(Id=line.STEM__r.Port__c,Name='Hong Kong',Port_Area__c='Hong Kong',Country__c='HONG KONG');
                update new Account(Id=line.STEM__r.Account__c,Banking_Preference__c='DBS');
                update new STEM__c(Id=line.STEM__c,Partial_CIA__c=false);
                update new STEM_Line_Item__c(Id=line.Id,Quantity__c=10,Quantity_Delivered_Per_BDN__c=10);
            } finally {ContextManager.skipTriggers=false;}
            DBS_Bank__c bank=DBS_Bank__c.getOrgDefaults();bank.SetupOwnerId=UserInfo.getOrganizationId();
            bank.Beneficiary_Bank__c='Synthetic test bank';bank.Beneficiary__c='FRATELLI COSULICH BUNKERS (HK) LTD';bank.Account_No__c='SYNTHETIC-NOT-A-BANK-ACCOUNT';upsert bank;
            Test.startTest();
            try {configure(true);System.enqueueJob(new SeedIssuedDocuments(line.Id));}
            finally {Test.stopTest();}
        }
    }
    private static User actor() {return [SELECT Id FROM User WHERE LastName='FxPaymentIntegration' LIMIT 1];}
    private static Invoice__c buyerInvoice() {
        return [SELECT Id,Document_HKD_Amount__c,Amount__c FROM Invoice__c WHERE Document_Currency__c='HKD' AND Original_Invoice__c=null LIMIT 1];
    }
    private static Supplier_Invoice__c supplierInvoice() {
        return [SELECT Id,Document_HKD_Amount__c,Invoice_Amount__c FROM Supplier_Invoice__c WHERE Document_Currency__c='HKD' AND Original_Supplier_Invoice__c=null LIMIT 1];
    }
    private static Id post(Id invoiceId,Decimal amount,String operationId) {
        return FcosTradePaymentService.recordPayment(invoiceId,amount,Date.newInstance(2026,9,10),'payment-day-rate','DBS','HKD',amount.abs(),'synthetic-statement',operationId);
    }
    private static Id credit(Id originalId,String reason) {
        FcosTradeCreditService.CreditReview review=FcosTradeCreditService.preview(originalId);
        Id creditId=FcosTradeCreditService.recordCredit(originalId,review.fingerprint,Date.newInstance(2026,9,2),reason);
        FcosTradeCreditService.generateCreditPdf(creditId);
        return creditId;
    }
    private static void attachPdf(Id documentId,String field,String title) {
        ContentVersion version=new ContentVersion(Title=title,PathOnClient=title+'.pdf',VersionData=Blob.valueOf('issued test PDF'),FirstPublishLocationId=documentId);
        insert version;version=[SELECT ContentDocumentId FROM ContentVersion WHERE Id=:version.Id];
        SObject document=documentId.getSObjectType().newSObject(documentId);
        document.put(field,URL.getOrgDomainURL().toExternalForm()+'/'+version.ContentDocumentId);update document;
    }
    private class SeedIssuedDocuments implements Queueable,Database.AllowsCallouts {
        private final Id lineId;
        SeedIssuedDocuments(Id lineId) {this.lineId=lineId;}
        public void execute(QueueableContext context) {
            FcosCompanyFxRateService.settingsOverride=new Fcos_Trading_FX_Setting__c(Enabled__c=true,
                Endpoint__c='https://fcos.example.invalid/api/salesforce/company-fx',Signing_Secret__c='dedicated-payment-integration-test-secret');
            STEM_Line_Item__c line=[SELECT Id,STEM__c,Original_Supplier__c FROM STEM_Line_Item__c WHERE Id=:lineId];
            FcosCompanyFxRateService.Snapshot invoiceRate=new FcosCompanyFxRateService.Snapshot();
            invoiceRate.rateId='invoice-rate';invoiceRate.usdHkdRate=7.8;invoiceRate.effectiveAt=Datetime.newInstanceGmt(2026,9,1,0,0,0);
            FcosTradeCurrencyService.Review sell=FcosTradeCurrencyService.review(line.Id,'Sell',invoiceRate);
            FcosTradeCurrencyService.save(line.Id,'Sell','HKD',780,sell.fingerprint,invoiceRate,true);
            List<String> ids=new List<String>{String.valueOf(line.Id)};
            FcosTradeDocumentService.DocumentReview buyerReview=FcosTradeDocumentService.preview(
                line.STEM__c,'Sell',null,new List<Id>{line.Id});
            Invoice__c buyer=InvoiceController.createReviewedInvoice(String.valueOf(line.STEM__c),ids,false,false,
                Date.newInstance(2026,9,1),Date.newInstance(2026,9,1),Date.newInstance(2026,9,10),buyerReview.fingerprint);
            InvoiceController.generateInvoicePDF(String.valueOf(buyer.Id),'Payment integration buyer invoice',ids,null,false,buyerReview.fingerprint);

            FcosTradeCurrencyService.Review buy=FcosTradeCurrencyService.review(line.Id,'Buy',invoiceRate);
            FcosTradeCurrencyService.save(line.Id,'Buy','HKD',780,buy.fingerprint,invoiceRate,true);
            FcosTradeDocumentService.DocumentReview supplierReview=FcosTradeDocumentService.preview(line.STEM__c,'Buy',line.Original_Supplier__c,new List<Id>{line.Id});
            Map<String,Object> fields=new Map<String,Object>{'Name'=>'FX-PAYMENT-SUPPLIER-1','Bank_Details__c'=>'Synthetic supplier bank instructions',
                'Invoice_Date__c'=>Date.newInstance(2026,9,1),'Supplier_Delivery_Date__c'=>Date.newInstance(2026,9,1)};
            Id supplierId=FcosTradeDocumentService.recordSupplierInvoice(line.STEM__c,line.Original_Supplier__c,new List<Id>{line.Id},supplierReview.fingerprint,fields);
            attachPdf(supplierId,'Invoice_File__c','Payment integration supplier invoice');
        }
    }
    @IsTest static void originalPaymentsUseConfirmedNativeEvidenceBeforeAnyCredit() {
        System.runAs(actor()) {
            configure(true);Invoice__c original=buyerInvoice();
            Test.startTest();Id paymentId=post(original.Id,780,'10000000-0000-4000-8000-000000000001');Test.stopTest();
            Payment__c payment=[SELECT Amount__c,Payment_HKD_Amount__c,Invoice_Carrying_USD__c,Settlement_FX_USD__c,Payment_FX_Revision__c,Buyer_Invoice__c FROM Payment__c WHERE Id=:paymentId];
            System.assertEquals(Decimal.valueOf('97.50'),payment.Amount__c);System.assertEquals(Decimal.valueOf('100'),payment.Invoice_Carrying_USD__c);
            System.assertEquals(Decimal.valueOf('-2.50'),payment.Settlement_FX_USD__c);System.assertEquals(original.Id,payment.Buyer_Invoice__c);
            System.assertEquals('payment-day-rate',payment.Payment_FX_Revision__c);
        }
    }
    private class PostCashThenCredit implements Queueable,Database.AllowsCallouts {
        private final Id originalId;
        private final String operationId;
        PostCashThenCredit(Id originalId,String operationId) {this.originalId=originalId;this.operationId=operationId;}
        public void execute(QueueableContext context) {
            configure(true);post(originalId,780,operationId);
            credit(originalId,'Full credit after a partial native settlement');
        }
    }
    private static Id linkedCredit(Id originalId) {
        if(originalId.getSObjectType()==Invoice__c.SObjectType)
            return [SELECT Id FROM Invoice__c WHERE Original_Invoice__c=:originalId LIMIT 1].Id;
        return [SELECT Id FROM Supplier_Invoice__c WHERE Original_Supplier_Invoice__c=:originalId LIMIT 1].Id;
    }
    private static void assertOriginalLockedAndCreditUnpaid(Id originalId,String firstOperation,String secondOperation) {
        Id creditId=linkedCredit(originalId);
        Boolean previewRejected=false,postRejected=false;
        try {FcosTradePaymentService.previewAllocation(originalId,null,null);} catch(AuraHandledException expected) {previewRejected=true;}
        try {post(originalId,780,firstOperation);} catch(AuraHandledException expected) {postRejected=true;}
        System.assert(previewRejected,'A linked credit must lock its original against further settlements.');
        System.assert(postRejected,'A linked credit must lock its original against further settlements.');
        FcosTradePaymentService.PaymentAllocationReview review=FcosTradePaymentService.previewAllocation(creditId,null,null);
        System.assertEquals(Decimal.valueOf('0'),review.remainingNative,'An unpaid original provides no cash refund entitlement.');
        Boolean refundRejected=false;
        try {post(creditId,-1,secondOperation);} catch(AuraHandledException expected) {refundRejected=true;}
        System.assert(refundRejected,'An unpaid credit is an accounting allocation, not a cash refund.');
    }
    private class AssertOriginalLockedAndCreditUnpaid implements Queueable,Database.AllowsCallouts {
        private final Id originalId;
        private final String firstOperation;
        private final String secondOperation;
        AssertOriginalLockedAndCreditUnpaid(Id originalId,String firstOperation,String secondOperation) {
            this.originalId=originalId;this.firstOperation=firstOperation;this.secondOperation=secondOperation;
        }
        public void execute(QueueableContext context) {
            configure(true);assertOriginalLockedAndCreditUnpaid(originalId,firstOperation,secondOperation);
        }
    }
    @IsTest static void buyerCreditRejectsNewPaymentsAndUnpaidRefunds() {
        assertOriginalWithCreditRejectsPaymentsAndUnpaidRefunds(true);
    }
    @IsTest static void supplierCreditRejectsNewPaymentsAndUnpaidRefunds() {
        assertOriginalWithCreditRejectsPaymentsAndUnpaidRefunds(false);
    }
    private static void assertOriginalWithCreditRejectsPaymentsAndUnpaidRefunds(Boolean buyer) {
        System.runAs(actor()) {
            configure(true);
            Id originalId=buyer ? buyerInvoice().Id : supplierInvoice().Id;
            Test.startTest();
            try {
                credit(originalId,'Full credit before payment');
                System.enqueueJob(new AssertOriginalLockedAndCreditUnpaid(originalId,
                    '30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002'));
            } finally {Test.stopTest();}
        }
    }
    @IsTest static void completedPreCreditPaymentRetryReturnsExistingRecord() {
        System.runAs(actor()) {
            Invoice__c original=buyerInvoice();configure(true);Test.startTest();
            System.enqueueJob(new PostCashThenCredit(original.Id,'20000000-0000-4000-8000-000000000001'));Test.stopTest();
            configure(false);Id retry=post(original.Id,780,'20000000-0000-4000-8000-000000000001');
            System.assertEquals(1,[SELECT COUNT() FROM Payment__c WHERE Buyer_Invoice__c=:original.Id]);System.assertNotEquals(null,retry);
        }
    }
    private static void assertPartialRefundRemaining(Id originalId,Boolean supplier,String paymentOperation,String refundOperation) {
        configure(true);Test.startTest();System.enqueueJob(new PostCashThenCredit(originalId,paymentOperation));Test.stopTest();
        Id creditId=linkedCredit(originalId);
        FcosTradePaymentService.PaymentAllocationReview initial=FcosTradePaymentService.previewAllocation(creditId,null,null);
        System.assertEquals(Decimal.valueOf('-780'),initial.remainingNative);
        Id firstRefund=post(creditId,-300,refundOperation);System.assertNotEquals(null,firstRefund);
        FcosTradePaymentService.PaymentAllocationReview remaining=FcosTradePaymentService.previewAllocation(creditId,null,null);
        System.assertEquals(Decimal.valueOf('-480'),remaining.remainingNative,'Prior refunds reduce the cash cap, not the credit face.');
        Payment__c refund=[SELECT Invoice_Carrying_USD__c FROM Payment__c WHERE Id=:firstRefund];
        System.assertEquals(Decimal.valueOf('-38.46'),refund.Invoice_Carrying_USD__c);
    }
    @IsTest static void buyerPartialRefundShowsOnlyRemainingOriginalCash() {
        System.runAs(actor()) {assertPartialRefundRemaining(buyerInvoice().Id,false,'40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002');}
    }
    @IsTest static void supplierPartialRefundShowsOnlyRemainingOriginalCash() {
        System.runAs(actor()) {assertPartialRefundRemaining(supplierInvoice().Id,true,'50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002');}
    }
    @IsTest static void fullRefundCanRetryAfterCashCapIsZero() {
        System.runAs(actor()) {
            Invoice__c original=buyerInvoice();configure(true);Test.startTest();
            System.enqueueJob(new PostCashThenCredit(original.Id,'60000000-0000-4000-8000-000000000001'));Test.stopTest();
            Id creditId=linkedCredit(original.Id);Id refund=post(creditId,-780,'60000000-0000-4000-8000-000000000002');
            configure(false);Id retry=post(creditId,-780,'60000000-0000-4000-8000-000000000002');
            System.assertEquals(refund,retry);
        }
    }
    @IsTest static void creditRejectsCashAboveOriginalPaidAmount() {
        System.runAs(actor()) {
            Invoice__c original=buyerInvoice();configure(true);Test.startTest();
            System.enqueueJob(new PostCashThenCredit(original.Id,'70000000-0000-4000-8000-000000000001'));Test.stopTest();
            Boolean rejected=false;try {post(linkedCredit(original.Id),Decimal.valueOf('-780.01'),'70000000-0000-4000-8000-000000000002');} catch(AuraHandledException expected) {rejected=true;}
            System.assert(rejected);
        }
    }
    @IsTest static void missingHistoricalRateLeavesNoPayment() {
        System.runAs(actor()) {
            configure(false);Invoice__c original=buyerInvoice();Boolean rejected=false;
            Test.startTest();try {post(original.Id,780,'60000000-0000-4000-8000-000000000001');} catch(FcosCompanyFxRateService.FxException expected) {rejected=true;} Test.stopTest();
            System.assert(rejected);System.assertEquals(0,[SELECT COUNT() FROM Payment__c WHERE Buyer_Invoice__c=:original.Id]);
        }
    }
    @IsTest static void futureHkdPaymentDateIsRejectedBeforeDml() {
        System.runAs(actor()) {
            configure(true);Invoice__c original=buyerInvoice();
            Date futureDate=Date.valueOf(Datetime.now().format('yyyy-MM-dd','Asia/Hong_Kong')).addDays(1);
            String operationId='80000000-0000-4000-8000-000000000001';Boolean rejected=false;
            Test.startTest();
            try {
                FcosTradePaymentService.recordPayment(original.Id,780,futureDate,'future-rate','DBS','HKD',780,
                    'future synthetic statement',operationId);
            } catch(AuraHandledException expected) {rejected=true;}
            Test.stopTest();
            System.assert(rejected,'A planned future date must not be accepted as actual HKD bank cash.');
            System.assertEquals(0,[SELECT COUNT() FROM Payment__c WHERE Payment_Operation_Id__c=:operationId],
                'Rejecting a future date must leave no payment evidence.');
        }
    }
}
