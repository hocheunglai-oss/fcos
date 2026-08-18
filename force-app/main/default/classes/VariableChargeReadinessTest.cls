@IsTest
private class VariableChargeReadinessTest {
    @TestSetup
    static void makeData() {
        TestDataFactory.prepareDataForNominationConfirmationFlow();
    }

    private static Map<String, Id> prepareRequiredSupplier(Boolean manualOnly) {
        STEM__c stem = [SELECT Id, Delivery_Date__c, Variable_Charges_Confirmed__c FROM STEM__c LIMIT 1];
        STEM_Line_Item__c line = [SELECT Id, STEM__c, Original_Supplier__c, Cancelled__c FROM STEM_Line_Item__c WHERE STEM__c = :stem.Id LIMIT 1];
        Account supplier = [SELECT Id, Is_Agent__c FROM Account WHERE Id = :line.Original_Supplier__c];
        ContextManager.skipTriggers = true;
        try {
            stem.Delivery_Date__c = Date.today().addDays(-1);
            stem.Variable_Charges_Confirmed__c = false;
            update stem;
            supplier.Is_Agent__c = !manualOnly;
            update supplier;
        } finally {
            ContextManager.skipTriggers = false;
        }
        STEM_Variable_Charge_Supplier__c stage = new STEM_Variable_Charge_Supplier__c(
            STEM__c = stem.Id,
            Supplier__c = supplier.Id,
            Manual_Review_Required__c = manualOnly,
            Supplier_Status__c = 'Pending'
        );
        insert stage;
        return new Map<String, Id>{'stem' => stem.Id, 'supplier' => supplier.Id, 'stage' => stage.Id};
    }

    private static void verifyStage(Map<String, Id> ids) {
        STEM_Variable_Charge_Supplier__c stage = [
            SELECT Id, STEM__c, Supplier__c, Supplier_Status__c, Verified_At__c,
                Verified_By_Email__c, Reviewed_Source_Fingerprint__c
            FROM STEM_Variable_Charge_Supplier__c WHERE Id = :ids.get('stage')
        ];
        stage.Supplier_Status__c = 'Verified';
        stage.Verified_At__c = System.now();
        stage.Verified_By_Email__c = 'supplier.trader@example.com';
        stage.Reviewed_Source_Fingerprint__c = VariableChargeInvoiceReadinessService.supplierFingerprint(ids.get('stem'), ids.get('supplier'));
        update stage;
    }

    private static Invoice__c insertInvoiceWithoutTriggers(Id stemId) {
        ContextManager.avoidInvoiceFiring = true;
        try {
            Invoice__c invoice = new Invoice__c(Name = '00001T-INV-VC', STEM__c = stemId, Proforma__c = false);
            insert invoice;
            return invoice;
        } finally {
            ContextManager.avoidInvoiceFiring = false;
        }
    }

    @IsTest
    static void agentRequirementGatesSupplierAndBuyer() {
        Map<String, Id> ids = prepareRequiredSupplier(false);
        Test.startTest();
        assertRequiredFlow(ids);
        Test.stopTest();
    }

    @IsTest
    static void manualRequirementGatesSupplierAndBuyer() {
        Map<String, Id> ids = prepareRequiredSupplier(true);
        Test.startTest();
        assertRequiredFlow(ids);
        Test.stopTest();
    }

    private static void assertRequiredFlow(Map<String, Id> ids) {
        VariableChargeInvoiceReadinessService.Readiness supplier = VariableChargeInvoiceReadinessService.evaluateSupplier(ids.get('stem'), ids.get('supplier'));
        System.assertEquals(false, supplier.ready);
        System.assertEquals(true, supplier.requiresVariableChargeReview);
        System.assert(supplier.reason.contains('Supplier Trader'));

        verifyStage(ids);
        System.assertEquals(true, VariableChargeInvoiceReadinessService.evaluateSupplier(ids.get('stem'), ids.get('supplier')).ready);
        System.assertEquals(false, VariableChargeInvoiceReadinessService.evaluateBuyer(ids.get('stem')).ready);

        ContextManager.skipTriggers = true;
        try {
            update new STEM__c(Id = ids.get('stem'), Variable_Charges_Confirmed__c = true);
        } finally {
            ContextManager.skipTriggers = false;
        }
        System.assertEquals(true, VariableChargeInvoiceReadinessService.evaluateBuyer(ids.get('stem')).ready);
    }

    @IsTest
    static void directSupplierInvoiceIdentityIsBlockedUntilVerified() {
        Map<String, Id> ids = prepareRequiredSupplier(false);
        Test.startTest();
        Supplier_Invoice__c invoice = new Supplier_Invoice__c(STEM__c = ids.get('stem'), Supplier__c = ids.get('supplier'));
        VariableChargeInvoiceReadinessService.assertSupplierInvoiceTransitionsAllowed(new List<Supplier_Invoice__c>{invoice}, null);
        System.assertEquals(true, invoice.hasErrors());
        verifyStage(ids);
        invoice = new Supplier_Invoice__c(STEM__c = ids.get('stem'), Supplier__c = ids.get('supplier'));
        VariableChargeInvoiceReadinessService.assertSupplierInvoiceTransitionsAllowed(new List<Supplier_Invoice__c>{invoice}, null);
        System.assertEquals(false, invoice.hasErrors());
        Test.stopTest();
    }

    @IsTest
    static void supplierFinancialChangeInvalidatesOnlyItsStageAndBuyerConfirmation() {
        Map<String, Id> ids = prepareRequiredSupplier(false);
        Test.startTest();
        verifyStage(ids);
        ContextManager.skipTriggers = true;
        try {
            update new STEM__c(Id = ids.get('stem'), Variable_Charges_Confirmed__c = true);
        } finally {
            ContextManager.skipTriggers = false;
        }
        STEM_Line_Item__c line = [SELECT Id, STEM__c, Original_Supplier__c, Quantity__c FROM STEM_Line_Item__c WHERE STEM__c = :ids.get('stem') AND Original_Supplier__c = :ids.get('supplier') LIMIT 1];
        STEM_Line_Item__c before = line.clone(true, true, false, false);
        line.Quantity__c = (line.Quantity__c == null ? 1 : line.Quantity__c) + 1;
        VariableChargeInvoiceReadinessService.invalidateForLineItemChanges(
            new List<STEM_Line_Item__c>{line},
            new Map<Id, STEM_Line_Item__c>{line.Id => before}
        );
        System.assertEquals('Invalidated', [SELECT Supplier_Status__c FROM STEM_Variable_Charge_Supplier__c WHERE Id = :ids.get('stage')].Supplier_Status__c);
        System.assertEquals(false, [SELECT Variable_Charges_Confirmed__c FROM STEM__c WHERE Id = :ids.get('stem')].Variable_Charges_Confirmed__c);
        Test.stopTest();
    }

    @IsTest
    static void noRequirementBypassesBothGates() {
        Map<String, Id> ids = prepareRequiredSupplier(false);
        Test.startTest();
        Account supplier = [SELECT Id, Is_Agent__c FROM Account WHERE Id = :ids.get('supplier')];
        ContextManager.skipTriggers = true;
        try {
            supplier.Is_Agent__c = false;
            update supplier;
            STEM_Variable_Charge_Supplier__c stage = [SELECT Id, Manual_Review_Required__c FROM STEM_Variable_Charge_Supplier__c WHERE Id = :ids.get('stage')];
            stage.Manual_Review_Required__c = false;
            update stage;
        } finally {
            ContextManager.skipTriggers = false;
        }
        System.assertEquals(true, VariableChargeInvoiceReadinessService.evaluateSupplier(ids.get('stem'), ids.get('supplier')).ready);
        System.assertEquals(true, VariableChargeInvoiceReadinessService.evaluateBuyer(ids.get('stem')).ready);
        Test.stopTest();
    }

    @IsTest
    static void finalBuyerInvoiceCreationPathsAreBlocked() {
        Map<String, Id> ids = prepareRequiredSupplier(false);
        Test.startTest();
        try {
            InvoiceController.createInvoice(ids.get('stem'), new List<String>(), false, false, Date.today(), Date.today(), Date.today());
            System.assert(false, 'Unconfirmed Variable Charges must block final invoice creation.');
        } catch (Exception expected) {
            System.assertNotEquals(null, expected);
        }
        try {
            insert new Invoice__c(Name = '00001T-INV-VC-DIRECT', STEM__c = ids.get('stem'), Proforma__c = false);
            System.assert(false, 'Unconfirmed Variable Charges must block direct final invoice insertion.');
        } catch (Exception expected) {
            System.assertNotEquals(null, expected);
        }
        Test.stopTest();
    }

    @IsTest
    static void finalBuyerInvoiceGenerationAndEmailAreBlocked() {
        Map<String, Id> ids = prepareRequiredSupplier(false);
        Invoice__c invoice = insertInvoiceWithoutTriggers(ids.get('stem'));
        Test.startTest();
        try {
            InvoiceController.generateInvoicePDF(invoice.Id, invoice.Name, new List<String>(), 'VGVzdA==', false);
            System.assert(false, 'Unconfirmed Variable Charges must block final PDF generation.');
        } catch (Exception expected) {
            System.assertNotEquals(null, expected);
        }
        EmailInvoiceController.EmailData emailData = new EmailInvoiceController.EmailData();
        emailData.stemId = ids.get('stem');
        try {
            EmailInvoiceController.sendEmail(emailData, new List<Invoice__c>{invoice}, new List<String>());
            System.assert(false, 'Unconfirmed Variable Charges must block final invoice email.');
        } catch (Exception expected) {
            System.assertNotEquals(null, expected);
        }
        Test.stopTest();
    }

    @IsTest
    static void proformasAndCreditNotesBypassBuyerGate() {
        Map<String, Id> ids = prepareRequiredSupplier(false);
        Test.startTest();
        insert new Invoice__c(Name = '00001T-PROFORMA-VC', STEM__c = ids.get('stem'), Proforma__c = true);
        insert new Invoice__c(Name = '00001T-CN-VC', STEM__c = ids.get('stem'), Proforma__c = false);
        Test.stopTest();
    }
}
