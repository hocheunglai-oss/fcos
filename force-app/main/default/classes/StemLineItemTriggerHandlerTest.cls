@isTest
public class StemLineItemTriggerHandlerTest {
    @TestSetup
    static void makeData(){
        TestDataFactory.prepareDataForNominationConfirmationFlow();
    }

    @isTest
    static void testSetCalculatedPricePerUnit(){
        Test.startTest();
        Account testSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID];
        Product2 testProduct = [SELECT Id FROM Product2 LIMIT 1];
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        Supplier_Invoice__c supplierInvoice = new Supplier_Invoice__c(STEM__c = stem.Id, Payment_Term__c = '2 P', Supplier_Delivery_Date__c = Date.today(), Bank_Details__c = 'Not Provided', Supplier__c = testSupplier.Id);
        insert supplierInvoice;
        STEM_Line_Item__c stemLineItem = [SELECT Id FROM STEM_Line_Item__c];
        STEM_Extra_Cost__c stemExtraCost = TestDataFactory.createTestStemExtraCost(stem.Id ,stemLineItem.Id, 100,31,31,31,31,31,'Product Charge',false);
        stemExtraCost.Supplier__c = supplierInvoice.Supplier__c;
        stemExtraCost.Payment_Term__c = '2 P';
        insert stemExtraCost;
        ContentVersion contentVersion = new ContentVersion( Title  = 'PSPRS', PathOnClient = 'Test.pdf', VersionData = Blob.valueOf('Test Content'), IsMajorVersion = true);
        insert contentVersion;
        List<ContentDocument> documents = [SELECT Id, Title, LatestPublishedVersionId FROM ContentDocument];
        //create ContentDocumentLink  record
        ContentDocumentLink cdl = New ContentDocumentLink();
        cdl.LinkedEntityId = supplierInvoice.id;
        cdl.ContentDocumentId = documents[0].Id;
        insert cdl;
        update stemLineItem;
        Test.stopTest();
    }

    @isTest
    static void testUpdateNominations(){
        Test.startTest();
        Account supplier = TestDataFactory.createTestAccount('TEST SUPPLIER 2', 'SUPPLIER', true);
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        STEM_Line_Item__c stemLineItem = [SELECT Id, Payment_Term__c, Unit_Sell_At__c, Original_Supplier__c FROM STEM_Line_Item__c WHERE STEM__c =: stem.Id LIMIT 1];
        stemLineItem.Unit_Sell_At__c += 5;
        update stemLineItem;
        system.assertEquals(2, [SELECT Id FROM Nomination__c].size());
        stemLineItem.Original_Supplier__c = supplier.Id;
        update stemLineItem;
        system.assertEquals(3, [SELECT Id FROM Nomination__c].size());
        Test.stopTest();
    }

    @isTest
    static void testUpdateNominationUnspecifiedSupplier(){
        Test.startTest();
        Account testSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID];
        Account newSupplier = TestDataFactory.createTestAccount('**NEW SUPPLIER**', 'SUPPLIER', true);
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        STEM_Line_Item__c stemLineItem = [SELECT Id, Payment_Term__c, Original_Supplier__c FROM STEM_Line_Item__c WHERE STEM__c =: stem.Id LIMIT 1];
        stemLineItem.Original_Supplier__c = newSupplier.Id;
        update stemLineItem;
        system.assertEquals(newSupplier.Id, [SELECT Id, Account__c FROM Nomination__c WHERE RecordTypeId =: FCBStatic.NOMINATION_SUPPLIER_RT_IT AND Deprecated__c = false LIMIT 1].Account__c);
        stemLineItem.Original_Supplier__c = testSupplier.Id;
        update stemLineItem;
        system.assertEquals(2, [SELECT Id FROM Nomination__c WHERE Deprecated__c = false].size());
        Test.stopTest();
    }

    @isTest
    static void testUpdateInput() {
        Test.startTest();
        Account testSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID];
        Product2 testProduct = [SELECT Id FROM Product2 LIMIT 1];
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        Supplier_Invoice__c supplierInvoice = new Supplier_Invoice__c(STEM__c = stem.Id, Payment_Term__c = '2 P', Supplier_Delivery_Date__c = Date.today(), Bank_Details__c = 'Not Provided', Supplier__c = testSupplier.Id);
        insert supplierInvoice;
        STEM_Line_Item__c stemLineItem = [SELECT Id, Quantity_Delivered_Per_BDN__c FROM STEM_Line_Item__c];
        stemLineItem.Quantity_Delivered_Per_BDN__c = 150.0;
        update stemLineItem;
        stemLineItem = [SELECT Id, Input__c FROM STEM_Line_Item__c LIMIT 1];
        system.assertEquals('🟡', stemLineItem.Input__c);
        Test.stopTest();
    }

    @isTest
    static void testDeposits(){
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        Account testSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID];
        List<Deposit__c> deposits = new List<Deposit__c>{new Deposit__c(Paid_Date__c = Date.today().addDays(-1), Paid_Amount__c = 10000, Account__c = testSupplier.Id),
                                                        new Deposit__c(Paid_Date__c = Date.today(), Paid_Amount__c = 100000, Account__c = testSupplier.Id)};
        insert deposits;
        STEM_Line_Item__c stemLineItem = [SELECT Id, Payment_Term__c  FROM STEM_Line_Item__c LIMIT 1];
        stemLineItem.Payment_Term__c = 'Deposit';
        Test.startTest();
        update stemLineItem;
        Test.stopTest();
    }

    @isTest
    static void testDepositDeleteGuard(){
        Id fakeLineItemId = Id.valueOf('a05000000000001');
        STEM_Line_Item__c depositLine = new STEM_Line_Item__c(Id = fakeLineItemId, Payment_Term__c = 'Deposit');
        STEM_Line_Item__c ciaLine = new STEM_Line_Item__c(Id = fakeLineItemId, Payment_Term__c = 'CIA');
        Test.startTest();
        StemLineItemTriggerHandler.deleteDepositPayments(new List<STEM_Line_Item__c>{ depositLine });
        StemLineItemTriggerHandler.deleteDepositPayments(
            new List<STEM_Line_Item__c>{ ciaLine },
            new Map<Id, STEM_Line_Item__c>{ fakeLineItemId => depositLine }
        );
        StemLineItemTriggerHandler.createDepositPayment(
            new List<STEM_Line_Item__c>{ depositLine },
            null,
            TriggerOperation.AFTER_INSERT
        );
        Test.stopTest();
    }

    @IsTest
    static void testApplyEnquirySpecialTerms() {
        Test.startTest();
        Opportunity testEnquiry = [SELECT Id FROM Opportunity LIMIT 1];
        Port__c testPort = [SELECT Id FROM Port__c LIMIT 1];
        Port__c testPort2 = TestDataFactory.createTestPort('Test port 2', 'CHINA', true);
        Product2 testProduct = [SELECT Id FROM Product2 LIMIT 1];
        Account testSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID LIMIT 1];
        Quote testQuote = [SELECT Id FROM Quote WHERE OpportunityId = :testEnquiry.Id LIMIT 1];
        List<Special_Term__c> specialTerms = new List<Special_Term__c>();
        // Add 6 special terms
        specialTerms.add(TestDataFactory.createTestSpecialTerm('Test special term 1', 'Test text 1', false));
        specialTerms.add(TestDataFactory.createTestSpecialTerm('Test special term 2', 'Test text 2', false));
        specialTerms.add(TestDataFactory.createTestSpecialTerm('Test special term 3', 'Test text 3', false));
        specialTerms.add(TestDataFactory.createTestSpecialTerm('Test special term 4', 'Test text 4', false));
        specialTerms.add(TestDataFactory.createTestSpecialTerm('Test special term 5', 'Test text 5', false));
        specialTerms.add(TestDataFactory.createTestSpecialTerm('Test special term 6', 'Test text 6', false));
        insert specialTerms;

        // TestDataFactory.createTestEnquirySpecialTerm(testEnquiry.Id, specialTerms[0].Id, 'Test reason 1', new List<String>{testOfferLineItem.Id}, true);

        List<Special_Term_Rule__c> specialTermRules = new List<Special_Term_Rule__c>();
        specialTermRules.add(TestDataFactory.createSpecialTermRule(specialTerms[0].Id, null, null, testSupplier.Id, null, 'Supplier', false));
        specialTermRules.add(TestDataFactory.createSpecialTermRule(specialTerms[1].Id, testProduct.Id, null, testSupplier.Id, null, 'Supplier', false));
        specialTermRules.add(TestDataFactory.createSpecialTermRule(specialTerms[2].Id, testProduct.Id, null, testSupplier.Id, 'CHINA', 'Supplier', false));
        specialTermRules.add(TestDataFactory.createSpecialTermRule(specialTerms[3].Id, testProduct.Id, testPort.Id, testSupplier.Id, null, 'Supplier', false));
        specialTermRules.add(TestDataFactory.createSpecialTermRule(specialTerms[4].Id, null, testPort2.Id, null, 'CHINA', null, false));
        specialTermRules.add(TestDataFactory.createSpecialTermRule(specialTerms[5].Id, null, testPort.Id, null, 'CHINA', null, false));
        insert specialTermRules;

        STEM_Line_Item__c stemLineItem = [SELECT Id FROM STEM_Line_Item__c LIMIT 1];
        stemLineItem.Unit_Sell_At__c = 100;
        update stemLineItem;
        List<Enquiry_Special_Term__c> insertedEnquirySpecialTerms = [SELECT Id FROM Enquiry_Special_Term__c];
        System.assertEquals(7, insertedEnquirySpecialTerms.size());

        Test.stopTest();
    }

    @isTest
    static void testDeleteContentDocument(){
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
        delete stemLineItem;
        system.assertEquals(0, [SELECT Id FROM ContentDocumentLink WHERE LinkedEntityId =: stemLineItem.Id].size());
        Test.stopTest();
    }
}
