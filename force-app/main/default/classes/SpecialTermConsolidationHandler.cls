public class SpecialTermConsolidationHandler {
    private static Boolean changed(Object leftValue, Object rightValue) {
        return leftValue != rightValue && (leftValue == null || !leftValue.equals(rightValue));
    }

    public static void validateConsolidations(List<Special_Term_Clause_Consolidation__c> rows, Map<Id, Special_Term_Clause_Consolidation__c> oldMap) {
        Set<Id> clauseIds = new Set<Id>();
        Set<Id> versionIds = new Set<Id>();
        Set<Id> sourcesRequiringNoReferences = new Set<Id>();
        for (Special_Term_Clause_Consolidation__c row : rows) {
            if (row.Source_Clause__c != null) clauseIds.add(row.Source_Clause__c);
            if (row.Replacement_Clause__c != null) clauseIds.add(row.Replacement_Clause__c);
            if (row.Replacement_Version__c != null) versionIds.add(row.Replacement_Version__c);
            if (new Set<String>{ 'Ready to Retire', 'Completed' }.contains(row.Status__c) && row.Source_Clause__c != null) sourcesRequiringNoReferences.add(row.Source_Clause__c);
        }
        Map<Id, Special_Term_Clause__c> clauses = new Map<Id, Special_Term_Clause__c>([
            SELECT Id, Status__c, Latest_Approved_Version_Number__c FROM Special_Term_Clause__c WHERE Id IN :clauseIds
        ]);
        Map<Id, Special_Term_Clause_Version__c> versions = new Map<Id, Special_Term_Clause_Version__c>([
            SELECT Id, Clause__c, Revision_Number__c, Status__c FROM Special_Term_Clause_Version__c WHERE Id IN :versionIds
        ]);
        Set<Id> sourcesWithReferences = new Set<Id>();
        if (!sourcesRequiringNoReferences.isEmpty()) {
            for (Special_Term_Clause_Assignment__c assignment : [
                SELECT Clause__c FROM Special_Term_Clause_Assignment__c WHERE Clause__c IN :sourcesRequiringNoReferences AND State__c = 'Active'
            ]) sourcesWithReferences.add(assignment.Clause__c);
            for (Special_Term_Revision_Clause__c revisionClause : [
                SELECT Clause__c FROM Special_Term_Revision_Clause__c
                WHERE Clause__c IN :sourcesRequiringNoReferences AND Special_Term_Revision__r.Status__c IN ('Draft', 'In Review')
            ]) sourcesWithReferences.add(revisionClause.Clause__c);
        }
        Map<Id, Set<Id>> overlappingByClause = new Map<Id, Set<Id>>();
        if (!clauseIds.isEmpty()) for (Special_Term_Clause_Consolidation__c existing : [
            SELECT Id, Source_Clause__c, Replacement_Clause__c FROM Special_Term_Clause_Consolidation__c
            WHERE Status__c IN ('Relinking', 'Paused', 'Ready to Retire')
            AND (Source_Clause__c IN :clauseIds OR Replacement_Clause__c IN :clauseIds)
        ]) {
            for (Id clauseId : new Set<Id>{ existing.Source_Clause__c, existing.Replacement_Clause__c }) {
                if (!overlappingByClause.containsKey(clauseId)) overlappingByClause.put(clauseId, new Set<Id>());
                overlappingByClause.get(clauseId).add(existing.Id);
            }
        }
        Set<Id> incomingOpenClauseIds = new Set<Id>();
        for (Special_Term_Clause_Consolidation__c row : rows) {
            Special_Term_Clause_Consolidation__c prior = oldMap == null ? null : oldMap.get(row.Id);
            if (row.Source_Clause__c == null || row.Replacement_Clause__c == null || row.Replacement_Version__c == null) row.addError('Source clause, replacement clause, and pinned replacement version are required.');
            if (row.Source_Clause__c == row.Replacement_Clause__c) row.addError('A clause cannot replace itself.');
            if (String.isBlank(row.Reason__c) || String.isBlank(row.Confirmed_By_Email__c) || row.Confirmed_At__c == null) row.addError('A consolidation reason and confirmation identity are required.');
            if (prior == null) {
                if (row.Status__c != 'Relinking') row.addError('A consolidation must begin in Relinking status.');
                if (incomingOpenClauseIds.contains(row.Source_Clause__c) || incomingOpenClauseIds.contains(row.Replacement_Clause__c)) row.addError('A clause can participate in only one open consolidation.');
                incomingOpenClauseIds.add(row.Source_Clause__c);
                incomingOpenClauseIds.add(row.Replacement_Clause__c);
            }
            if (prior != null) {
                if (changed(row.Source_Clause__c, prior.Source_Clause__c) || changed(row.Replacement_Clause__c, prior.Replacement_Clause__c) || changed(row.Replacement_Version__c, prior.Replacement_Version__c) || changed(row.Consolidation_Key__c, prior.Consolidation_Key__c)) row.addError('Consolidation identities and the pinned replacement version are immutable. Cancel and start a new consolidation.');
                if (new Set<String>{ 'Completed', 'Cancelled' }.contains(prior.Status__c)) row.addError('Completed and cancelled consolidations are immutable.');
                Map<String, Set<String>> allowed = new Map<String, Set<String>>{
                    'Relinking' => new Set<String>{ 'Relinking', 'Paused', 'Ready to Retire', 'Cancelled' },
                    'Paused' => new Set<String>{ 'Paused', 'Relinking', 'Cancelled' },
                    'Ready to Retire' => new Set<String>{ 'Ready to Retire', 'Relinking', 'Paused', 'Completed', 'Cancelled' }
                };
                if (!allowed.containsKey(prior.Status__c) || !allowed.get(prior.Status__c).contains(row.Status__c)) row.addError('The requested consolidation lifecycle transition is not allowed.');
            }
            for (Id clauseId : new Set<Id>{ row.Source_Clause__c, row.Replacement_Clause__c }) {
                Set<Id> overlaps = overlappingByClause.get(clauseId);
                if (overlaps != null && (row.Id == null || overlaps.size() > 1 || !overlaps.contains(row.Id))) row.addError('The source or replacement clause already participates in another open consolidation.');
            }
            Special_Term_Clause__c source = clauses.get(row.Source_Clause__c);
            Special_Term_Clause__c replacement = clauses.get(row.Replacement_Clause__c);
            Special_Term_Clause_Version__c replacementVersion = versions.get(row.Replacement_Version__c);
            if (!new Set<String>{ 'Completed', 'Cancelled' }.contains(row.Status__c) && source?.Status__c != 'Active') row.addError('The source clause must remain active until consolidation completes.');
            if (new Set<String>{ 'Relinking', 'Ready to Retire', 'Completed' }.contains(row.Status__c)
                && (replacement?.Status__c != 'Active' || replacementVersion?.Clause__c != row.Replacement_Clause__c || replacementVersion?.Status__c != 'Approved'
                    || replacement.Latest_Approved_Version_Number__c != replacementVersion.Revision_Number__c)) row.addError('The pinned replacement must be the current approved version of an active clause.');
            if (sourcesWithReferences.contains(row.Source_Clause__c)) row.addError('Live and pending Special Term references must be relinked before retirement is ready or completed.');
            if (row.Status__c == 'Completed' && (String.isBlank(row.Completed_By_Email__c) || row.Completed_At__c == null)) row.addError('Completed consolidations require completion identity and time.');
            if (row.Status__c == 'Cancelled' && (String.isBlank(row.Cancelled_By_Email__c) || row.Cancelled_At__c == null)) row.addError('Cancelled consolidations require cancellation identity and time.');
        }
    }

    public static void validateMappings(List<Special_Term_Clause_Consolidation_Map__c> rows, Map<Id, Special_Term_Clause_Consolidation_Map__c> oldMap) {
        Set<Id> consolidationIds = new Set<Id>();
        Set<Id> versionIds = new Set<Id>();
        for (Special_Term_Clause_Consolidation_Map__c row : rows) {
            if (row.Consolidation__c != null) consolidationIds.add(row.Consolidation__c);
            if (row.Source_Version__c != null) versionIds.add(row.Source_Version__c);
            if (row.Replacement_Version__c != null) versionIds.add(row.Replacement_Version__c);
        }
        Map<Id, Special_Term_Clause_Consolidation__c> consolidations = new Map<Id, Special_Term_Clause_Consolidation__c>([
            SELECT Id, Source_Clause__c, Replacement_Clause__c, Replacement_Version__c, Status__c
            FROM Special_Term_Clause_Consolidation__c WHERE Id IN :consolidationIds
        ]);
        Map<Id, Special_Term_Clause_Version__c> versions = new Map<Id, Special_Term_Clause_Version__c>([
            SELECT Id, Clause__c, Status__c, Content_Hash__c FROM Special_Term_Clause_Version__c WHERE Id IN :versionIds
        ]);
        for (Special_Term_Clause_Consolidation_Map__c row : rows) {
            Special_Term_Clause_Consolidation_Map__c prior = oldMap == null ? null : oldMap.get(row.Id);
            if (prior != null && (changed(row.Consolidation__c, prior.Consolidation__c) || changed(row.Source_Version__c, prior.Source_Version__c) || changed(row.Replacement_Version__c, prior.Replacement_Version__c) || changed(row.Equivalence_Status__c, prior.Equivalence_Status__c) || changed(row.Mapping_Key__c, prior.Mapping_Key__c) || changed(row.Source_Content_Hash__c, prior.Source_Content_Hash__c) || changed(row.Replacement_Content_Hash__c, prior.Replacement_Content_Hash__c) || changed(row.Confirmed_By_Email__c, prior.Confirmed_By_Email__c) || changed(row.Confirmed_At__c, prior.Confirmed_At__c))) row.addError('Approved consolidation version mappings are immutable.');
            Special_Term_Clause_Consolidation__c consolidation = consolidations.get(row.Consolidation__c);
            Special_Term_Clause_Version__c source = versions.get(row.Source_Version__c);
            Special_Term_Clause_Version__c replacement = versions.get(row.Replacement_Version__c);
            if (consolidation == null || source == null || replacement == null) {
                row.addError('The consolidation and both reviewed versions must exist.');
                continue;
            }
            if (new Set<String>{ 'Completed', 'Cancelled' }.contains(consolidation.Status__c)) row.addError('Mappings cannot be added to a closed consolidation.');
            if (source.Clause__c != consolidation.Source_Clause__c || replacement.Clause__c != consolidation.Replacement_Clause__c || replacement.Id != consolidation.Replacement_Version__c) row.addError('Version mapping does not match the consolidation identities.');
            if (!new Set<String>{ 'Approved', 'Superseded' }.contains(source.Status__c) || replacement.Status__c != 'Approved') row.addError('Mappings require retained source wording and the current approved replacement version.');
            if (row.Source_Content_Hash__c != source.Content_Hash__c || row.Replacement_Content_Hash__c != replacement.Content_Hash__c) row.addError('Mapped clause wording changed after equivalence review.');
            if (String.isBlank(row.Confirmed_By_Email__c) || row.Confirmed_At__c == null) row.addError('Version mapping confirmation identity is required.');
        }
    }

    public static void preventConsolidationDelete(List<Special_Term_Clause_Consolidation__c> rows) {
        for (Special_Term_Clause_Consolidation__c row : rows) row.addError('Clause consolidation lineage must be retained.');
    }

    public static void preventMappingDelete(List<Special_Term_Clause_Consolidation_Map__c> rows) {
        for (Special_Term_Clause_Consolidation_Map__c row : rows) row.addError('Clause consolidation lineage must be retained.');
    }
}
