@isTest
public class EmailCompensationsSchedulerTest {
    @TestSetup
    static void makeData(){
        Account account = TestDataFactory.createTestAccount('Test Buyer', 'BUYER', true);
        STEM__c stem = new STEM__c (Delivery_Date__c = Date.newInstance(2022, 02, 25), Name = 'TestStem', Acknowledge_Receipt__c = true, Account__c = account.Id, Invoice_Due_Date__c = Date.newInstance(2022, 02, 28));
        insert stem;
        Agreed_Compensation__c agreedCompensation = new Agreed_Compensation__c(Account__c = account.Id, Amount__c = 1000, Deadline_Date__c = Date.today(), Status__c = 'Opened');
        insert agreedCompensation;
        Unofficial_Compensation__c unofficialCompensation = new Unofficial_Compensation__c(Account__c = account.Id, STEM__c = stem.Id, Lumpsum_Price__c = 100, Fixed__c = true);
        insert unofficialCompensation;
    }
    
	@IsTest
    static void testSchedulerExecution(){
        Test.startTest();
        String CRON = '0 0 0 3 9 ? ' + Date.today().year();
        Test.setMock(HttpCalloutMock.class, new SyncApiMock());
        String jobId = System.schedule('EmailCompensationsScheduler', CRON, new EmailCompensationsScheduler());
        CronTrigger cronTrigger = [SELECT Id, CronExpression, TimesTriggered, NextFireTime FROM CronTrigger WHERE Id = :jobId]; 
        System.assertEquals(0, cronTrigger.TimesTriggered);
        System.assertEquals(Date.today().year() + '-09-03 00:00:00', String.valueOf(cronTrigger.NextFireTime));   
        Test.stopTest();        
    }
}