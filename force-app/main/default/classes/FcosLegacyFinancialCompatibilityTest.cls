@IsTest
private class FcosLegacyFinancialCompatibilityTest {
    private static final String ACTOR_LAST_NAME='LegacyFinancialCompatibility';

    private static void configure(Boolean enabled) {
        FcosCompanyFxRateService.settingsOverride=new Fcos_Trading_FX_Setting__c(Enabled__c=enabled);
    }

    @TestSetup
    static void fixtures() {
        User actor=new User(Alias='legacyfx',LastName=ACTOR_LAST_NAME,Email='legacy-fx@example.invalid',
            Username='legacy-fx.'+UserInfo.getOrganizationId()+'.'+System.now().getTime()+'@example.invalid',
            EmailEncodingKey='UTF-8',LanguageLocaleKey='en_US',LocaleSidKey='en_US',
            TimeZoneSidKey='Asia/Hong_Kong',ProfileId=UserInfo.getProfileId());
        insert actor;
        List<PermissionSetAssignment> assignments=new List<PermissionSetAssignment>();
        for(PermissionSet permission:[SELECT Id FROM PermissionSet WHERE Name IN
            ('Fcos_Trading_FX_Access','FCOS_Variable_Charges_User')])
            assignments.add(new PermissionSetAssignment(AssigneeId=actor.Id,PermissionSetId=permission.Id));
        System.assertEquals(2,assignments.size());insert assignments;

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
