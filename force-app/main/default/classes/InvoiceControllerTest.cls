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
    
    @IsTest
    static void staleNativeReviewCannotAuthorizeInvoiceCreation() {
        STEM_Line_Item__c selected=[SELECT Id FROM STEM_Line_Item__c LIMIT 1];
        FcosTradeDocumentService.Line line=new FcosTradeDocumentService.Line();
        line.id=selected.Id;
        FcosTradeDocumentService.DocumentReview review=new FcosTradeDocumentService.DocumentReview();
        review.currencyCode='HKD';
        review.fingerprint='current-review';
        review.lines.add(line);
        Integer dmlBefore=Limits.getDmlStatements();
        for(String fingerprint:new List<String>{null,'stale-review'}) {
            try {
                InvoiceController.assertNativeCreateReview(review,fingerprint,new List<Id>{selected.Id});
                System.assert(false,'A missing or stale fingerprint cannot authorize an invoice.');
            } catch(AuraHandledException expected) {}
        }
        try {
            InvoiceController.assertNativeCreateReview(review,'current-review',new List<Id>{selected.Id,selected.Id});
            System.assert(false,'Duplicate selected rows cannot authorize an invoice.');
        } catch(AuraHandledException expected) {}
        InvoiceController.assertNativeCreateReview(review,'current-review',new List<Id>{selected.Id});
        System.assertEquals(dmlBefore,Limits.getDmlStatements(),'Review admission is read-only.');
    }

    @IsTest
    static void ordinaryInvoiceRejectsAnUnmatchedReviewBeforeWriting() {
        STEM__c stem=[SELECT Id FROM STEM__c LIMIT 1];
        Integer invoiceCount=[SELECT COUNT() FROM Invoice__c WHERE STEM__c=:stem.Id];
        Integer taskCount=[SELECT COUNT() FROM Task WHERE WhatId=:stem.Id];
        try {
            InvoiceController.createReviewedInvoice(stem.Id,new List<String>(),false,false,Date.today(),Date.today(),Date.today(),'review-for-another-selection');
            System.assert(false,'An ordinary invoice must refuse an unrelated managed review.');
        } catch(AuraHandledException expected) {}
        System.assertEquals(invoiceCount,[SELECT COUNT() FROM Invoice__c WHERE STEM__c=:stem.Id]);
        System.assertEquals(taskCount,[SELECT COUNT() FROM Task WHERE WhatId=:stem.Id]);
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
