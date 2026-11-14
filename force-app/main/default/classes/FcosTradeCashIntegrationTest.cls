@IsTest
private class FcosTradeCashIntegrationTest {
    private static final String ACTOR_LAST_NAME='TradeCashIntegration';
    private static final String DENIED_LAST_NAME='TradeCashDenied';
    private static final String BASE_LINE_NAME='Cash Supplier One Line';
    private static final String SECOND_LINE_NAME='Cash Supplier Two Line';
    private static final Decimal CONFIRMATION_RATE=Decimal.valueOf('7.800000');
    private static final Date PAYMENT_DATE=Date.newInstance(2026,9,10);
    private static final Date REFUND_DATE=Date.newInstance(2026,9,11);

    private class RateMock implements HttpCalloutMock {
        private final Boolean missingHistorical;
        RateMock(Boolean missingHistorical) {this.missingHistorical=missingHistorical;}
        public HttpResponse respond(HttpRequest request) {
            Map<String,Object> body=(Map<String,Object>)JSON.deserializeUntyped(request.getBody());
            System.assertEquals('payment',body.get('purpose'));
            String paymentDate=(String)body.get('paymentDate');
            HttpResponse response=new HttpResponse();
            if(missingHistorical && paymentDate=='2026-09-09') {
                response.setStatusCode(404);response.setBody('{"ok":false}');return response;
            }
            Boolean refund=paymentDate=='2026-09-11';
            System.assert(paymentDate=='2026-09-10' || refund,'Unexpected payment date: '+paymentDate);
            response.setStatusCode(200);
            response.setBody(JSON.serialize(new Map<String,Object>{
                'ok'=>true,'purpose'=>'payment','requestId'=>request.getHeader('x-salesforce-event-id'),
                'rate'=>new Map<String,Object>{
                    'rateId'=>refund?'refund-day-rate':'payment-day-rate','revision'=>refund?3:2,
                    'usdHkdRate'=>refund?'10.000000':'8.000000',
                    'effectiveAt'=>refund?'2026-09-10T16:00:00.000Z':'2026-09-09T16:00:00.000Z'
                }
            }));
            return response;
        }
    }

    private static void configure(Boolean missingHistorical) {
        FcosCompanyFxRateService.settingsOverride=new Fcos_Trading_FX_Setting__c(
            Enabled__c=true,Cash_Enabled__c=true
        );

        Test.setMock(HttpCalloutMock.class,new RateMock(missingHistorical));
    }

    @TestSetup
    static void fixtures() {
        User actor=new User(Alias='fxcash',LastName=ACTOR_LAST_NAME,Email='fxcash@example.invalid',
            Username='fxcash.'+UserInfo.getOrganizationId()+'.'+System.now().getTime()+'@example.invalid',
            EmailEncodingKey='UTF-8',LanguageLocaleKey='en_US',LocaleSidKey='en_US',
            TimeZoneSidKey='Asia/Hong_Kong',ProfileId=UserInfo.getProfileId());
        User denied=new User(Alias='cashdeny',LastName=DENIED_LAST_NAME,Email='cashdeny@example.invalid',
            Username='cashdeny.'+UserInfo.getOrganizationId()+'.'+System.now().getTime()+'@example.invalid',
            EmailEncodingKey='UTF-8',LanguageLocaleKey='en_US',LocaleSidKey='en_US',
            TimeZoneSidKey='Asia/Hong_Kong',ProfileId=UserInfo.getProfileId());
        insert new List<User>{actor,denied};
        List<PermissionSetAssignment> assignments=new List<PermissionSetAssignment>();
        for(PermissionSet permission:[SELECT Id FROM PermissionSet WHERE Name IN
            ('Fcos_Trading_FX_Access','Fcos_Trading_FX_Amend_Access','Fcos_Trading_FX_Settlement','FCOS_Variable_Charges_User')])
            assignments.add(new PermissionSetAssignment(AssigneeId=actor.Id,PermissionSetId=permission.Id));
        System.assertEquals(4,assignments.size(),'The cash fixture requires entry, amendment, settlement and variable-charge access.');
        insert assignments;

        System.runAs(actor) {
            Test.startTest();
            try {
                Fcos_Trading_FX_Setting__c setting=Fcos_Trading_FX_Setting__c.getOrgDefaults();
                if(setting==null) setting=new Fcos_Trading_FX_Setting__c(SetupOwnerId=UserInfo.getOrganizationId());
                setting.Enabled__c=true;setting.Cash_Enabled__c=true;
                upsert setting;

                TestDataFactory.prepareDataForNominationConfirmationFlow();
                STEM_Line_Item__c base=[SELECT Id,Name,STEM__c,STEM__r.Port__c,STEM__r.Account__c,
                    Original_Supplier__c,Product__c,Payment_Term__c FROM STEM_Line_Item__c WHERE Cancelled__c=false LIMIT 1];
                Account supplierTwo=TestDataFactory.createTestAccount('Cash Supplier Two','SUPPLIER',true);
                ContextManager.skipTriggers=true;
                try {
                    update new Port__c(Id=base.STEM__r.Port__c,Name='Hong Kong',Port_Area__c='Hong Kong',Country__c='HONG KONG');
                    update new Account(Id=base.STEM__r.Account__c,Banking_Preference__c='DBS');
                    update new STEM__c(Id=base.STEM__c,Partial_CIA__c=false);
                    update new STEM_Line_Item__c(Id=base.Id,Name=BASE_LINE_NAME,Quantity__c=1,
                        Quantity_Delivered_Per_BDN__c=1,Unit_Sell_At__c=100,Unit_Buy_At__c=100);
                    TestDataFactory.createTestStemLineItem(SECOND_LINE_NAME,String.valueOf(base.STEM__c),
                        String.valueOf(supplierTwo.Id),String.valueOf(base.Product__c),1,100,100,1,
                        String.valueOf(base.Payment_Term__c),true);
                } finally {ContextManager.skipTriggers=false;}
                DBS_Bank__c bank=DBS_Bank__c.getOrgDefaults();bank.SetupOwnerId=UserInfo.getOrganizationId();
                bank.Beneficiary_Bank__c='Synthetic test bank';bank.Beneficiary__c='FRATELLI COSULICH BUNKERS (HK) LTD';
                bank.Account_No__c='SYNTHETIC-NOT-A-BANK-ACCOUNT';upsert bank;

                STEM_Line_Item__c second=[SELECT Id FROM STEM_Line_Item__c WHERE Name=:SECOND_LINE_NAME LIMIT 1];
                System.enqueueJob(new ConfirmSidesJob(base.Id,second.Id));
            } finally {Test.stopTest();}
        }
    }

    private class ConfirmSidesJob implements Queueable {
        private final Id baseLineId;
        private final Id secondLineId;
        ConfirmSidesJob(Id baseLineId,Id secondLineId) {this.baseLineId=baseLineId;this.secondLineId=secondLineId;}
        public void execute(QueueableContext context) {
            configure(false);
            FcosCompanyFxRateService.Snapshot snapshot=new FcosCompanyFxRateService.Snapshot();
            snapshot.rateId='invoice-rate';snapshot.usdHkdRate=CONFIRMATION_RATE;
            snapshot.effectiveAt=Datetime.newInstanceGmt(2026,9,1,0,0,0);
            FcosTradeCurrencyService.Review sell=FcosTradeCurrencyService.review(baseLineId,'Sell',snapshot);
            sell=FcosTradeCurrencyService.save(baseLineId,'Sell','HKD',780,sell.fingerprint,snapshot,true);
            System.assertEquals(false,sell.needsConfirmation);
            FcosTradeCurrencyService.Review buyUsd=FcosTradeCurrencyService.review(baseLineId,'Buy',null);
            buyUsd=FcosTradeCurrencyService.save(baseLineId,'Buy','USD',buyUsd.nativeUnitPrice,buyUsd.fingerprint,null,true);
            System.assertEquals(false,buyUsd.needsConfirmation);
            FcosTradeCurrencyService.Review buyHkd=FcosTradeCurrencyService.review(secondLineId,'Buy',snapshot);
            buyHkd=FcosTradeCurrencyService.save(secondLineId,'Buy','HKD',780,buyHkd.fingerprint,snapshot,true);
            System.assertEquals(false,buyHkd.needsConfirmation);
        }
    }

    private static User actor() {return [SELECT Id FROM User WHERE LastName=:ACTOR_LAST_NAME LIMIT 1];}
    private static User deniedActor() {return [SELECT Id FROM User WHERE LastName=:DENIED_LAST_NAME LIMIT 1];}
    private static STEM_Line_Item__c baseLine() {
        return [SELECT Id,STEM__c,STEM__r.Account__c,Original_Supplier__c FROM STEM_Line_Item__c
            WHERE Name=:BASE_LINE_NAME LIMIT 1];
    }
    private static STEM_Line_Item__c secondLine() {
        return [SELECT Id,STEM__c,Original_Supplier__c FROM STEM_Line_Item__c WHERE Name=:SECOND_LINE_NAME LIMIT 1];
    }
    private static String paymentRequest(Id lineId,String direction,String bankCurrencyCode,Decimal nativeAmount,
        Decimal bankAmount,Date paymentDate,String reviewedRateId) {
        FcosTradeCashService.CashRequest request=new FcosTradeCashService.CashRequest();
        request.tradeRecordId=lineId;request.direction=direction;request.kind='Payment';
        request.nativeAmount=nativeAmount;request.paymentDate=paymentDate;request.reviewedRateId=reviewedRateId;
        request.bankName='DBS';request.bankCurrencyCode=bankCurrencyCode;request.bankNativeAmount=bankAmount;
        request.bankEvidence='synthetic-statement-evidence';request.reference='cash integration payment';
        return JSON.serialize(request);
    }
    private static String refundRequest(Id originalCashId,String direction,Decimal nativeAmount) {
        FcosTradeCashService.CashRequest request=new FcosTradeCashService.CashRequest();
        request.originalCashId=originalCashId;request.direction=direction;request.kind='Refund';
        request.nativeAmount=nativeAmount;request.paymentDate=REFUND_DATE;request.reviewedRateId='refund-day-rate';
        request.bankName='DBS';request.bankCurrencyCode='HKD';request.bankNativeAmount=nativeAmount;
        request.bankEvidence='synthetic-refund-statement';request.reference='cash integration refund';
        return JSON.serialize(request);
    }
    private static Id record(String requestJson,String operationId) {
        FcosTradeCashService.CashReview review=FcosTradeCashService.previewCash(requestJson);
        return FcosTradeCashService.recordCash(requestJson,review.fingerprint,operationId);
    }
    private class RecordCashThenAmendSideJob implements Queueable,Database.AllowsCallouts {
        private final String requestJson;
        private final String operationId;
        private final Id lineId;
        RecordCashThenAmendSideJob(String requestJson,String operationId,Id lineId) {
            this.requestJson=requestJson;this.operationId=operationId;this.lineId=lineId;
        }
        public void execute(QueueableContext context) {
            configure(false);record(requestJson,operationId);
            FcosTradeCurrencyService.Review hkd=FcosTradeCurrencyService.review(lineId,'Sell',null);
            FcosTradeCurrencyService.Review usd=FcosTradeCurrencyService.amend(lineId,'Sell','USD',hkd.usdUnitPrice,
                hkd.fingerprint,null,'Buyer corrected the agreed currency to USD');
            FcosTradeCurrencyService.save(lineId,'Sell','USD',usd.nativeUnitPrice,usd.fingerprint,null,true);
        }
    }
    private class AllocateAndReverseCashJob implements Queueable,Database.AllowsCallouts {
        private final Id cashId;
        private final Id invoiceId;
        private final Id stemId;
        AllocateAndReverseCashJob(Id cashId,Id invoiceId,Id stemId) {
            this.cashId=cashId;this.invoiceId=invoiceId;this.stemId=stemId;
        }
        public void execute(QueueableContext context) {
            configure(false);
            FcosTradeCashService.AllocationReview partial=FcosTradeCashService.previewAllocation(
                cashId,invoiceId,Decimal.valueOf('33.33'));
            Id partialId=FcosTradeCashService.allocate(cashId,invoiceId,Decimal.valueOf('33.33'),
                partial.fingerprint,'b1000000-0000-4000-8000-000000000001');
            FcosTradeCashService.AllocationReview finalReview=FcosTradeCashService.previewAllocation(
                cashId,invoiceId,Decimal.valueOf('66.68'));
            Id finalId=FcosTradeCashService.allocate(cashId,invoiceId,Decimal.valueOf('66.68'),
                finalReview.fingerprint,'b1000000-0000-4000-8000-000000000002');
            String reversalFingerprint=FcosTradeCashService.previewReversal(partialId);
            Id reversalId=FcosTradeCashService.reverseAllocation(partialId,reversalFingerprint,
                'c1000000-0000-4000-8000-000000000001');
            System.assertEquals(reversalId,FcosTradeCashService.reverseAllocation(partialId,reversalFingerprint,
                'c1000000-0000-4000-8000-000000000001'));
            System.assertEquals(finalId,FcosTradeCashService.allocate(cashId,invoiceId,Decimal.valueOf('66.68'),
                finalReview.fingerprint,'b1000000-0000-4000-8000-000000000002'));
            Set<Id> allocationIds=new Set<Id>{partialId,finalId,reversalId};
            Map<Id,Trade_Cash_Allocation__c> rows=new Map<Id,Trade_Cash_Allocation__c>([
                SELECT Kind__c,Reverses_Allocation__c,Allocated_HKD__c,Allocated_Cash_USD__c,
                    Bank_Native_Allocation__c,Payment__c FROM Trade_Cash_Allocation__c
                WHERE Id IN :allocationIds
            ]);
            System.assertEquals(Decimal.valueOf('4.17'),rows.get(partialId).Allocated_Cash_USD__c);
            System.assertEquals(Decimal.valueOf('4.17'),rows.get(partialId).Bank_Native_Allocation__c);
            System.assertEquals(Decimal.valueOf('8.33'),rows.get(finalId).Allocated_Cash_USD__c);
            System.assertEquals(Decimal.valueOf('8.34'),rows.get(finalId).Bank_Native_Allocation__c,
                'The final application must consume the exact bank rounding remainder.');
            System.assertEquals('Reversal',rows.get(reversalId).Kind__c);
            System.assertEquals(partialId,rows.get(reversalId).Reverses_Allocation__c);
            System.assertEquals(Decimal.valueOf('-33.33'),rows.get(reversalId).Allocated_HKD__c);
            FcosTradeCashService.CashPosition restored=FcosTradeCashService.cashPosition(cashId);
            System.assertEquals(Decimal.valueOf('33.33'),restored.nativeRemaining);
            System.assertEquals(Decimal.valueOf('4.17'),restored.cashUsdRemaining);
            System.assertEquals(Decimal.valueOf('4.17'),restored.bankRemaining);
            System.assertEquals(1,[SELECT COUNT() FROM Trade_Cash_Event__c WHERE STEM__c=:stemId],
                'An allocation reversal must restore cash without inventing another bank event.');
        }
    }
    private class AllocationRejectionJob implements Queueable,Database.AllowsCallouts {
        private final Id cashId;
        private final Id invoiceId;
        AllocationRejectionJob(Id cashId,Id invoiceId) {this.cashId=cashId;this.invoiceId=invoiceId;}
        public void execute(QueueableContext context) {
            configure(false);
            FcosTradeCashService.AllocationReview stale=FcosTradeCashService.previewAllocation(
                cashId,invoiceId,Decimal.valueOf('66.68'));
            FcosTradeCashService.AllocationReview partial=FcosTradeCashService.previewAllocation(
                cashId,invoiceId,Decimal.valueOf('33.33'));
            FcosTradeCashService.allocate(cashId,invoiceId,Decimal.valueOf('33.33'),partial.fingerprint,
                'b2000000-0000-4000-8000-000000000001');
            Boolean staleRejected=false,overRejected=false;
            try {FcosTradeCashService.allocate(cashId,invoiceId,Decimal.valueOf('66.68'),stale.fingerprint,
                'b2000000-0000-4000-8000-000000000002');} catch(AuraHandledException expected) {staleRejected=true;}
            try {FcosTradeCashService.previewAllocation(cashId,invoiceId,Decimal.valueOf('66.69'));}
            catch(AuraHandledException expected) {overRejected=true;}
            System.assert(staleRejected,'A balance-changing allocation must invalidate an earlier review.');
            System.assert(overRejected,'An allocation cannot exceed the remaining immutable cash evidence.');
        }
    }
    private class RejectDirectLedgerMutationJob implements Queueable,Database.AllowsCallouts {
        private final Id cashId;
        private final Id allocationId;
        RejectDirectLedgerMutationJob(Id cashId,Id allocationId) {this.cashId=cashId;this.allocationId=allocationId;}
        public void execute(QueueableContext context) {
            configure(false);
            Database.SaveResult forgedEvent=Database.insert(new Trade_Cash_Event__c(),false);
            Database.SaveResult forgedAllocation=Database.insert(new Trade_Cash_Allocation__c(),false);
            Database.SaveResult changedEvent=Database.update(
                new Trade_Cash_Event__c(Id=cashId,Reference__c='forged'),false);
            Database.SaveResult changedAllocation=Database.update(new Trade_Cash_Allocation__c(
                Id=allocationId,Allocation_Date__c=Date.newInstance(2026,9,9)),false);
            Database.DeleteResult deletedEvent=Database.delete(new Trade_Cash_Event__c(Id=cashId),false);
            Database.DeleteResult deletedAllocation=Database.delete(
                new Trade_Cash_Allocation__c(Id=allocationId),false);
            System.assert(!forgedEvent.isSuccess() && !forgedAllocation.isSuccess());
            System.assert(!changedEvent.isSuccess() && !changedAllocation.isSuccess());
            System.assert(!deletedEvent.isSuccess() && !deletedAllocation.isSuccess());
            System.assert(forgedEvent.getErrors()[0].getMessage().contains('immutable'));
            System.assert(forgedAllocation.getErrors()[0].getMessage().contains('immutable'));
            System.assert(changedEvent.getErrors()[0].getMessage().contains('immutable'));
            System.assert(changedAllocation.getErrors()[0].getMessage().contains('immutable'));
            System.assert(deletedEvent.getErrors()[0].getMessage().contains('immutable'));
            System.assert(deletedAllocation.getErrors()[0].getMessage().contains('immutable'));
        }
    }
    private class RejectCashPaymentMutationJob implements Queueable,Database.AllowsCallouts {
        private final Id cashId;
        private final Id allocationId;
        RejectCashPaymentMutationJob(Id cashId,Id allocationId) {this.cashId=cashId;this.allocationId=allocationId;}
        public void execute(QueueableContext context) {
            configure(false);
            Trade_Cash_Allocation__c allocation=[SELECT Payment__c FROM Trade_Cash_Allocation__c
                WHERE Id=:allocationId];
            Payment__c payment=[SELECT Id,STEM__c,Account__c,RecordTypeId,Amount__c,Date__c,Bank__c,Buyer_Invoice__c,Supplier_Invoice__c,
                Cash_Event__c,Payment_Currency__c,Payment_HKD_Amount__c,Payment_FX_Rate__c,Payment_FX_Revision__c,Payment_FX_Effective_At__c,
                Invoice_Carrying_USD__c,Settlement_FX_USD__c,Bank_Currency__c,Bank_Native_Amount__c,Bank_FX_Evidence__c,
                Payment_Operation_Id__c,Payment_Request_Fingerprint__c FROM Payment__c WHERE Id=:allocation.Payment__c];
            Payment__c forgedPayment=payment.clone(false,true,false,false);
            forgedPayment.Payment_Operation_Id__c='c5000000-0000-4000-8000-000000000001';
            Database.SaveResult forgedPaymentResult=Database.insert(forgedPayment,false);
            Database.SaveResult changedPayment=Database.update(new Payment__c(Id=payment.Id,Amount__c=999),false);
            Database.DeleteResult deletedPayment=Database.delete(payment,false);
            System.assert(!forgedPaymentResult.isSuccess(),'Cash-linked Payment evidence cannot be forged.');
            System.assert(!changedPayment.isSuccess(),'Cash-linked Payment evidence is immutable.');
            System.assert(!deletedPayment.isSuccess(),'Cash-linked Payment evidence cannot be deleted.');
            Boolean operationGuardRejected=false;
            for(Database.Error failure:forgedPaymentResult.getErrors()) if(failure.getMessage().contains('operation evidence')) operationGuardRejected=true;
            System.assert(operationGuardRejected,'The reviewed-operation guard must reject an otherwise complete forged cash payment.');
            System.assert(changedPayment.getErrors()[0].getMessage().contains('immutable'));
            System.assert(deletedPayment.getErrors()[0].getMessage().contains('cannot be deleted'));
        }
    }

    private static Invoice__c issueBuyerInvoice(STEM_Line_Item__c line) {
        List<String> selected=new List<String>{String.valueOf(line.Id)};
        FcosTradeDocumentService.DocumentReview review=FcosTradeDocumentService.preview(
            line.STEM__c,'Sell',null,new List<Id>{line.Id});
        Invoice__c invoice=InvoiceController.createReviewedInvoice(String.valueOf(line.STEM__c),selected,false,false,
            PAYMENT_DATE,PAYMENT_DATE,Date.newInstance(2026,9,20),review.fingerprint);
        InvoiceController.generateInvoicePDF(String.valueOf(invoice.Id),'Cash integration buyer invoice',
            selected,null,false,review.fingerprint);
        return [SELECT Id,STEM__c,Amount__c,Document_HKD_Amount__c,Document_Currency__c,File__c
            FROM Invoice__c WHERE Id=:invoice.Id];
    }
    private static void attachSupplierPdf(Id invoiceId) {
        ContentVersion version=new ContentVersion(Title='Cash integration supplier invoice',
            PathOnClient='cash-integration-supplier.pdf',VersionData=Blob.valueOf('issued test PDF'),
            FirstPublishLocationId=invoiceId);
        insert version;version=[SELECT ContentDocumentId FROM ContentVersion WHERE Id=:version.Id];
        update new Supplier_Invoice__c(Id=invoiceId,
            Invoice_File__c=URL.getOrgDomainURL().toExternalForm()+'/'+version.ContentDocumentId);
    }
    private static Supplier_Invoice__c issueSecondSupplierInvoice() {
        STEM_Line_Item__c line=secondLine();
        FcosTradeDocumentService.DocumentReview review=FcosTradeDocumentService.preview(
            line.STEM__c,'Buy',line.Original_Supplier__c,new List<Id>{line.Id});
        Map<String,Object> fields=new Map<String,Object>{'Name'=>'CASH-SUPPLIER-TWO-1',
            'Bank_Details__c'=>'Synthetic supplier bank instructions','Invoice_Date__c'=>PAYMENT_DATE,
            'Supplier_Delivery_Date__c'=>PAYMENT_DATE};
        Id invoiceId=FcosTradeDocumentService.recordSupplierInvoice(line.STEM__c,line.Original_Supplier__c,
            new List<Id>{line.Id},review.fingerprint,fields);
        attachSupplierPdf(invoiceId);
        return [SELECT Id,STEM__c,Supplier__c,Document_Currency__c,Document_HKD_Amount__c
            FROM Supplier_Invoice__c WHERE Id=:invoiceId];
    }

    @IsTest
    static void hkdCashAllocatesRemaindersRetriesAndReversesWithoutNewBankCash() {
        System.runAs(actor()) {
            configure(false);STEM_Line_Item__c line=baseLine();
            String requestJson=paymentRequest(line.Id,'Sell','USD',Decimal.valueOf('100.01'),
                Decimal.valueOf('12.51'),PAYMENT_DATE,'payment-day-rate');
            FcosTradeCashService.CashReview cashReview=FcosTradeCashService.previewCash(requestJson);
            Id cashId=FcosTradeCashService.recordCash(requestJson,cashReview.fingerprint,
                'a1000000-0000-4000-8000-000000000001');
            System.assertEquals(cashId,FcosTradeCashService.recordCash(requestJson,cashReview.fingerprint,
                'a1000000-0000-4000-8000-000000000001'));
            System.assertEquals(0,[SELECT COUNT() FROM Invoice__c WHERE STEM__c=:line.STEM__c AND Proforma__c=false],
                'Cash must exist independently before the final invoice.');
            Trade_Cash_Event__c cash=[SELECT Cash_HKD_Amount__c,Cash_USD_Amount__c,FX_Rate__c,
                FX_Revision__c,Bank_Native_Amount__c,Buyer_Proforma__c FROM Trade_Cash_Event__c WHERE Id=:cashId];
            System.assertEquals(Decimal.valueOf('100.01'),cash.Cash_HKD_Amount__c);
            System.assertEquals(Decimal.valueOf('12.50'),cash.Cash_USD_Amount__c);
            System.assertEquals(Decimal.valueOf('8.000000'),cash.FX_Rate__c);
            System.assertEquals(Decimal.valueOf('12.51'),cash.Bank_Native_Amount__c);
            System.assertEquals('payment-day-rate',cash.FX_Revision__c);System.assertEquals(null,cash.Buyer_Proforma__c);
            Test.startTest();
            try {
                Invoice__c invoice=issueBuyerInvoice(line);
                System.enqueueJob(new AllocateAndReverseCashJob(cashId,invoice.Id,line.STEM__c));
            } finally {Test.stopTest();}
        }
    }

    @IsTest
    static void staleReviewsAndOverAllocationAreRejected() {
        System.runAs(actor()) {
            configure(false);STEM_Line_Item__c line=baseLine();
            String staleRateRequest=paymentRequest(line.Id,'Sell','USD',Decimal.valueOf('100.01'),
                Decimal.valueOf('12.51'),PAYMENT_DATE,'obsolete-rate');
            Boolean staleRateRejected=false;
            try {FcosTradeCashService.previewCash(staleRateRequest);} catch(AuraHandledException expected) {staleRateRejected=true;}
            System.assert(staleRateRejected,'A changed payment-date rate must require review.');
            String requestJson=paymentRequest(line.Id,'Sell','USD',Decimal.valueOf('100.01'),
                Decimal.valueOf('12.51'),PAYMENT_DATE,'payment-day-rate');
            Id cashId=record(requestJson,'a2000000-0000-4000-8000-000000000001');
            Test.startTest();
            try {
                Invoice__c invoice=issueBuyerInvoice(line);
                System.enqueueJob(new AllocationRejectionJob(cashId,invoice.Id));
            } finally {Test.stopTest();}
        }
    }

    @IsTest
    static void unallocatedRefundAfterCurrencyAmendmentUsesOriginalSideRateAndBasis() {
        System.runAs(actor()) {
            STEM_Line_Item__c line=baseLine();
            String originalRequest=paymentRequest(line.Id,'Sell','USD',Decimal.valueOf('100.01'),
                Decimal.valueOf('12.51'),PAYMENT_DATE,'payment-day-rate');
            Test.startTest();System.enqueueJob(new RecordCashThenAmendSideJob(originalRequest,
                'a3000000-0000-4000-8000-000000000001',line.Id));Test.stopTest();
            Trade_Cash_Event__c original=[SELECT Id,Trade_FX_Side__c,Currency__c FROM Trade_Cash_Event__c
                WHERE Operation_Id__c='a3000000-0000-4000-8000-000000000001' LIMIT 1];
            STEM_Line_Item__c amended=[SELECT Sell_Currency__c,Sell_FX_Side__c FROM STEM_Line_Item__c WHERE Id=:line.Id];
            System.assertEquals('HKD',original.Currency__c);System.assertEquals('USD',amended.Sell_Currency__c);
            System.assertNotEquals(original.Trade_FX_Side__c,amended.Sell_FX_Side__c,
                'An explicit currency amendment must create a new current side without rewriting original cash evidence.');
            configure(false);String refundJson=refundRequest(original.Id,'Sell',Decimal.valueOf('100.01'));
            FcosTradeCashService.CashReview review=FcosTradeCashService.previewCash(refundJson);
            System.assertEquals(original.Trade_FX_Side__c,review.sideId,
                'Refund review must retain the original cash side after a later trade amendment.');
            System.assertEquals(Decimal.valueOf('10.00'),review.cashUsd);
            System.assertEquals(Decimal.valueOf('12.50'),review.originalCarryingUsd);
            System.assertEquals(Decimal.valueOf('2.50'),review.settlementFxUsd);
            Id refundId=FcosTradeCashService.recordCash(refundJson,review.fingerprint,
                'e3000000-0000-4000-8000-000000000001');
            Trade_Cash_Event__c refund=[SELECT Kind__c,Cash_HKD_Amount__c,Cash_USD_Amount__c,
                Original_Carrying_USD__c,Original_Bank_Allocation__c,Settlement_FX_USD__c,
                FX_Revision__c,Bank_Native_Amount__c,Trade_FX_Side__c FROM Trade_Cash_Event__c WHERE Id=:refundId];
            System.assertEquals('Refund',refund.Kind__c);System.assert(refund.Cash_HKD_Amount__c>0);
            System.assertEquals(original.Trade_FX_Side__c,refund.Trade_FX_Side__c);
            System.assertEquals(Decimal.valueOf('10.00'),refund.Cash_USD_Amount__c);
            System.assertEquals(Decimal.valueOf('12.50'),refund.Original_Carrying_USD__c);
            System.assertEquals(Decimal.valueOf('12.51'),refund.Original_Bank_Allocation__c);
            System.assertEquals(Decimal.valueOf('2.50'),refund.Settlement_FX_USD__c);
            System.assertEquals('refund-day-rate',refund.FX_Revision__c);
            System.assertEquals(Decimal.valueOf('100.01'),refund.Bank_Native_Amount__c,
                'Refund bank evidence remains its actual positive bank amount.');
            FcosTradeCashService.CashPosition empty=FcosTradeCashService.cashPosition(original.Id);
            System.assertEquals(Decimal.valueOf('0'),empty.nativeRemaining);
            System.assertEquals(Decimal.valueOf('0'),empty.cashUsdRemaining);
            System.assertEquals(Decimal.valueOf('0'),empty.bankRemaining);
            Id retry=FcosTradeCashService.recordCash(refundJson,review.fingerprint,
                'e3000000-0000-4000-8000-000000000001');
            System.assertEquals(refundId,retry,'A lost-response retry must recover the full refund after its cash position reaches zero.');
            System.assertEquals(1,[SELECT COUNT() FROM Trade_Cash_Event__c WHERE Original_Cash_Event__c=:original.Id]);
        }
    }

    @IsTest
    static void confirmedUsdCashRejectsDifferentSupplierAndCurrencyInvoice() {
        System.runAs(actor()) {
            configure(false);STEM_Line_Item__c line=baseLine();
            String requestJson=paymentRequest(line.Id,'Buy','USD',50,50,PAYMENT_DATE,'USD');
            Id cashId=record(requestJson,'f4000000-0000-4000-8000-000000000001');
            Trade_Cash_Event__c cash=[SELECT Party__c,Currency__c,Cash_HKD_Amount__c,Cash_USD_Amount__c,
                FX_Rate__c,FX_Revision__c,Trade_FX_Side__c FROM Trade_Cash_Event__c WHERE Id=:cashId];
            System.assertEquals('USD',cash.Currency__c);
            System.assertEquals(Decimal.valueOf('50.00'),cash.Cash_USD_Amount__c);
            System.assertEquals(null,cash.Cash_HKD_Amount__c);System.assertEquals(null,cash.FX_Rate__c);
            System.assertEquals(null,cash.FX_Revision__c);System.assertNotEquals(null,cash.Trade_FX_Side__c,
                'USD cash still requires a confirmed immutable trading side.');
            Supplier_Invoice__c other=issueSecondSupplierInvoice();
            System.assertEquals('HKD',other.Document_Currency__c);System.assertNotEquals(cash.Party__c,other.Supplier__c);
            Boolean mismatchRejected=false;
            Test.startTest();
            try {FcosTradeCashService.previewAllocation(cashId,other.Id,10);}
            catch(AuraHandledException expected) {mismatchRejected=true;}
            Test.stopTest();
            System.assert(mismatchRejected,
                'Cash cannot cross supplier, agreed currency, direction or party boundaries.');
        }
    }

    @IsTest
    static void directLedgerAndPaymentForgeryMutationAndDeletionAreRejected() {
        System.runAs(actor()) {
            configure(false);STEM_Line_Item__c line=baseLine();
            String requestJson=paymentRequest(line.Id,'Sell','USD',20,Decimal.valueOf('2.50'),
                PAYMENT_DATE,'payment-day-rate');
            Id cashId=record(requestJson,'a5000000-0000-4000-8000-000000000001');
            Invoice__c invoice=issueBuyerInvoice(line);
            Test.startTest();
            try {
                FcosTradeCashService.AllocationReview review=FcosTradeCashService.previewAllocation(
                    cashId,invoice.Id,20);
                Id allocationId=FcosTradeCashService.allocate(cashId,invoice.Id,20,review.fingerprint,
                    'b5000000-0000-4000-8000-000000000001');
                System.enqueueJob(new RejectDirectLedgerMutationJob(cashId,allocationId));
                System.enqueueJob(new RejectCashPaymentMutationJob(cashId,allocationId));
            } finally {Test.stopTest();}
        }
    }

    @IsTest
    static void disabledCashRolloutRejectsEntry() {
        System.runAs(actor()) {
            Fcos_Trading_FX_Setting__c setting=Fcos_Trading_FX_Setting__c.getOrgDefaults();
            setting.Cash_Enabled__c=false;update setting;configure(false);
            STEM_Line_Item__c line=baseLine();Boolean rejected=false;
            try {FcosTradeCashService.previewCash(paymentRequest(line.Id,'Sell','USD',20,
                Decimal.valueOf('2.50'),PAYMENT_DATE,'payment-day-rate'));}
            catch(AuraHandledException expected) {rejected=true;}
            System.assert(rejected,'The independently disabled cash rollout must fail closed.');
        }
    }

    @IsTest
    static void settlementPermissionIsRequired() {
        Id lineId=baseLine().Id;
        System.runAs(deniedActor()) {
            configure(false);Boolean rejected=false;
            try {FcosTradeCashService.previewCash(paymentRequest(lineId,'Sell','USD',20,
                Decimal.valueOf('2.50'),PAYMENT_DATE,'payment-day-rate'));}
            catch(AuraHandledException expected) {rejected=true;}
            System.assert(rejected,'Cash entry requires the dedicated settlement permission.');
        }
    }

    @IsTest
    static void missingHistoricalPaymentRateLeavesNoCashEvidence() {
        System.runAs(actor()) {
            configure(true);STEM_Line_Item__c line=baseLine();Boolean rejected=false;
            String requestJson=paymentRequest(line.Id,'Sell','USD',20,Decimal.valueOf('2.50'),
                Date.newInstance(2026,9,9),null);
            Test.startTest();
            try {FcosTradeCashService.previewCash(requestJson);}
            catch(FcosCompanyFxRateService.FxException expected) {rejected=true;}
            Test.stopTest();
            System.assert(rejected,'Missing historical company rates must fail before persistence.');
            System.assertEquals(0,[SELECT COUNT() FROM Trade_Cash_Event__c]);
        }
    }
}
