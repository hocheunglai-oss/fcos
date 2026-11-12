@IsTest
private class InvoiceReplacementTest {
    @TestSetup
    static void createOriginalInvoice() {
        TestDataFactory.prepareDataForNominationConfirmationFlow();
        Account buyer = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.BUYER_ACCOUNT_RT_ID LIMIT 1];
        buyer.Mailing_Requirement__c = 'OXCX-1a';
        update buyer;
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        STEM_Line_Item__c line = [SELECT Id FROM STEM_Line_Item__c WHERE STEM__c = :stem.Id LIMIT 1];
        STEM_Extra_Cost__c cost = new STEM_Extra_Cost__c(STEM__c = stem.Id,
            STEM_Line_Item__c = line.Id, Unit_Price__c = 100, Unit_Cost__c = 50, Quantity__c = 100);
        insert cost;
        List<String> selected = new List<String>{line.Id, cost.Id};

        Test.startTest();
        Invoice__c invoice = InvoiceController.createInvoice(stem.Id, selected, false, false,
            Date.today(), Date.today(), Date.today());
        InvoiceController.generateInvoicePdf(invoice.Id, invoice.Name, selected, 'TestString', false);
        invoice.Deprecated__c = true;
        update invoice;
        System.assertEquals(1, [SELECT COUNT() FROM Task WHERE WhatId = :stem.Id]);
        Test.stopTest();
    }

    @IsTest
    static void replacesDeprecatedInvoice() {

        Invoice__c invoice = [SELECT Id, STEM__c FROM Invoice__c WHERE Deprecated__c = true LIMIT 1];
        STEM__c stem = [SELECT Id FROM STEM__c WHERE Id = :invoice.STEM__c];
        STEM_Extra_Cost__c cost = [SELECT Id, STEM_Line_Item__c FROM STEM_Extra_Cost__c
            WHERE STEM__c = :stem.Id AND Unit_Price__c = 100 AND Unit_Cost__c = 50 AND Quantity__c = 100 LIMIT 1];
        List<String> selected = new List<String>{cost.STEM_Line_Item__c, cost.Id};
        Test.startTest();
        Invoice__c replacement = InvoiceController.createInvoice(stem.Id, selected, false, false,
            Date.today(), Date.today(), Date.today());
        InvoiceController.generateInvoicePdf(replacement.Id, replacement.Name, selected, 'TestString', false);
        Test.stopTest();
        System.assertNotEquals(null, replacement.Id, 'The replacement invoice must be created.');
        System.assertNotEquals(invoice.Id, replacement.Id, 'The replacement invoice must be a distinct record.');
    }
}
