public class SpecialTermAssignmentHandler {
    private static Boolean synchronizingProjection = false;
    public static Boolean suppressRecompile = false;

    public static void validate(List<Special_Term_Clause_Assignment__c> assignments, Map<Id, Special_Term_Clause_Assignment__c> oldMap) {
        Set<Id> versionIds = new Set<Id>();
        for (Special_Term_Clause_Assignment__c assignment : assignments) if (assignment.Clause_Version__c != null) versionIds.add(assignment.Clause_Version__c);
        Map<Id, Special_Term_Clause_Version__c> versions = new Map<Id, Special_Term_Clause_Version__c>([
            SELECT Id, Clause__c, Status__c, Clause__r.Status__c
            FROM Special_Term_Clause_Version__c
            WHERE Id IN :versionIds
        ]);
        for (Special_Term_Clause_Assignment__c assignment : assignments) {
            assignment.Projection__c = SpecialTermClauseCompiler.normalizeProjection(assignment.Projection__c);
            if (assignment.Sequence__c == null || assignment.Sequence__c < 1) assignment.addError('Clause sequence must be positive.');
            Special_Term_Clause_Version__c version = versions.get(assignment.Clause_Version__c);
            if (version == null || version.Clause__c != assignment.Clause__c) {
                assignment.addError('The selected clause version does not belong to the selected clause.');
                continue;
            }
            Special_Term_Clause_Assignment__c oldAssignment = oldMap == null ? null : oldMap.get(assignment.Id);
            if (oldAssignment != null && oldAssignment.State__c == 'Historical') {
                if (assignment.State__c != 'Historical'
                    || assignment.Special_Term__c != oldAssignment.Special_Term__c
                    || assignment.Projection__c != oldAssignment.Projection__c
                    || assignment.Clause__c != oldAssignment.Clause__c
                    || assignment.Clause_Version__c != oldAssignment.Clause_Version__c
                    || assignment.Sequence__c != oldAssignment.Sequence__c) assignment.addError('Historical clause assignments are immutable.');
            }
            Boolean retainedExistingUse = oldAssignment != null
                && oldAssignment.State__c == 'Active'
                && oldAssignment.Clause__c == assignment.Clause__c
                && oldAssignment.Clause_Version__c == assignment.Clause_Version__c;
            if (assignment.State__c == 'Active') {
                Boolean currentlySelectable = version.Status__c == 'Approved' && version.Clause__r.Status__c == 'Active';
                Boolean retainedButClosed = retainedExistingUse
                    && new Set<String>{ 'Approved', 'Superseded' }.contains(version.Status__c)
                    && new Set<String>{ 'Active', 'Retired' }.contains(version.Clause__r.Status__c);
                Boolean reviewedHistoricalMigration = oldAssignment != null
                    && oldAssignment.State__c == 'Proposed'
                    && oldAssignment.Clause__c == assignment.Clause__c
                    && oldAssignment.Clause_Version__c == assignment.Clause_Version__c
                    && version.Status__c == 'Superseded'
                    && version.Clause__r.Status__c == 'Active';
                if (!currentlySelectable && !retainedButClosed && !reviewedHistoricalMigration) assignment.addError('New active assignments require the current approved version of an active clause.');
            }
            if (assignment.State__c == 'Historical' && oldAssignment == null) assignment.addError('Historical clause assignments can only be retained from an existing assignment.');
            if (assignment.State__c == 'Historical' && oldAssignment != null && !new Set<String>{ 'Active', 'Proposed', 'Historical' }.contains(oldAssignment.State__c)) assignment.addError('Only a retained assignment can become Historical.');
            if (!new Set<String>{ 'Active', 'Proposed', 'Historical' }.contains(assignment.State__c)) assignment.addError('Clause assignment state is invalid.');
            if (assignment.Special_Term__c != null && assignment.Sequence__c != null && assignment.Clause__c != null) {
                String prefix = String.valueOf(assignment.Special_Term__c) + ':' + assignment.Projection__c + ':' + assignment.State__c + ':';
                if (assignment.State__c == 'Historical' && assignment.Id != null) {
                    assignment.Assignment_Key__c = prefix + String.valueOf(assignment.Id);
                    assignment.Clause_Use_Key__c = prefix + String.valueOf(assignment.Id);
                } else {
                    assignment.Assignment_Key__c = prefix + String.valueOf(assignment.Sequence__c.intValue());
                    assignment.Clause_Use_Key__c = prefix + String.valueOf(assignment.Clause__c);
                }
            }
        }
    }

    public static void beforeDelete(List<Special_Term_Clause_Assignment__c> assignments) {
        for (Special_Term_Clause_Assignment__c assignment : assignments) assignment.addError('Clause assignment lineage must be retained. Archive the assignment as Historical.');
    }

    private static String sequenceKey(Special_Term_Clause_Assignment__c assignment) {
        return String.valueOf(assignment.Special_Term__c) + ':' + SpecialTermClauseCompiler.normalizeProjection(assignment.Projection__c);
    }

    public static void recompile(Set<Id> specialTermIds) {
        if (specialTermIds.isEmpty() || synchronizingProjection || suppressRecompile) return;
        List<Special_Term__c> terms = [
            SELECT Id, Clause_Structure_Status__c, Confirmation_Clause_Status__c, Nomination_Clause_Status__c
            FROM Special_Term__c
            WHERE Id IN :specialTermIds
            AND (Clause_Structure_Status__c = 'Active' OR Confirmation_Clause_Status__c = 'Active' OR Nomination_Clause_Status__c = 'Active')
        ];
        if (terms.isEmpty()) return;
        Map<Id, Special_Term__c> activeTerms = new Map<Id, Special_Term__c>(terms);
        Set<Id> activeIds = activeTerms.keySet();
        Map<String, Integer> nextSequenceByProjection = new Map<String, Integer>();
        List<Special_Term_Clause_Assignment__c> sequenceUpdates = new List<Special_Term_Clause_Assignment__c>();
        for (Special_Term_Clause_Assignment__c assignment : [
            SELECT Id, Special_Term__c, Projection__c, Sequence__c
            FROM Special_Term_Clause_Assignment__c
            WHERE Special_Term__c IN :activeIds AND State__c = 'Active'
            ORDER BY Special_Term__c, Projection__c, Sequence__c, Id
        ]) {
            String key = sequenceKey(assignment);
            Integer expected = nextSequenceByProjection.containsKey(key) ? nextSequenceByProjection.get(key) : 1;
            if (assignment.Sequence__c != expected) sequenceUpdates.add(new Special_Term_Clause_Assignment__c(Id = assignment.Id, Sequence__c = expected));
            nextSequenceByProjection.put(key, expected + 1);
        }
        if (!sequenceUpdates.isEmpty()) {
            try {
                synchronizingProjection = true;
                update sequenceUpdates;
            } finally {
                synchronizingProjection = false;
            }
        }
        Map<Id, Map<String, SpecialTermClauseCompiler.Compilation>> compilations = SpecialTermClauseCompiler.compileAll(activeIds);
        List<Special_Term__c> updates = new List<Special_Term__c>();
        for (Id termId : activeIds) {
            Special_Term__c live = activeTerms.get(termId);
            Map<String, SpecialTermClauseCompiler.Compilation> compiled = compilations.get(termId);
            Special_Term__c updateRow = new Special_Term__c(Id = termId);
            if (live.Clause_Structure_Status__c == 'Active') {
                updateRow.Terms_Text__c = compiled.get(SpecialTermClauseCompiler.TERMS_TEXT).text;
                updateRow.Clause_Compiled_Hash__c = compiled.get(SpecialTermClauseCompiler.TERMS_TEXT).hash;
            }
            if (live.Confirmation_Clause_Status__c == 'Active') {
                updateRow.Special_Remark_in_Confirmation__c = compiled.get(SpecialTermClauseCompiler.CONFIRMATION_REMARK).text;
                updateRow.Confirmation_Compiled_Hash__c = compiled.get(SpecialTermClauseCompiler.CONFIRMATION_REMARK).hash;
            }
            if (live.Nomination_Clause_Status__c == 'Active') {
                updateRow.Special_Remark_in_Nomination__c = compiled.get(SpecialTermClauseCompiler.NOMINATION_REMARK).text;
                updateRow.Nomination_Compiled_Hash__c = compiled.get(SpecialTermClauseCompiler.NOMINATION_REMARK).hash;
            }
            updates.add(updateRow);
        }
        try {
            SpecialTermTriggerHandler.allowCompiledProjectionUpdate = true;
            update updates;
        } finally {
            SpecialTermTriggerHandler.allowCompiledProjectionUpdate = false;
        }
    }
}
