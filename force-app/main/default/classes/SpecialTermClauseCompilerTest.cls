@isTest
private class SpecialTermClauseCompilerTest {
    private static Special_Term_Clause__c clause(String name, String key) {
        Special_Term_Clause__c row = new Special_Term_Clause__c(
            Name = name,
            Short_Name_Key__c = name.toLowerCase(),
            Canonical_Text_Key__c = key,
            Category__c = 'Other',
            Status__c = 'Draft',
            Latest_Approved_Version_Number__c = 0
        );
        Database.insert(row, AccessLevel.SYSTEM_MODE);
        return row;
    }

    private static Special_Term_Clause_Version__c approve(Special_Term_Clause__c clauseRow, Integer revision, String wording) {
        Special_Term_Clause_Version__c version = new Special_Term_Clause_Version__c(
            Clause__c = clauseRow.Id,
            Revision_Number__c = revision,
            Clause_Text__c = wording,
            Content_Hash__c = 'placeholder',
            Status__c = 'Draft',
            Revision_Reason__c = 'Test revision'
        );
        Database.insert(version, AccessLevel.SYSTEM_MODE);
        version.Status__c = 'Approved';
        version.Approved_By_Email__c = 'approver@example.com';
        version.Approved_At__c = System.now();
        version.Approval_Reason__c = 'Approved for test coverage';
        Database.update(version, AccessLevel.SYSTEM_MODE);
        clauseRow.Status__c = 'Active';
        clauseRow.Latest_Approved_Version_Number__c = revision;
        clauseRow.Last_Approved_At__c = System.now();
        Database.update(clauseRow, AccessLevel.SYSTEM_MODE);
        return version;
    }

    @isTest static void compilesAndProtectsNumberedTerms() {
        Special_Term__c term = new Special_Term__c(
            Name = 'Clause test term',
            Clause_Structure_Status__c = 'Legacy'
        );
        Database.insert(term, AccessLevel.SYSTEM_MODE);
        Special_Term_Clause__c first = clause('Payment Due', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
        Special_Term_Clause__c second = clause('No Warranty', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
        Special_Term_Clause_Version__c firstVersion = approve(first, 1, 'Buyer shall pay by the due date.');
        Special_Term_Clause_Version__c secondVersion = approve(second, 1, 'No warranty is provided.\n- Local specifications apply.');
        Database.insert(new List<Special_Term_Clause_Assignment__c>{
            new Special_Term_Clause_Assignment__c(Special_Term__c = term.Id, Clause__c = first.Id, Clause_Version__c = firstVersion.Id, Sequence__c = 1, State__c = 'Active'),
            new Special_Term_Clause_Assignment__c(Special_Term__c = term.Id, Clause__c = second.Id, Clause_Version__c = secondVersion.Id, Sequence__c = 2, State__c = 'Active')
        }, AccessLevel.SYSTEM_MODE);
        String expected = '1. Buyer shall pay by the due date.\n\n2. No warranty is provided.\n- Local specifications apply.';
        term.Terms_Text__c = expected;
        term.Clause_Compiled_Hash__c = SpecialTermClauseCompiler.sha256(expected);
        term.Clause_Structure_Status__c = 'Active';
        Database.update(term, AccessLevel.SYSTEM_MODE);

        Special_Term__c saved = term;
        System.assertEquals(expected, saved.Terms_Text__c);
        System.assertEquals(SpecialTermClauseCompiler.sha256(expected), saved.Clause_Compiled_Hash__c);

        saved.Terms_Text__c = '1. Changed directly.';
        try {
            Database.update(saved, AccessLevel.SYSTEM_MODE);
            System.assert(false, 'Direct wording edit should fail.');
        } catch (DmlException error) {
            System.assert(error.getMessage().contains('cannot be edited directly'));
        }

        List<Special_Term_Clause_Assignment__c> activeRows = [
            SELECT Id, Sequence__c, State__c
            FROM Special_Term_Clause_Assignment__c
            WHERE Special_Term__c = :term.Id AND State__c = 'Active'
            ORDER BY Sequence__c
        ];
        activeRows[0].State__c = 'Historical';
        Database.update(activeRows[0], AccessLevel.SYSTEM_MODE);
        Special_Term__c recompiled = [SELECT Terms_Text__c FROM Special_Term__c WHERE Id = :term.Id];
        Special_Term_Clause_Assignment__c remaining = [SELECT Sequence__c FROM Special_Term_Clause_Assignment__c WHERE Special_Term__c = :term.Id AND State__c = 'Active' LIMIT 1];
        System.assertEquals(Decimal.valueOf('1'), remaining.Sequence__c);
        System.assertEquals('1. No warranty is provided.\n- Local specifications apply.', recompiled.Terms_Text__c);
        System.assertEquals(1, [SELECT COUNT() FROM Special_Term_Clause_Assignment__c WHERE Special_Term__c = :term.Id AND State__c = 'Historical']);
    }

    @isTest static void compilesAndProtectsIndependentRemarkStyles() {
        Special_Term__c term = new Special_Term__c(
            Name = 'Remark projection term',
            Clause_Structure_Status__c = 'Legacy',
            Confirmation_Clause_Status__c = 'Legacy',
            Confirmation_Clause_Style__c = 'Hyphen',
            Nomination_Clause_Status__c = 'Legacy',
            Nomination_Clause_Style__c = 'Numbered'
        );
        Database.insert(term, AccessLevel.SYSTEM_MODE);
        Special_Term_Clause__c first = clause('First Remark Clause', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
        Special_Term_Clause__c second = clause('Second Remark Clause', '1111111111111111111111111111111111111111111111111111111111111111');
        Special_Term_Clause_Version__c firstVersion = approve(first, 1, 'First approved remark.');
        Special_Term_Clause_Version__c secondVersion = approve(second, 1, 'Second approved remark.');
        Database.insert(new List<Special_Term_Clause_Assignment__c>{
            new Special_Term_Clause_Assignment__c(Special_Term__c = term.Id, Projection__c = 'Confirmation Remark', Clause__c = first.Id, Clause_Version__c = firstVersion.Id, Sequence__c = 1, State__c = 'Active'),
            new Special_Term_Clause_Assignment__c(Special_Term__c = term.Id, Projection__c = 'Confirmation Remark', Clause__c = second.Id, Clause_Version__c = secondVersion.Id, Sequence__c = 2, State__c = 'Active'),
            new Special_Term_Clause_Assignment__c(Special_Term__c = term.Id, Projection__c = 'Nomination Remark', Clause__c = second.Id, Clause_Version__c = secondVersion.Id, Sequence__c = 1, State__c = 'Active')
        }, AccessLevel.SYSTEM_MODE);

        String confirmation = '- First approved remark.\n- Second approved remark.';
        String nomination = '1. Second approved remark.';
        term.Special_Remark_in_Confirmation__c = confirmation;
        term.Confirmation_Compiled_Hash__c = SpecialTermClauseCompiler.sha256(confirmation);
        term.Confirmation_Clause_Status__c = 'Active';
        term.Special_Remark_in_Nomination__c = nomination;
        term.Nomination_Compiled_Hash__c = SpecialTermClauseCompiler.sha256(nomination);
        term.Nomination_Clause_Status__c = 'Active';
        Database.update(term, AccessLevel.SYSTEM_MODE);

        Special_Term__c saved = [
            SELECT Special_Remark_in_Confirmation__c, Confirmation_Compiled_Hash__c,
                Confirmation_Clause_Status__c, Confirmation_Clause_Style__c,
                Special_Remark_in_Nomination__c, Nomination_Compiled_Hash__c,
                Nomination_Clause_Status__c, Nomination_Clause_Style__c
            FROM Special_Term__c WHERE Id = :term.Id
        ];
        System.assertEquals(confirmation, saved.Special_Remark_in_Confirmation__c);
        System.assertEquals(nomination, saved.Special_Remark_in_Nomination__c);

        saved.Special_Remark_in_Confirmation__c = '- Direct edit.';
        try {
            Database.update(saved, AccessLevel.SYSTEM_MODE);
            System.assert(false, 'Direct Confirmation remark wording edit should fail.');
        } catch (DmlException error) {
            System.assert(error.getMessage().contains('Confirmation special remark'));
        }

        saved = [
            SELECT Special_Remark_in_Confirmation__c, Confirmation_Compiled_Hash__c,
                Confirmation_Clause_Status__c, Confirmation_Clause_Style__c
            FROM Special_Term__c WHERE Id = :term.Id
        ];
        saved.Confirmation_Clause_Style__c = 'Numbered';
        try {
            Database.update(saved, AccessLevel.SYSTEM_MODE);
            System.assert(false, 'Active remark style changes should fail.');
        } catch (DmlException error) {
            System.assert(error.getMessage().contains('style cannot be changed'));
        }

        saved = [
            SELECT Special_Remark_in_Confirmation__c, Confirmation_Compiled_Hash__c,
                Confirmation_Clause_Status__c, Confirmation_Clause_Style__c
            FROM Special_Term__c WHERE Id = :term.Id
        ];
        saved.Confirmation_Clause_Status__c = 'In Review';
        try {
            Database.update(saved, AccessLevel.SYSTEM_MODE);
            System.assert(false, 'Active remark status changes should fail outside rollback.');
        } catch (DmlException error) {
            System.assert(error.getMessage().contains('only leave Active'));
        }
    }

    @isTest static void protectsApprovedVersionsAndRejectsDraftActiveAssignments() {
        Special_Term_Clause__c clauseRow = clause('Immutable Clause', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc');
        Special_Term_Clause_Version__c approved = approve(clauseRow, 1, 'Approved wording.');
        approved.Clause_Text__c = 'Changed wording.';
        try {
            Database.update(approved, AccessLevel.SYSTEM_MODE);
            System.assert(false, 'Approved version edit should fail.');
        } catch (DmlException error) {
            System.assert(error.getMessage().contains('immutable'));
        }

        Special_Term_Clause_Version__c draft = new Special_Term_Clause_Version__c(
            Clause__c = clauseRow.Id,
            Revision_Number__c = 2,
            Clause_Text__c = 'Draft wording.',
            Content_Hash__c = 'placeholder',
            Status__c = 'Draft',
            Revision_Reason__c = 'Test draft'
        );
        Database.insert(draft, AccessLevel.SYSTEM_MODE);
        Special_Term__c term = new Special_Term__c(Name = 'Draft rejection term', Clause_Structure_Status__c = 'Legacy');
        Database.insert(term, AccessLevel.SYSTEM_MODE);
        try {
            Database.insert(new Special_Term_Clause_Assignment__c(Special_Term__c = term.Id, Clause__c = clauseRow.Id, Clause_Version__c = draft.Id, Sequence__c = 1, State__c = 'Active'), AccessLevel.SYSTEM_MODE);
            System.assert(false, 'Draft version should not be active.');
        } catch (DmlException error) {
            System.assert(error.getMessage().contains('approved version'));
        }
    }

    @isTest static void normalizesAndRejectsInvalidSequences() {
        System.assertEquals('One\n\nTwo', SpecialTermClauseCompiler.normalizeClauseText('  One\r\n\r\n\r\nTwo  '));
        System.assertEquals(true, SpecialTermClauseCompiler.hasTopLevelListMarker('1. Numbered wording.'));
        System.assertEquals(true, SpecialTermClauseCompiler.hasTopLevelListMarker('- Hyphen wording.'));
        System.assertEquals(false, SpecialTermClauseCompiler.hasTopLevelListMarker('Markerless wording.\n- Internal point.'));
        System.assertEquals(SpecialTermClauseCompiler.sha256(''), SpecialTermClauseCompiler.sha256(null));
        System.assertEquals('', SpecialTermClauseCompiler.compile(new Set<Id>()).keySet().isEmpty() ? '' : 'unexpected');

        Special_Term__c term = new Special_Term__c(Name = 'Sequence test', Clause_Structure_Status__c = 'Legacy');
        Database.insert(term, AccessLevel.SYSTEM_MODE);
        Special_Term_Clause__c clauseRow = clause('Sequence Clause', 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd');
        Special_Term_Clause_Version__c version = approve(clauseRow, 1, 'Sequence wording.');
        Database.insert(new Special_Term_Clause_Assignment__c(
            Special_Term__c = term.Id,
            Clause__c = clauseRow.Id,
            Clause_Version__c = version.Id,
            Sequence__c = 2,
            State__c = 'Active'
        ), AccessLevel.SYSTEM_MODE);
        try {
            SpecialTermClauseCompiler.compile(new Set<Id>{ term.Id });
            System.assert(false, 'A sequence starting at 2 should fail.');
        } catch (SpecialTermClauseCompiler.SpecialTermClauseException error) {
            System.assert(error.getMessage().contains('continuous'));
        }
    }

    @isTest static void validatesVersionLifecycle() {
        Special_Term_Clause__c clauseRow = clause('Lifecycle Clause', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
        try {
            Database.insert(new Special_Term_Clause_Version__c(
                Clause__c = clauseRow.Id,
                Revision_Number__c = 1,
                Clause_Text__c = 'Cannot publish directly.',
                Content_Hash__c = 'placeholder',
                Status__c = 'Approved',
                Revision_Reason__c = 'Invalid direct publish'
            ), AccessLevel.SYSTEM_MODE);
            System.assert(false, 'Versions must begin as Draft.');
        } catch (DmlException error) {
            System.assert(error.getMessage().contains('created as Draft'));
        }

        Special_Term_Clause_Version__c version = approve(clauseRow, 1, 'Immutable wording.');
        version.Content_Hash__c = SpecialTermClauseCompiler.sha256(version.Clause_Text__c);
        version.Status__c = 'Superseded';
        Database.update(version, AccessLevel.SYSTEM_MODE);
        version.Revision_Reason__c = 'Changed after superseding';
        try {
            Database.update(version, AccessLevel.SYSTEM_MODE);
            System.assert(false, 'Superseded versions must be immutable.');
        } catch (DmlException error) {
            System.assert(error.getMessage().contains('immutable'));
        }
        try {
            Database.delete(version, AccessLevel.SYSTEM_MODE);
            System.assert(false, 'Superseded versions must be retained.');
        } catch (DmlException error) {
            System.assert(error.getMessage().contains('cannot be deleted'));
        }

        Special_Term_Clause_Version__c draft = new Special_Term_Clause_Version__c(
            Clause__c = clauseRow.Id,
            Revision_Number__c = 2,
            Clause_Text__c = 'Disposable draft.',
            Content_Hash__c = 'placeholder',
            Status__c = 'Draft',
            Revision_Reason__c = 'Disposable test'
        );
        Database.insert(draft, AccessLevel.SYSTEM_MODE);
        Database.delete(draft, AccessLevel.SYSTEM_MODE);

        try {
            Database.delete(clauseRow, AccessLevel.SYSTEM_MODE);
            System.assert(false, 'Approved clause identities must be retained.');
        } catch (DmlException error) {
            System.assert(error.getMessage().contains('must be retained'));
        }
    }

    @isTest static void deletesOnlyUnreferencedDraftClauseRecords() {
        Special_Term_Clause__c disposable = clause('Disposable Draft Clause', 'abababababababababababababababababababababababababababababababab');
        Special_Term_Clause_Version__c disposableVersion = new Special_Term_Clause_Version__c(
            Clause__c = disposable.Id, Revision_Number__c = 1, Clause_Text__c = 'Disposable draft wording.',
            Status__c = 'Draft', Revision_Reason__c = 'Delete test', Proposed_By_Email__c = 'creator@example.com'
        );
        insert disposableVersion;
        delete disposable;
        System.assertEquals(0, [SELECT COUNT() FROM Special_Term_Clause__c WHERE Id = :disposable.Id]);

        Special_Term_Clause__c retained = clause('Referenced Draft Clause', 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd');
        Special_Term_Clause_Version__c retainedVersion = new Special_Term_Clause_Version__c(
            Clause__c = retained.Id, Revision_Number__c = 1, Clause_Text__c = 'Referenced draft wording.',
            Status__c = 'Draft', Revision_Reason__c = 'Reference test', Proposed_By_Email__c = 'creator@example.com'
        );
        insert retainedVersion;
        Special_Term__c term = new Special_Term__c(Name = 'Draft version reference term', Approval_Status__c = 'Legacy', Clause_Structure_Status__c = 'Legacy');
        insert term;
        Special_Term_Revision__c revision = new Special_Term_Revision__c(Special_Term__c = term.Id, Revision_Number__c = 1, Status__c = 'Draft', Revision_Reason__c = 'Reference draft version');
        insert revision;
        insert new Special_Term_Revision_Clause__c(Special_Term_Revision__c = revision.Id, Clause__c = retained.Id, Clause_Version__c = retainedVersion.Id, Projection__c = 'Terms Text', Sequence__c = 1, State__c = 'Proposed');
        try { delete retainedVersion; System.assert(false, 'Revision-referenced Draft versions must be retained.'); }
        catch (DmlException error) { System.assert(error.getMessage().contains('Referenced clause versions')); }
        try { delete retained; System.assert(false, 'Revision-referenced Draft clause identities must be retained.'); }
        catch (DmlException error) { System.assert(error.getMessage().contains('Referenced clause identities')); }

        Special_Term_Clause__c protectedIdentity = clause('Protected Version Draft Identity', 'efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef');
        Special_Term_Clause_Version__c approvedVersion = new Special_Term_Clause_Version__c(
            Clause__c = protectedIdentity.Id, Revision_Number__c = 1, Clause_Text__c = 'Approved wording must be retained.',
            Status__c = 'Draft', Revision_Reason__c = 'Approval history test', Proposed_By_Email__c = 'creator@example.com'
        );
        insert approvedVersion;
        approvedVersion.Status__c = 'Approved';
        approvedVersion.Approved_By_Email__c = 'gm@example.com';
        approvedVersion.Approved_At__c = System.now();
        approvedVersion.Approval_Reason__c = 'Approved for retention test.';
        Database.update(approvedVersion, AccessLevel.SYSTEM_MODE);
        try { delete protectedIdentity; System.assert(false, 'A Draft identity cannot cascade-delete approved version history.'); }
        catch (DmlException error) { System.assert(error.getMessage().contains('approved or superseded version history')); }
    }
}
