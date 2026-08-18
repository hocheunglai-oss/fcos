@isTest
public class SupplierInvoiceTriggerHandlerTest {

    @TestSetup
    static void makeDate(){
        TestDataFactory.prepareDataForNominationConfirmationFlow();
    }
 
    @isTest
    static void testSetCalculatedAmount(){
        Test.startTest();
        Account testSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID];
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        Supplier_Invoice__c supplierInvoice = new Supplier_Invoice__c(STEM__c = stem.Id, Payment_Term__c = '2 P', Supplier_Delivery_Date__c = Date.today(), Bank_Details__c = 'Not Provided', Supplier__c = testSupplier.Id);
        insert supplierInvoice;
        STEM_Line_Item__c stemLineItem = [Select Id, Subtotal_Buy_At__c FROM STEM_Line_Item__c LIMIT 1];
        stemLineItem.Supplier_Invoice__c = supplierInvoice.Id;
        stemLineItem.Supplier_Issued__c = true;
        update stemLineItem;
        supplierInvoice = [SELECT Id, Calculated_Amount__c FROM Supplier_Invoice__c LIMIT 1];
        system.assertEquals(stemLineItem.Subtotal_Buy_At__c, supplierInvoice.Calculated_Amount__c);
        stemLineItem.Payment_Term__c = '2 I';
        update stemLineItem;
        supplierInvoice = [SELECT Id, PSPRS__c FROM Supplier_Invoice__c LIMIT 1];
        system.assertEquals('NOT Required', supplierInvoice.PSPRS__c);
        Test.stopTest();
    }
    
    @isTest
    static void testAddBankDetailToSupplier(){
        Test.startTest();
        Account testSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID];
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        Supplier_Invoice__c supplierInvoice = new Supplier_Invoice__c(STEM__c = stem.Id, Payment_Term__c = '2 P', Supplier_Delivery_Date__c = Date.today(), Bank_Details__c = 'Not Provided', Supplier__c = testSupplier.Id);
        insert supplierInvoice;
        supplierInvoice.Bank_Details__c = 'Test';
        update supplierInvoice;
        system.assert([SELECT Bank_Details__c FROM Account WHERE Id =: testSupplier.Id].Bank_Details__c.contains('Test'));
        supplierInvoice.Bank_Details__c = 'Test1';
        update supplierInvoice;
        system.assert([SELECT Bank_Details__c FROM Account WHERE Id =: testSupplier.Id].Bank_Details__c.contains('Test1'));
        supplierInvoice = new Supplier_Invoice__c(STEM__c = stem.Id, Payment_Term__c = '2 P', Supplier_Delivery_Date__c = Date.today(), Bank_Details__c = 'Not Provided', Supplier__c = testSupplier.Id);
        insert supplierInvoice;
        Test.stopTest();
    }
    
    @isTest
    static void testAssigningDeposits(){
        Test.startTest();
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        Account testSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID];
        List<Deposit__c> deposits = new List<Deposit__c>{new Deposit__c(Paid_Date__c = Date.today().addDays(-1), Paid_Amount__c = 10000, Account__c = testSupplier.Id),
            											new Deposit__c(Paid_Date__c = Date.today(), Paid_Amount__c = 100000, Account__c = testSupplier.Id)};
        insert deposits;
        STEM_Line_Item__c stemLineItem = [SELECT Id, Payment_Term__c  FROM STEM_Line_Item__c LIMIT 1];
        stemLineItem.Payment_Term__c = 'Deposit';
        update stemLineItem;
        
        Supplier_Invoice__c supplierInvoice = new Supplier_Invoice__c(STEM__c = stem.Id, Payment_Term__c = 'Deposit', Invoice_Amount__c = 1000, Supplier_Delivery_Date__c = Date.today(), Bank_Details__c = 'Not Provided', Supplier__c = testSupplier.Id);
        insert supplierInvoice;
        stemLineItem.Payment_Term__c = 'Deposit';
        stemLineItem.Supplier_Invoice__c = supplierInvoice.Id;
        stemLineItem.Supplier_Issued__c = true;
        update stemLineItem;
       	
        Decimal paymentAmount = 0;
        paymentAmount += [SELECT Id, Invoice_Amount__c FROM Supplier_Invoice__c LIMIT 1].Invoice_Amount__c;
        system.assertEquals(paymentAmount, [SELECT Id, Amount__c FROM Payment__c LIMIT 1].Amount__c);
        Test.stopTest();
    }
    
    @isTest
    static void testUpdateDepositPayments(){
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        Account testSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID];
        List<Deposit__c> deposits = new List<Deposit__c>{new Deposit__c(Paid_Date__c = Date.today().addDays(-1), Paid_Amount__c = 10000, Account__c = testSupplier.Id),
            											new Deposit__c(Paid_Date__c = Date.today(), Paid_Amount__c = 100000, Account__c = testSupplier.Id)};
        insert deposits;
        Test.startTest();
       	Supplier_Invoice__c supplierInvoice = new Supplier_Invoice__c(STEM__c = stem.Id, Payment_Term__c = 'Deposit', Invoice_Amount__c = 1000, Supplier_Delivery_Date__c = Date.today(), Bank_Details__c = 'Not Provided', Supplier__c = testSupplier.Id);
        insert supplierInvoice;
        delete supplierInvoice;
        Test.stopTest();
    }
}