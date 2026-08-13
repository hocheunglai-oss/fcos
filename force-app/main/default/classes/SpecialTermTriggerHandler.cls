public class SpecialTermTriggerHandler {
    public static Boolean allowCompiledProjectionUpdate = false;
    public static Boolean allowRevisionLifecycleUpdate = false;

    public static void updateSpecialRemarks(List<Special_Term__c> specialTerms) {
        for (Special_Term__c specialTerm : specialTerms) {
            if (specialTerm.Add_to_Confirmation__c
                && specialTerm.Special_Remark_in_Confirmation__c == null
                && specialTerm.Confirmation_Clause_Status__c != 'Active') {
                specialTerm.Special_Remark_in_Confirmation__c = '- ' + specialTerm.Name;
            }
            if (specialTerm.Add_to_Nomination__c
                && specialTerm.Special_Remark_in_Nomination__c == null
                && specialTerm.Nomination_Clause_Status__c != 'Active') {
                specialTerm.Special_Remark_in_Nomination__c = '- ' + specialTerm.Name;
            }
        }
    }

    private static Boolean rollbackMatches(String nextText, String originalText, String nextHash) {
        return SpecialTermClauseCompiler.normalizeClauseText(nextText) == SpecialTermClauseCompiler.normalizeClauseText(originalText)
            && String.isBlank(nextHash);
    }

    private static Boolean protectedTextChanged(String nextText, String oldText) {
        return SpecialTermClauseCompiler.normalizeClauseText(nextText) != SpecialTermClauseCompiler.normalizeClauseText(oldText);
    }

    private static void validateRollback(Special_Term__c term, Special_Term__c oldTerm) {
        if (oldTerm == null) return;
        if (oldTerm.Clause_Structure_Status__c == 'Active' && term.Clause_Structure_Status__c != 'Active') {
            if (term.Clause_Structure_Status__c != 'Legacy' || !rollbackMatches(term.Terms_Text__c, oldTerm.Original_Terms_Text__c, term.Clause_Compiled_Hash__c)) {
                term.addError('Structured Terms Text can only leave Active through the audited FCOS rollback action.');
            }
        }
        if (oldTerm.Confirmation_Clause_Status__c == 'Active' && term.Confirmation_Clause_Status__c != 'Active') {
            if (term.Confirmation_Clause_Status__c != 'Legacy' || !rollbackMatches(term.Special_Remark_in_Confirmation__c, oldTerm.Original_Confirmation_Remark__c, term.Confirmation_Compiled_Hash__c)) {
                term.addError('A structured Confirmation remark can only leave Active through the audited FCOS rollback action.');
            }
        }
        if (oldTerm.Nomination_Clause_Status__c == 'Active' && term.Nomination_Clause_Status__c != 'Active') {
            if (term.Nomination_Clause_Status__c != 'Legacy' || !rollbackMatches(term.Special_Remark_in_Nomination__c, oldTerm.Original_Nomination_Remark__c, term.Nomination_Compiled_Hash__c)) {
                term.addError('A structured Nomination remark can only leave Active through the audited FCOS rollback action.');
            }
        }
        if (oldTerm.Confirmation_Clause_Status__c == 'Active' && term.Confirmation_Clause_Status__c == 'Active'
            && oldTerm.Confirmation_Clause_Style__c != term.Confirmation_Clause_Style__c) {
            term.addError('An active Confirmation remark style cannot be changed without reviewed rollback and reactivation.');
        }
        if (oldTerm.Nomination_Clause_Status__c == 'Active' && term.Nomination_Clause_Status__c == 'Active'
            && oldTerm.Nomination_Clause_Style__c != term.Nomination_Clause_Style__c) {
            term.addError('An active Nomination remark style cannot be changed without reviewed rollback and reactivation.');
        }
        if (oldTerm.Original_Terms_Text__c != null && protectedTextChanged(term.Original_Terms_Text__c, oldTerm.Original_Terms_Text__c)) {
            term.addError('Preserved original Terms Text is immutable.');
        }
        if (oldTerm.Original_Confirmation_Remark__c != null && protectedTextChanged(term.Original_Confirmation_Remark__c, oldTerm.Original_Confirmation_Remark__c)) {
            term.addError('The preserved original Confirmation remark is immutable.');
        }
        if (oldTerm.Original_Nomination_Remark__c != null && protectedTextChanged(term.Original_Nomination_Remark__c, oldTerm.Original_Nomination_Remark__c)) {
            term.addError('The preserved original Nomination remark is immutable.');
        }
    }

    private static Boolean validProjection(String text, String hash, SpecialTermClauseCompiler.Compilation expected) {
        return SpecialTermClauseCompiler.normalizeClauseText(text) == expected.text && hash == expected.hash;
    }

    public static void validateStructuredTerms(List<Special_Term__c> specialTerms, Map<Id, Special_Term__c> oldMap) {
        if (!allowRevisionLifecycleUpdate) validateRevisionLifecycle(specialTerms, oldMap);
        if (allowCompiledProjectionUpdate) return;
        Set<Id> activeTermIds = new Set<Id>();
        for (Special_Term__c term : specialTerms) {
            Special_Term__c oldTerm = oldMap == null ? null : oldMap.get(term.Id);
            validateRollback(term, oldTerm);
            Boolean anyActive = term.Clause_Structure_Status__c == 'Active'
                || term.Confirmation_Clause_Status__c == 'Active'
                || term.Nomination_Clause_Status__c == 'Active';
            if (anyActive && term.Id != null) activeTermIds.add(term.Id);
            if (term.Id == null && term.Clause_Structure_Status__c == 'Active'
                && (!String.isBlank(SpecialTermClauseCompiler.normalizeClauseText(term.Terms_Text__c))
                    || term.Clause_Compiled_Hash__c != SpecialTermClauseCompiler.sha256(''))) {
                term.addError('New structured Terms Text must begin with an empty compiled clause set.');
            }
            if (term.Id == null && term.Confirmation_Clause_Status__c == 'Active'
                && (!String.isBlank(SpecialTermClauseCompiler.normalizeClauseText(term.Special_Remark_in_Confirmation__c))
                    || term.Confirmation_Compiled_Hash__c != SpecialTermClauseCompiler.sha256(''))) {
                term.addError('A new structured Confirmation remark must begin with an empty compiled clause set.');
            }
            if (term.Id == null && term.Nomination_Clause_Status__c == 'Active'
                && (!String.isBlank(SpecialTermClauseCompiler.normalizeClauseText(term.Special_Remark_in_Nomination__c))
                    || term.Nomination_Compiled_Hash__c != SpecialTermClauseCompiler.sha256(''))) {
                term.addError('A new structured Nomination remark must begin with an empty compiled clause set.');
            }
        }
        if (activeTermIds.isEmpty()) return;

        Map<Id, Map<String, SpecialTermClauseCompiler.Compilation>> compiled;
        try {
            compiled = SpecialTermClauseCompiler.compileAll(activeTermIds);
        } catch (Exception error) {
            for (Special_Term__c term : specialTerms) if (activeTermIds.contains(term.Id)) term.addError(error.getMessage());
            return;
        }
        for (Special_Term__c term : specialTerms) {
            if (!activeTermIds.contains(term.Id)) continue;
            Map<String, SpecialTermClauseCompiler.Compilation> expected = compiled.get(term.Id);
            if (term.Clause_Structure_Status__c == 'Active'
                && !validProjection(term.Terms_Text__c, term.Clause_Compiled_Hash__c, expected.get(SpecialTermClauseCompiler.TERMS_TEXT))) {
                term.addError('Terms Text is compiled from approved FCOS clause assignments and cannot be edited directly.');
            }
            if (term.Confirmation_Clause_Status__c == 'Active'
                && !validProjection(term.Special_Remark_in_Confirmation__c, term.Confirmation_Compiled_Hash__c, expected.get(SpecialTermClauseCompiler.CONFIRMATION_REMARK))) {
                term.addError('The Confirmation special remark is compiled from approved FCOS clause assignments and cannot be edited directly.');
            }
            if (term.Nomination_Clause_Status__c == 'Active'
                && !validProjection(term.Special_Remark_in_Nomination__c, term.Nomination_Compiled_Hash__c, expected.get(SpecialTermClauseCompiler.NOMINATION_REMARK))) {
                term.addError('The Nomination special remark is compiled from approved FCOS clause assignments and cannot be edited directly.');
            }
        }
    }

    private static void validateRevisionLifecycle(List<Special_Term__c> specialTerms, Map<Id, Special_Term__c> oldMap) {
        Set<Id> revisionIds = new Set<Id>();
        for (Special_Term__c term : specialTerms) if (term.Current_Revision__c != null) revisionIds.add(term.Current_Revision__c);
        Map<Id, Special_Term_Revision__c> revisions = revisionIds.isEmpty() ? new Map<Id, Special_Term_Revision__c>() : new Map<Id, Special_Term_Revision__c>([
            SELECT Id, Special_Term__c, Status__c FROM Special_Term_Revision__c WHERE Id IN :revisionIds
        ]);
        for (Special_Term__c term : specialTerms) {
            Special_Term__c oldTerm = oldMap == null ? null : oldMap.get(term.Id);
            if (oldTerm != null && (term.Approval_Status__c != oldTerm.Approval_Status__c || term.Current_Revision__c != oldTerm.Current_Revision__c)) {
                Special_Term_Revision__c proposed = revisions.get(term.Current_Revision__c);
                Boolean legalLegacyInitialization = oldTerm.Approval_Status__c == null
                    && term.Approval_Status__c == 'Legacy'
                    && oldTerm.Current_Revision__c == null
                    && term.Current_Revision__c == null;
                Boolean legalDraftLink = term.Approval_Status__c == 'Draft'
                    && proposed != null
                    && proposed.Special_Term__c == term.Id
                    && proposed.Status__c == 'In Review'
                    && oldTerm.Approval_Status__c != 'Approved';
                if (!legalLegacyInitialization && !legalDraftLink) {
                    term.addError('Special Term approval lifecycle and current revision can only change through the controlled FCOS revision action.');
                    continue;
                }
            }
            if (term.Approval_Status__c == 'Approved') {
                Special_Term_Revision__c revision = revisions.get(term.Current_Revision__c);
                if (revision == null || revision.Special_Term__c != term.Id || revision.Status__c != 'Active') term.addError('Approved Special Terms must reference their active controlled revision.');
            }
        }
    }
}
