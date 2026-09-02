@isTest
public class InvoiceControllerTest {
	@TestSetup
	static void makeData() {
		TestDataFactory.prepareDataForNominationConfirmationFlow();
	}
    
    @isTest
    static void getStemInfoTest(){
        Test.startTest();
        STEM__c stem = [SELECT Id, Invoice_Date__c FROM STEM__c LIMIT 1];
        InvoiceController.getDBSInfo();
        InvoiceController.getUBSInfo();
        system.assertEquals(stem.Invoice_Date__c, InvoiceController.getStemInfo(stem.Id).Invoice_Date__c);
        Test.stopTest();
    }
    
    @isTest
    static void getPaymentTermTest(){
        Test.startTest();
        Payment_Term__c paymentTerm = [SELECT Id, Name FROM Payment_Term__c WHERE RecordType.Name = 'Buyer' LIMIT 1];
        system.assertEquals(paymentTerm.Id, InvoiceController.getPaymentTerm(paymentTerm.Name).Id);
        Test.stopTest();
    }
    
    @isTest
    static void testCreateInvoice(){
        Account buyer = [SELECT Id, Mailing_Requirement__c FROM Account WHERE RecordTypeId =: FCBStatic.BUYER_ACCOUNT_RT_ID LIMIT 1];
        buyer.Mailing_Requirement__c = 'OXCX-1a';
        update buyer;
        Test.startTest();
        STEM__c stem = [SELECT Id, Mailing_Requirement__c FROM STEM__c LIMIT 1];
		STEM_Line_Item__c stemLineItem = [SELECT Id FROM STEM_Line_Item__c WHERE STEM__c = :stem.Id ];
		STEM_Extra_Cost__c stemExtraCost = new STEM_Extra_Cost__c(STEM__c =stem.id ,STEM_Line_Item__c =stemLineItem.id, Unit_Price__c = 100, Unit_Cost__c = 50, Quantity__c = 100);
        insert stemExtraCost;
        List<String> extraIds = new List<String>{stemLineItem.Id, stemExtraCost.Id};
        Invoice__c invoice = InvoiceController.createInvoice(stem.Id, extraIds, false, false, Date.today(), Date.today(), Date.today());
        InvoiceController.generateInvoicePdf(invoice.Id, invoice.Name, extraIds, 'TestString', false);
        invoice.Deprecated__c = true;
        update invoice;
        System.assertEquals(1, [SELECT Id FROM Task WHERE WhatId =: stem.Id].size());
        Invoice__c newInvoice = InvoiceController.createInvoice(stem.Id, extraIds, false, false, Date.today(), Date.today(), Date.today());
        InvoiceController.generateInvoicePdf(newInvoice.Id, newInvoice.Name, extraIds, 'TestString', false);
        System.assertNotEquals(null, invoice.Id, 'The first invoice must be created.');
        System.assertNotEquals(null, newInvoice.Id, 'The replacement invoice must be created.');
        System.assertNotEquals(invoice.Id, newInvoice.Id, 'The replacement invoice must be a distinct record.');
        
        Test.stopTest();
    }
    
    @IsTest
    static void testUpserLastInvoiceForm(){
        Test.startTest();
        Last_Invoice_Form__c lastInvoiceForm = new Last_Invoice_Form__c(Info_Text__c = 'Test');
        InvoiceController.upsertLastInvoiceForm(lastInvoiceForm);
        System.assertEquals(1, [SELECT Id FROM Last_Invoice_Form__c].size());
        Test.stopTest();
    }
    
    @IsTest
    static void testGetBDNBase64Strings(){
        Test.startTest();
        STEM_Line_Item__c stemLineItem = [SELECT Id FROM STEM_Line_Item__c];
        ContentVersion contentVersion = new ContentVersion( Title  = 'BDN', PathOnClient = 'BDN.pdf', VersionData = Blob.valueOf('Test Content'), IsMajorVersion = true);
        insert contentVersion; 
		List<ContentDocument> documents = [SELECT Id, Title, LatestPublishedVersionId FROM ContentDocument];
		//create ContentDocumentLink  record 
    	ContentDocumentLink cdl = New ContentDocumentLink();
        cdl.LinkedEntityId = stemLineItem.id;
        cdl.ContentDocumentId = documents[0].Id;
        insert cdl;
        system.assertEquals(1, InvoiceController.getBDNBase64Strings(new List<String>{stemLineItem.Id}).size());
        Test.stopTest();
    }
    
    @IsTest
    static void testUpdateStemDeliveryDate(){
        Test.startTest();
        Product2 testProduct = [SELECT Id FROM Product2 LIMIT 1];
        Account testSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID];
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
		STEM_Extra_Cost__c stemExtraCost = TestDataFactory.createTestStemExtraCost(stem.Id, null, 100,31,31,31,31,31,'STEM Charge',false);
        stemExtraCost.Payment_Term__c = '2 I';
        stemExtraCost.Supplier__c = testSupplier.Id;
        insert stemExtraCost;
        InvoiceController.updateStemDeliveryDate(stem.Id);
        system.assertEquals(null, [SELECT Id, Delivery_Date__c FROM STEM__c LIMIT 1].Delivery_Date__c);
        Test.stopTest();
    }
}
