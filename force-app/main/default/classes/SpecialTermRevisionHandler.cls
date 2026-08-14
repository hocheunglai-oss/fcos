public class SpecialTermRevisionHandler {
    public static Boolean allowLifecycleUpdate = false;

    private static Boolean changed(Object leftValue, Object rightValue) {
        return leftValue != rightValue && (leftValue == null || !leftValue.equals(rightValue));
    }

    public static void beforeInsert(List<Special_Term_Revision__c> revisions) {
        for (Special_Term_Revision__c revision : revisions) {
            if (revision.Status__c != null && revision.Status__c != 'Draft') revision.addError('Special Term revisions must be created as Draft.');
            if (revision.Revision_Number__c == null || revision.Revision_Number__c < 1) revision.addError('Revision number must be positive.');
            if (String.isBlank(revision.Revision_Reason__c)) revision.addError('Revision reason is required.');
            if (revision.Special_Term__c != null && revision.Revision_Number__c != null) revision.Revision_Key__c = String.valueOf(revision.Special_Term__c) + ':' + String.valueOf(revision.Revision_Number__c.intValue());
        }
    }

    public static void beforeUpdate(List<Special_Term_Revision__c> revisions, Map<Id, Special_Term_Revision__c> oldMap) {
        for (Special_Term_Revision__c revision : revisions) {
            Special_Term_Revision__c oldRevision = oldMap.get(revision.Id);
            if (changed(revision.Special_Term__c, oldRevision.Special_Term__c) || changed(revision.Revision_Number__c, oldRevision.Revision_Number__c)) {
                revision.addError('Revision identity is immutable.');
                continue;
            }
            if (oldRevision.Status__c == 'Active' || oldRevision.Status__c == 'Superseded' || oldRevision.Status__c == 'Rolled Back') {
                if (!allowLifecycleUpdate) revision.addError('Activated Special Term revisions may only change through the controlled FCOS lifecycle.');
                continue;
            }
            if (!allowLifecycleUpdate && oldRevision.Status__c != revision.Status__c && !new Set<String>{ 'Draft', 'In Review', 'Approved', 'Rejected' }.contains(revision.Status__c)) {
                revision.addError('Revision activation is restricted to the controlled FCOS lifecycle.');
            }
            if (String.isBlank(revision.Revision_Reason__c)) revision.addError('Revision reason is required.');
        }
    }

    public static void beforeDelete(List<Special_Term_Revision__c> revisions) {
        for (Special_Term_Revision__c revision : revisions) {
            if (!new Set<String>{ 'Draft', 'In Review' }.contains(revision.Status__c)) {
                revision.addError('Only transient Draft or In Review revisions may be deleted. Historical revision lineage must be retained.');
            }
        }
    }
}
