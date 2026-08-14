public class SpecialTermVersionHandler {
    private static Boolean changed(Object leftValue, Object rightValue) {
        return leftValue != rightValue && (leftValue == null || !leftValue.equals(rightValue));
    }

    public static void beforeInsert(List<Special_Term_Clause_Version__c> versions) {
        for (Special_Term_Clause_Version__c version : versions) {
            if (version.Status__c != 'Draft') version.addError('Clause versions must be created as Draft.');
            String normalizedText = SpecialTermClauseCompiler.normalizeClauseText(version.Clause_Text__c);
            if (String.isBlank(normalizedText)) version.addError('Clause text is required.');
            if (SpecialTermClauseCompiler.hasTopLevelListMarker(normalizedText)) version.addError('Clause text cannot contain its own top-level number or hyphen marker.');
            if (version.Revision_Number__c == null || version.Revision_Number__c < 1) version.addError('Revision number must be positive.');
            if (String.isBlank(version.Revision_Reason__c)) version.addError('Revision reason is required.');
            if (version.Approved_At__c != null || !String.isBlank(version.Approved_By_Email__c) || !String.isBlank(version.Approval_Reason__c)) version.addError('Draft versions cannot contain approval metadata.');
            version.Clause_Text__c = normalizedText;
            version.Content_Hash__c = SpecialTermClauseCompiler.sha256(normalizedText);
            if (version.Clause__c != null && version.Revision_Number__c != null) {
                version.Version_Key__c = String.valueOf(version.Clause__c) + ':' + String.valueOf(version.Revision_Number__c.intValue());
            }
        }
    }

    public static void beforeUpdate(List<Special_Term_Clause_Version__c> versions, Map<Id, Special_Term_Clause_Version__c> oldMap) {
        Set<Id> approvingClauseIds = new Set<Id>();
        for (Special_Term_Clause_Version__c version : versions) {
            Special_Term_Clause_Version__c oldVersion = oldMap.get(version.Id);
            if (oldVersion != null && oldVersion.Status__c == 'Draft' && version.Status__c == 'Approved' && version.Clause__c != null) approvingClauseIds.add(version.Clause__c);
        }
        Set<Id> consolidatingClauseIds = new Set<Id>();
        if (!approvingClauseIds.isEmpty()) for (Special_Term_Clause_Consolidation__c row : [
            SELECT Source_Clause__c FROM Special_Term_Clause_Consolidation__c
            WHERE Source_Clause__c IN :approvingClauseIds AND Status__c IN ('Relinking', 'Paused', 'Ready to Retire')
        ]) consolidatingClauseIds.add(row.Source_Clause__c);
        for (Special_Term_Clause_Version__c version : versions) {
            Special_Term_Clause_Version__c oldVersion = oldMap.get(version.Id);
            if (changed(version.Clause__c, oldVersion.Clause__c) || changed(version.Revision_Number__c, oldVersion.Revision_Number__c)) {
                version.addError('Clause and revision number are immutable.');
                continue;
            }
            if (oldVersion.Status__c == 'Superseded') {
                version.addError('Superseded clause versions are immutable.');
                continue;
            }
            if (oldVersion.Status__c == 'Approved') {
                Boolean legalTransition = version.Status__c == 'Superseded'
                    && !changed(version.Clause_Text__c, oldVersion.Clause_Text__c)
                    && !changed(version.Content_Hash__c, oldVersion.Content_Hash__c)
                    && !changed(version.Revision_Reason__c, oldVersion.Revision_Reason__c)
                    && !changed(version.Proposed_By_Email__c, oldVersion.Proposed_By_Email__c)
                    && !changed(version.Approved_By_Email__c, oldVersion.Approved_By_Email__c)
                    && !changed(version.Approved_At__c, oldVersion.Approved_At__c)
                    && !changed(version.Approval_Reason__c, oldVersion.Approval_Reason__c);
                if (!legalTransition) version.addError('Approved clause versions are immutable and may only be superseded.');
                continue;
            }
            String normalizedText = SpecialTermClauseCompiler.normalizeClauseText(version.Clause_Text__c);
            if (String.isBlank(normalizedText)) version.addError('Clause text is required.');
            if (SpecialTermClauseCompiler.hasTopLevelListMarker(normalizedText)) version.addError('Clause text cannot contain its own top-level number or hyphen marker.');
            if (String.isBlank(version.Revision_Reason__c)) version.addError('Revision reason is required.');
            if (version.Status__c == 'Approved') {
                if (consolidatingClauseIds.contains(version.Clause__c)) version.addError('Cancel the active clause consolidation before approving another source version.');
                if (changed(normalizedText, SpecialTermClauseCompiler.normalizeClauseText(oldVersion.Clause_Text__c))) {
                    version.addError('Save the final Draft wording before approving it.');
                }
                if (String.isBlank(version.Approved_By_Email__c) || version.Approved_At__c == null || String.isBlank(version.Approval_Reason__c)) {
                    version.addError('Approval identity, time, and reason are required.');
                }
            } else if (version.Status__c != 'Draft') {
                version.addError('Draft versions may only remain Draft or become Approved.');
            }
            version.Clause_Text__c = normalizedText;
            version.Content_Hash__c = SpecialTermClauseCompiler.sha256(normalizedText);
            version.Version_Key__c = String.valueOf(version.Clause__c) + ':' + String.valueOf(version.Revision_Number__c.intValue());
        }
    }

    public static void beforeDelete(List<Special_Term_Clause_Version__c> versions) {
        Set<Id> versionIds = new Map<Id, Special_Term_Clause_Version__c>(versions).keySet();
        Set<Id> referencedIds = new Set<Id>();
        for (Special_Term_Clause_Assignment__c row : [
            SELECT Clause_Version__c FROM Special_Term_Clause_Assignment__c WHERE Clause_Version__c IN :versionIds
        ]) referencedIds.add(row.Clause_Version__c);
        for (Special_Term_Revision_Clause__c row : [
            SELECT Clause_Version__c FROM Special_Term_Revision_Clause__c WHERE Clause_Version__c IN :versionIds
        ]) referencedIds.add(row.Clause_Version__c);
        for (Special_Term_Clause_Consolidation__c row : [
            SELECT Replacement_Version__c FROM Special_Term_Clause_Consolidation__c WHERE Replacement_Version__c IN :versionIds
        ]) referencedIds.add(row.Replacement_Version__c);
        for (Special_Term_Clause_Consolidation_Map__c row : [
            SELECT Source_Version__c, Replacement_Version__c FROM Special_Term_Clause_Consolidation_Map__c
            WHERE Source_Version__c IN :versionIds OR Replacement_Version__c IN :versionIds
        ]) {
            if (row.Source_Version__c != null) referencedIds.add(row.Source_Version__c);
            if (row.Replacement_Version__c != null) referencedIds.add(row.Replacement_Version__c);
        }
        for (Special_Term_Clause_Version__c version : versions) {
            if (version.Status__c != 'Draft') version.addError('Approved and superseded clause versions cannot be deleted.');
            else if (referencedIds.contains(version.Id)) version.addError('Referenced clause versions and their assignment, revision, or consolidation lineage must be retained.');
        }
    }

    public static void afterUpdate(List<Special_Term_Clause_Version__c> versions, Map<Id, Special_Term_Clause_Version__c> oldMap) {
        Set<Id> newlyApprovedClauseIds = new Set<Id>();
        for (Special_Term_Clause_Version__c version : versions) {
            Special_Term_Clause_Version__c prior = oldMap.get(version.Id);
            if (prior.Status__c == 'Draft' && version.Status__c == 'Approved') newlyApprovedClauseIds.add(version.Clause__c);
        }
        if (newlyApprovedClauseIds.isEmpty()) return;
        List<Special_Term_Clause_Consolidation__c> pauses = new List<Special_Term_Clause_Consolidation__c>();
        for (Special_Term_Clause_Consolidation__c consolidation : [
            SELECT Id FROM Special_Term_Clause_Consolidation__c
            WHERE Replacement_Clause__c IN :newlyApprovedClauseIds AND Status__c IN ('Relinking', 'Ready to Retire')
        ]) pauses.add(new Special_Term_Clause_Consolidation__c(Id = consolidation.Id, Status__c = 'Paused'));
        if (!pauses.isEmpty()) Database.update(pauses, AccessLevel.SYSTEM_MODE);
    }
}
