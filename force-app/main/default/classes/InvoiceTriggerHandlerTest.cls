@isTest
public class InvoiceTriggerHandlerTest {
    @TestSetup
	static void makeData(){
		TestDataFactory.prepareDataForNominationConfirmationFlow();     
	}
    
	@isTest
    static void testDeprecateVersions(){
        Test.startTest();
        STEM__c stem = [SELECT Id FROM STEM__c];
        STEM_Line_Item__c stemLineItem = [SELECT Id FROM STEM_Line_Item__c LIMIT 1];
        Account testSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID];
        STEM_Extra_Cost__c stemExtraCost = TestDataFactory.createTestStemExtraCost(stem.Id, null, 1000,31,31,31,31,31,'STEM Charge', false);
        stemExtraCost.Supplier__c = testSupplier.Id;
        insert stemExtraCost;
        List<String> extraIds = new List<String>{stemLineItem.Id, stemExtraCost.Id};
        Invoice__c invoice = InvoiceController.createInvoice(stem.Id, extraIds, false, false, Date.today(), Date.today(), Date.today());
        InvoiceController.generateInvoicePDF(invoice.Id, invoice.Name, extraIds, 'Test Body', false);
        invoice.Deprecated__c = true;
        update invoice;
    }
    
    @isTest
    static void testDeleteContentDocuments(){
        Test.startTest();
        STEM__c stem = [SELECT Id FROM STEM__c];
        Invoice__c invoice = new Invoice__c(Name = '00001T-INV-1', Deprecated__c = false, STEM__c = stem.Id);
        insert invoice;
        ContentVersion contentVersion = new ContentVersion( Title  = 'INV-1', PathOnClient = 'INV-1.pdf', VersionData = Blob.valueOf('Test Content'), IsMajorVersion = true);
        insert contentVersion; 
		List<ContentDocument> documents = [SELECT Id, Title, LatestPublishedVersionId FROM ContentDocument];
		//create ContentDocumentLink  record 
    	ContentDocumentLink cdl = New ContentDocumentLink();
        cdl.LinkedEntityId = invoice.id;
        cdl.ContentDocumentId = documents[0].Id;
        insert cdl;
        delete invoice;
        system.assertEquals(0, [SELECT Id FROM ContentDocumentLink WHERE LinkedEntityId =: invoice.Id].size());
        Test.stopTest();
    }
}