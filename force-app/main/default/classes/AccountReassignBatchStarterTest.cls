@isTest
public class AccountReassignBatchStarterTest {
	@TestSetup
    static void makeData(){
        TestDataFactory.prepareEnquiryToQuoteData();
    }
    
    @isTest
    static void testStartReassignment(){
        Test.startTest();
        Account testBuyer = [SELECT Id FROM Account WHERE RecordTypeId = :FCBStatic.BUYER_ACCOUNT_RT_ID];
        Account newTestBuyer = TestDataFactory.createTestAccount('TEST123', 'BUYER', true);
        AccountReassignBatchStarter.startReassignment(testBuyer.Id, newTestBuyer.Id);
        Test.stopTest();
    }
}