@isTest
private class SpecialTermConsolidationTest {
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
            Status__c = 'Draft',
            Revision_Reason__c = 'Test revision'
        );
        Database.insert(version, AccessLevel.SYSTEM_MODE);
        version.Status__c = 'Approved';
        version.Approved_By_Email__c = 'approver@example.com';
        version.Approved_At__c = System.now();
        version.Approval_Reason__c = 'Approved for consolidation test';
        Database.update(version, AccessLevel.SYSTEM_MODE);
        clauseRow.Status__c = 'Active';
        clauseRow.Latest_Approved_Version_Number__c = revision;
        clauseRow.Last_Approved_At__c = System.now();
        Database.update(clauseRow, AccessLevel.SYSTEM_MODE);
        return [SELECT Id, Clause__c, Revision_Number__c, Status__c, Content_Hash__c FROM Special_Term_Clause_Version__c WHERE Id = :version.Id];
    }

    @isTest static void retainsMappingsAndBlocksNewSourceApproval() {
        Special_Term_Clause__c source = clause('Source Equivalent Clause', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
        Special_Term_Clause__c replacement = clause('Replacement Equivalent Clause', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
        Special_Term_Clause_Version__c sourceVersion = approve(source, 1, 'Buyer shall pay within 14 days.');
        Special_Term_Clause_Version__c replacementVersion = approve(replacement, 1, 'Buyer shall pay within 14 days.');
        Special_Term_Clause_Consolidation__c consolidation = new Special_Term_Clause_Consolidation__c(
            Consolidation_Key__c = source.Id + ':test',
            Source_Clause__c = source.Id,
            Replacement_Clause__c = replacement.Id,
            Replacement_Version__c = replacementVersion.Id,
            Status__c = 'Relinking',
            Reason__c = 'Equivalent wording is duplicated.',
            Confirmed_By_Email__c = 'approver@example.com',
            Confirmed_At__c = System.now()
        );
        Database.insert(consolidation, AccessLevel.SYSTEM_MODE);
        Special_Term_Clause_Consolidation_Map__c mapping = new Special_Term_Clause_Consolidation_Map__c(
            Consolidation__c = consolidation.Id,
            Source_Version__c = sourceVersion.Id,
            Replacement_Version__c = replacementVersion.Id,
            Equivalence_Status__c = 'Exact Normalized',
            Mapping_Key__c = sourceVersion.Id + ':' + replacementVersion.Id,
            Source_Content_Hash__c = sourceVersion.Content_Hash__c,
            Replacement_Content_Hash__c = replacementVersion.Content_Hash__c,
            Confirmed_By_Email__c = 'approver@example.com',
            Confirmed_At__c = System.now()
        );
        Database.insert(mapping, AccessLevel.SYSTEM_MODE);

        source.Status__c = 'Retired';
        try {
            Database.update(source, AccessLevel.SYSTEM_MODE);
            System.assert(false, 'The source cannot retire before relinking completes.');
        } catch (DmlException error) {
            System.assert(error.getMessage().contains('open consolidation'));
        }

        mapping.Equivalence_Status__c = 'Approved Equivalent';
        try {
            Database.update(mapping, AccessLevel.SYSTEM_MODE);
            System.assert(false, 'Reviewed version mappings must be immutable.');
        } catch (DmlException error) {
            System.assert(error.getMessage().contains('immutable'));
        }

        Special_Term_Clause_Version__c nextVersion = new Special_Term_Clause_Version__c(
            Clause__c = source.Id,
            Revision_Number__c = 2,
            Clause_Text__c = 'Buyer shall pay within 14 days after invoice.',
            Status__c = 'Draft',
            Revision_Reason__c = 'Attempt during consolidation'
        );
        Database.insert(nextVersion, AccessLevel.SYSTEM_MODE);
        nextVersion.Status__c = 'Approved';
        nextVersion.Approved_By_Email__c = 'approver@example.com';
        nextVersion.Approved_At__c = System.now();
        nextVersion.Approval_Reason__c = 'Should be blocked';
        try {
            Database.update(nextVersion, AccessLevel.SYSTEM_MODE);
            System.assert(false, 'Source approval must pause until consolidation is cancelled.');
        } catch (DmlException error) {
            System.assert(error.getMessage().contains('Cancel the active clause consolidation'));
        }

        try {
            Database.delete(consolidation, AccessLevel.SYSTEM_MODE);
            System.assert(false, 'Consolidation lineage must be retained.');
        } catch (DmlException error) {
            System.assert(error.getMessage().contains('must be retained'));
        }
    }

    @isTest static void pausesWhenReplacementReceivesNewApproval() {
        Special_Term_Clause__c source = clause('Pause Source Clause', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
        Special_Term_Clause__c replacement = clause('Pause Target Clause', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
        approve(source, 1, 'Supplier shall provide notice promptly.');
        Special_Term_Clause_Version__c firstTarget = approve(replacement, 1, 'Supplier shall provide notice promptly.');
        Special_Term_Clause_Consolidation__c consolidation = new Special_Term_Clause_Consolidation__c(
            Consolidation_Key__c = source.Id + ':pause', Source_Clause__c = source.Id,
            Replacement_Clause__c = replacement.Id, Replacement_Version__c = firstTarget.Id,
            Status__c = 'Relinking', Reason__c = 'Pause target test',
            Confirmed_By_Email__c = 'approver@example.com', Confirmed_At__c = System.now()
        );
        Database.insert(consolidation, AccessLevel.SYSTEM_MODE);
        firstTarget.Status__c = 'Superseded';
        Database.update(firstTarget, AccessLevel.SYSTEM_MODE);
        Special_Term_Clause_Version__c nextTarget = new Special_Term_Clause_Version__c(
            Clause__c = replacement.Id, Revision_Number__c = 2,
            Clause_Text__c = 'Supplier shall provide notice without delay.', Status__c = 'Draft', Revision_Reason__c = 'New target wording'
        );
        Database.insert(nextTarget, AccessLevel.SYSTEM_MODE);
        nextTarget.Status__c = 'Approved';
        nextTarget.Approved_By_Email__c = 'approver@example.com';
        nextTarget.Approved_At__c = System.now();
        nextTarget.Approval_Reason__c = 'Approved new target wording';
        Database.update(nextTarget, AccessLevel.SYSTEM_MODE);
        System.assertEquals('Paused', [SELECT Status__c FROM Special_Term_Clause_Consolidation__c WHERE Id = :consolidation.Id].Status__c);
    }

    @isTest static void enforcesFinalLifecycleMetadata() {
        Special_Term_Clause__c source = clause('Lifecycle Source Clause', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc');
        Special_Term_Clause__c replacement = clause('Lifecycle Target Clause', 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd');
        approve(source, 1, 'Supplier shall provide notice.');
        Special_Term_Clause_Version__c replacementVersion = approve(replacement, 1, 'Supplier shall provide notice.');
        Special_Term_Clause_Consolidation__c consolidation = new Special_Term_Clause_Consolidation__c(
            Consolidation_Key__c = source.Id + ':lifecycle', Source_Clause__c = source.Id,
            Replacement_Clause__c = replacement.Id, Replacement_Version__c = replacementVersion.Id,
            Status__c = 'Relinking', Reason__c = 'Lifecycle test',
            Confirmed_By_Email__c = 'approver@example.com', Confirmed_At__c = System.now()
        );
        Database.insert(consolidation, AccessLevel.SYSTEM_MODE);
        consolidation.Status__c = 'Ready to Retire';
        Database.update(consolidation, AccessLevel.SYSTEM_MODE);
        consolidation.Status__c = 'Completed';
        try {
            Database.update(consolidation, AccessLevel.SYSTEM_MODE);
            System.assert(false, 'Completion identity is required.');
        } catch (DmlException error) {
            System.assert(error.getMessage().contains('completion identity'));
        }
        consolidation.Completed_By_Email__c = 'approver@example.com';
        consolidation.Completed_At__c = System.now();
        Database.update(consolidation, AccessLevel.SYSTEM_MODE);
        consolidation.Reason__c = 'Cannot change closed lineage';
        try {
            Database.update(consolidation, AccessLevel.SYSTEM_MODE);
            System.assert(false, 'Completed records must be immutable.');
        } catch (DmlException error) {
            System.assert(error.getMessage().contains('immutable') || error.getMessage().contains('lifecycle transition'));
        }
    }
}
