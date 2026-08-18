@isTest
public class AccountControllerTest {
    
    @isTest
    static void testGetAccountSTEMs(){
        Test.startTest();
        Account parentAccount = TestDataFactory.createTestAccount('Test Group', 'GROUP', true);
        Account account = TestDataFactory.createTestAccount('Test Supplier', 'SUPPLIER', false);
        account.ParentId = parentAccount.Id;
        insert account;
        STEM__c stem = new STEM__c (Delivery_Date__c = Date.newInstance(2022, 02, 25), Name = 'TestStem', Account__c = account.Id, Invoice_Due_Date__c = Date.newInstance(2022, 02, 28));
        insert stem;
        Invoice__c invoice = new Invoice__c(Amount__c = 10000, Invoice_Date__c = Date.newInstance(2022, 02, 24), STEM__c = stem.Id);
        insert invoice;
        
        Payment__c payment = new Payment__c(Amount__c = 10000, Date__c = Date.newInstance(2022, 02, 25), STEM__c = stem.Id, Account__c = account.Id,
                                            RecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Receivable').getRecordTypeId());
        insert payment;
        List<AccountController.WrapperSTEM> stems = AccountController.getAccountSTEMs(account.Id);
		system.assertEquals(1, stems.size());
        stems = AccountController.getAccountSTEMs(parentAccount.Id);
        system.assertEquals(1, stems.size());
        Test.stopTest();
    }
    
    @isTest
    static void testChildAccounts(){
        Test.startTest();
        Account parentAccount = TestDataFactory.createTestAccount('Test Group', 'GROUP', true);
        Account childAccount = TestDataFactory.createTestAccount('Test Supplier', 'SUPPLIER', false);
        childAccount.ParentId = parentAccount.Id;
        insert childAccount;
        List<Account> accounts= AccountController.getChildAccounts(parentAccount.Id);
		system.assertEquals(1, accounts.size());
        Test.stopTest();
    }
    
    @isTest
    static void testGetAccount(){
        Test.startTest();
        Account broker = TestDataFactory.createTestAccount('Test Broker', 'BROKER', true);
		system.assertEquals(true, AccountController.getAccount(broker.Id).Is_Broker__c);
        Test.stopTest();
    }
    
    @isTest
    static void testResetAcknowledgeReceipt(){
        Test.startTest();
        Id originatedRecordTypeId = Schema.SObjectType.STEM__c.getRecordTypeInfosByName().get('Originated').getRecordTypeId();
        Account account = TestDataFactory.createTestAccount('Test Buyer', 'BUYER', true);
        STEM__c stem = new STEM__c (RecordTypeId = originatedRecordTypeId, Delivery_Date__c = Date.newInstance(2022, 02, 25), Name = 'TestStem', Acknowledge_Receipt__c = true, Account__c = account.Id, Invoice_Due_Date__c = Date.newInstance(2022, 02, 28));
        insert stem;
        AccountController.resetAcknowledgeReceipt(account.Id);
		system.assertEquals(false, [SELECT Id, Acknowledge_Receipt__c FROM STEM__c LIMIT 1].Acknowledge_Receipt__c);
        Test.stopTest();
    }
    
    @isTest
    static void testCompensations(){
        Test.startTest();
        Account account = TestDataFactory.createTestAccount('Test Buyer', 'BUYER', true);
        STEM__c stem = new STEM__c (Delivery_Date__c = Date.newInstance(2022, 02, 25), Name = 'TestStem', Acknowledge_Receipt__c = true, Account__c = account.Id, Invoice_Due_Date__c = Date.newInstance(2022, 02, 28));
        insert stem;
        Agreed_Compensation__c agreedCompensation = new Agreed_Compensation__c(Account__c = account.Id, Amount__c = 1000, Deadline_Date__c = Date.today(), Status__c = 'Opened');
        insert agreedCompensation;
        Unofficial_Compensation__c unofficialCompensation = new Unofficial_Compensation__c(Account__c = account.Id, STEM__c = stem.Id, Lumpsum_Price__c = 100, Fixed__c = true);
        insert unofficialCompensation;
        system.assertEquals(1, AccountController.getAgreedCompensations(account.Id).size());
        system.assertEquals(1, AccountController.getUnofficialCompensations(account.Id).size());
        system.assertEquals('Opened', AccountController.getAccountCompensationInfo(account.Id).Compensation_Status__c);
        Test.stopTest();
    }
    
    @isTest
    static void testGetDeposits(){
        TestDataFactory.prepareDataForNominationConfirmationFlow();
        Test.startTest();
        STEM__c stem = [SELECT Id FROM STEM__c LIMIT 1];
        Account testSupplier = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID];
        List<Deposit__c> deposits = new List<Deposit__c>{new Deposit__c(Paid_Date__c = Date.today().addDays(-1), Paid_Amount__c = 10000, Account__c = testSupplier.Id),
            											new Deposit__c(Paid_Date__c = Date.today(), Paid_Amount__c = 100000, Account__c = testSupplier.Id)};
        insert deposits;
        STEM_Line_Item__c stemLineItem = [SELECT Id, Payment_Term__c FROM STEM_Line_Item__c WHERE STEM__c =: stem.Id LIMIT 1];
        STEM_Extra_Cost__c stemExtraCost = TestDataFactory.createTestStemExtraCost(stem.Id, stemLineItem.Id, 100,1,1,1,1,1,'STEM Charge',false);
        stemExtraCost.Supplier__c = testSupplier.Id;
        stemExtraCost.Payment_Term__c = '2 P';
        insert stemExtraCost;
        stemLineItem.Payment_Term__c = 'Deposit';
        update stemLineItem;
        Decimal paymentAmount = 0;
        paymentAmount += [SELECT Id, Line_Total_Buy__c FROM STEM_Extra_Cost__c LIMIT 1].Line_Total_Buy__c;
        paymentAmount += [SELECT Id, Total_Cost__c FROM STEM_Line_Item__c LIMIT 1].Total_Cost__c;
        system.assertEquals(2, AccountController.getDeposits(testSupplier.Id).size());
        system.assertEquals(1, AccountController.getDepositPayments(testSupplier.Id).size());
        Test.stopTest();
    }
}