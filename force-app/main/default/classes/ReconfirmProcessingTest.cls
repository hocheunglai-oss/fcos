@isTest
public class ReconfirmProcessingTest {
	@TestSetup
    static void makeData(){
        TestDataFactory.prepareDataForNominationConfirmationFlow();
    }
    
    @isTest
    static void testGetReconfirmInfo(){
        Test.startTest();
        STEM__c stem = [SELECT Id, Enquiry__c FROM STEM__c LIMIT 1];
        Product2 testProduct = [SELECT Id FROM Product2 LIMIT 1];
        Account testBuyer = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.BUYER_ACCOUNT_RT_ID];
        Account testSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID];
        STEM_Extra_Cost__c stemExtraCost = TestDataFactory.createTestStemExtraCost(stem.Id, null, 100,1,1,1,1,1,'STEM Charge',false);
        stemExtraCost.Supplier__c = testSupplier.Id;
        stemExtraCost.Payment_Term__c = 'CIA';
        insert stemExtraCost;
        String payableRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Payable').getRecordTypeId();
        Supplier_Invoice__c supplierInvoice = TestDataFactory.createTestSupplierInvoice('Test invoice', stem.Id, testSupplier.Id, testBuyer.Id, 1000, Date.today(), 'Not Provided', 'CIA', true);
        Payment__c payment = new Payment__c(STEM__c = stem.Id, Account__c = testBuyer.Id, RecordTypeId = payableRecordTypeId, Supplier_Invoice__c = supplierInvoice.Id, Amount__c = 10, Date__c = Date.today().addDays(-1));
        insert payment;
        system.assertEquals(1, ReconfirmProcessing.getReconfirmInfo(new List<String>{stem.Enquiry__c}).size());
        system.assertEquals(1, ReconfirmProcessing.getPayablePayments(stem.Enquiry__c).size());
        Test.stopTest();
    }
    
    @isTest
    static void testSendReconfirmNotification(){
        Test.startTest();
        STEM__c stem = [SELECT Id, Enquiry__c FROM STEM__c LIMIT 1];
        Product2 testProduct = [SELECT Id FROM Product2 LIMIT 1];
        Account testBuyer = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.BUYER_ACCOUNT_RT_ID];
        Account testSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID];
        STEM_Extra_Cost__c stemExtraCost = TestDataFactory.createTestStemExtraCost(stem.Id, null, 100,1,1,1,1,1,'STEM Charge',false);
        stemExtraCost.Supplier__c = testSupplier.Id;
        stemExtraCost.Payment_Term__c = 'CIA';
        stemExtraCost.Intended_Payment_Date__c = Date.today();
        insert stemExtraCost;
        List<ReconfirmProcessing.ReconfirmItem> reconfirmItems = ReconfirmProcessing.getReconfirmInfo(new List<String>{stem.Enquiry__c});
        ReconfirmProcessing.sendReconfirmNotification(reconfirmItems);
        ReconfirmProcessing.completeTasks(reconfirmItems);
        ReconfirmProcessing.cancelTasks(reconfirmItems);
        Test.stopTest();
    }
    
    @isTest
    static void testSendUrgentNotification(){
        Test.startTest();
        STEM__c stem = [SELECT Id, Enquiry__c FROM STEM__c LIMIT 1];
        Product2 testProduct = [SELECT Id FROM Product2 LIMIT 1];
        Account testSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID];
        STEM_Extra_Cost__c stemExtraCost = TestDataFactory.createTestStemExtraCost(stem.Id, null, 100,1,1,1,1,1,'STEM Charge',false);
        stemExtraCost.Supplier__c = testSupplier.Id;
        stemExtraCost.Payment_Term__c = 'CIA';
        insert stemExtraCost;
        ReconfirmProcessing.sendUrgentNotification(testSupplier.Id, stem.Id);
        Test.stopTest();
    }
    
    @isTest
    static void testUpdateTasksOwner(){
        Test.startTest();
        STEM__c stem = [SELECT Id, Enquiry__c FROM STEM__c LIMIT 1];
        Product2 testProduct = [SELECT Id FROM Product2 LIMIT 1];
        Account testSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID];
        STEM_Extra_Cost__c stemExtraCost = TestDataFactory.createTestStemExtraCost(stem.Id, null, 100,1,1,1,1,1,'STEM Charge',false);
        stemExtraCost.Supplier__c = testSupplier.Id;
        stemExtraCost.Payment_Term__c = 'CIA';
        insert stemExtraCost;
        List<String> nominationIds = new List<String>();
        List<Nomination__c> nominations = [SELECT Id FROM Nomination__c];
        for(Nomination__c nomination: nominations){
            nominationIds.add(nomination.Id);
        }
        ReconfirmProcessing.updateTasksOwner(nominationIds);
        Test.stopTest();
    }
}
