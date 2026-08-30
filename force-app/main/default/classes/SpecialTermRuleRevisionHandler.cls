public class SpecialTermRuleRevisionHandler {
    public static Boolean allowRevisionUpdate = false;
    public static void protect(List<Special_Term_Rule__c> rows) {
        if (allowRevisionUpdate) return;
        Set<Id> termIds = new Set<Id>();
        for (Special_Term_Rule__c row : rows) if (row.Special_Term__c != null) termIds.add(row.Special_Term__c);
        Map<Id, Special_Term__c> terms = termIds.isEmpty() ? new Map<Id, Special_Term__c>() : new Map<Id, Special_Term__c>([SELECT Id, Approval_Status__c FROM Special_Term__c WHERE Id IN :termIds]);
        for (Special_Term_Rule__c row : rows) if (terms.get(row.Special_Term__c)?.Approval_Status__c == 'Approved') row.addError('Rules for an approved Special Term are frozen. Create and approve a complete Special Term revision.');
    }

    public static void beforeDelete(List<Special_Term_Rule__c> rows) {
        protect(rows);
        if (allowRevisionUpdate) return;
        Set<Id> ruleIds = new Map<Id, Special_Term_Rule__c>(rows).keySet();
        Set<Id> referencedIds = new Set<Id>();
        for (Special_Term_Revision_Rule__c revisionRule : [
            SELECT Special_Term_Rule__c FROM Special_Term_Revision_Rule__c
            WHERE Special_Term_Rule__c IN :ruleIds
        ]) referencedIds.add(revisionRule.Special_Term_Rule__c);
        for (Special_Term_Rule__c row : rows) {
            if (referencedIds.contains(row.Id)) row.addError('Special Term rule revision lineage must be retained.');
        }
    }
}
