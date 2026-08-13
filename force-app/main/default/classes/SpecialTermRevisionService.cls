public without sharing class SpecialTermRevisionService {
    public class RevisionException extends Exception {}

    private static void require(Boolean condition, String message) {
        if (!condition) throw new RevisionException(message);
    }

    private static Boolean matchesExpectedLastModified(Datetime live, String expected) {
        if (String.isBlank(expected)) return false;
        return expected == String.valueOfGmt(live)
            || expected == live.formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'')
            || expected == live.formatGmt('yyyy-MM-dd\'T\'HH:mm:ss.SSS\'Z\'');
    }

    private static String compile(List<Special_Term_Revision_Clause__c> rows, String style) {
        List<String> values = new List<String>();
        Integer expected = 1;
        for (Special_Term_Revision_Clause__c row : rows) {
            require(row.Sequence__c != null && row.Sequence__c.intValue() == expected, 'Revision clauses must use continuous sequence numbers from 1 within each projection.');
            require(row.Clause__c == row.Clause_Version__r.Clause__c && row.Clause_Version__r.Status__c == 'Approved', 'Every activated revision clause must reference an approved version of its clause.');
            String wording = SpecialTermClauseCompiler.normalizeClauseText(row.Clause_Version__r.Clause_Text__c);
            require(!String.isBlank(wording) && !SpecialTermClauseCompiler.hasTopLevelListMarker(wording), 'Revision clause wording is invalid.');
            values.add(style == 'Hyphen' ? '- ' + wording : String.valueOf(expected) + '. ' + wording);
            expected++;
        }
        return String.join(values, style == 'Hyphen' ? '\n' : '\n\n');
    }

    private static Map<String, List<Special_Term_Revision_Clause__c>> projectionRows(Id revisionId) {
        Map<String, List<Special_Term_Revision_Clause__c>> values = new Map<String, List<Special_Term_Revision_Clause__c>>{
            SpecialTermClauseCompiler.TERMS_TEXT => new List<Special_Term_Revision_Clause__c>(),
            SpecialTermClauseCompiler.CONFIRMATION_REMARK => new List<Special_Term_Revision_Clause__c>(),
            SpecialTermClauseCompiler.NOMINATION_REMARK => new List<Special_Term_Revision_Clause__c>()
        };
        for (Special_Term_Revision_Clause__c row : [
            SELECT Id, Clause__c, Clause_Version__c, Projection__c, Sequence__c, State__c,
                Clause_Version__r.Clause__c, Clause_Version__r.Status__c, Clause_Version__r.Clause_Text__c
            FROM Special_Term_Revision_Clause__c WHERE Special_Term_Revision__c = :revisionId
            ORDER BY Projection__c, Sequence__c, Id
        ]) values.get(SpecialTermClauseCompiler.normalizeProjection(row.Projection__c)).add(row);
        return values;
    }

    public static void activate(Id revisionId, String approverEmail, String approvalReason, String expectedLastModifiedAt) {
        require(revisionId != null, 'A Special Term revision is required.');
        require(!String.isBlank(approverEmail) && !String.isBlank(approvalReason), 'Approval identity and reason are required.');
        require(!String.isBlank(expectedLastModifiedAt), 'The expected Special Term revision timestamp is required. Refresh before activating.');
        Special_Term_Revision__c revision = [
            SELECT Id, LastModifiedDate, Special_Term__c, Status__c, Revision_Number__c, Special_Term__r.Id,
                Special_Term__r.Terms_Text__c, Special_Term__r.Special_Remark_in_Confirmation__c, Special_Term__r.Special_Remark_in_Nomination__c,
                Special_Term__r.Original_Terms_Text__c, Special_Term__r.Original_Confirmation_Remark__c, Special_Term__r.Original_Nomination_Remark__c,
                Confirmation_Style__c, Nomination_Style__c, Prior_Confirmation_Style__c, Prior_Nomination_Style__c,
                Special_Term__r.Confirmation_Clause_Style__c, Special_Term__r.Nomination_Clause_Style__c, Special_Term__r.Current_Revision__c
            FROM Special_Term_Revision__c WHERE Id = :revisionId FOR UPDATE
        ];
        require(matchesExpectedLastModified(revision.LastModifiedDate, expectedLastModifiedAt), 'This Special Term revision changed after it was opened. Refresh before activating.');
        require(new Set<String>{ 'In Review', 'Approved' }.contains(revision.Status__c), 'Only an In Review or Approved revision can be activated.');
        Map<String, List<Special_Term_Revision_Clause__c>> rows = projectionRows(revisionId);
        require(!rows.get(SpecialTermClauseCompiler.TERMS_TEXT).isEmpty() || String.isBlank(revision.Special_Term__r.Terms_Text__c), 'A populated Terms Text projection requires reviewed revision clauses.');
        require(!rows.get(SpecialTermClauseCompiler.CONFIRMATION_REMARK).isEmpty() || String.isBlank(revision.Special_Term__r.Special_Remark_in_Confirmation__c), 'A populated Confirmation remark requires reviewed revision clauses.');
        require(!rows.get(SpecialTermClauseCompiler.NOMINATION_REMARK).isEmpty() || String.isBlank(revision.Special_Term__r.Special_Remark_in_Nomination__c), 'A populated Nomination remark requires reviewed revision clauses.');
        String terms = compile(rows.get(SpecialTermClauseCompiler.TERMS_TEXT), 'Numbered');
        String confirmationStyle = revision.Confirmation_Style__c == 'Numbered' ? 'Numbered' : 'Hyphen';
        String nominationStyle = revision.Nomination_Style__c == 'Numbered' ? 'Numbered' : 'Hyphen';
        String confirmation = compile(rows.get(SpecialTermClauseCompiler.CONFIRMATION_REMARK), confirmationStyle);
        String nomination = compile(rows.get(SpecialTermClauseCompiler.NOMINATION_REMARK), nominationStyle);
        List<Special_Term_Revision_Rule__c> ruleSnapshots = [
            SELECT Id, Snapshot_Type__c, Sequence__c, Special_Term_Rule__c, Source_Last_Modified__c,
                Audience__c, Account__c, Port__c, Product__c, Country__c, Priority__c, State__c
            FROM Special_Term_Revision_Rule__c WHERE Special_Term_Revision__c = :revisionId
            ORDER BY Snapshot_Type__c, Sequence__c, Id
        ];
        Map<Id, Special_Term_Rule__c> liveRules = new Map<Id, Special_Term_Rule__c>([
            SELECT Id, LastModifiedDate FROM Special_Term_Rule__c WHERE Special_Term__c = :revision.Special_Term__c FOR UPDATE
        ]);
        Set<Id> baselineIds = new Set<Id>();
        for (Special_Term_Revision_Rule__c snapshot : ruleSnapshots) if (snapshot.Snapshot_Type__c == 'Baseline') {
            require(snapshot.Special_Term_Rule__c != null && liveRules.containsKey(snapshot.Special_Term_Rule__c), 'The live Special Term rules changed after this revision was prepared. Refresh before activating.');
            require(snapshot.Source_Last_Modified__c == liveRules.get(snapshot.Special_Term_Rule__c).LastModifiedDate, 'A live Special Term rule changed after this revision was prepared. Refresh before activating.');
            baselineIds.add(snapshot.Special_Term_Rule__c);
        }
        require(liveRules.keySet().equals(baselineIds), 'Revision rules must include a current baseline of every live Special Term rule.');

        SpecialTermAssignmentHandler.suppressRecompile = true;
        SpecialTermRevisionHandler.allowLifecycleUpdate = true;
        SpecialTermRevisionClauseHandler.allowLifecycleUpdate = true;
        SpecialTermRevisionRuleHandler.allowLifecycleUpdate = true;
        SpecialTermRuleRevisionHandler.allowRevisionUpdate = true;
        SpecialTermTriggerHandler.allowCompiledProjectionUpdate = true;
        SpecialTermTriggerHandler.allowRevisionLifecycleUpdate = true;
        try {
            List<Special_Term_Clause_Assignment__c> pending = [SELECT Id FROM Special_Term_Clause_Assignment__c WHERE Special_Term__c = :revision.Special_Term__c AND State__c = 'Proposed'];
            if (!pending.isEmpty()) delete pending;
            List<Special_Term_Clause_Assignment__c> previous = [SELECT Id, State__c FROM Special_Term_Clause_Assignment__c WHERE Special_Term__c = :revision.Special_Term__c AND State__c = 'Active'];
            for (Special_Term_Clause_Assignment__c row : previous) row.State__c = 'Proposed';
            if (!previous.isEmpty()) update previous;
            List<Special_Term_Clause_Assignment__c> assignments = new List<Special_Term_Clause_Assignment__c>();
            for (String projection : SpecialTermClauseCompiler.PROJECTIONS) for (Special_Term_Revision_Clause__c row : rows.get(projection)) assignments.add(new Special_Term_Clause_Assignment__c(
                Special_Term__c = revision.Special_Term__c, Clause__c = row.Clause__c, Clause_Version__c = row.Clause_Version__c,
                Projection__c = projection, Sequence__c = row.Sequence__c, State__c = 'Active'
            ));
            if (!assignments.isEmpty()) insert assignments;
            List<Special_Term_Revision_Clause__c> revisionClauses = [SELECT Id, State__c FROM Special_Term_Revision_Clause__c WHERE Special_Term_Revision__c = :revisionId];
            for (Special_Term_Revision_Clause__c row : revisionClauses) row.State__c = 'Active';
            if (!revisionClauses.isEmpty()) update revisionClauses;
            List<Special_Term_Revision_Rule__c> revisionRules = [SELECT Id, State__c FROM Special_Term_Revision_Rule__c WHERE Special_Term_Revision__c = :revisionId];
            for (Special_Term_Revision_Rule__c row : revisionRules) row.State__c = 'Active';
            if (!revisionRules.isEmpty()) update revisionRules;
            if (!liveRules.isEmpty()) delete liveRules.values();
            List<Special_Term_Rule__c> proposedRules = new List<Special_Term_Rule__c>();
            for (Special_Term_Revision_Rule__c snapshot : ruleSnapshots) if (snapshot.Snapshot_Type__c == 'Proposed') proposedRules.add(new Special_Term_Rule__c(
                Special_Term__c = revision.Special_Term__c, Supplier_Buyer__c = snapshot.Audience__c,
                Account__c = snapshot.Account__c, Port__c = snapshot.Port__c, Product__c = snapshot.Product__c,
                Country__c = snapshot.Country__c
            ));
            if (!proposedRules.isEmpty()) insert proposedRules;
            if (revision.Special_Term__r.Current_Revision__c != null && revision.Special_Term__r.Current_Revision__c != revisionId) update new Special_Term_Revision__c(Id = revision.Special_Term__r.Current_Revision__c, Status__c = 'Superseded');
            update new Special_Term_Revision__c(Id = revisionId, Status__c = 'Active', Approved_By_Email__c = approverEmail, Approved_At__c = System.now(), Approval_Reason__c = approvalReason, Compiled_Hash__c = SpecialTermClauseCompiler.sha256(terms + '\n' + confirmation + '\n' + nomination));
            update new Special_Term__c(
                Id = revision.Special_Term__c, Approval_Status__c = 'Approved', Current_Revision__c = revisionId,
                Confirmation_Clause_Style__c = confirmationStyle, Nomination_Clause_Style__c = nominationStyle,
                Original_Terms_Text__c = revision.Special_Term__r.Original_Terms_Text__c == null ? revision.Special_Term__r.Terms_Text__c : revision.Special_Term__r.Original_Terms_Text__c,
                Original_Confirmation_Remark__c = revision.Special_Term__r.Original_Confirmation_Remark__c == null ? revision.Special_Term__r.Special_Remark_in_Confirmation__c : revision.Special_Term__r.Original_Confirmation_Remark__c,
                Original_Nomination_Remark__c = revision.Special_Term__r.Original_Nomination_Remark__c == null ? revision.Special_Term__r.Special_Remark_in_Nomination__c : revision.Special_Term__r.Original_Nomination_Remark__c,
                Terms_Text__c = terms, Clause_Compiled_Hash__c = SpecialTermClauseCompiler.sha256(terms), Clause_Structure_Status__c = 'Active',
                Special_Remark_in_Confirmation__c = confirmation, Confirmation_Compiled_Hash__c = SpecialTermClauseCompiler.sha256(confirmation), Confirmation_Clause_Status__c = 'Active',
                Special_Remark_in_Nomination__c = nomination, Nomination_Compiled_Hash__c = SpecialTermClauseCompiler.sha256(nomination), Nomination_Clause_Status__c = 'Active'
            );
        } finally {
            SpecialTermAssignmentHandler.suppressRecompile = false;
            SpecialTermRevisionHandler.allowLifecycleUpdate = false;
            SpecialTermRevisionClauseHandler.allowLifecycleUpdate = false;
            SpecialTermRevisionRuleHandler.allowLifecycleUpdate = false;
            SpecialTermRuleRevisionHandler.allowRevisionUpdate = false;
            SpecialTermTriggerHandler.allowCompiledProjectionUpdate = false;
            SpecialTermTriggerHandler.allowRevisionLifecycleUpdate = false;
        }
    }

    public static void activate(Id revisionId, String approverEmail, String approvalReason) {
        activate(revisionId, approverEmail, approvalReason, null);
    }

    public static void rollback(Id revisionId, String reason, String expectedLastModifiedAt) {
        require(revisionId != null && !String.isBlank(reason), 'Revision and rollback reason are required.');
        require(!String.isBlank(expectedLastModifiedAt), 'The expected Special Term revision timestamp is required. Refresh before rolling back.');
        Special_Term_Revision__c revision = [SELECT Id, LastModifiedDate, Special_Term__c, Status__c, Prior_Confirmation_Style__c, Prior_Nomination_Style__c, Special_Term__r.Current_Revision__c, Special_Term__r.Original_Terms_Text__c, Special_Term__r.Original_Confirmation_Remark__c, Special_Term__r.Original_Nomination_Remark__c FROM Special_Term_Revision__c WHERE Id = :revisionId FOR UPDATE];
        require(matchesExpectedLastModified(revision.LastModifiedDate, expectedLastModifiedAt), 'This Special Term revision changed after it was opened. Refresh before rolling back.');
        require(revision.Status__c == 'Active' && revision.Special_Term__r.Current_Revision__c == revisionId, 'Only the current active revision can be rolled back.');
        SpecialTermAssignmentHandler.suppressRecompile = true;
        SpecialTermRevisionHandler.allowLifecycleUpdate = true;
        SpecialTermRevisionClauseHandler.allowLifecycleUpdate = true;
        SpecialTermRevisionRuleHandler.allowLifecycleUpdate = true;
        SpecialTermRuleRevisionHandler.allowRevisionUpdate = true;
        SpecialTermTriggerHandler.allowCompiledProjectionUpdate = true;
        SpecialTermTriggerHandler.allowRevisionLifecycleUpdate = true;
        try {
            List<Special_Term_Clause_Assignment__c> active = [SELECT Id FROM Special_Term_Clause_Assignment__c WHERE Special_Term__c = :revision.Special_Term__c AND State__c = 'Active'];
            if (!active.isEmpty()) delete active;
            List<Special_Term_Revision_Clause__c> clauses = [SELECT Id, State__c FROM Special_Term_Revision_Clause__c WHERE Special_Term_Revision__c = :revisionId];
            for (Special_Term_Revision_Clause__c row : clauses) row.State__c = 'Proposed';
            if (!clauses.isEmpty()) update clauses;
            List<Special_Term_Revision_Rule__c> rules = [SELECT Id, State__c FROM Special_Term_Revision_Rule__c WHERE Special_Term_Revision__c = :revisionId];
            for (Special_Term_Revision_Rule__c row : rules) row.State__c = 'Proposed';
            if (!rules.isEmpty()) update rules;
            List<Special_Term_Rule__c> currentRules = [SELECT Id FROM Special_Term_Rule__c WHERE Special_Term__c = :revision.Special_Term__c];
            if (!currentRules.isEmpty()) delete currentRules;
            List<Special_Term_Rule__c> restoredRules = new List<Special_Term_Rule__c>();
            for (Special_Term_Revision_Rule__c snapshot : [
                SELECT Audience__c, Account__c, Port__c, Product__c, Country__c
                FROM Special_Term_Revision_Rule__c
                WHERE Special_Term_Revision__c = :revisionId AND Snapshot_Type__c = 'Baseline'
                ORDER BY Sequence__c, Id
            ]) restoredRules.add(new Special_Term_Rule__c(
                Special_Term__c = revision.Special_Term__c, Supplier_Buyer__c = snapshot.Audience__c,
                Account__c = snapshot.Account__c, Port__c = snapshot.Port__c,
                Product__c = snapshot.Product__c, Country__c = snapshot.Country__c
            ));
            if (!restoredRules.isEmpty()) insert restoredRules;
            update new Special_Term_Revision__c(Id = revisionId, Status__c = 'Rolled Back', Approval_Reason__c = reason);
            update new Special_Term__c(Id = revision.Special_Term__c, Approval_Status__c = 'Legacy', Current_Revision__c = null,
                Confirmation_Clause_Style__c = revision.Prior_Confirmation_Style__c, Nomination_Clause_Style__c = revision.Prior_Nomination_Style__c,
                Terms_Text__c = revision.Special_Term__r.Original_Terms_Text__c, Clause_Compiled_Hash__c = null, Clause_Structure_Status__c = 'Legacy',
                Special_Remark_in_Confirmation__c = revision.Special_Term__r.Original_Confirmation_Remark__c, Confirmation_Compiled_Hash__c = null, Confirmation_Clause_Status__c = 'Legacy',
                Special_Remark_in_Nomination__c = revision.Special_Term__r.Original_Nomination_Remark__c, Nomination_Compiled_Hash__c = null, Nomination_Clause_Status__c = 'Legacy');
        } finally {
            SpecialTermAssignmentHandler.suppressRecompile = false;
            SpecialTermRevisionHandler.allowLifecycleUpdate = false;
            SpecialTermRevisionClauseHandler.allowLifecycleUpdate = false;
            SpecialTermRevisionRuleHandler.allowLifecycleUpdate = false;
            SpecialTermRuleRevisionHandler.allowRevisionUpdate = false;
            SpecialTermTriggerHandler.allowCompiledProjectionUpdate = false;
            SpecialTermTriggerHandler.allowRevisionLifecycleUpdate = false;
        }
    }

    public static void rollback(Id revisionId, String reason) {
        rollback(revisionId, reason, null);
    }
}
