public with sharing class AccountController {
    @AuraEnabled
    public static Account getAccount(String accountId){
        return [SELECT Id, RecordTypeId, RecordType.Name, Is_Agent__c, Is_Variable__c, Is_Broker__c, Hidden_Broker__c, Hidden_Broker_Company__c, Email_Invoice__c, Invoice_Format__c,
                Email_Confirmation__c, Email_Nomination__c, Confirmation_Format__c, Nomination_Format__c, Mailing_Requirement__c
                FROM Account WHERE Id =: accountId LIMIT 1];
    }
    
    @AuraEnabled
    public static List<Account> getChildAccounts(String accountId){
        return [SELECT Id, CL_Category__c, CL_Individual__c, CL_Special__c, CL_Special_Group__c, CL_Used_Customer__c, CL_Used_Group__c, CL_Group__c,
                CL_Available_Credit__c, Total_Enquiry_Value__c
                FROM Account
                WHERE ParentId =: accountId ORDER BY CL_Used_Group__c DESC];
    }
    
	@AuraEnabled(cacheable=true)
    public static List<WrapperSTEM> getAccountSTEMs(String accountId){
        Id groupRecordTypeId = Schema.SObjectType.Account.getRecordTypeInfosByName().get('Group').getRecordTypeId();
        Account account = [SELECT Id, RecordTypeId FROM Account WHERE Id =: accountId];
        List<WrapperSTEM> wrapperStems = new List<WrapperSTEM>();
        List<STEM__c> stems = new List<STEM__c>();
        if(Account.RecordTypeId == groupRecordTypeId){
            Map<Id, Account> childAccountMap = new Map<Id, Account>([SELECT Id, ParentId FROM Account WHERE ParentId =: accountId]);
            stems = [SELECT Id, KeyStem__c, Payment_Delay__c, Total_Invoice_Amount__c, Invoice_Due_Date__c, RecordType.Name, Invoice_Amount__c, Due_Date__c
                                    FROM STEM__c
                                    WHERE Account__c IN: childAccountMap.keySet() AND ((Invoice_Due_Date__c != null AND Total_Invoice_Amount__c != null)
                                    OR (RecordType.Name = 'Historical' AND Invoice_Amount__c != null AND  Due_Date__c != null And KeyStem__c LIKE '%B'))];
        } else{
        	stems =  [SELECT Id, KeyStem__c, Payment_Delay__c, Total_Invoice_Amount__c, Invoice_Due_Date__c, RecordType.Name, Invoice_Amount__c, Due_Date__c
                                    FROM STEM__c
                                    WHERE Account__c =: accountId AND ((Invoice_Due_Date__c != null AND Total_Invoice_Amount__c != null)
                                    OR (RecordType.Name = 'Historical' AND Invoice_Amount__c != null AND  Due_Date__c != null And KeyStem__c LIKE '%B'))];
        }
        for(STEM__c stem: stems){
            if(stem.RecordType.Name == 'Historical'){
                wrapperStems.add(new WrapperSTEM(stem.Id, stem.KeyStem__c, stem.Payment_Delay__c, stem.Invoice_Amount__c, stem.Due_Date__c));
            } else{
                wrapperStems.add(new WrapperSTEM(stem.Id, stem.KeyStem__c, stem.Payment_Delay__c, stem.Total_Invoice_Amount__c, stem.Invoice_Due_Date__c));
            }
        }
        return wrapperStems;
    }
    
    @AuraEnabled
    public static void resetAcknowledgeReceipt(String accountId){
        Id originatedRecordTypeId = Schema.SObjectType.STEM__c.getRecordTypeInfosByName().get('Originated').getRecordTypeId();
        List<STEM__c> stems = [SELECT Id, Acknowledge_Receipt__c FROM STEM__c WHERE Account__c =: accountId AND RecordTypeId =: originatedRecordTypeId];
        for(STEM__c stem: stems){
            stem.Acknowledge_Receipt__c = false;
        }
        update stems;
    }
    
    @AuraEnabled
    public static List<Agreed_Compensation__c> getAgreedCompensations(String accountId){
        return [SELECT Id, Account__c, Account__r.Name, Amount__c, Deadline_Date__c, Status__c, Contact__c, Contact__r.Name, Buyer_Supplier_Trader__c
                FROM Agreed_Compensation__c WHERE Account__c =: accountId ORDER BY Contact__r.Name NULLS LAST];
    }
    
    @AuraEnabled
    public static List<Unofficial_Compensation__c> getUnofficialCompensations(String accountId){
        return [SELECT Id, Account__c, Account__r.Name, Amount__c, Contact__c, Contact__r.Name, STEM__c, STEM__r.Name, Buyer_Supplier_Trader__c
                FROM Unofficial_Compensation__c WHERE Account__c =: accountId AND Cancelled__c = false ORDER BY Contact__r.Name NULLS LAST];
    }
    
    @AuraEnabled
    public static Account getAccountCompensationInfo(String accountId){
        return [SELECT Id, Compensation_Total__c, Compensation_Status__c
                FROM Account WHERE Id =: accountId];
    }
    
    @AuraEnabled
    public static List<Deposit__c> getDeposits(String accountId){
        return [SELECT Id, Paid_Amount__c, Paid_Date__c
                FROM Deposit__c WHERE Account__c =: accountId ORDER BY Paid_Date__c];
    }
    
    @AuraEnabled
    public static List<Payment__c> getDepositPayments(String accountId){
        Id payableRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Payable').getRecordTypeId();
        return [SELECT Id, Amount__c, Maximum_Amount__c, Date__c, STEM__c, STEM__r.Name
                FROM Payment__c WHERE Account__c =: accountId AND RecordTypeId =: payableRecordTypeId AND Is_Deposit__c = true AND Is_Volume_Discount__c = false
                ORDER BY Date__c];
    }
    
    public class WrapperSTEM{
        @AuraEnabled
        public String Id;
        @AuraEnabled
        public String KeyStem;
        @AuraEnabled
        public Decimal Payment_Delay;
        @AuraEnabled
        public Decimal Amount;
        @AuraEnabled
        public Date Due_Date;
        
        public WrapperSTEM(String Id, String KeyStem, Decimal Payment_Delay, Decimal Amount, Date Due_Date){
            this.Id = Id;
            this.KeyStem = KeyStem;
            this.Payment_Delay = Payment_Delay;
            this.Amount = Amount;
            this.Due_Date = Due_Date;
        }
    }
}
