global with sharing class EmailCompensationsScheduler implements Schedulable {

    global void execute(SchedulableContext sc) {

        Map<Id, Account> accountMap = new Map<Id, Account>([SELECT Id FROM Account WHERE Agreed_Compansation_Size__c > 0 OR Unofficial_Compensation_Size__c > 0]);

        if (!accountMap.isEmpty()) {
            EmailCompensations.sendEmails(accountMap.keySet());
        }
    }
}