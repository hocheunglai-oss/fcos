@IsTest
private class OverrideNewOpportunityControllerTest {

	@TestSetup
	static void makeData() {
		TestDataFactory.prepareEnquiryToQuoteData();
        Account privateAccount = TestDataFactory.createTestAccount('PRIVATE', 'BUYER', true);
		Account supplierAccount = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.SUPPLIER_ACCOUNT_RT_ID];
        Account buyerAccount = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.BUYER_ACCOUNT_RT_ID LIMIT 1];
        Office__c office = TestDataFactory.createTestOffice(buyerAccount.Id, null, true);
        Contact contact = new Contact(LastName = 'Test', Office__c = office.Id, CISTEMCompanyCountry__c = 'Test Country');
        insert contact;
		TestDataFactory.createTestVessel('Prequod', '5161354', buyerAccount.Id, true);
	}

	@IsTest
	static void testSaveOpportunity() {
		Vessel__c vessel = [SELECT Id FROM Vessel__c LIMIT 1];
		Account account = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.BUYER_ACCOUNT_RT_ID LIMIT 1];
        TestDataFactory.prepareAccountContactRelationship(account, null);
        Contact contact = [SELECT Id FROM Contact LIMIT 1];
        Office__c office = [SELECT Id, Default_Contact__c FROM Office__c];
		Opportunity brokerEnquiry = new Opportunity(Name = 'OppBroker', Direct_Offer__c = true, Broker_Enquiry__c = true,
												  AccountId = account.id, Vessel__c = vessel.Id, CloseDate = Date.today(),
												  Time__c = Time.newInstance(1, 2, 3, 4), StageName = 'Requirements Gathering');
		Opportunity enquiry = new Opportunity(Name = 'OppBroker1', Direct_Offer__c = true, Broker_Enquiry__c = false,
												   AccountId = account.id, Vessel__c = vessel.Id, CloseDate = Date.today(),
												   Time__c = Time.newInstance(1, 2, 3, 4), StageName = 'Requirements Gathering');
		List<Broker_Enquiry__c> enquiryChannels = new List<Broker_Enquiry__c>();
		Account brokerAccount1 = TestDataFactory.createTestAccount('BrokerAccount1', 'BROKER', true);
		Account brokerAccount2 = TestDataFactory.createTestAccount('BrokerAccount2', 'BROKER', true);
		enquiryChannels.add(new Broker_Enquiry__c(Broker__c = brokerAccount1.Id, Contact__c = null));
		enquiryChannels.add(new Broker_Enquiry__c(Broker__c = brokerAccount2.Id, Contact__c = null));
		Test.startTest();
		OverrideNewOpportunityController.saveOpportunity(brokerEnquiry, vessel, contact, office, account, null, 'Requirements Gathering', 'MT', enquiryChannels);
		OverrideNewOpportunityController.saveOpportunity(enquiry, vessel, contact, office, account, null, 'Requirements Gathering', 'MT', enquiryChannels);
		List<Opportunity> oppList = [SELECT Id FROM Opportunity];
		List<Broker_Enquiry__c> enquiryBrokers = [SELECT Id FROM Broker_Enquiry__c];
		System.assertEquals(3, oppList.size());
		System.assertEquals(5, enquiryBrokers.size());
		Test.stopTest();
	}
    
    @isTest
    static void testGetDefaultContact(){
        Account account = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.BUYER_ACCOUNT_RT_ID LIMIT 1];
        Office__c office = [SELECT Id, Default_Contact__c FROM Office__c];
        Contact contact = [SELECT Id FROM Contact LIMIT 1];
        office.Default_Contact__c = contact.Id;
        update office;
        Test.startTest();
        system.assertEquals(contact.Id, OverrideNewOpportunityController.getDefaultContact(account.Id, office.Id).Id);
        Test.stopTest();
    }

    @isTest
    static void testGetDefaultAccount(){
        Test.startTest();
        Account account = [SELECT Id, RecordType.Name FROM Account WHERE RecordTypeId = :FCBStatic.BUYER_ACCOUNT_RT_ID LIMIT 1];
        system.assertEquals(account.RecordType.Name, OverrideNewOpportunityController.getDefaultAccount(account.Id).RecordType.Name);
        Test.stopTest();
    }
    
	@IsTest
	static void testGetPicklistValues() {
		Test.startTest();
		Set<String> expectedResult = new Set<String>{'MT', 'BBL', 'CBM', 'L', '1.', 'DRUM', 'GALLON', 'PAIL'};
		List<String> result = OverrideNewOpportunityController.getPickListValuesIntoList();
		System.assertEquals(expectedResult.size(), result.size());
		System.assertEquals(expectedResult, new Set<String>(result));
		Test.stopTest();
	}

    @IsTest
	static void testFetchAccount() {
		Account account = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.BUYER_ACCOUNT_RT_ID LIMIT 1];
		account.Main_Office__c = 'HK';
		update account;
		Test.startTest();
		List<Account> accountList = OverrideNewOpportunityController.fetchAccount('Test B');
		System.assertEquals(1, accountList.size());
		Test.stopTest();
	}
    
    @IsTest
	static void testFetchBroker() {
		Account brokerAccount1 = TestDataFactory.createTestAccount('BrokerAccount1', 'BROKER', true);
        brokerAccount1.Main_Office__c = 'HK';
        update brokerAccount1;
		Test.startTest();
		List<Account> accountList = OverrideNewOpportunityController.fetchBroker('BrokerAccount1');
		System.assertEquals(1, accountList.size());
		Test.stopTest();
	}
    
    @IsTest
	static void testFetchContact() {
		Account account = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.BUYER_ACCOUNT_RT_ID LIMIT 1];
		Office__c office = [SELECT Id, Name FROM Office__c LIMIT 1];
		Test.startTest();
		List<Contact> contactList = OverrideNewOpportunityController.fetchContact('', account.Id, office.Id, office.Name);
		System.assertEquals(1, contactList.size());
		Test.stopTest();
	}

    @IsTest
	static void testFetchOffice() {
		Account account = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.BUYER_ACCOUNT_RT_ID LIMIT 1];
		Test.startTest();
		List<Office__c> officeList = OverrideNewOpportunityController.fetchOffice('', account.Id);
		System.assertEquals(1, officeList.size());
		Test.stopTest();
	}
    
	@IsTest
	static void testFetchVessel() {
		List<Vessel__c> expectedResult = [SELECT Id, Name, IMO__c, Account__c FROM Vessel__c WHERE Name = 'Prequod'];
		Test.startTest();
		List<Vessel__c> vesselList = OverrideNewOpportunityController.fetchVessel('Prequod');
		System.assertEquals(expectedResult, vesselList);
		Test.stopTest();
	}

	@IsTest
	static void testGetAccountsGroupPickList() {
		Account groupAccount = TestDataFactory.createTestAccount('Group Account', 'GROUP', false);
		groupAccount.Main_Office__c = 'HK';
		groupAccount.Entity_Selection_Notice__c = 'Test Entity Selection Notice';
		insert groupAccount;
		List<Account> childAccounts = new List<Account>();
		for (Integer i = 0; i < 3; i++) {
			Account childAccount = TestDataFactory.createTestAccount('Buyer Account' + i, 'BUYER', false);
			childAccount.ParentId = groupAccount.Id;
			childAccount.Parent = groupAccount;
			childAccount.Entity_Selection_Notice__c = 'Test Entity Selection Notice';
			childAccount.Office_Name__c = 'HK';
			childAccount.Main_Office__c = 'HK';
			childAccounts.add(childAccount);
		}
		insert childAccounts;
		Test.startTest();
		List<Account> accountList = OverrideNewOpportunityController.getAccountsGroupPickList(groupAccount.Id, groupAccount);
		System.assertEquals(3, accountList.size());
		List<Account> childList = OverrideNewOpportunityController.getAccountsGroupPickList(null, childAccounts[2]);
		System.assertEquals(3, childList.size());
		Test.stopTest();
	}
}
