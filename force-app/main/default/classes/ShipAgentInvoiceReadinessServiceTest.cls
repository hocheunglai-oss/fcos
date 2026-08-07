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

        supplier.Imported_Particulars__c = 'Mixed Case SHIP aGeNt particulars';
        update supplier;
        lineItem.Original_Supplier__c = supplier.Id;
        lineItem.Cancelled__c = false;
        update lineItem;
        stem.Delivery_Date__c = Date.today().addDays(-1);
        stem.Ship_Agent_Charges_Confirmed__c = false;
        update stem;
        return [SELECT Id, Delivery_Date__c, Ship_Agent_Charges_Confirmed__c FROM STEM__c WHERE Id = :stem.Id];
    }

    @IsTest
    static void readinessRequiresDeliveryAndConfirmationAndInvalidates() {
        STEM__c stem = makeShipAgentStem();

        stem.Delivery_Date__c = null;
        update stem;
        ShipAgentInvoiceReadinessService.Readiness readiness = ShipAgentInvoiceReadinessService.evaluate(stem.Id);
        System.assertEquals(true, readiness.requiresShipAgentReview);
        System.assertEquals(false, readiness.ready);
        System.assert(readiness.reason.contains('delivery date'));
        System.assert(readiness.fcosUrl.endsWith(String.valueOf(stem.Id)));

        stem.Delivery_Date__c = Date.today();
        update stem;
        readiness = ShipAgentInvoiceReadinessService.evaluate(stem.Id);
        System.assertEquals(false, readiness.ready);
        System.assert(readiness.reason.contains('after'));
        stem.Delivery_Date__c = Date.today().addDays(-1);
        update stem;
        readiness = ShipAgentInvoiceReadinessService.evaluate(stem.Id);
        System.assertEquals(false, readiness.ready);
        System.assert(readiness.reason.contains('confirmation'));
        stem.Ship_Agent_Charges_Confirmed__c = true;
        update stem;
        System.assertEquals(true, ShipAgentInvoiceReadinessService.evaluate(stem.Id).ready);

        STEM_Line_Item__c lineItem = [SELECT Id, Cancelled__c FROM STEM_Line_Item__c WHERE STEM__c = :stem.Id LIMIT 1];
        lineItem.Cancelled__c = true;
        update lineItem;
        System.assertEquals(false, [SELECT Ship_Agent_Charges_Confirmed__c FROM STEM__c WHERE Id = :stem.Id].Ship_Agent_Charges_Confirmed__c);

        lineItem.Cancelled__c = false;
        update lineItem;
        stem = [SELECT Id, Ship_Agent_Charges_Confirmed__c FROM STEM__c WHERE Id = :stem.Id];
        stem.Ship_Agent_Charges_Confirmed__c = true;
        update stem;
        Account supplier = [SELECT Id, Imported_Particulars__c FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID LIMIT 1];
        supplier.Imported_Particulars__c = 'No longer a ship-agent';
        update supplier;
        System.assertEquals(false, [SELECT Ship_Agent_Charges_Confirmed__c FROM STEM__c WHERE Id = :stem.Id].Ship_Agent_Charges_Confirmed__c);
    }

    @IsTest
    static void finalInvoicePathsAreBlockedButProformasAndCreditNotesBypass() {
        STEM__c stem = makeShipAgentStem();

        try {
            InvoiceController.createInvoice(stem.Id, new List<String>(), false, false, Date.today(), Date.today(), Date.today());
            System.assert(false, 'Unconfirmed ship-agent final invoice creation must be blocked.');
        } catch (Exception expected) {
            System.assertNotEquals(null, expected);
        }

        try {
            insert new Invoice__c(Name = '00001T-INV-99', STEM__c = stem.Id, Proforma__c = false);
            System.assert(false, 'Direct final invoice insertion must be blocked.');
        } catch (Exception expected) {
            System.assertNotEquals(null, expected);
        }

        insert new Invoice__c(Name = 'INV-P99', STEM__c = stem.Id, Proforma__c = true);
        insert new Invoice__c(Name = '00001T-CN-99', STEM__c = stem.Id, Proforma__c = false);

        stem = [SELECT Id, Ship_Agent_Charges_Confirmed__c FROM STEM__c WHERE Id = :stem.Id];
        stem.Ship_Agent_Charges_Confirmed__c = true;
        update stem;
        Invoice__c finalInvoice = new Invoice__c(Name = '00001T-INV-100', STEM__c = stem.Id, Proforma__c = false);
        insert finalInvoice;

        stem.Ship_Agent_Charges_Confirmed__c = false;
        update stem;
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
