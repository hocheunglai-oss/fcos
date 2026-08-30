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
    static void testAtomicCiaSaveSupportsSameDayReconfirmation(){
        STEM__c stem = [SELECT Id, Enquiry__c FROM STEM__c LIMIT 1];
        Account testSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID LIMIT 1];
        STEM_Extra_Cost__c stemExtraCost = TestDataFactory.createTestStemExtraCost(stem.Id, null, 100,1,1,1,1,1,'STEM Charge',false);
        stemExtraCost.Supplier__c = testSupplier.Id;
        stemExtraCost.Payment_Term__c = 'CIA';
        stemExtraCost.Intended_Payment_Date__c = Date.today().addDays(4);
        insert stemExtraCost;

        ReconfirmProcessing.ReconfirmItem initial = findItem(
            ReconfirmProcessing.getReconfirmInfo(new List<String>{stem.Enquiry__c}), stemExtraCost.Id);
        ReconfirmProcessing.CiaChangeInput confirmChange = new ReconfirmProcessing.CiaChangeInput();
        confirmChange.recordId = stemExtraCost.Id;
        confirmChange.intendedPaymentDate = Date.today();
        confirmChange.intendedPaymentDateChanged = true;
        confirmChange.reconfirm = true;
        confirmChange.reconfirmChanged = true;
        confirmChange.expectedLastModifiedAt = initial.lastModifiedAt;

        Test.startTest();
        List<ReconfirmProcessing.ReconfirmItem> confirmed = ReconfirmProcessing.saveCiaChanges(
            stem.Enquiry__c, new List<ReconfirmProcessing.CiaChangeInput>{ confirmChange });
        Test.stopTest();

        STEM_Extra_Cost__c saved = [
            SELECT Intended_Payment_Date__c, Reconfirm__c
            FROM STEM_Extra_Cost__c WHERE Id = :stemExtraCost.Id
        ];
        System.assertEquals(Date.today(), saved.Intended_Payment_Date__c);
        System.assertEquals(true, saved.Reconfirm__c);
		String taskKey = stem.Id + '-' + testSupplier.Id;
        Task primaryTask = [
            SELECT Status, IsReminderSet, ActivityDate
            FROM Task
			WHERE Reconfirm_Unique_Key__c = :taskKey
            LIMIT 1
        ];
        System.assertEquals('Completed', primaryTask.Status);
        System.assertEquals(false, primaryTask.IsReminderSet, 'A same-day completed task must not carry a past reminder.');
        System.assertEquals(Date.today(), primaryTask.ActivityDate);

        System.assertNotEquals(null, findItem(confirmed, stemExtraCost.Id).lastModifiedAt);
    }

    @isTest
    static void testAtomicCiaSaveRejectsStaleRowsWithoutPartialWrites(){
        STEM__c stem = [SELECT Id, Enquiry__c FROM STEM__c LIMIT 1];
        Account testSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID LIMIT 1];
        STEM_Extra_Cost__c stemExtraCost = TestDataFactory.createTestStemExtraCost(stem.Id, null, 100,1,1,1,1,1,'STEM Charge',false);
        stemExtraCost.Supplier__c = testSupplier.Id;
        stemExtraCost.Payment_Term__c = 'CIA';
        stemExtraCost.Intended_Payment_Date__c = Date.today().addDays(4);
        insert stemExtraCost;

        ReconfirmProcessing.CiaChangeInput staleChange = new ReconfirmProcessing.CiaChangeInput();
        staleChange.recordId = stemExtraCost.Id;
        staleChange.intendedPaymentDate = Date.today();
        staleChange.intendedPaymentDateChanged = true;
        staleChange.reconfirm = true;
        staleChange.reconfirmChanged = true;
        staleChange.expectedLastModifiedAt = Datetime.now().addDays(-1);

        try {
            ReconfirmProcessing.saveCiaChanges(
                stem.Enquiry__c, new List<ReconfirmProcessing.CiaChangeInput>{ staleChange });
            System.assert(false, 'Expected stale-write protection.');
        } catch (AuraHandledException expected) {
			System.assertNotEquals(null, expected);
        }
        STEM_Extra_Cost__c unchanged = [
            SELECT Intended_Payment_Date__c, Reconfirm__c
            FROM STEM_Extra_Cost__c WHERE Id = :stemExtraCost.Id
        ];
        System.assertEquals(Date.today().addDays(4), unchanged.Intended_Payment_Date__c);
        System.assertNotEquals(true, unchanged.Reconfirm__c);
    }

    private static ReconfirmProcessing.ReconfirmItem findItem(
        List<ReconfirmProcessing.ReconfirmItem> items, Id recordId
    ) {
        for (ReconfirmProcessing.ReconfirmItem item : items) if (item.id == recordId) return item;
        System.assert(false, 'Expected CIA reconfirmation item was not returned.');
        return null;
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
