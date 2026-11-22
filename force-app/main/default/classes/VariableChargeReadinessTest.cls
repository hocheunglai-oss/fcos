@IsTest
private class VariableChargeReadinessTest {
    @TestSetup
    static void makeData() {
        TestDataFactory.prepareDataForNominationConfirmationFlow();
    }

    private static Map<String, Id> prepareRequiredSupplier(Boolean manualOnly) {
        STEM__c stem = [SELECT Id, Delivery_Date__c, Variable_Charges_Confirmed__c FROM STEM__c LIMIT 1];
        STEM_Line_Item__c line = [SELECT Id, STEM__c, Original_Supplier__c, Cancelled__c FROM STEM_Line_Item__c WHERE STEM__c = :stem.Id LIMIT 1];
        Account supplier = [SELECT Id, Is_Agent__c, Is_Variable__c FROM Account WHERE Id = :line.Original_Supplier__c];
        ContextManager.skipTriggers = true;
        try {
            stem.Delivery_Date__c = Date.today().addDays(-1);
            stem.Variable_Charges_Confirmed__c = false;
            update stem;
            supplier.Is_Agent__c = !manualOnly;
            supplier.Is_Variable__c = false;
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

    @IsTest
    static void invoiceTabCollectsOnlyOutstandingBuyerApprovalSuppliers() {
        Map<String, Id> ids = prepareRequiredSupplier(true);
        Id stemId = ids.get('stem');
        Account other = TestDataFactory.createTestAccount('Second invoice reminder supplier', 'SUPPLIER', false);
        other.Is_Variable__c = true;
        insert other;
        STEM_Extra_Cost__c extra = TestDataFactory.createTestStemExtraCost(
            stemId, null, null, null, null, 25, 20, null, 'STEM Charge', false
        );
        extra.Supplier__c = other.Id;
        extra.Fixed__c = true;
        ContextManager.skipTriggers = true;
        try {
            insert extra;
        } finally {
            ContextManager.skipTriggers = false;
        }

        Test.startTest();
        VariableChargeInvoiceReadinessService.Readiness tab =
            VariableChargeInvoiceReadinessService.getBuyerInvoiceTabReadiness(String.valueOf(stemId));
        System.assertEquals(false, tab.ready);
        System.assertEquals(true, tab.pendingBuyerApproval);
        System.assertEquals(new Set<Id>{ids.get('supplier'), other.Id}, new Set<Id>(tab.blockingBuyerSupplierIds));

        verifyBuyerSide(ids);
        tab = VariableChargeInvoiceReadinessService.getBuyerInvoiceTabReadiness(String.valueOf(stemId));
        System.assertEquals(new List<Id>{other.Id}, tab.blockingBuyerSupplierIds);
        Test.stopTest();
    }

    @IsTest
    static void invoiceTabDoesNotOfferReminderForDeliveryOrAggregateFlag() {
        Map<String, Id> ids = prepareRequiredSupplier(true);
        Id stemId = ids.get('stem');
        verifyBuyerSide(ids);

        Test.startTest();
        VariableChargeInvoiceReadinessService.Readiness aggregate =
            VariableChargeInvoiceReadinessService.getBuyerInvoiceTabReadiness(String.valueOf(stemId));
        System.assertEquals(false, aggregate.ready);
        System.assertEquals(false, aggregate.pendingBuyerApproval);
        System.assert(aggregate.reason.contains('STEM-level Buyer Charges Confirmed'));

        ContextManager.skipTriggers = true;
        try {
            update new STEM__c(Id = stemId, Delivery_Date__c = null);
        } finally {
            ContextManager.skipTriggers = false;
        }
        VariableChargeInvoiceReadinessService.Readiness missingDelivery =
            VariableChargeInvoiceReadinessService.getBuyerInvoiceTabReadiness(String.valueOf(stemId));
        System.assertEquals(false, missingDelivery.pendingBuyerApproval);
        System.assert(missingDelivery.reason.contains('Add the Salesforce Delivery Date'));
        Test.stopTest();
    }

    @IsTest
    static void nonHongKongAgentDoesNotRequireHongKongCurrencyConfiguration() {
        Map<String, Id> ids = prepareRequiredSupplier(false);
        Port__c nonHongKong = TestDataFactory.createTestPort('GIBRALTAR', 'GIBRALTAR', true);
        Port__c hongKong = TestDataFactory.createTestPort('HONG KONG', 'HONG KONG', true);
        ContextManager.skipTriggers = true;
        try {
            update new STEM__c(Id = ids.get('stem'), Port__c = nonHongKong.Id);
            update new Account(Id = ids.get('supplier'), Agency_Fee_Currency__c = null);
        } finally {
            ContextManager.skipTriggers = false;
        }
        Test.startTest();
        System.assertEquals(null, VariableChargeInvoiceReadinessService.agentCurrencyProblem(ids.get('stem'), ids.get('supplier')));
        ContextManager.skipTriggers = true;
        try {
            update new Account(Id = ids.get('supplier'), Agency_Fee_Currency__c = 'HKD');
        } finally {
            ContextManager.skipTriggers = false;
        }
        System.assertEquals(null, VariableChargeInvoiceReadinessService.agentCurrencyProblem(ids.get('stem'), ids.get('supplier')),
            'A shared agent Account must not impose its Hong Kong currency on another port.');
        ContextManager.skipTriggers = true;
        try {
            update new STEM__c(Id = ids.get('stem'), Port__c = hongKong.Id);
            update new Account(Id = ids.get('supplier'), Agency_Fee_Currency__c = null);
        } finally {
            ContextManager.skipTriggers = false;
        }
        System.assert(VariableChargeInvoiceReadinessService.agentCurrencyProblem(ids.get('stem'), ids.get('supplier')).contains('Agreed Agency Fee Currency'));
        Test.stopTest();
    }

    private static void verifyBuyerSide(Map<String, Id> ids) {
        STEM_Variable_Charge_Supplier__c stage = [
            SELECT Id, Buyer_Charge_Status__c, Buyer_Charge_Confirmed_At__c,
                Buyer_Charge_Confirmed_By_Email__c, Buyer_Charge_Reviewed_Source_Fingerprint__c
            FROM STEM_Variable_Charge_Supplier__c WHERE Id = :ids.get('stage')
        ];
        stage.Buyer_Charge_Status__c = 'Verified';
        stage.Buyer_Charge_Confirmed_At__c = System.now();
        stage.Buyer_Charge_Confirmed_By_Email__c = 'supplier.trader@example.com';
        stage.Buyer_Charge_Reviewed_Source_Fingerprint__c = VariableChargeInvoiceReadinessService.buyerChargeFingerprint(ids.get('stem'), ids.get('supplier'));
        update stage;
    }

    @IsTest
    static void buyerApprovalAcceptsLegacyApiLinksAndDetectsChangedInputs() {
        Map<String, Id> ids = prepareRequiredSupplier(true);
        Id stemId = ids.get('stem');
        Id supplierId = ids.get('supplier');
        verifyBuyerSide(ids);
        String stable = VariableChargeInvoiceReadinessService.buyerChargeFingerprint(stemId, supplierId);
        String legacy = VariableChargeInvoiceReadinessService.buyerChargeFingerprintForVersion(stemId, supplierId, '68.0');
        System.assertNotEquals(stable, legacy, 'The generated API links must produce different historical fingerprints.');
        update new STEM_Variable_Charge_Supplier__c(Id = ids.get('stage'), Buyer_Charge_Reviewed_Source_Fingerprint__c = legacy);

        Test.startTest();
        VariableChargeInvoiceReadinessService.Readiness incomplete = VariableChargeInvoiceReadinessService.evaluateBuyer(stemId);
        System.assertEquals(false, incomplete.ready);
        System.assert(incomplete.reason.contains('STEM-level Buyer Charges Confirmed flag is off'), incomplete.reason);
        update new STEM__c(Id = stemId, Variable_Charges_Confirmed__c = true);
        System.assertEquals(true, VariableChargeInvoiceReadinessService.evaluateBuyer(stemId).ready);

        ContextManager.skipTriggers = true;
        try {
            update new STEM__c(Id = stemId, Delivery_Date__c = Date.today().addDays(-2));
        } finally {
            ContextManager.skipTriggers = false;
        }
        VariableChargeInvoiceReadinessService.Readiness mismatch = VariableChargeInvoiceReadinessService.evaluateBuyerSupplier(stemId, supplierId);
        System.assertEquals(false, mismatch.ready);
        System.assert(mismatch.reason.contains('differs from the fingerprint of the current delivery, product and charge inputs'), mismatch.reason);
        Test.stopTest();
    }

    @IsTest
    static void buyerApprovalAcceptsRecordTypeMetadataFromLegacyCallers() {
        Map<String, Id> ids = prepareRequiredSupplier(true);
        Id stemId = ids.get('stem');
        Id supplierId = ids.get('supplier');
        String canonical = VariableChargeInvoiceReadinessService.buyerChargeFingerprint(stemId, supplierId);

        Test.startTest();
        for (String version : new List<String>{'67.0', '68.0'}) {
            String legacy = VariableChargeInvoiceReadinessService.buyerChargeFingerprintWithLegacyRecordType(stemId, supplierId, version);
            System.assertNotEquals(canonical, legacy, 'The fixture must exercise a distinct historical header.');
            System.assertEquals(canonical, VariableChargeInvoiceReadinessService.matchingBuyerChargeFingerprint(stemId, supplierId, legacy));
        }
        String oldFingerprint = VariableChargeInvoiceReadinessService.buyerChargeFingerprintWithLegacyRecordType(stemId, supplierId, '68.0');
        ContextManager.skipTriggers = true;
        try { update new STEM__c(Id = stemId, Delivery_Date__c = Date.today().addDays(-2)); }
        finally { ContextManager.skipTriggers = false; }
        System.assertEquals(null, VariableChargeInvoiceReadinessService.matchingBuyerChargeFingerprint(stemId, supplierId, oldFingerprint));
        Test.stopTest();
    }

    @IsTest
    static void buyerApprovalAcceptsLegacyUtcOffsetWithoutIgnoringDeliveryChanges() {
        Map<String, Id> ids = prepareRequiredSupplier(true);
        Id stemId = ids.get('stem');
        Id supplierId = ids.get('supplier');
        String canonical = VariableChargeInvoiceReadinessService.buyerChargeFingerprint(stemId, supplierId);
        Set<String> approvedVariants = new Set<String>();
        Test.startTest();
        for (String version : new List<String>{'67.0', '68.0'}) {
            for (Boolean withRecordType : new List<Boolean>{false, true}) {
                String legacy = VariableChargeInvoiceReadinessService.legacyBuyerCreatedDateFingerprint(stemId, supplierId, version, withRecordType);
                System.assertNotEquals(canonical, legacy);
                approvedVariants.add(legacy);
                System.assertEquals(canonical, VariableChargeInvoiceReadinessService.matchingBuyerChargeFingerprint(stemId, supplierId, legacy));
            }
        }
        ContextManager.skipTriggers = true;
        try { update new STEM__c(Id = stemId, Delivery_Date__c = Date.today().addDays(-2)); }
        finally { ContextManager.skipTriggers = false; }
        for (String approved : approvedVariants) {
            System.assertEquals(null, VariableChargeInvoiceReadinessService.matchingBuyerChargeFingerprint(stemId, supplierId, approved));
        }
        Test.stopTest();
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

    @IsTest
    static void isVariableRequirementGatesSupplierAndBuyer() {
        Map<String, Id> ids = prepareRequiredSupplier(false);
        ContextManager.skipTriggers = true;
        try {
            update new Account(Id = ids.get('supplier'), Is_Agent__c = false, Is_Variable__c = true);
        } finally {
            ContextManager.skipTriggers = false;
        }
        Test.startTest();
        System.assertEquals(true, VariableChargeInvoiceReadinessService.requiredSupplierIds(ids.get('stem')).contains(ids.get('supplier')));
        assertRequiredFlow(ids);
        Test.stopTest();
    }

    @IsTest
    static void actionabilityUsesDeliveryForProductsAndLatestScheduleForExtraCosts() {
        STEM__c productStem = new STEM__c(Delivery_Date__c = Date.today().addDays(-1));
        VariableChargeInvoiceReadinessService.Actionability productResult =
            VariableChargeInvoiceReadinessService.calculateActionability(productStem, true);
        System.assertEquals('delivery_date', productResult.actionBasis);
        System.assertEquals(Date.today(), productResult.actionableOn);
        System.assertEquals(true, productResult.deliveryRequired);
        System.assertEquals(true, productResult.ready);

        STEM__c extraOnlyStem = new STEM__c(
            ETA_Start_Date__c = Date.today().addDays(-7),
            ETA_End_Date__c = Date.today().addDays(-9),
            ETB_End_Date__c = Date.today().addDays(-5),
            ETCD_Start_Date__c = Date.today().addDays(-6),
            ETD_Start_Date__c = Date.today().addDays(-8)
        );
        VariableChargeInvoiceReadinessService.Actionability extraResult =
            VariableChargeInvoiceReadinessService.calculateActionability(extraOnlyStem, false);
        System.assertEquals('latest_schedule_date', extraResult.actionBasis);
        System.assertEquals(Date.today().addDays(-5), extraResult.actionBasisDate);
        System.assertEquals(Date.today().addDays(-4), extraResult.actionableOn);
        System.assertEquals(false, extraResult.deliveryRequired);
        System.assertEquals(true, extraResult.ready);
    }

    @IsTest
    static void extraCostOnlyActionabilityFallsBackToHongKongCreatedDate() {
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        Test.setCreatedDate(stem.Id, Datetime.newInstanceGMT(2026, 8, 1, 16, 30, 0));
        STEM__c reloaded = [
            SELECT Id, CreatedDate, Delivery_Date__c,
                ETA_Start_Date__c, ETA_End_Date__c, ETB_Start_Date__c, ETB_End_Date__c,
                ETCD_Start_Date__c, ETCD_End_Date__c, ETD_Start_Date__c, ETD_End_Date__c
            FROM STEM__c WHERE Id = :stem.Id
        ];
        reloaded.Delivery_Date__c = null;
        reloaded.ETA_Start_Date__c = null;
        reloaded.ETA_End_Date__c = null;
        reloaded.ETB_Start_Date__c = null;
        reloaded.ETB_End_Date__c = null;
        reloaded.ETCD_Start_Date__c = null;
        reloaded.ETCD_End_Date__c = null;
        reloaded.ETD_Start_Date__c = null;
        reloaded.ETD_End_Date__c = null;
        VariableChargeInvoiceReadinessService.Actionability result =
            VariableChargeInvoiceReadinessService.calculateActionability(reloaded, false);
        System.assertEquals('enquiry_created_date', result.actionBasis);
        System.assertEquals(Date.newInstance(2026, 8, 2), result.actionBasisDate);
        System.assertEquals(Date.newInstance(2026, 8, 3), result.actionableOn);
    }

    @IsTest
    static void taskActionabilityUsesTheSameProductAndScheduleRules() {
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        List<STEM_Line_Item__c> lines = [SELECT Id, Cancelled__c FROM STEM_Line_Item__c WHERE STEM__c = :stem.Id];
        ContextManager.skipTriggers = true;
        try {
            for (STEM_Line_Item__c line : lines) line.Cancelled__c = true;
            update lines;
            update new STEM__c(
                Id = stem.Id,
                Delivery_Date__c = null,
                ETA_End_Date__c = Date.today().addDays(-1)
            );
        } finally {
            ContextManager.skipTriggers = false;
        }

        VariableChargeInvoiceReadinessService.Readiness readiness =
            VariableChargeInvoiceReadinessService.evaluateTaskActionability(stem.Id);
        System.assertEquals(true, readiness.ready);
        System.assertEquals(false, readiness.deliveryRequired);
        System.assertEquals('latest_schedule_date', readiness.actionBasis);
        System.assertEquals(Date.today().addDays(-1), readiness.actionBasisDate);
        System.assertEquals(Date.today(), readiness.actionableOn);
    }

    private static void assertRequiredFlow(Map<String, Id> ids) {
        VariableChargeInvoiceReadinessService.Readiness supplier = VariableChargeInvoiceReadinessService.evaluateSupplier(ids.get('stem'), ids.get('supplier'));
        System.assertEquals(false, supplier.ready);
        System.assertEquals(true, supplier.requiresVariableChargeReview);
        System.assert(supplier.reason.contains('Confirm'));
        System.assert(supplier.reason.contains('costs in FCOS'));

        verifyStage(ids);
        System.assertEquals(true, VariableChargeInvoiceReadinessService.evaluateSupplier(ids.get('stem'), ids.get('supplier')).ready);
        System.assertEquals(false, VariableChargeInvoiceReadinessService.evaluateBuyer(ids.get('stem')).ready);

        verifyBuyerSide(ids);

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
    static void sharedFinancialChangeInvalidatesBothSidesAndBuyerConfirmation() {
        Map<String, Id> ids = prepareRequiredSupplier(false);
        Test.startTest();
        verifyStage(ids);
        verifyBuyerSide(ids);
        ContextManager.skipTriggers = true;
        try {
            update new STEM__c(Id = ids.get('stem'), Variable_Charges_Confirmed__c = true);
        } finally {
            ContextManager.skipTriggers = false;
        }
        STEM_Line_Item__c line = [SELECT Id, STEM__c, Original_Supplier__c, Cancelled__c, Quantity__c FROM STEM_Line_Item__c WHERE STEM__c = :ids.get('stem') AND Original_Supplier__c = :ids.get('supplier') LIMIT 1];
        STEM_Line_Item__c before = line.clone(true, true, false, false);
        line.Quantity__c = (line.Quantity__c == null ? 1 : line.Quantity__c) + 1;
        VariableChargeInvoiceReadinessService.invalidateForLineItemChanges(
            new List<STEM_Line_Item__c>{line},
            new Map<Id, STEM_Line_Item__c>{line.Id => before}
        );
        STEM_Variable_Charge_Supplier__c invalidated = [SELECT Supplier_Status__c, Buyer_Charge_Status__c FROM STEM_Variable_Charge_Supplier__c WHERE Id = :ids.get('stage')];
        System.assertEquals('Invalidated', invalidated.Supplier_Status__c);
        System.assertEquals('Invalidated', invalidated.Buyer_Charge_Status__c);
        System.assertEquals(false, [SELECT Variable_Charges_Confirmed__c FROM STEM__c WHERE Id = :ids.get('stem')].Variable_Charges_Confirmed__c);
        Test.stopTest();
    }

    @IsTest
    static void costOnlyChangeLeavesBuyerSideAndAggregateReady() {
        Map<String, Id> ids = prepareRequiredSupplier(false);
        verifyStage(ids);
        verifyBuyerSide(ids);
        ContextManager.skipTriggers = true;
        try {
            update new STEM__c(Id = ids.get('stem'), Variable_Charges_Confirmed__c = true);
        } finally {
            ContextManager.skipTriggers = false;
        }
        STEM_Line_Item__c line = [SELECT Id, STEM__c, Original_Supplier__c, Cancelled__c, Unit_Buy_At__c FROM STEM_Line_Item__c WHERE STEM__c = :ids.get('stem') AND Original_Supplier__c = :ids.get('supplier') LIMIT 1];
        STEM_Line_Item__c before = line.clone(true, true, false, false);
        line.Unit_Buy_At__c = (line.Unit_Buy_At__c == null ? 0 : line.Unit_Buy_At__c) + 1;
        VariableChargeInvoiceReadinessService.invalidateForLineItemChanges(new List<STEM_Line_Item__c>{line}, new Map<Id, STEM_Line_Item__c>{line.Id => before});
        STEM_Variable_Charge_Supplier__c stage = [SELECT Supplier_Status__c, Buyer_Charge_Status__c FROM STEM_Variable_Charge_Supplier__c WHERE Id = :ids.get('stage')];
        System.assertEquals('Invalidated', stage.Supplier_Status__c);
        System.assertEquals('Verified', stage.Buyer_Charge_Status__c);
        System.assertEquals(true, [SELECT Variable_Charges_Confirmed__c FROM STEM__c WHERE Id = :ids.get('stem')].Variable_Charges_Confirmed__c);
    }

    @IsTest
    static void vesselNrtChangeInvalidatesOnlyVersionedAnchorageReviews() {
        Map<String, Id> ids = prepareRequiredSupplier(false);
        verifyStage(ids);
        verifyBuyerSide(ids);
        ContextManager.skipTriggers = true;
        Vessel__c vessel;
        try {
            vessel = new Vessel__c(Name = 'ANCHORAGE NRT TEST', IMO__c = '9898785', NRT__c = 7000);
            insert vessel;
            update new STEM__c(Id = ids.get('stem'), Vessel__c = vessel.Id, Variable_Charges_Confirmed__c = true);
            Id productId = [SELECT Product__c FROM STEM_Line_Item__c WHERE STEM__c = :ids.get('stem') LIMIT 1].Product__c;
            insert new STEM_Extra_Cost__c(
                STEM__c = ids.get('stem'), Supplier__c = ids.get('supplier'), Product2Id__c = productId,
                Cancelled__c = false, Anchorage_Calculation_Version__c = 'hk-md-2026-v1',
                Anchorage_Arrival__c = System.now().addHours(-20), Anchorage_Departure__c = System.now(),
                Anchorage_Location__c = 'Elsewhere in Hong Kong', Anchorage_Dues_Allocation_HKD__c = 840,
                Anchorage_NRT_Snapshot__c = 7000, Anchorage_USD_HKD_Rate__c = 7.84,
                Anchorage_Buyer_Default_USD__c = 112, Anchorage_Buyer_Rate_USD__c = 0.002,
                Anchorage_Buyer_Calc_Version__c = 'hk-buyer-nrt-hour-2026-v1'
            );
        } finally {
            ContextManager.skipTriggers = false;
        }
        Vessel__c before = vessel.clone(true, true, false, false);
        vessel.NRT__c = 7100;
        Test.startTest();
        VariableChargeInvoiceReadinessService.invalidateForVesselChanges(
            new Map<Id, Vessel__c>{ vessel.Id => vessel },
            new Map<Id, Vessel__c>{ before.Id => before }
        );
        Test.stopTest();
        STEM_Variable_Charge_Supplier__c stage = [
            SELECT Supplier_Status__c, Buyer_Charge_Status__c
            FROM STEM_Variable_Charge_Supplier__c WHERE Id = :ids.get('stage')
        ];
        System.assertEquals('Invalidated', stage.Supplier_Status__c);
        System.assertEquals('Invalidated', stage.Buyer_Charge_Status__c);
        System.assertEquals(false, [SELECT Variable_Charges_Confirmed__c FROM STEM__c WHERE Id = :ids.get('stem')].Variable_Charges_Confirmed__c);
    }

    @IsTest
    static void vesselNrtChangeInvalidatesVersionedLightDuesReviews() {
        Map<String, Id> ids = prepareRequiredSupplier(false);
        verifyStage(ids);
        verifyBuyerSide(ids);
        ContextManager.skipTriggers = true;
        Vessel__c vessel;
        try {
            vessel = new Vessel__c(Name = 'LIGHT DUES NRT TEST', IMO__c = '9898786', NRT__c = 7000);
            insert vessel;
            update new STEM__c(Id = ids.get('stem'), Vessel__c = vessel.Id, Variable_Charges_Confirmed__c = true);
            Id productId = [SELECT Product__c FROM STEM_Line_Item__c WHERE STEM__c = :ids.get('stem') LIMIT 1].Product__c;
            insert new STEM_Extra_Cost__c(
                STEM__c = ids.get('stem'), Supplier__c = ids.get('supplier'), Product2Id__c = productId,
                Cancelled__c = false, Light_Dues_Calculation_Version__c = 'hk-md-2026-v1',
                Light_Dues_Entry_Date__c = Date.today(), Light_Dues_Category__c = 'All Other',
                Light_Dues_NRT_Snapshot__c = 7000, Light_Dues_Rate_HKD__c = 43,
                Light_Dues_Amount_HKD__c = 3010, Light_Dues_USD_HKD_Rate__c = 7.84,
                Light_Dues_FX_Settings_Revision__c = 1
            );
        } finally {
            ContextManager.skipTriggers = false;
        }
        Vessel__c before = vessel.clone(true, true, false, false);
        vessel.NRT__c = 7001;
        Test.startTest();
        VariableChargeInvoiceReadinessService.invalidateForVesselChanges(
            new Map<Id, Vessel__c>{ vessel.Id => vessel },
            new Map<Id, Vessel__c>{ before.Id => before }
        );
        Test.stopTest();
        STEM_Variable_Charge_Supplier__c stage = [
            SELECT Supplier_Status__c, Buyer_Charge_Status__c
            FROM STEM_Variable_Charge_Supplier__c WHERE Id = :ids.get('stage')
        ];
        System.assertEquals('Invalidated', stage.Supplier_Status__c);
        System.assertEquals('Invalidated', stage.Buyer_Charge_Status__c);
        System.assertEquals(false, [SELECT Variable_Charges_Confirmed__c FROM STEM__c WHERE Id = :ids.get('stem')].Variable_Charges_Confirmed__c);
    }

    @IsTest
    static void buyerOnlyChangeLeavesSupplierCostVerifiedAndClosesBuyerGate() {
        Map<String, Id> ids = prepareRequiredSupplier(false);
        verifyStage(ids);
        verifyBuyerSide(ids);
        ContextManager.skipTriggers = true;
        try {
            update new STEM__c(Id = ids.get('stem'), Variable_Charges_Confirmed__c = true);
        } finally {
            ContextManager.skipTriggers = false;
        }
        STEM_Line_Item__c line = [SELECT Id, STEM__c, Original_Supplier__c, Cancelled__c, Unit_Sell_At__c FROM STEM_Line_Item__c WHERE STEM__c = :ids.get('stem') AND Original_Supplier__c = :ids.get('supplier') LIMIT 1];
        STEM_Line_Item__c before = line.clone(true, true, false, false);
        line.Unit_Sell_At__c = (line.Unit_Sell_At__c == null ? 0 : line.Unit_Sell_At__c) + 1;
        VariableChargeInvoiceReadinessService.invalidateForLineItemChanges(new List<STEM_Line_Item__c>{line}, new Map<Id, STEM_Line_Item__c>{line.Id => before});
        STEM_Variable_Charge_Supplier__c stage = [SELECT Supplier_Status__c, Buyer_Charge_Status__c FROM STEM_Variable_Charge_Supplier__c WHERE Id = :ids.get('stage')];
        System.assertEquals('Verified', stage.Supplier_Status__c);
        System.assertEquals('Invalidated', stage.Buyer_Charge_Status__c);
        System.assertEquals(false, [SELECT Variable_Charges_Confirmed__c FROM STEM__c WHERE Id = :ids.get('stem')].Variable_Charges_Confirmed__c);
    }

    @IsTest
    static void buyerSideCanFinishBeforeSupplierCostAndOpenBuyerGate() {
        Map<String, Id> ids = prepareRequiredSupplier(false);
        verifyBuyerSide(ids);
        ContextManager.skipTriggers = true;
        try {
            update new STEM__c(Id = ids.get('stem'), Variable_Charges_Confirmed__c = true);
        } finally {
            ContextManager.skipTriggers = false;
        }
        System.assertEquals('Pending', [SELECT Supplier_Status__c FROM STEM_Variable_Charge_Supplier__c WHERE Id = :ids.get('stage')].Supplier_Status__c);
        System.assertEquals(false, VariableChargeInvoiceReadinessService.evaluateSupplier(ids.get('stem'), ids.get('supplier')).ready);
        System.assertEquals(true, VariableChargeInvoiceReadinessService.evaluateBuyer(ids.get('stem')).ready);
    }

    @IsTest
    static void buyerInvoiceUsesItsApprovedChargesWhenSupplierCurrencyIsUnreviewed() {
        Map<String, Id> ids = prepareRequiredSupplier(false);
        Port__c hongKong = TestDataFactory.createTestPort('HONG KONG', 'HONG KONG', true);
        ContextManager.skipTriggers = true;
        try {
            update new STEM__c(Id = ids.get('stem'), Port__c = hongKong.Id, Variable_Charges_Confirmed__c = false);
            update new Account(Id = ids.get('supplier'), Agency_Fee_Currency__c = null);
        } finally {
            ContextManager.skipTriggers = false;
        }
        verifyBuyerSide(ids);

        Test.startTest();
        VariableChargeInvoiceReadinessService.Readiness supplier =
            VariableChargeInvoiceReadinessService.evaluateSupplier(ids.get('stem'), ids.get('supplier'));
        System.assertEquals(false, supplier.ready);
        System.assert(supplier.reason.contains('Agreed Agency Fee Currency'), supplier.reason);

        VariableChargeInvoiceReadinessService.Readiness unconfirmedBuyer =
            VariableChargeInvoiceReadinessService.evaluateBuyer(ids.get('stem'));
        System.assertEquals(false, unconfirmedBuyer.ready);
        System.assert(unconfirmedBuyer.reason.contains('STEM-level Buyer Charges Confirmed flag is off'), unconfirmedBuyer.reason);

        ContextManager.skipTriggers = true;
        try {
            update new STEM__c(Id = ids.get('stem'), Variable_Charges_Confirmed__c = true);
        } finally {
            ContextManager.skipTriggers = false;
        }
        VariableChargeInvoiceReadinessService.Readiness confirmedBuyer =
            VariableChargeInvoiceReadinessService.evaluateBuyer(ids.get('stem'));
        System.assertEquals(true, confirmedBuyer.ready, 'Current buyer approval should allow the buyer invoice.');
        Test.stopTest();
    }

    @IsTest
    static void noRequirementBypassesBothGates() {
        Map<String, Id> ids = prepareRequiredSupplier(false);
        Test.startTest();
        Account supplier = [SELECT Id, Is_Agent__c, Is_Variable__c FROM Account WHERE Id = :ids.get('supplier')];
        ContextManager.skipTriggers = true;
        try {
            supplier.Is_Agent__c = false;
            supplier.Is_Variable__c = false;
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

    private static Map<String, Id> prepareUnrelatedCharge() {
        Map<String, Id> ids = prepareRequiredSupplier(true);
        Account ordinary = TestDataFactory.createTestAccount('Unrelated fixed supplier', 'SUPPLIER', true);
        STEM_Extra_Cost__c extra = TestDataFactory.createTestStemExtraCost(
            ids.get('stem'), null, null, null, null, 75, 50, null, 'STEM Charge', false);
        extra.Supplier__c = ordinary.Id;
        extra.Fixed__c = true;
        ContextManager.skipTriggers = true;
        try { insert extra; } finally { ContextManager.skipTriggers = false; }
        ids.put('extra', extra.Id);
        ids.put('ordinary', ordinary.Id);
        verifyBuyerSide(ids);
        update new STEM__c(Id = ids.get('stem'), Variable_Charges_Confirmed__c = true);
        return ids;
    }

    private static void assertOriginalBuyerApproval(Map<String, Id> ids, STEM_Variable_Charge_Supplier__c before) {
        STEM_Variable_Charge_Supplier__c after = [
            SELECT Buyer_Charge_Status__c, Buyer_Charge_Confirmed_At__c, Buyer_Charge_Confirmed_By_Email__c,
                Buyer_Charge_Reviewed_Source_Fingerprint__c, Buyer_Charge_Revision__c
            FROM STEM_Variable_Charge_Supplier__c WHERE Id = :ids.get('stage')
        ];
        System.assertEquals(JSON.serialize(before), JSON.serialize(after), 'An unrelated charge must preserve the original buyer approval.');
        System.assertEquals(true, [SELECT Variable_Charges_Confirmed__c FROM STEM__c WHERE Id = :ids.get('stem')].Variable_Charges_Confirmed__c);
        System.assertEquals(true, VariableChargeInvoiceReadinessService.evaluateBuyer(ids.get('stem')).ready);
    }

    private static STEM_Variable_Charge_Supplier__c originalBuyerApproval(Map<String, Id> ids) {
        return [SELECT Buyer_Charge_Status__c, Buyer_Charge_Confirmed_At__c, Buyer_Charge_Confirmed_By_Email__c,
            Buyer_Charge_Reviewed_Source_Fingerprint__c, Buyer_Charge_Revision__c
            FROM STEM_Variable_Charge_Supplier__c WHERE Id = :ids.get('stage')];
    }

    @IsTest static void unrelatedExtraCostInsertPreservesBuyerConfirmation() {
        Map<String, Id> ids = prepareUnrelatedCharge();
        STEM_Variable_Charge_Supplier__c before = originalBuyerApproval(ids);
        STEM_Extra_Cost__c extra = TestDataFactory.createTestStemExtraCost(
            ids.get('stem'), null, null, null, null, 125, 100, null, 'STEM Charge', false);
        extra.Supplier__c = ids.get('ordinary');
        extra.Fixed__c = true;
        Test.startTest();
        insert extra;
        assertOriginalBuyerApproval(ids, before);
        Test.stopTest();
    }

    @IsTest static void unrelatedExtraCostUpdatePreservesBuyerConfirmation() {
        Map<String, Id> ids = prepareUnrelatedCharge();
        STEM_Variable_Charge_Supplier__c before = originalBuyerApproval(ids);
        Test.startTest();
        update new STEM_Extra_Cost__c(Id = ids.get('extra'), Lumpsum_Price__c = 95);
        assertOriginalBuyerApproval(ids, before);
        Test.stopTest();
    }

    @IsTest static void unrelatedExtraCostDeletePreservesBuyerConfirmation() {
        Map<String, Id> ids = prepareUnrelatedCharge();
        STEM_Variable_Charge_Supplier__c before = originalBuyerApproval(ids);
        Test.startTest();
        delete new STEM_Extra_Cost__c(Id = ids.get('extra'));
        assertOriginalBuyerApproval(ids, before);
        Test.stopTest();
    }

    @IsTest static void unrelatedExtraCostCannotRestoreExplicitlyClearedConfirmation() {
        Map<String, Id> ids = prepareUnrelatedCharge();
        update new STEM__c(Id = ids.get('stem'), Variable_Charges_Confirmed__c = false);
        Test.startTest();
        update new STEM_Extra_Cost__c(Id = ids.get('extra'), Lumpsum_Price__c = 95);
        System.assertEquals(false, [SELECT Variable_Charges_Confirmed__c FROM STEM__c WHERE Id = :ids.get('stem')].Variable_Charges_Confirmed__c);
        System.assertEquals(false, VariableChargeInvoiceReadinessService.evaluateBuyer(ids.get('stem')).ready);
        Test.stopTest();
    }

    private static STEM_Line_Item__c unrelatedProduct(Map<String, Id> ids) {
        STEM_Line_Item__c source = [SELECT Product__c FROM STEM_Line_Item__c WHERE STEM__c = :ids.get('stem') LIMIT 1];
        return TestDataFactory.createTestStemLineItem('Unrelated product', String.valueOf(ids.get('stem')),
            String.valueOf(ids.get('ordinary')), String.valueOf(source.Product__c), 10, 100, 90, 10, '30', false);
    }

    @IsTest static void unrelatedProductPricePreservesBuyerConfirmation() {
        Map<String, Id> ids = prepareUnrelatedCharge();
        STEM_Line_Item__c line = unrelatedProduct(ids);
        ContextManager.skipTriggers = true;
        try { insert line; } finally { ContextManager.skipTriggers = false; }
        verifyBuyerSide(ids);
        STEM_Variable_Charge_Supplier__c before = originalBuyerApproval(ids);
        Test.startTest();
        update new STEM_Line_Item__c(Id = line.Id, Unit_Sell_At__c = 110);
        assertOriginalBuyerApproval(ids, before);
        Test.stopTest();
    }

    @IsTest static void unrelatedProductInsertRevokesBuyerConfirmation() {
        Map<String, Id> ids = prepareUnrelatedCharge();
        STEM_Line_Item__c line = unrelatedProduct(ids);
        Test.startTest();
        insert line;
        System.assertEquals(false, [SELECT Variable_Charges_Confirmed__c FROM STEM__c WHERE Id = :ids.get('stem')].Variable_Charges_Confirmed__c);
        System.assertEquals('Invalidated', [SELECT Buyer_Charge_Status__c FROM STEM_Variable_Charge_Supplier__c WHERE Id = :ids.get('stage')].Buyer_Charge_Status__c);
        Test.stopTest();
    }

    @IsTest static void unrelatedProductDeleteRevokesBuyerConfirmation() {
        Map<String, Id> ids = prepareUnrelatedCharge();
        STEM_Line_Item__c line = unrelatedProduct(ids);
        ContextManager.skipTriggers = true;
        try { insert line; } finally { ContextManager.skipTriggers = false; }
        verifyBuyerSide(ids);
        Test.startTest();
        delete line;
        System.assertEquals(false, [SELECT Variable_Charges_Confirmed__c FROM STEM__c WHERE Id = :ids.get('stem')].Variable_Charges_Confirmed__c);
        System.assertEquals('Invalidated', [SELECT Buyer_Charge_Status__c FROM STEM_Variable_Charge_Supplier__c WHERE Id = :ids.get('stage')].Buyer_Charge_Status__c);
        Test.stopTest();
    }

    @IsTest static void requiredExtraCostWithoutStageStillRevokesBuyerConfirmation() {
        Map<String, Id> ids = prepareUnrelatedCharge();
        ContextManager.skipTriggers = true;
        try { update new Account(Id = ids.get('ordinary'), Is_Variable__c = true); }
        finally { ContextManager.skipTriggers = false; }
        Test.startTest();
        update new STEM_Extra_Cost__c(Id = ids.get('extra'), Lumpsum_Price__c = 95);
        System.assertEquals(false, [SELECT Variable_Charges_Confirmed__c FROM STEM__c WHERE Id = :ids.get('stem')].Variable_Charges_Confirmed__c);
        Test.stopTest();
    }

    @IsTest static void deletingLastRequiredManualExtraStillRevokesBuyerConfirmation() {
        Map<String, Id> ids = prepareUnrelatedCharge();
        insert new STEM_Variable_Charge_Supplier__c(STEM__c = ids.get('stem'), Supplier__c = ids.get('ordinary'), Manual_Review_Required__c = true);
        Test.startTest();
        delete new STEM_Extra_Cost__c(Id = ids.get('extra'));
        System.assertEquals(false, [SELECT Variable_Charges_Confirmed__c FROM STEM__c WHERE Id = :ids.get('stem')].Variable_Charges_Confirmed__c);
        Test.stopTest();
    }
}
