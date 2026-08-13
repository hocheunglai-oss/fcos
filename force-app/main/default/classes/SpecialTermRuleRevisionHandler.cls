public class SpecialTermRuleRevisionHandler {
    public static Boolean allowRevisionUpdate = false;
    public static void protect(List<Special_Term_Rule__c> rows) {
        if (allowRevisionUpdate) return;
        Set<Id> termIds = new Set<Id>();
        for (Special_Term_Rule__c row : rows) if (row.Special_Term__c != null) termIds.add(row.Special_Term__c);
        Map<Id, Special_Term__c> terms = termIds.isEmpty() ? new Map<Id, Special_Term__c>() : new Map<Id, Special_Term__c>([SELECT Id, Approval_Status__c FROM Special_Term__c WHERE Id IN :termIds]);
        for (Special_Term_Rule__c row : rows) if (terms.get(row.Special_Term__c)?.Approval_Status__c == 'Approved') row.addError('Rules for an approved Special Term are frozen. Create and approve a complete Special Term revision.');
    }
}
