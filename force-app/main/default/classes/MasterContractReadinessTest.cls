@IsTest
private class MasterContractReadinessTest {
    @TestSetup
    static void makeData() {
        TestDataFactory.prepareDataForNominationConfirmationFlow();
    }

    private static Map<String, Id> prepareMasterContractLine(String status) {
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        STEM_Line_Item__c line = [
            SELECT Id, Original_Supplier__c
            FROM STEM_Line_Item__c
            WHERE STEM__c = :stem.Id
            LIMIT 1
        ];
        ContextManager.skipTriggers = true;
        try {
            update new STEM__c(
                Id = stem.Id,
                Master_Contract_Source__c = true,
                Master_Contract_Key__c = 'MC-TEST-2026'
            );
            update new STEM_Line_Item__c(
                Id = line.Id,
                Master_Contract_Source__c = true,
                Master_Contract_Line_Key__c = 'MC-TEST-2026-D01-HSFO',
                DON_Price_Status__c = status
            );
        } finally {
            ContextManager.skipTriggers = false;
        }
        return new Map<String, Id>{ 'stem' => stem.Id, 'supplier' => line.Original_Supplier__c, 'line' => line.Id };
    }

    @IsTest
    static void exactUnresolvedLineBlocksBuyerSupplierAndEveryBuyerDocumentKind() {
        Map<String, Id> ids = prepareMasterContractLine('Unresolved');
        Test.startTest();
        MasterContractInvoiceReadinessService.Readiness buyer =
            MasterContractInvoiceReadinessService.getBuyerReadiness(String.valueOf(ids.get('stem')));
        MasterContractInvoiceReadinessService.Readiness supplier =
            MasterContractInvoiceReadinessService.getSupplierReadiness(
                String.valueOf(ids.get('stem')), String.valueOf(ids.get('supplier'))
            );
        System.assertEquals(false, buyer.ready);
        System.assertEquals(false, supplier.ready);
        System.assertEquals(1, buyer.unresolvedLineCount);
        System.assertEquals(1, supplier.unresolvedLineCount);

        for (List<Boolean> form : new List<List<Boolean>>{
            new List<Boolean>{ false, false },
            new List<Boolean>{ true, false },
            new List<Boolean>{ false, true }
        }) {
            try {
                InvoiceController.createInvoice(
                    String.valueOf(ids.get('stem')), new List<String>(), form[0], form[1],
                    Date.today(), Date.today(), Date.today().addDays(30)
                );
                System.assert(false, 'Every Master Contract buyer document must remain blocked before DON pricing is applied.');
            } catch (Exception expected) {
                System.assertNotEquals(null, expected);
            }
        }

        Supplier_Invoice__c supplierInvoice = new Supplier_Invoice__c(
            STEM__c = ids.get('stem'), Supplier__c = ids.get('supplier')
        );
        MasterContractInvoiceReadinessService.assertSupplierInvoiceTransitionsAllowed(
            new List<Supplier_Invoice__c>{ supplierInvoice }, null
        );
        System.assertEquals(true, supplierInvoice.hasErrors());
        Test.stopTest();
    }

    @IsTest
    static void appliedLineAllowsExactBuyerAndSupplierWhileInvalidInputsFailClosed() {
        Map<String, Id> ids = prepareMasterContractLine('Applied');
        Test.startTest();
        System.assertEquals(true, MasterContractInvoiceReadinessService.getBuyerReadiness(String.valueOf(ids.get('stem'))).ready);
        System.assertEquals(true, MasterContractInvoiceReadinessService.getSupplierReadiness(
            String.valueOf(ids.get('stem')), String.valueOf(ids.get('supplier'))
        ).ready);
        MasterContractInvoiceReadinessService.assertBuyerAllowed(ids.get('stem'));
        MasterContractInvoiceReadinessService.assertSupplierAllowed(ids.get('stem'), ids.get('supplier'));
        Invoice__c invoice = new Invoice__c(STEM__c = ids.get('stem'));
        MasterContractInvoiceReadinessService.assertInvoiceRecordsAllowed(new List<Invoice__c>{ invoice });
        MasterContractInvoiceReadinessService.assertInvoiceTransitionsAllowed(
            new Map<Id, Invoice__c>(),
            new Map<Id, Invoice__c>()
        );
        System.assertEquals(false, MasterContractInvoiceReadinessService.getBuyerReadiness('not-an-id').ready);
        System.assertEquals(false, MasterContractInvoiceReadinessService.getSupplierReadiness(
            String.valueOf(ids.get('stem')), ''
        ).ready);
        Test.stopTest();
    }

    @IsTest
    static void ordinaryStemBypassesOnlyTheMasterContractGate() {
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        Test.startTest();
        MasterContractInvoiceReadinessService.Readiness readiness =
            MasterContractInvoiceReadinessService.getBuyerReadiness(String.valueOf(stem.Id));
        System.assertEquals(true, readiness.ready);
        System.assertEquals(false, readiness.masterContract);
        Test.stopTest();
    }
}
