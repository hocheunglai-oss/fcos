@isTest
private class SpecialTermRevisionServiceTest {
    private static Special_Term_Clause_Version__c approvedVersion(String name, String key, String wording) {
        Special_Term_Clause__c clauseRow = new Special_Term_Clause__c(Name = name, Short_Name_Key__c = name.toLowerCase(), Canonical_Text_Key__c = key, Category__c = 'Other', Status__c = 'Draft', Origin__c = 'Manual', Latest_Approved_Version_Number__c = 0);
        Database.insert(clauseRow, AccessLevel.SYSTEM_MODE);
        Special_Term_Clause_Version__c version = new Special_Term_Clause_Version__c(Clause__c = clauseRow.Id, Revision_Number__c = 1, Clause_Text__c = wording, Status__c = 'Draft', Revision_Reason__c = 'Test wording', Draft_Source__c = 'Manual');
        Database.insert(version, AccessLevel.SYSTEM_MODE);
        version.Status__c = 'Approved'; version.Approved_By_Email__c = 'approver@example.com'; version.Approved_At__c = System.now(); version.Approval_Reason__c = 'Test approval';
        Database.update(version, AccessLevel.SYSTEM_MODE);
        Database.update(new Special_Term_Clause__c(Id = clauseRow.Id, Status__c = 'Active', Latest_Approved_Version_Number__c = 1, Last_Approved_At__c = System.now()), AccessLevel.SYSTEM_MODE);
        return [SELECT Id, Clause__c FROM Special_Term_Clause_Version__c WHERE Id = :version.Id];
    }

    @isTest static void activatesWholeRevisionAndBlocksDirectLifecycleChanges() {
        Special_Term__c term = new Special_Term__c(Name = 'Revision lifecycle term', Terms_Text__c = 'Legacy contractual wording.', Special_Remark_in_Confirmation__c = '- Legacy confirmation.', Special_Remark_in_Nomination__c = '- Legacy nomination.', Clause_Structure_Status__c = 'Legacy', Confirmation_Clause_Status__c = 'Legacy', Nomination_Clause_Status__c = 'Legacy', Approval_Status__c = 'Legacy');
        insert term;
        Special_Term_Clause_Version__c termsVersion = approvedVersion('Revision Payment Clause', '1111111111111111111111111111111111111111111111111111111111111111', 'Buyer shall pay the final invoice when due.');
        Special_Term_Clause_Version__c confirmationVersion = approvedVersion('Revision Confirmation Clause', '2222222222222222222222222222222222222222222222222222222222222222', 'Confirmation shall be binding when issued.');
        Special_Term_Clause_Version__c nominationVersion = approvedVersion('Revision Nomination Clause', '3333333333333333333333333333333333333333333333333333333333333333', 'Nomination shall identify the receiving party.');
        Special_Term_Revision__c revision = new Special_Term_Revision__c(Special_Term__c = term.Id, Revision_Number__c = 1, Status__c = 'Draft', Revision_Reason__c = 'Structured migration', Proposed_By_Email__c = 'drafter@example.com');
        insert revision;
        insert new List<Special_Term_Revision_Clause__c>{
            new Special_Term_Revision_Clause__c(Special_Term_Revision__c = revision.Id, Clause__c = termsVersion.Clause__c, Clause_Version__c = termsVersion.Id, Projection__c = 'Terms Text', Sequence__c = 1, State__c = 'Proposed'),
            new Special_Term_Revision_Clause__c(Special_Term_Revision__c = revision.Id, Clause__c = confirmationVersion.Clause__c, Clause_Version__c = confirmationVersion.Id, Projection__c = 'Confirmation Remark', Sequence__c = 1, State__c = 'Proposed'),
            new Special_Term_Revision_Clause__c(Special_Term_Revision__c = revision.Id, Clause__c = nominationVersion.Clause__c, Clause_Version__c = nominationVersion.Id, Projection__c = 'Nomination Remark', Sequence__c = 1, State__c = 'Proposed')
        };
        revision.Status__c = 'In Review'; Database.update(revision, AccessLevel.SYSTEM_MODE);
        revision = [SELECT Id, LastModifiedDate FROM Special_Term_Revision__c WHERE Id = :revision.Id];
        Test.startTest(); SpecialTermRevisionService.activate(revision.Id, 'gm@example.com', 'Approved as a complete revision.', String.valueOfGmt(revision.LastModifiedDate)); Test.stopTest();
        term = [SELECT Approval_Status__c, Current_Revision__c, Terms_Text__c, Special_Remark_in_Confirmation__c, Special_Remark_in_Nomination__c, Original_Terms_Text__c, Clause_Structure_Status__c FROM Special_Term__c WHERE Id = :term.Id];
        System.assertEquals('Approved', term.Approval_Status__c);
        System.assertEquals(revision.Id, term.Current_Revision__c);
        System.assertEquals('1. Buyer shall pay the final invoice when due.', term.Terms_Text__c);
        System.assertEquals('- Confirmation shall be binding when issued.', term.Special_Remark_in_Confirmation__c);
        System.assertEquals('- Nomination shall identify the receiving party.', term.Special_Remark_in_Nomination__c);
        System.assertEquals('Legacy contractual wording.', term.Original_Terms_Text__c);
        System.assertEquals(3, [SELECT COUNT() FROM Special_Term_Clause_Assignment__c WHERE Special_Term__c = :term.Id AND State__c = 'Active']);
        term.Approval_Status__c = 'Legacy';
        try { update term; System.assert(false, 'Direct lifecycle change must fail.'); } catch (DmlException error) { System.assert(error.getMessage().contains('controlled FCOS revision action')); }
    }

    @isTest static void rollbackRestoresOriginalWholeTerm() {
        Special_Term__c term = new Special_Term__c(Name = 'Rollback revision term', Terms_Text__c = 'Legacy wording.', Add_to_Confirmation__c = false, Add_to_Nomination__c = false, Clause_Structure_Status__c = 'Legacy', Confirmation_Clause_Status__c = 'Legacy', Nomination_Clause_Status__c = 'Legacy', Approval_Status__c = 'Legacy'); insert term;
        Special_Term_Clause_Version__c version = approvedVersion('Rollback Clause', '4444444444444444444444444444444444444444444444444444444444444444', 'Approved replacement wording.');
        Special_Term_Revision__c revision = new Special_Term_Revision__c(Special_Term__c = term.Id, Revision_Number__c = 1, Status__c = 'Draft', Revision_Reason__c = 'Rollback coverage'); insert revision;
        revision.Status__c = 'In Review'; Database.update(revision, AccessLevel.SYSTEM_MODE);
        insert new Special_Term_Revision_Clause__c(Special_Term_Revision__c = revision.Id, Clause__c = version.Clause__c, Clause_Version__c = version.Id, Projection__c = 'Terms Text', Sequence__c = 1, State__c = 'Proposed');
        revision = [SELECT Id, LastModifiedDate FROM Special_Term_Revision__c WHERE Id = :revision.Id];
        SpecialTermRevisionService.activate(revision.Id, 'gm@example.com', 'Activate test revision.', String.valueOfGmt(revision.LastModifiedDate));
        revision = [SELECT Id, LastModifiedDate FROM Special_Term_Revision__c WHERE Id = :revision.Id];
        SpecialTermRevisionService.rollback(revision.Id, 'Restore original wording.', String.valueOfGmt(revision.LastModifiedDate));
        term = [SELECT Approval_Status__c, Current_Revision__c, Terms_Text__c, Clause_Structure_Status__c FROM Special_Term__c WHERE Id = :term.Id];
        System.assertEquals('Legacy', term.Approval_Status__c);
        System.assertEquals(null, term.Current_Revision__c);
        System.assertEquals('Legacy wording.', term.Terms_Text__c);
        System.assertEquals('Legacy', term.Clause_Structure_Status__c);
        System.assertEquals(0, [SELECT COUNT() FROM Special_Term_Clause_Assignment__c WHERE Special_Term__c = :term.Id AND State__c = 'Active']);
        System.assertEquals('Rolled Back', [SELECT Status__c FROM Special_Term_Revision__c WHERE Id = :revision.Id].Status__c);
    }

    @isTest static void rejectsActivatedRevisionClauseDirectEdit() {
        Special_Term__c term = new Special_Term__c(Name = 'Revision direct edit term', Add_to_Confirmation__c = false, Add_to_Nomination__c = false, Clause_Structure_Status__c = 'Legacy', Confirmation_Clause_Status__c = 'Legacy', Nomination_Clause_Status__c = 'Legacy', Approval_Status__c = 'Legacy'); insert term;
        Special_Term_Clause_Version__c version = approvedVersion('Revision Direct Clause', '5555555555555555555555555555555555555555555555555555555555555555', 'Approved wording.');
        Special_Term_Revision__c revision = new Special_Term_Revision__c(Special_Term__c = term.Id, Revision_Number__c = 1, Status__c = 'Draft', Revision_Reason__c = 'Direct edit coverage'); insert revision;
        revision.Status__c = 'In Review'; Database.update(revision, AccessLevel.SYSTEM_MODE);
        Special_Term_Revision_Clause__c row = new Special_Term_Revision_Clause__c(Special_Term_Revision__c = revision.Id, Clause__c = version.Clause__c, Clause_Version__c = version.Id, Projection__c = 'Terms Text', Sequence__c = 1, State__c = 'Proposed'); insert row;
        revision = [SELECT Id, LastModifiedDate FROM Special_Term_Revision__c WHERE Id = :revision.Id];
        SpecialTermRevisionService.activate(revision.Id, 'gm@example.com', 'Activate test revision.', String.valueOfGmt(revision.LastModifiedDate));
        row = [SELECT Id, Special_Term_Revision__c, Clause__c, Clause_Version__c, Projection__c, Sequence__c, State__c FROM Special_Term_Revision_Clause__c WHERE Id = :row.Id]; row.Sequence__c = 2;
        Database.SaveResult protectedEdit = Database.update(row, false, AccessLevel.SYSTEM_MODE);
        System.assertEquals(false, protectedEdit.isSuccess(), 'Active revision clauses are immutable.');
        System.assert(protectedEdit.getErrors().size() > 0, 'Protected edit must return a validation error.');
    }

    @isTest static void protectsApprovedRulesAndRevisionRuleSnapshots() {
        Special_Term__c term = new Special_Term__c(Name = 'Revision rule term', Add_to_Confirmation__c = false, Add_to_Nomination__c = false, Clause_Structure_Status__c = 'Legacy', Confirmation_Clause_Status__c = 'Legacy', Nomination_Clause_Status__c = 'Legacy', Approval_Status__c = 'Legacy');
        insert term;
        Special_Term_Rule__c rule = new Special_Term_Rule__c(Special_Term__c = term.Id, Supplier_Buyer__c = 'Buyer', Country__c = 'ARGENTINA');
        insert rule;
        rule = [SELECT Id, LastModifiedDate, Supplier_Buyer__c, Country__c FROM Special_Term_Rule__c WHERE Id = :rule.Id];
        Special_Term_Revision__c revision = new Special_Term_Revision__c(Special_Term__c = term.Id, Revision_Number__c = 1, Status__c = 'Draft', Revision_Reason__c = 'Rule snapshot coverage');
        insert revision;
        Special_Term_Revision_Rule__c snapshot = new Special_Term_Revision_Rule__c(Special_Term_Revision__c = revision.Id, Special_Term_Rule__c = rule.Id, Snapshot_Type__c = 'Baseline', Sequence__c = 1, Audience__c = 'Buyer', Country__c = 'ARGENTINA', Source_Last_Modified__c = rule.LastModifiedDate, State__c = 'Proposed');
        Special_Term_Revision_Rule__c proposal = new Special_Term_Revision_Rule__c(Special_Term_Revision__c = revision.Id, Special_Term_Rule__c = rule.Id, Snapshot_Type__c = 'Proposed', Sequence__c = 1, Audience__c = 'Buyer', Country__c = 'AUSTRALIA', Source_Last_Modified__c = rule.LastModifiedDate, State__c = 'Proposed');
        insert new List<Special_Term_Revision_Rule__c>{ snapshot, proposal };
        revision.Status__c = 'In Review'; Database.update(revision, AccessLevel.SYSTEM_MODE);
        revision = [SELECT Id, LastModifiedDate FROM Special_Term_Revision__c WHERE Id = :revision.Id];
        SpecialTermRevisionService.activate(revision.Id, 'gm@example.com', 'Approve rule snapshot.', String.valueOfGmt(revision.LastModifiedDate));
        snapshot = [SELECT Id, State__c FROM Special_Term_Revision_Rule__c WHERE Id = :snapshot.Id];
        System.assertEquals('Active', snapshot.State__c);
        Special_Term_Rule__c activatedRule = [SELECT Country__c FROM Special_Term_Rule__c WHERE Special_Term__c = :term.Id LIMIT 1];
        System.assertEquals('AUSTRALIA', activatedRule.Country__c, 'Approval must atomically materialize the proposed rule snapshot.');
        snapshot.State__c = 'Proposed';
        try { Database.update(snapshot, AccessLevel.SYSTEM_MODE); System.assert(false, 'Active revision rules are immutable.'); } catch (DmlException error) { System.assert(error.getMessage().contains('immutable')); }
        activatedRule.Country__c = 'CHINA';
        try { Database.update(activatedRule, AccessLevel.SYSTEM_MODE); System.assert(false, 'Approved term rules must be frozen.'); } catch (DmlException error) { System.assert(error.getMessage().contains('frozen')); }
    }

    @isTest static void restEndpointRequiresExactActionAndReturnsOnlyIdentifiers() {
        Special_Term__c term = new Special_Term__c(Name = 'REST revision term', Add_to_Confirmation__c = false, Add_to_Nomination__c = false, Clause_Structure_Status__c = 'Legacy', Confirmation_Clause_Status__c = 'Legacy', Nomination_Clause_Status__c = 'Legacy', Approval_Status__c = 'Legacy'); insert term;
        Special_Term_Clause_Version__c version = approvedVersion('REST Clause', '6666666666666666666666666666666666666666666666666666666666666666', 'REST approved wording.');
        Special_Term_Revision__c revision = new Special_Term_Revision__c(Special_Term__c = term.Id, Revision_Number__c = 1, Status__c = 'Draft', Revision_Reason__c = 'REST coverage'); insert revision;
        revision.Status__c = 'In Review'; Database.update(revision, AccessLevel.SYSTEM_MODE);
        insert new Special_Term_Revision_Clause__c(Special_Term_Revision__c = revision.Id, Clause__c = version.Clause__c, Clause_Version__c = version.Id, Projection__c = 'Terms Text', Sequence__c = 1, State__c = 'Proposed');
        revision = [SELECT Id, LastModifiedDate FROM Special_Term_Revision__c WHERE Id = :revision.Id];
        RestRequest request = new RestRequest(); request.httpMethod = 'POST'; request.requestURI = '/services/apexrest/fcos/special-term-revisions/' + revision.Id + '/activate'; request.requestBody = Blob.valueOf(JSON.serialize(new Map<String, Object>{ 'termId' => term.Id, 'approverEmail' => 'gm@example.com', 'reason' => 'REST approval.', 'expectedLastModifiedAt' => String.valueOfGmt(revision.LastModifiedDate) }));
        RestContext.request = request; RestContext.response = new RestResponse();
        Test.startTest(); SpecialTermRevisionRest.ResponseBody response = SpecialTermRevisionRest.execute(); Test.stopTest();
        System.assertEquals(true, response.success); System.assertEquals(revision.Id, response.revisionId); System.assertEquals(term.Id, response.termId); System.assertEquals('Active', response.status); System.assertEquals(200, RestContext.response.statusCode);
        request = new RestRequest(); request.httpMethod = 'POST'; request.requestURI = '/services/apexrest/fcos/special-term-revisions/' + revision.Id + '/delete'; request.requestBody = Blob.valueOf('{}');
        RestContext.request = request; RestContext.response = new RestResponse();
        response = SpecialTermRevisionRest.execute();
        System.assertEquals(false, response.success); System.assertEquals(400, RestContext.response.statusCode);
    }

    @isTest static void rejectsStaleRevisionActivation() {
        Special_Term__c term = new Special_Term__c(Name = 'Stale revision term', Add_to_Confirmation__c = false, Add_to_Nomination__c = false, Clause_Structure_Status__c = 'Legacy', Confirmation_Clause_Status__c = 'Legacy', Nomination_Clause_Status__c = 'Legacy', Approval_Status__c = 'Legacy'); insert term;
        Special_Term_Clause_Version__c version = approvedVersion('Stale Clause', '7777777777777777777777777777777777777777777777777777777777777777', 'Stale approved wording.');
        Special_Term_Revision__c revision = new Special_Term_Revision__c(Special_Term__c = term.Id, Revision_Number__c = 1, Status__c = 'Draft', Revision_Reason__c = 'Stale coverage'); insert revision;
        revision.Status__c = 'In Review'; Database.update(revision, AccessLevel.SYSTEM_MODE);
        insert new Special_Term_Revision_Clause__c(Special_Term_Revision__c = revision.Id, Clause__c = version.Clause__c, Clause_Version__c = version.Id, Projection__c = 'Terms Text', Sequence__c = 1, State__c = 'Proposed');
        try { SpecialTermRevisionService.activate(revision.Id, 'gm@example.com', 'Stale test.', '2000-01-01 00:00:00'); System.assert(false, 'Stale activation must fail.'); } catch (SpecialTermRevisionService.RevisionException error) { System.assert(error.getMessage().contains('changed after it was opened')); }
    }
}
