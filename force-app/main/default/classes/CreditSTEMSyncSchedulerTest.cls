@IsTest
private class CreditSTEMSyncSchedulerTest {

    @IsTest
    static void testSchedulerExecution(){
        Test.startTest();
        Date nextRunDate = Date.today().addDays(1);
        String CRON = '0 0 0 ' + nextRunDate.day() + ' ' + nextRunDate.month() + ' ? ' + nextRunDate.year();
        Test.setMock(HttpCalloutMock.class, new SyncApiMock());
        CreditSTEMSyncScheduler.invokeSync();
        String jobId = System.schedule('CreditSTEMSyncScheduler', CRON, new CreditSTEMSyncScheduler());
        CronTrigger cronTrigger = [SELECT Id, CronExpression, TimesTriggered, NextFireTime FROM CronTrigger WHERE Id = :jobId]; 
        System.assertEquals(0, cronTrigger.TimesTriggered);
        System.assertEquals(CRON, cronTrigger.CronExpression);
        System.assert(cronTrigger.NextFireTime > System.now(), 'The test schedule must always be in the future.');
        Test.stopTest();        
    }
}
