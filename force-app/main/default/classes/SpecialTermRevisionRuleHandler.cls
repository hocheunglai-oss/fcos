public class SpecialTermRevisionRuleHandler {
    public static Boolean allowLifecycleUpdate = false;
    public static void validate(List<Special_Term_Revision_Rule__c> rows) {
        Set<Id> revisionIds = new Set<Id>();
        for (Special_Term_Revision_Rule__c row : rows) if (row.Special_Term_Revision__c != null) revisionIds.add(row.Special_Term_Revision__c);
        Map<Id, Special_Term_Revision__c> revisions = new Map<Id, Special_Term_Revision__c>([SELECT Id, Status__c FROM Special_Term_Revision__c WHERE Id IN :revisionIds]);
        for (Special_Term_Revision_Rule__c row : rows) {
            Special_Term_Revision__c revision = revisions.get(row.Special_Term_Revision__c);
            if (revision == null) row.addError('The selected Special Term revision is unavailable.');
            else if (!allowLifecycleUpdate && new Set<String>{ 'Active', 'Superseded', 'Rolled Back' }.contains(revision.Status__c)) row.addError('Activated revision rules are immutable. Create a new Special Term revision.');
            if (!allowLifecycleUpdate && row.State__c == 'Active') row.addError('Revision rules become Active only through controlled revision activation.');
            if (row.Special_Term_Revision__c != null && row.Sequence__c != null) row.Rule_Key__c = String.valueOf(row.Special_Term_Revision__c) + ':' + row.Snapshot_Type__c + ':' + String.valueOf(row.Sequence__c.intValue());
        }
    }
}
