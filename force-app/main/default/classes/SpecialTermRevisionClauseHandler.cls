public class SpecialTermRevisionClauseHandler {
    public static Boolean allowLifecycleUpdate = false;

    public static void validate(List<Special_Term_Revision_Clause__c> rows, Map<Id, Special_Term_Revision_Clause__c> oldMap) {
        Set<Id> revisionIds = new Set<Id>();
        Set<Id> versionIds = new Set<Id>();
        for (Special_Term_Revision_Clause__c row : rows) {
            if (row.Special_Term_Revision__c != null) revisionIds.add(row.Special_Term_Revision__c);
            if (row.Clause_Version__c != null) versionIds.add(row.Clause_Version__c);
        }
        Map<Id, Special_Term_Revision__c> revisions = new Map<Id, Special_Term_Revision__c>([SELECT Id, Status__c FROM Special_Term_Revision__c WHERE Id IN :revisionIds]);
        Map<Id, Special_Term_Clause_Version__c> versions = new Map<Id, Special_Term_Clause_Version__c>([SELECT Id, Clause__c, Status__c FROM Special_Term_Clause_Version__c WHERE Id IN :versionIds]);
        for (Special_Term_Revision_Clause__c row : rows) {
            if (row.Sequence__c == null || row.Sequence__c < 1) row.addError('Revision clause sequence must be positive.');
            row.Projection__c = SpecialTermClauseCompiler.normalizeProjection(row.Projection__c);
            Special_Term_Clause_Version__c version = versions.get(row.Clause_Version__c);
            if (version == null || version.Clause__c != row.Clause__c) row.addError('The selected clause version does not belong to the selected clause.');
            Special_Term_Revision__c revision = revisions.get(row.Special_Term_Revision__c);
            if (revision == null) row.addError('The selected Special Term revision is unavailable.');
            else if (!allowLifecycleUpdate && new Set<String>{ 'Active', 'Superseded', 'Rolled Back' }.contains(revision.Status__c)) row.addError('Activated revision clauses are immutable. Create a new Special Term revision.');
            if (!allowLifecycleUpdate && row.State__c == 'Active') row.addError('Revision clauses become Active only through controlled revision activation.');
            if (row.Special_Term_Revision__c != null && row.Sequence__c != null) {
                row.Revision_Clause_Key__c = String.valueOf(row.Special_Term_Revision__c) + ':' + row.Projection__c + ':' + String.valueOf(row.Sequence__c.intValue());
            }
        }
    }
}
