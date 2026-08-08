@IsTest
private class ShipAgentInvoiceReadinessServiceTest {
    @TestSetup
    static void makeData() {
        TestDataFactory.prepareDataForNominationConfirmationFlow();
    }

    private static STEM__c makeShipAgentStem() {
        STEM__c stem = [SELECT Id, Delivery_Date__c, Ship_Agent_Charges_Confirmed__c FROM STEM__c LIMIT 1];
        STEM_Line_Item__c lineItem = [SELECT Id, Original_Supplier__c, Cancelled__c FROM STEM_Line_Item__c WHERE STEM__c = :stem.Id LIMIT 1];
        Account supplier = [SELECT Id, Imported_Particulars__c FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID LIMIT 1];

        ContextManager.skipTriggers = true;
        try {
            supplier.Imported_Particulars__c = 'Mixed Case SHIP aGeNt particulars';
            update supplier;
            lineItem.Original_Supplier__c = supplier.Id;
            lineItem.Cancelled__c = false;
            update lineItem;
            stem.Delivery_Date__c = Date.today().addDays(-1);
            stem.Ship_Agent_Charges_Confirmed__c = false;
            update stem;
        } finally {
            ContextManager.skipTriggers = false;
        }
        return [SELECT Id, Delivery_Date__c, Ship_Agent_Charges_Confirmed__c FROM STEM__c WHERE Id = :stem.Id];
    }

    private static void setState(STEM__c stem, Date deliveryDate, Boolean confirmed) {
        ContextManager.skipTriggers = true;
        try {
            stem.Delivery_Date__c = deliveryDate;
            stem.Ship_Agent_Charges_Confirmed__c = confirmed;
            update stem;
        } finally {
            ContextManager.skipTriggers = false;
        }
    }

    private static Invoice__c insertInvoiceWithoutTriggers(STEM__c stem) {
        ContextManager.avoidInvoiceFiring = true;
        try {
            Invoice__c invoice = new Invoice__c(Name = '00001T-INV-100', STEM__c = stem.Id, Proforma__c = false);
            insert invoice;
            return invoice;
        } finally {
            ContextManager.avoidInvoiceFiring = false;
        }
    }

    @IsTest
    static void readinessRequiresDeliveryAndConfirmation() {
        STEM__c stem = makeShipAgentStem();

        setState(stem, null, false);
        ShipAgentInvoiceReadinessService.Readiness readiness = ShipAgentInvoiceReadinessService.evaluate(stem.Id);
        System.assertEquals(true, readiness.requiresShipAgentReview);
        System.assertEquals(false, readiness.ready);
        System.assert(readiness.reason.contains('delivery date'));
        System.assert(readiness.fcosUrl.endsWith(String.valueOf(stem.Id)));

        setState(stem, Date.today(), false);
        readiness = ShipAgentInvoiceReadinessService.evaluate(stem.Id);
        System.assertEquals(false, readiness.ready);
        System.assert(readiness.reason.contains('after'));
        setState(stem, Date.today().addDays(-1), false);
        readiness = ShipAgentInvoiceReadinessService.evaluate(stem.Id);
        System.assertEquals(false, readiness.ready);
        System.assert(readiness.reason.contains('confirmation'));
        setState(stem, Date.today().addDays(-1), true);
        System.assertEquals(true, ShipAgentInvoiceReadinessService.evaluate(stem.Id).ready);
    }

    @IsTest
    static void lineItemChangeInvalidatesConfirmation() {
        STEM__c stem = makeShipAgentStem();
        setState(stem, Date.today().addDays(-1), true);
        STEM_Line_Item__c lineItem = [
            SELECT Id, STEM__c, Original_Supplier__c, Cancelled__c
            FROM STEM_Line_Item__c WHERE STEM__c = :stem.Id LIMIT 1
        ];
        STEM_Line_Item__c oldLineItem = lineItem.clone(true, true, false, false);
        lineItem.Cancelled__c = true;
        ContextManager.skipTriggers = true;
        try {
            ShipAgentInvoiceReadinessService.invalidateForLineItemChanges(
                new List<STEM_Line_Item__c>{lineItem},
                new Map<Id, STEM_Line_Item__c>{oldLineItem.Id => oldLineItem}
            );
        } finally {
            ContextManager.skipTriggers = false;
        }
        System.assertEquals(false, [SELECT Ship_Agent_Charges_Confirmed__c FROM STEM__c WHERE Id = :stem.Id].Ship_Agent_Charges_Confirmed__c);
    }

    @IsTest
    static void supplierChangeInvalidatesConfirmation() {
        STEM__c stem = makeShipAgentStem();
        setState(stem, Date.today().addDays(-1), true);
        STEM_Line_Item__c lineItem = [SELECT Original_Supplier__c FROM STEM_Line_Item__c WHERE STEM__c = :stem.Id LIMIT 1];
        Account supplier = [SELECT Id, Imported_Particulars__c FROM Account WHERE Id = :lineItem.Original_Supplier__c];
        supplier.Imported_Particulars__c = 'No longer a ship-agent';
        update supplier;
        System.assertEquals(false, [SELECT Ship_Agent_Charges_Confirmed__c FROM STEM__c WHERE Id = :stem.Id].Ship_Agent_Charges_Confirmed__c);
    }

    @IsTest
    static void createInvoiceIsBlocked() {
        STEM__c stem = makeShipAgentStem();

        try {
            InvoiceController.createInvoice(stem.Id, new List<String>(), false, false, Date.today(), Date.today(), Date.today());
            System.assert(false, 'Unconfirmed ship-agent final invoice creation must be blocked.');
        } catch (Exception expected) {
            System.assertNotEquals(null, expected);
        }
    }

    @IsTest
    static void invoiceTriggerBlocksFinalInvoice() {
        STEM__c stem = makeShipAgentStem();
        try {
            insert new Invoice__c(Name = '00001T-INV-99', STEM__c = stem.Id, Proforma__c = false);
            System.assert(false, 'Direct final invoice insertion must be blocked.');
        } catch (Exception expected) {
            System.assertNotEquals(null, expected);
        }
    }

    @IsTest
    static void proformasAndCreditNotesBypass() {
        STEM__c stem = makeShipAgentStem();
        insert new Invoice__c(Name = 'INV-P99', STEM__c = stem.Id, Proforma__c = true);
        insert new Invoice__c(Name = '00001T-CN-99', STEM__c = stem.Id, Proforma__c = false);
    }

    @IsTest
    static void generationAndEmailAreBlockedAfterInvalidation() {
        STEM__c stem = makeShipAgentStem();
        Invoice__c finalInvoice = insertInvoiceWithoutTriggers(stem);
        try {
            InvoiceController.generateInvoicePDF(finalInvoice.Id, finalInvoice.Name, new List<String>(), 'VGVzdA==', false);
            System.assert(false, 'Final PDF generation must be blocked after invalidation.');
        } catch (Exception expected) {
            System.assertNotEquals(null, expected);
        }

        EmailInvoiceController.EmailData emailData = new EmailInvoiceController.EmailData();
        emailData.stemId = stem.Id;
        try {
            EmailInvoiceController.sendEmail(emailData, new List<Invoice__c>{finalInvoice}, new List<String>());
            System.assert(false, 'Final invoice sending must be blocked after invalidation.');
        } catch (Exception expected) {
            System.assertNotEquals(null, expected);
        }
    }
}
