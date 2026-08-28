@isTest
public class PaidAmountServiceTest {

    @TestSetup
    static void makeData(){
        TestDataFactory.prepareDataForNominationConfirmationFlow();
    }

    @isTest
    static void testRecalculateInvoiceAmount(){
        Test.startTest();
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        Account testBuyer = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.BUYER_ACCOUNT_RT_ID];
        STEM_Line_Item__c stemLineItem = [SELECT Id, Unit_Sell_At__c FROM STEM_Line_Item__c WHERE STEM__c = :stem.Id ];
        STEM_Extra_Cost__c stemExtraCost = new STEM_Extra_Cost__c(STEM__c =stem.id ,STEM_Line_Item__c =stemLineItem.id, Unit_Price__c = 100, Unit_Cost__c = 50, Quantity__c = 100);
        insert stemExtraCost;
        List<String> extraIds = new List<String>{stemLineItem.Id, stemExtraCost.Id};
        Invoice__c invoice = InvoiceController.createInvoice(stem.Id, extraIds, false, false, Date.today(), Date.today(), Date.today());
        InvoiceController.generateInvoicePdf(invoice.Id, invoice.Name, extraIds, 'TestString', false);
        stemLineItem.Unit_Sell_At__c = stemLineItem.Unit_Sell_At__c + 10;
        update stemLineItem;
        Test.stopTest();
    }

    @isTest
    static void testRecalculationPreservesLegacyInactiveBuyerBroker(){
        Account legacyBroker = TestDataFactory.createTestAccount('Legacy Broker', 'BROKER', true);
        STEM__c stem = [SELECT Id, Buyer_Broker__c FROM STEM__c LIMIT 1];
        stem.Buyer_Broker__c = legacyBroker.Id;
        update stem;

        STEM_Line_Item__c stemLineItem = [SELECT Id, Unit_Sell_At__c FROM STEM_Line_Item__c WHERE STEM__c = :stem.Id LIMIT 1];
        List<String> invoiceLineIds = new List<String>{stemLineItem.Id};
        Invoice__c invoice = InvoiceController.createInvoice(stem.Id, invoiceLineIds, false, false, Date.today(), Date.today(), Date.today());
        stemLineItem.Buyer_Invoice__c = invoice.Id;
        ContextManager.avoidSTEMLineItemFiring = true;
        update stemLineItem;
        ContextManager.avoidSTEMLineItemFiring = false;

        legacyBroker.Inactive_Suspended__c = true;
        update legacyBroker;

        Test.startTest();
        stemLineItem.Unit_Sell_At__c += 1;
        update stemLineItem;
        Test.stopTest();

        STEM_Line_Item__c savedLine = [SELECT Total_Price__c FROM STEM_Line_Item__c WHERE Id = :stemLineItem.Id];
        Invoice__c savedInvoice = [SELECT Amount__c FROM Invoice__c WHERE Id = :invoice.Id];
        STEM__c savedStem = [SELECT Buyer_Broker__c FROM STEM__c WHERE Id = :stem.Id];
        System.assertEquals(savedLine.Total_Price__c, savedInvoice.Amount__c);
        System.assertEquals(legacyBroker.Id, savedStem.Buyer_Broker__c);
    }

    @isTest
    static void testUpdatePaidAmount(){
        Test.startTest();
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        Account testBroker = TestDataFactory.createTestAccount('TestBroker', 'BROKER', true);
        List<STEM_Line_Item__c> stemLineItems = [SELECT Id, Supplier_Broker__c, Suppliers_Brokers_Commission_Per_Unit__c FROM STEM_Line_Item__c WHERE STEM__c =: stem.Id];
        stemLineItems[0].Supplier_Broker__c = testBroker.Id;
        stemLineItems[0].Suppliers_Brokers_Commission_Per_Unit__c = 1;
        update stemLineItems;
        Commission_Invoice__c commInvoice = new Commission_Invoice__c(STEM__c = stem.Id, Broker__c = testBroker.Id, Invoice_Amount__c = 100);
        insert commInvoice;
        Id commissionRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Commission').getRecordTypeId();
        Payment__c payment = new Payment__c(STEM__c = stem.Id, Account__c = testBroker.Id, Amount__c = 10, Date__c = Date.today(), Commission_Invoice__c = commInvoice.Id);
        insert payment;
        system.assertEquals(commInvoice.Invoice_Amount__c - payment.Amount__c, [SELECT Id, Payable_Balance__c FROM Commission_Invoice__c WHERE Id =: commInvoice.Id][0].Payable_Balance__c);
        Test.stopTest();
    }
}
