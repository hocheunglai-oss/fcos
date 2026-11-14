@IsTest
private class FcosLegacyFinancialCompatibilityTest {
    private static final String ACTOR_LAST_NAME='LegacyFinancialCompatibility';
    private static final String LEGACY_OPERATOR_LAST_NAME='LegacyUsdDocumentOperator';

    private static void configure(Boolean enabled) {
        FcosCompanyFxRateService.settingsOverride=new Fcos_Trading_FX_Setting__c(Enabled__c=enabled);
    }

    @TestSetup
    static void fixtures() {
        User actor=new User(Alias='legacyfx',LastName=ACTOR_LAST_NAME,Email='legacy-fx@example.invalid',
            Username='legacy-fx.'+UserInfo.getOrganizationId()+'.'+System.now().getTime()+'@example.invalid',
            EmailEncodingKey='UTF-8',LanguageLocaleKey='en_US',LocaleSidKey='en_US',
            TimeZoneSidKey='Asia/Hong_Kong',ProfileId=UserInfo.getProfileId());
        Profile salesSupport=[SELECT Id,PermissionsViewAllData,PermissionsModifyAllData FROM Profile WHERE Name='Sales Support' LIMIT 1];
        System.assertEquals(false,salesSupport.PermissionsViewAllData);
        System.assertEquals(false,salesSupport.PermissionsModifyAllData);
        User legacyUser=new User(Alias='legacyus',LastName=LEGACY_OPERATOR_LAST_NAME,Email='legacy-usd@example.invalid',
            Username='legacy-usd.'+UserInfo.getOrganizationId()+'.'+System.now().getTime()+'@example.invalid',
            EmailEncodingKey='UTF-8',LanguageLocaleKey='en_US',LocaleSidKey='en_US',
            TimeZoneSidKey='Asia/Hong_Kong',ProfileId=salesSupport.Id);
        insert new List<User>{actor,legacyUser};
        List<PermissionSetAssignment> assignments=new List<PermissionSetAssignment>();
        for(PermissionSet permission:[SELECT Id,Name FROM PermissionSet WHERE Name IN
            ('Fcos_Trading_FX_Access','FCOS_Variable_Charges_User')]) {
            assignments.add(new PermissionSetAssignment(AssigneeId=actor.Id,PermissionSetId=permission.Id));
            if(permission.Name=='FCOS_Variable_Charges_User') {
                assignments.add(new PermissionSetAssignment(AssigneeId=legacyUser.Id,PermissionSetId=permission.Id));
            }
        }
        System.assertEquals(3,assignments.size());
        insert assignments;

        Test.startTest();
        try {
            System.runAs(actor) {
                configure(false);
                TestDataFactory.prepareDataForNominationConfirmationFlow();
                STEM_Line_Item__c line=[SELECT STEM__r.Port__c FROM STEM_Line_Item__c WHERE Cancelled__c=false LIMIT 1];
                ContextManager.skipTriggers=true;
                try {update new Port__c(Id=line.STEM__r.Port__c,Name='Hong Kong',Port_Area__c='Hong Kong',Country__c='HONG KONG');}
                finally {ContextManager.skipTriggers=false;}
            }
        } finally {Test.stopTest();}
    }

    private static User actor() {return [SELECT Id FROM User WHERE LastName=:ACTOR_LAST_NAME LIMIT 1];}
    private static STEM_Line_Item__c line() {
        return [SELECT Id,STEM__c,Unit_Sell_At__c FROM STEM_Line_Item__c WHERE Cancelled__c=false LIMIT 1];
    }
    private static Invoice__c draftLegacyInvoice(STEM_Line_Item__c source) {
        return InvoiceController.createInvoice(String.valueOf(source.STEM__c),new List<String>{String.valueOf(source.Id)},
            false,false,Date.today(),Date.today(),Date.today());
    }
    private static String legacyPdf() {return EncodingUtil.base64Encode(Blob.valueOf('legacy invoice PDF'));}

    private static User legacyOperator() {return [SELECT Id FROM User WHERE LastName=:LEGACY_OPERATOR_LAST_NAME LIMIT 1];}

    private static void assertLegacyReview(FcosTradeDocumentService.DocumentReview review) {
        System.assertEquals('USD',review.currencyCode);
        System.assertEquals(0,review.lines.size());
        System.assertEquals(null,review.nativeTotal);
        System.assertEquals(null,review.sideId);
        System.assertEquals(null,review.reissueOfId);
        System.assertEquals(null,review.rate);
        System.assertEquals(null,review.rateId);
        System.assertEquals(null,review.confirmedAt);
    }

    @IsTest
    static void disabledTradingFxPreservesLegacyOperatorDocumentReads() {
        STEM_Line_Item__c source=[SELECT Id,STEM__c,STEM__r.Account__c,Original_Supplier__c FROM STEM_Line_Item__c WHERE Cancelled__c=false LIMIT 1];
        List<Nomination__c> nominations=[SELECT Id FROM Nomination__c WHERE STEM__c=:source.STEM__c ORDER BY RecordTypeId,Id];
        System.assertEquals(2,nominations.size(),'The fixture needs the buyer confirmation and supplier nomination.');
        List<Id> selected=new List<Id>{source.Id};
        System.runAs(legacyOperator()) {
            configure(false);
            System.assertEquals(false,FeatureManagement.checkPermission('Fcos_Trading_FX_Entry'));
            STEM_Line_Item__c visible=[SELECT Total_Cost__c FROM STEM_Line_Item__c WHERE Id=:source.Id WITH USER_MODE];
            Test.startTest();
            Integer initialWrites=Limits.getDmlStatements();
            List<FcosTradeDocumentService.DocumentReview> legacyViews=new List<FcosTradeDocumentService.DocumentReview>{
                InvoiceController.previewTradingDocument(source.STEM__c,selected)
            };
            for(Nomination__c nomination:nominations) legacyViews.add(NominationController.previewTradingDocument(nomination.Id));
            FcosTradeDocumentService.DocumentReview supplier=VariableChargeInvoiceReadinessService.previewSupplierTradingDocument(
                source.STEM__c,source.Original_Supplier__c,selected);
            Boolean mismatchedSupplierDenied=false;
            try {VariableChargeInvoiceReadinessService.previewSupplierTradingDocument(source.STEM__c,source.STEM__r.Account__c,selected);}
            catch(AuraHandledException expected) {mismatchedSupplierDenied=true;}
            System.assertEquals(true,mismatchedSupplierDenied,'A supplier invoice preview must refuse another counterparty\'s line.');
            System.assertEquals(initialWrites,Limits.getDmlStatements());
            Test.stopTest();

            for(FcosTradeDocumentService.DocumentReview review:legacyViews) {
                assertLegacyReview(review);
                System.assertEquals(null,review.usdTotal);
                System.assertEquals(null,review.fingerprint);
            }
            assertLegacyReview(supplier);
            System.assertEquals(visible.Total_Cost__c==null?0:visible.Total_Cost__c.setScale(2,RoundingMode.HALF_UP),supplier.usdTotal);
            System.assertEquals(64,supplier.fingerprint.length());
        }
    }

    @IsTest
    static void legacyDocumentWrapperRefusesManagedEvidenceWithoutTradingPermission() {
        STEM_Line_Item__c source=line();
        Id buyerNomination=[SELECT Id FROM Nomination__c WHERE STEM__c=:source.STEM__c AND RecordTypeId=:FCBStatic.NOMINATION_BUYER_RT_IT LIMIT 1].Id;
        Test.startTest();
        System.runAs(actor()) {
            configure(true);
            FcosCompanyFxRateService.Snapshot rate=new FcosCompanyFxRateService.Snapshot();
            rate.rateId='legacy-operator-managed-rate';
            rate.revision='1';
            rate.usdHkdRate=7.8;
            rate.effectiveAt=Datetime.newInstanceGmt(2026,9,10,0,0,0);
            FcosTradeCurrencyService.Review review=FcosTradeCurrencyService.review(source.Id,'Sell',rate);
            FcosTradeCurrencyService.save(source.Id,'Sell','HKD',780,review.fingerprint,rate,true);
            FcosTradeDocumentService.DocumentReview allowed=InvoiceController.previewTradingDocument(source.STEM__c,new List<Id>{source.Id});
            System.assertEquals('HKD',allowed.currencyCode);
            System.assertEquals(rate.rateId,allowed.rateId);
        }
        System.runAs(legacyOperator()) {
            configure(false);
            System.assertEquals(false,FeatureManagement.checkPermission('Fcos_Trading_FX_Entry'));
            Boolean invoiceDenied=false,confirmationDenied=false;
            try {InvoiceController.previewTradingDocument(source.STEM__c,new List<Id>{source.Id});}
            catch(AuraHandledException expected) {invoiceDenied=true;}
            try {NominationController.previewTradingDocument(buyerNomination);}
            catch(AuraHandledException expected) {confirmationDenied=true;}
            System.assertEquals(true,invoiceDenied,'A managed invoice cannot use the legacy USD projection.');
            System.assertEquals(true,confirmationDenied,'A managed confirmation cannot use the legacy USD projection.');
        }
        Test.stopTest();
    }

    @IsTest
    static void disabledUnmanagedInvoiceGenerationKeepsAReserveQueryBudget() {
        System.runAs(actor()) {
            configure(false);STEM_Line_Item__c source=line();Integer generationQueries;
            Test.startTest();
            Invoice__c invoice=draftLegacyInvoice(source);
            Integer beforeGeneration=Limits.getQueries();
            InvoiceController.generateInvoicePDF(invoice.Id,invoice.Name,new List<String>{String.valueOf(source.Id)},legacyPdf(),false);
            generationQueries=Limits.getQueries()-beforeGeneration;
            Test.stopTest();
            System.assert(generationQueries<50,
                'A disabled evidence-free legacy PDF must retain at least half the synchronous query budget; used '+generationQueries+'.');
            System.assertNotEquals(null,[SELECT File__c FROM Invoice__c WHERE Id=:invoice.Id].File__c);
        }
    }

    @IsTest
    static void disabledGateStillRejectsLegacyPdfAfterHkdConfirmation() {
        System.runAs(actor()) {
            configure(false);STEM_Line_Item__c source=line();Invoice__c invoice=draftLegacyInvoice(source);
            configure(true);
            FcosCompanyFxRateService.Snapshot rate=new FcosCompanyFxRateService.Snapshot();
            rate.rateId='legacy-generation-hkd-rate';rate.revision='1';rate.usdHkdRate=Decimal.valueOf('7.800000');
            rate.effectiveAt=Datetime.newInstanceGmt(2026,9,10,0,0,0);
            FcosTradeCurrencyService.Review review=FcosTradeCurrencyService.review(source.Id,'Sell',rate);
            FcosTradeCurrencyService.save(source.Id,'Sell','HKD',Decimal.valueOf('780'),review.fingerprint,rate,true);
            configure(false);
            Boolean rejected=false;
            Test.startTest();
            try {
                InvoiceController.generateInvoicePDF(invoice.Id,invoice.Name,new List<String>{String.valueOf(source.Id)},legacyPdf(),false);
            } catch(AuraHandledException expected) {rejected=true;}
            Test.stopTest();
            System.assert(rejected,'A current HKD agreement must use the reviewed native document path.');
            System.assertEquals(null,[SELECT File__c FROM Invoice__c WHERE Id=:invoice.Id].File__c);
        }
    }

    @IsTest
    static void legacyUnassignedPaymentGuardSkipsEmptyReferenceQueries() {
        System.runAs(actor()) {
            configure(false);STEM_Line_Item__c source=line();
            Payment__c payment=new Payment__c(STEM__c=source.STEM__c,Amount__c=100,Date__c=Date.today(),
                Payment_Currency__c='USD',RecordTypeId=Payment__c.SObjectType.getDescribe()
                    .getRecordTypeInfosByDeveloperName().get('Receivable').getRecordTypeId());
            Integer guardQueries;
            Test.startTest();
            Integer beforeGuard=Limits.getQueries();
            FcosTradePaymentService.guard(new List<Payment__c>{payment},null);
            guardQueries=Limits.getQueries()-beforeGuard;
            Test.stopTest();
            System.assertEquals(false,payment.hasErrors(),'An unmanaged unassigned legacy payment must remain supported.');
            System.assert(guardQueries<=3,'The legacy guard must not query empty invoice reference sets; used '+guardQueries+'.');
        }
    }

    @IsTest
    static void missingHistoricalCarryingAdjustmentMeansZeroAdjustment() {
        System.assertEquals(Decimal.valueOf('100'),PaymentTriggerHandler.carryingAmount(100,null));
        System.assertEquals(Decimal.valueOf('102.50'),
            PaymentTriggerHandler.carryingAmount(Decimal.valueOf('100'),Decimal.valueOf('2.50')));
        System.assertEquals(Decimal.valueOf('-97.50'),
            PaymentTriggerHandler.carryingAmount(Decimal.valueOf('-100'),Decimal.valueOf('2.50')));
    }

    @IsTest
    static void movedPaymentRecalculatesBothSupplierInvoicesOnce() {
        String invoicePrefix=Supplier_Invoice__c.SObjectType.getDescribe().getKeyPrefix();
        Id oldInvoice=Id.valueOf(invoicePrefix+'000000000001');
        Id newInvoice=Id.valueOf(invoicePrefix+'000000000002');
        Map<Id,Payment__c> current=new Map<Id,Payment__c>{newInvoice=>new Payment__c(Supplier_Invoice__c=newInvoice)};
        Map<Id,Payment__c> previous=new Map<Id,Payment__c>{newInvoice=>new Payment__c(Supplier_Invoice__c=oldInvoice),
            oldInvoice=>new Payment__c(Supplier_Invoice__c=newInvoice)};
        System.assertEquals(new Set<Id>{oldInvoice,newInvoice},PaymentTriggerHandler.payableInvoiceIds(current,previous));
    }

    @IsTest
    static void managedDepositRetirementRequiresProvenUnpostedPlan() {
        Payment__c payment=new Payment__c();
        System.assertEquals(false,DepositCalculationService.canRetireManagedPlan(payment));
        payment.Auto_Planned_Deposit__c=true;
        System.assertEquals(true,DepositCalculationService.canRetireManagedPlan(payment));
        payment.Payment_Operation_Id__c='reviewed-operation';
        System.assertEquals(false,DepositCalculationService.canRetireManagedPlan(payment));
        payment.Payment_Operation_Id__c=null;
        payment.Payment_Currency__c='HKD';
        System.assertEquals(false,DepositCalculationService.canRetireManagedPlan(payment));
        payment.Payment_Currency__c='USD';
        payment.Cash_Event__c=Id.valueOf(Trade_Cash_Event__c.SObjectType.getDescribe().getKeyPrefix()+'000000000001');
        System.assertEquals(false,DepositCalculationService.canRetireManagedPlan(payment));
    }

    @IsTest static void pendingHkdSideCannotFallBackToLegacyGeneration() {
        System.runAs(actor()) {
            configure(false);STEM_Line_Item__c source=line();Invoice__c invoice=draftLegacyInvoice(source);
            configure(true);
            FcosCompanyFxRateService.Snapshot rate=new FcosCompanyFxRateService.Snapshot();
            rate.rateId='pending-generation-hkd-rate';rate.revision='1';rate.usdHkdRate=7.8;
            rate.effectiveAt=Datetime.newInstanceGmt(2026,9,10,0,0,0);
            FcosTradeCurrencyService.Review review=FcosTradeCurrencyService.review(source.Id,'Sell',rate);
            FcosTradeCurrencyService.save(source.Id,'Sell','HKD',780,review.fingerprint,rate,false);
            configure(false);
            Test.startTest();
            Boolean rejected=false;
            try {InvoiceController.generateInvoicePDF(invoice.Id,invoice.Name,new List<String>{String.valueOf(source.Id)},legacyPdf(),false);}
            catch(AuraHandledException expected) {rejected=true;}
            Test.stopTest();
            System.assert(rejected,'An unconfirmed HKD side must be confirmed before issuing any invoice.');
            System.assertEquals(null,[SELECT File__c FROM Invoice__c WHERE Id=:invoice.Id].File__c);
        }
    }
}
