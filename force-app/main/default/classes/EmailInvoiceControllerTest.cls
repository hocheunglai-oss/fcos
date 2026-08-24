@isTest
public class EmailInvoiceControllerTest {
	@TestSetup
	static void makeData() {
		TestDataFactory.prepareDataForNominationConfirmationFlow();
	}
    
    @isTest
	static void testGetEmailData() {
        Test.startTest();
        Account testBuyer = [SELECT Id, Email_Invoice__c FROM Account WHERE RecordTypeId = :FCBStatic.BUYER_ACCOUNT_RT_ID];
        STEM__c stem = [SELECT Id, Buyer_Broker__c FROM STEM__c LIMIT 1];
        EmailInvoiceController.EmailData invoiceData = EmailInvoiceController.getEmailData(stem.Id, new List<Invoice__c>());
        System.assert(invoiceData.subject.contains('Invoice'));
        Account testBroker = TestDataFactory.createTestAccount('TestBroker', 'BROKER', false);
        testBroker.Email_Invoice__c = 'TO Buyer Only';
        insert testBroker;
        stem.Buyer_Broker__c = testBroker.Id;
        update stem;
        EmailInvoiceController.getEmailData(stem.Id, new List<Invoice__c>());
        testBroker.Email_Invoice__c = 'TO Buyer CC Broker';
        update testBroker;
        EmailInvoiceController.getEmailData(stem.Id, new List<Invoice__c>());
		Test.stopTest();
	}
    
    @isTest
    static void testSendEmail(){
        Test.startTest();
        STEM__c stem = [SELECT Id, KeyStem__c FROM STEM__c LIMIT 1];
        STEM_Line_Item__c stemLineItem = [SELECT Id FROM STEM_Line_Item__c LIMIT 1];
        STEM_Extra_Cost__c productExtraCost = TestDataFactory.createTestStemExtraCost(stem.Id, stemLineItem.Id, 100, 20, 20, 10, 10, 20, 'Product Charge', true);
        List<String> extraIds = new List<String>{stemLineItem.Id, productExtraCost.Id};
        List<Invoice__c> invoices = new List<Invoice__c>{ InvoiceController.createInvoice(stem.Id, extraIds, false, false, Date.today(), Date.today(), Date.today())};
        InvoiceController.generateInvoicePDF(invoices[0].Id, invoices[0].Name, extraIds, 'Test Body', false);
        EmailInvoiceController.EmailData invoiceData = EmailInvoiceController.getEmailData(stem.Id, invoices);
        invoiceData.toAddress = 'test@gmail.com';
		invoiceData.toCCAddress = 'testcc@gmail.com';
		invoiceData.toBCCAddress = 'testbcc@gmail.com';
		invoiceData.senderDisplayName = 'Test name';
        Integer countOfEmailInvocationsBefore = Limits.getEmailInvocations();
        Map<Id, ContentDocument> contentDocumentMap = new Map<Id, ContentDocument>([SELECT Id FROM ContentDocument]);
        List<String> contentDocumentKeys = new List<String>();
        for (Id key : contentDocumentMap.keySet()) {
            contentDocumentKeys.add(key);
        }
        EmailInvoiceController.sendEmail(invoiceData, invoices, contentDocumentKeys);
        System.assertNotEquals(countOfEmailInvocationsBefore, Limits.getEmailInvocations(), 'Should have decreased.');
        Test.stopTest();
    }
    
    @isTest
    static void testSendEmailProforma(){
        Test.startTest();
        STEM__c stem = [SELECT Id, KeyStem__c FROM STEM__c LIMIT 1];
        STEM_Line_Item__c stemLineItem = [SELECT Id FROM STEM_Line_Item__c LIMIT 1];
        STEM_Extra_Cost__c productExtraCost = TestDataFactory.createTestStemExtraCost(stem.Id, stemLineItem.Id, 100, 20, 20, 10, 10, 20, 'Product Charge', true);
        List<String> extraIds = new List<String>{stemLineItem.Id, productExtraCost.Id};
        Account testBuyer = [SELECT Id, Email_Invoice__c, Email_Address__c, Accounts_Email__c FROM Account WHERE RecordTypeId = :FCBStatic.BUYER_ACCOUNT_RT_ID];
        testBuyer.Accounts_Email__c = 'test@test.com';
        testBuyer.Email_Address__c = 'test@test.com';
        update testBuyer;
        List<Invoice__c> invoices = new List<Invoice__c>{ InvoiceController.createInvoice(stem.Id, extraIds, true, false, Date.today(), Date.today(), Date.today())};
        InvoiceController.generateInvoicePDF(invoices[0].Id, invoices[0].Name, extraIds, 'Test Body', false);
        EmailInvoiceController.EmailData invoiceData = EmailInvoiceController.getEmailData(stem.Id, invoices);
        invoiceData.toAddress = 'test@gmail.com';
		invoiceData.toCCAddress = 'testcc@gmail.com';
		invoiceData.toBCCAddress = 'testbcc@gmail.com';
		invoiceData.senderDisplayName = 'Test name';
        Integer countOfEmailInvocationsBefore = Limits.getEmailInvocations();
        Map<Id, ContentDocument> contentDocumentMap = new Map<Id, ContentDocument>([SELECT Id FROM ContentDocument]);
        List<String> contentDocumentKeys = new List<String>();
        for (Id key : contentDocumentMap.keySet()) {
            contentDocumentKeys.add(key);
        }
        EmailInvoiceController.sendEmail(invoiceData, invoices, contentDocumentKeys);
        System.assertNotEquals(countOfEmailInvocationsBefore, Limits.getEmailInvocations(), 'Should have decreased.');
        Test.stopTest();
    }
}