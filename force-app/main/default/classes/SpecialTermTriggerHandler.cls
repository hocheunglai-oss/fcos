public class SpecialTermTriggerHandler {
    public static Boolean allowCompiledProjectionUpdate = false;
    public static void updateSpecialRemarks(List<Special_Term__c> specialTerms) {
        for (Special_Term__c specialTerm : specialTerms) {
            if (specialTerm.Add_to_Confirmation__c && specialTerm.Special_Remark_in_Confirmation__c == null) {
                specialTerm.Special_Remark_in_Confirmation__c = '- ' + specialTerm.Name;
            }
            if (specialTerm.Add_to_Nomination__c && specialTerm.Special_Remark_in_Nomination__c == null) {
                specialTerm.Special_Remark_in_Nomination__c = '- ' + specialTerm.Name;
            }
        }
    }

    public static void validateStructuredTerms(List<Special_Term__c> specialTerms, Map<Id, Special_Term__c> oldMap) {
        if (allowCompiledProjectionUpdate) return;
        Set<Id> activeTermIds = new Set<Id>();
        for (Special_Term__c term : specialTerms) {
            Special_Term__c oldTerm = oldMap == null ? null : oldMap.get(term.Id);
            if (oldTerm != null && oldTerm.Clause_Structure_Status__c == 'Active' && term.Clause_Structure_Status__c == 'Legacy') {
                String originalText = SpecialTermClauseCompiler.normalizeClauseText(oldTerm.Original_Terms_Text__c);
                String nextText = SpecialTermClauseCompiler.normalizeClauseText(term.Terms_Text__c);
                if (nextText != originalText || !String.isBlank(term.Clause_Compiled_Hash__c)) {
                    term.addError('A structured Special Term can only return to Legacy through the audited FCOS rollback action.');
                }
                continue;
            }
            if (term.Clause_Structure_Status__c == 'Active' && term.Id != null) activeTermIds.add(term.Id);
            if (term.Clause_Structure_Status__c == 'Active' && term.Id == null) {
                String nextText = SpecialTermClauseCompiler.normalizeClauseText(term.Terms_Text__c);
                String expectedHash = SpecialTermClauseCompiler.sha256('');
                if (!String.isBlank(nextText) || term.Clause_Compiled_Hash__c != expectedHash) {
                    term.addError('New structured Special Terms must begin with an empty compiled clause set.');
                }
            }
        }
        if (activeTermIds.isEmpty()) return;

        Map<Id, SpecialTermClauseCompiler.Compilation> compiled;
        try {
            compiled = SpecialTermClauseCompiler.compile(activeTermIds);
        } catch (Exception error) {
            for (Special_Term__c term : specialTerms) if (activeTermIds.contains(term.Id)) term.addError(error.getMessage());
            return;
        }
        for (Special_Term__c term : specialTerms) {
            if (!activeTermIds.contains(term.Id)) continue;
            SpecialTermClauseCompiler.Compilation expected = compiled.get(term.Id);
            String nextText = SpecialTermClauseCompiler.normalizeClauseText(term.Terms_Text__c);
            if (nextText != expected.text || term.Clause_Compiled_Hash__c != expected.hash) {
                term.addError('Terms Text is compiled from approved FCOS clause assignments and cannot be edited directly.');
            }
        }
    }
}
