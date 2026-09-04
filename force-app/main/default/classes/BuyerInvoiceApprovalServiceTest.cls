@IsTest
private class BuyerInvoiceApprovalServiceTest {
    private class IssuedInvoice {
        Id invoiceId;
        Id stemId;
        Id supplierId;
        Id stageId;
        Id lineId;
        Id documentId;

        IssuedInvoice(Id invoiceId, Id stemId, Id supplierId, Id stageId, Id lineId, Id documentId) {
            this.invoiceId = invoiceId;
            this.stemId = stemId;
            this.supplierId = supplierId;
            this.stageId = stageId;
            this.lineId = lineId;
            this.documentId = documentId;
        }
    }

    @TestSetup
    static void makeData() {
        TestDataFactory.prepareDataForNominationConfirmationFlow();
    }

    private static Map<String, Id> prepareRequiredBuyerApproval(Boolean approved) {
        STEM__c stem = [
            SELECT Id, Delivery_Date__c, Variable_Charges_Confirmed__c
            FROM STEM__c LIMIT 1
        ];
        STEM_Line_Item__c line = [
            SELECT Id, STEM__c, Original_Supplier__c, Cancelled__c
            FROM STEM_Line_Item__c WHERE STEM__c = :stem.Id LIMIT 1
        ];
        Account supplier = [
            SELECT Id, Is_Agent__c, Is_Variable__c FROM Account WHERE Id = :line.Original_Supplier__c
        ];

        ContextManager.skipTriggers = true;
        try {
            stem.Delivery_Date__c = Date.today().addDays(-1);
            stem.Variable_Charges_Confirmed__c = false;
            update stem;
            supplier.Is_Agent__c = true;
            supplier.Is_Variable__c = false;
            update supplier;
        } finally {
            ContextManager.skipTriggers = false;
        }

        STEM_Variable_Charge_Supplier__c stage = new STEM_Variable_Charge_Supplier__c(
            STEM__c = stem.Id,
            Supplier__c = supplier.Id,
            Manual_Review_Required__c = false,
            Supplier_Status__c = approved ? 'Verified' : 'Pending',
            Buyer_Charge_Status__c = approved ? 'Verified' : 'Pending'
        );
        if (approved) {
            stage.Verified_At__c = System.now();
            stage.Verified_By_Email__c = 'supplier.trader@example.com';
            stage.Reviewed_Source_Fingerprint__c =
                VariableChargeInvoiceReadinessService.supplierFingerprint(stem.Id, supplier.Id);
            stage.Buyer_Charge_Confirmed_At__c = System.now();
            stage.Buyer_Charge_Confirmed_By_Email__c = 'buyer.trader@example.com';
            stage.Buyer_Charge_Reviewed_Source_Fingerprint__c =
                VariableChargeInvoiceReadinessService.buyerChargeFingerprint(stem.Id, supplier.Id);
        }
        insert stage;

        if (approved) {
            ContextManager.skipTriggers = true;
            try {
                update new STEM__c(Id = stem.Id, Variable_Charges_Confirmed__c = true);
            } finally {
                ContextManager.skipTriggers = false;
            }
        }
        return new Map<String, Id>{
            'stem' => stem.Id,
            'supplier' => supplier.Id,
            'stage' => stage.Id,
            'line' => line.Id
        };
    }

    private static IssuedInvoice issueApprovedInvoice() {
        Map<String, Id> ids = prepareRequiredBuyerApproval(true);
        STEM_Line_Item__c line = [
            SELECT Id FROM STEM_Line_Item__c WHERE Id = :ids.get('line')
        ];
        Invoice__c invoice = new Invoice__c(
            Name = '00001T-INV-SNAPSHOT',
            STEM__c = ids.get('stem'),
            Proforma__c = false,
            Invoice_Date__c = Date.today(),
            Delivery_Date__c = Date.today().addDays(-1),
            Invoice_Due_Date__c = Date.today().addDays(30)
        );
        insert invoice;

        // Invoice creation and PDF generation are separate Aura requests in the
        // production flow. Reset limits here so this fixture preserves that boundary.
        Test.startTest();
        InvoiceController.generateInvoicePDF(
            invoice.Id,
            invoice.Name,
            new List<String>{String.valueOf(line.Id)},
            EncodingUtil.base64Encode(Blob.valueOf('approved invoice PDF')),
            false
        );
        Id documentId = [
            SELECT ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId = :invoice.Id LIMIT 1
        ].ContentDocumentId;
        Invoice__c issued = [
            SELECT Id, Buyer_Charge_Snapshot__c FROM Invoice__c WHERE Id = :invoice.Id
        ];
        System.assertNotEquals(null, issued.Buyer_Charge_Snapshot__c,
            'An approved final invoice must capture its automatic issuance snapshot when its PDF is attached.');
        return new IssuedInvoice(invoice.Id, ids.get('stem'), ids.get('supplier'), ids.get('stage'), line.Id, documentId);
    }

    private static void assertBlocked(Id invoiceId) {
        try {
            BuyerInvoiceApprovalService.assertPersistedInvoicesCanSend(new Set<Id>{invoiceId});
            System.assert(false, 'The changed invoice must not be eligible for email delivery.');
        } catch (AuraHandledException expected) {
            System.assert(String.isNotBlank(expected.getMessage()),
                'The service should return a visible reason for withholding the invoice email.');
        }
    }

    @IsTest
    static void issuedApprovedInvoiceCanSendAfterCostWorkflowInvalidatesButItsContentIsUnchanged() {
        IssuedInvoice issued = issueApprovedInvoice();
        STEM__c originalStem = [
            SELECT Id, Variable_Charges_Confirmed__c, Total_Invoice_Amount__c
            FROM STEM__c WHERE Id = :issued.stemId
        ];
        Map<String, Object> accountingRollupValues = (Map<String, Object>) JSON.deserializeUntyped(
            JSON.serialize(originalStem.clone(true, false, false, false))
        );
        accountingRollupValues.put('Total_Invoice_Amount__c',
            (originalStem.Total_Invoice_Amount__c == null ? 0 : originalStem.Total_Invoice_Amount__c) + 1);
        STEM__c accountingRollup = (STEM__c) JSON.deserialize(
            JSON.serialize(accountingRollupValues), STEM__c.class
        );
        VariableChargeInvoiceReadinessService.invalidateForStemChanges(
            new List<STEM__c>{accountingRollup}, new Map<Id, STEM__c>{issued.stemId => originalStem});
        System.assertEquals(true, accountingRollup.Variable_Charges_Confirmed__c,
            'An accounting invoice rollup must not revoke the buyer approval aggregate.');
        STEM_Variable_Charge_Supplier__c stageAfterAccountingRollup = [
            SELECT Supplier_Status__c, Buyer_Charge_Status__c
            FROM STEM_Variable_Charge_Supplier__c WHERE Id = :issued.stageId
        ];
        System.assertEquals('Verified', stageAfterAccountingRollup.Supplier_Status__c,
            'An accounting invoice rollup must not invalidate the supplier stage.');
        System.assertEquals('Verified', stageAfterAccountingRollup.Buyer_Charge_Status__c,
            'An accounting invoice rollup must not invalidate the buyer stage.');

        ContextManager.skipTriggers = true;
        try {
            update new STEM_Variable_Charge_Supplier__c(Id = issued.stageId, Supplier_Status__c = 'Invalidated');
            update new STEM__c(Id = issued.stemId, Variable_Charges_Confirmed__c = false);
        } finally {
            ContextManager.skipTriggers = false;
        }

        BuyerInvoiceApprovalService.assertPersistedInvoicesCanSend(new Set<Id>{issued.invoiceId});
        update new Invoice__c(Id = issued.invoiceId, Sent__c = true);
        System.assertEquals(true, [SELECT Sent__c FROM Invoice__c WHERE Id = :issued.invoiceId].Sent__c,
            'The real Sent transition must accept a captured, unchanged invoice despite a later cost-side workflow invalidation.');
        Test.stopTest();
    }

    @IsTest
    static void singleCurrencySchemaKeepsV1CurrencyKeysNullAndAllowsCapturedInvoiceToSend() {
        BuyerInvoiceApprovalService.currencyIsoCodeAvailableForTest = false;
        try {
            IssuedInvoice issued = issueApprovedInvoice();
            String serializedSnapshot = [
                SELECT Buyer_Charge_Snapshot__c FROM Invoice__c WHERE Id = :issued.invoiceId
            ].Buyer_Charge_Snapshot__c;
            Map<String, Object> snapshot = (Map<String, Object>) JSON.deserializeUntyped(serializedSnapshot);
            System.assert(((Map<String, Object>) snapshot.get('invoice')).containsKey('CurrencyIsoCode'));
            System.assertEquals(null, ((Map<String, Object>) snapshot.get('invoice')).get('CurrencyIsoCode'));
            System.assert(((Map<String, Object>) snapshot.get('stem')).containsKey('CurrencyIsoCode'));
            System.assertEquals(null, ((Map<String, Object>) snapshot.get('stem')).get('CurrencyIsoCode'));
            List<Object> lines = (List<Object>) snapshot.get('lines');
            System.assert(((Map<String, Object>) lines[0]).containsKey('CurrencyIsoCode'));
            System.assertEquals(null, ((Map<String, Object>) lines[0]).get('CurrencyIsoCode'));

            BuyerInvoiceApprovalService.assertPersistedInvoicesCanSend(new Set<Id>{issued.invoiceId});
        } finally {
            Test.stopTest();
            BuyerInvoiceApprovalService.currencyIsoCodeAvailableForTest = null;
        }
    }

    @IsTest
    static void changedBuyerChargeBlocksCapturedInvoice() {
        IssuedInvoice priceChanged = issueApprovedInvoice();
        ContextManager.skipTriggers = true;
        try {
            STEM_Line_Item__c line = [SELECT Id, Unit_Sell_At__c FROM STEM_Line_Item__c WHERE Id = :priceChanged.lineId];
            line.Unit_Sell_At__c = (line.Unit_Sell_At__c == null ? 1 : line.Unit_Sell_At__c + 1);
            update line;
        } finally {
            ContextManager.skipTriggers = false;
        }
        assertBlocked(priceChanged.invoiceId);
        Test.stopTest();
    }

    @IsTest
    static void changedInvoiceHeaderBlocksCapturedInvoice() {
        IssuedInvoice headerChanged = issueApprovedInvoice();
        update new Invoice__c(Id = headerChanged.invoiceId, Invoice_Due_Date__c = Date.today().addDays(31));
        assertBlocked(headerChanged.invoiceId);
        Test.stopTest();
    }

    @IsTest
    static void changedPdfVersionBlocksCapturedInvoice() {
        IssuedInvoice pdfChanged = issueApprovedInvoice();
        insert new ContentVersion(
            Title = 'revised.pdf',
            PathOnClient = '/revised.pdf',
            VersionData = Blob.valueOf('revised invoice PDF'),
            IsMajorVersion = true,
            ContentDocumentId = pdfChanged.documentId
        );
        assertBlocked(pdfChanged.invoiceId);
        Test.stopTest();
    }

    @IsTest
    static void cancelledBuyerRowBlocksCapturedInvoice() {
        IssuedInvoice cancelled = issueApprovedInvoice();
        ContextManager.skipTriggers = true;
        try {
            update new STEM_Line_Item__c(Id = cancelled.lineId, Cancelled__c = true);
        } finally {
            ContextManager.skipTriggers = false;
        }
        assertBlocked(cancelled.invoiceId);
        Test.stopTest();
    }

    @IsTest
    static void movedBuyerInvoiceLinkBlocksCapturedInvoice() {
        IssuedInvoice linkMoved = issueApprovedInvoice();
        ContextManager.skipTriggers = true;
        try {
            update new STEM_Line_Item__c(Id = linkMoved.lineId, Buyer_Invoice__c = null);
        } finally {
            ContextManager.skipTriggers = false;
        }
        assertBlocked(linkMoved.invoiceId);
        Test.stopTest();
    }

    @IsTest
    static void snapshotCannotBeForgedAndDeprecatedInvoiceCannotSend() {
        IssuedInvoice issued = issueApprovedInvoice();
        String originalSnapshot = [SELECT Buyer_Charge_Snapshot__c FROM Invoice__c WHERE Id = :issued.invoiceId].Buyer_Charge_Snapshot__c;
        try {
            update new Invoice__c(Id = issued.invoiceId, Buyer_Charge_Snapshot__c = '{"forged":true}');
            System.assert(false, 'A caller must not be able to manufacture invoice approval.');
        } catch (DmlException expected) {
            System.assert(expected.getMessage().contains('recorded automatically'));
        }
        System.assertEquals(originalSnapshot,
            [SELECT Buyer_Charge_Snapshot__c FROM Invoice__c WHERE Id = :issued.invoiceId].Buyer_Charge_Snapshot__c);

        update new Invoice__c(Id = issued.invoiceId, Deprecated__c = true);
        assertBlocked(issued.invoiceId);
        Test.stopTest();
    }

    @IsTest
    static void unassignedBuyerChargeDoesNotReopenIssuedInvoice() {
        IssuedInvoice issued = issueApprovedInvoice();
        STEM_Line_Item__c line = [SELECT Id FROM STEM_Line_Item__c WHERE Id = :issued.lineId];
        STEM_Extra_Cost__c unassigned = TestDataFactory.createTestStemExtraCost(
            issued.stemId, line.Id, 10, 1, 1, 1, 1, 1, 'STEM Charge', true
        );
        ContextManager.skipTriggers = true;
        try {
            update new STEM__c(Id = issued.stemId, Variable_Charges_Confirmed__c = false);
        } finally {
            ContextManager.skipTriggers = false;
        }
        System.assertEquals(null, unassigned.Buyer_Invoice__c);
        BuyerInvoiceApprovalService.assertPersistedInvoicesCanSend(new Set<Id>{issued.invoiceId});
        Test.stopTest();
    }

    @IsTest
    static void legacyFinalInvoiceStillNeedsApproval() {
        Map<String, Id> pending = prepareRequiredBuyerApproval(false);
        Invoice__c legacy = new Invoice__c(Name = '00001T-INV-LEGACY', STEM__c = pending.get('stem'), Proforma__c = false);
        ContextManager.avoidInvoiceFiring = true;
        try {
            insert legacy;
        } finally {
            ContextManager.avoidInvoiceFiring = false;
        }
        assertBlocked(legacy.Id);
    }

    @IsTest
    static void proformasAndCreditNotesRemainOutsideTheFinalBuyerSnapshotGate() {
        Map<String, Id> pending = prepareRequiredBuyerApproval(false);
        Invoice__c proforma = new Invoice__c(Name = '00001T-INV-P-SNAPSHOT', STEM__c = pending.get('stem'), Proforma__c = true);
        Invoice__c creditNote = new Invoice__c(Name = '00001T-CN-SNAPSHOT', STEM__c = pending.get('stem'), Proforma__c = false);
        insert new List<Invoice__c>{proforma, creditNote};

        BuyerInvoiceApprovalService.assertPersistedInvoicesCanSend(new Set<Id>{proforma.Id, creditNote.Id});
    }
}
