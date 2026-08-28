@isTest
private class SpecialTermClausePublicationServiceTest {
    private static Special_Term_Clause_Version__c approvedVersion(String name, String wording) {
        Special_Term_Clause__c clauseRow = new Special_Term_Clause__c(
            Name = name,
            Short_Name_Key__c = name.toLowerCase(),
            Canonical_Text_Key__c = SpecialTermClauseCompiler.sha256(wording.toLowerCase()),
            Category__c = 'Other',
            Status__c = 'Draft',
            Origin__c = 'Manual',
            Latest_Approved_Version_Number__c = 0
        );
        Database.insert(clauseRow, AccessLevel.SYSTEM_MODE);
        Special_Term_Clause_Version__c version = new Special_Term_Clause_Version__c(
            Clause__c = clauseRow.Id,
            Revision_Number__c = 1,
            Clause_Text__c = wording,
            Proposed_Short_Name__c = name,
            Proposed_Category__c = 'Other',
            Status__c = 'Draft',
            Revision_Reason__c = 'Initial test wording',
            Proposed_By_Email__c = 'author@example.com',
            Draft_Source__c = 'Manual'
        );
        Database.insert(version, AccessLevel.SYSTEM_MODE);
        version.Status__c = 'Approved';
        version.Approved_By_Email__c = 'approver@example.com';
        version.Approved_At__c = System.now();
        version.Approval_Reason__c = 'Initial test approval';
        Database.update(version, AccessLevel.SYSTEM_MODE);
        Database.update(new Special_Term_Clause__c(
            Id = clauseRow.Id,
            Status__c = 'Active',
            Latest_Approved_Version_Number__c = 1,
            Last_Approved_At__c = System.now()
        ), AccessLevel.SYSTEM_MODE);
        return [SELECT Id,Clause__c,Revision_Number__c,LastModifiedDate FROM Special_Term_Clause_Version__c WHERE Id = :version.Id];
    }

    private static Special_Term__c activateTerm(Special_Term_Clause_Version__c version, String suffix, Boolean withRule) {
        Special_Term__c term = new Special_Term__c(
            Name = 'Global publication term ' + suffix,
            Terms_Text__c = 'Legacy terms ' + suffix,
            Special_Remark_in_Confirmation__c = '- Legacy confirmation ' + suffix,
            Special_Remark_in_Nomination__c = '- Legacy nomination ' + suffix,
            Add_to_Confirmation__c = true,
            Add_to_Nomination__c = true,
            Clause_Structure_Status__c = 'Legacy',
            Confirmation_Clause_Status__c = 'Legacy',
            Nomination_Clause_Status__c = 'Legacy',
            Approval_Status__c = 'Legacy'
        );
        Database.insert(term, AccessLevel.SYSTEM_MODE);
        Special_Term_Rule__c rule;
        if (withRule) {
            rule = new Special_Term_Rule__c(Special_Term__c = term.Id, Supplier_Buyer__c = 'Buyer', Country__c = 'CHINA');
            Database.insert(rule, AccessLevel.SYSTEM_MODE);
            rule = [SELECT Id,LastModifiedDate,Supplier_Buyer__c,Country__c FROM Special_Term_Rule__c WHERE Id = :rule.Id];
        }
        Special_Term_Revision__c revision = new Special_Term_Revision__c(
            Special_Term__c = term.Id,
            Revision_Number__c = 1,
            Status__c = 'Draft',
            Revision_Reason__c = 'Initial structured test revision',
            Proposed_By_Email__c = 'author@example.com',
            Confirmation_Style__c = 'Hyphen',
            Nomination_Style__c = 'Hyphen',
            Prior_Confirmation_Style__c = 'Hyphen',
            Prior_Nomination_Style__c = 'Hyphen'
        );
        Database.insert(revision, AccessLevel.SYSTEM_MODE);
        Database.insert(new List<Special_Term_Revision_Clause__c>{
            new Special_Term_Revision_Clause__c(Special_Term_Revision__c = revision.Id, Clause__c = version.Clause__c, Clause_Version__c = version.Id, Projection__c = 'Terms Text', Sequence__c = 1, State__c = 'Proposed'),
            new Special_Term_Revision_Clause__c(Special_Term_Revision__c = revision.Id, Clause__c = version.Clause__c, Clause_Version__c = version.Id, Projection__c = 'Confirmation Remark', Sequence__c = 1, State__c = 'Proposed'),
            new Special_Term_Revision_Clause__c(Special_Term_Revision__c = revision.Id, Clause__c = version.Clause__c, Clause_Version__c = version.Id, Projection__c = 'Nomination Remark', Sequence__c = 1, State__c = 'Proposed')
        }, AccessLevel.SYSTEM_MODE);
        if (rule != null) Database.insert(new List<Special_Term_Revision_Rule__c>{
            new Special_Term_Revision_Rule__c(Special_Term_Revision__c = revision.Id, Special_Term_Rule__c = rule.Id, Snapshot_Type__c = 'Baseline', Sequence__c = 1, Audience__c = rule.Supplier_Buyer__c, Country__c = rule.Country__c, Source_Last_Modified__c = rule.LastModifiedDate, State__c = 'Proposed'),
            new Special_Term_Revision_Rule__c(Special_Term_Revision__c = revision.Id, Special_Term_Rule__c = rule.Id, Snapshot_Type__c = 'Proposed', Sequence__c = 1, Audience__c = rule.Supplier_Buyer__c, Country__c = rule.Country__c, Source_Last_Modified__c = rule.LastModifiedDate, State__c = 'Proposed')
        }, AccessLevel.SYSTEM_MODE);
        revision.Status__c = 'In Review';
        Database.update(revision, AccessLevel.SYSTEM_MODE);
        revision = [SELECT Id,LastModifiedDate FROM Special_Term_Revision__c WHERE Id = :revision.Id];
        SpecialTermRevisionService.activate(revision.Id, 'gm@example.com', 'Activate initial structured test revision.', String.valueOfGmt(revision.LastModifiedDate));
        return [SELECT Id,Current_Revision__c,LastModifiedDate FROM Special_Term__c WHERE Id = :term.Id];
    }

    private static SpecialTermClausePublicationService.PublishRequest requestFrom(
        SpecialTermClausePublicationService.PreviewResult preview,
        String shortName,
        String category,
        String wording
    ) {
        SpecialTermClausePublicationService.PublishRequest request = new SpecialTermClausePublicationService.PublishRequest();
        request.baseVersionId = preview.latestApprovedVersion.id;
        request.draftVersionId = preview.draftVersion?.id;
        request.shortName = shortName;
        request.category = category;
        request.clauseText = wording;
        request.reason = 'Publish reviewed wording everywhere.';
        request.approverEmail = 'gm@example.com';
        request.expectedImpactHash = preview.impactHash;
        request.expectedClauseLastModifiedAt = preview.clauseLastModifiedAt;
        request.expectedBaseVersionLastModifiedAt = preview.latestApprovedVersion.lastModifiedAt;
        request.expectedDraftVersionLastModifiedAt = preview.draftVersion?.lastModifiedAt;
        return request;
    }

    @isTest static void publishesAcrossAllProjectionsAndPreservesHistoryAndRules() {
        Special_Term_Clause_Version__c original = approvedVersion('Shared Delivery Notice', 'Supplier shall issue the delivery notice promptly.');
        Special_Term__c first = activateTerm(original, 'A', true);
        Special_Term__c second = activateTerm(original, 'B', false);
        Id firstRevision = first.Current_Revision__c;
        Id secondRevision = second.Current_Revision__c;
        Special_Term_Rule__c originalRule = [SELECT Id,Country__c,LastModifiedDate FROM Special_Term_Rule__c WHERE Special_Term__c = :first.Id LIMIT 1];

        SpecialTermClausePublicationService.PreviewResult preview = SpecialTermClausePublicationService.preview(original.Clause__c);
        System.assertEquals(2, preview.termCount);
        System.assertEquals(6, preview.occurrenceCount);
        System.assertEquals(0, preview.blockers.size());
        System.assertEquals(2, preview.projectionCounts.get('Terms Text'));
        SpecialTermClausePublicationService.PublishRequest request = requestFrom(
            preview,
            'Shared Delivery Notice Updated',
            'Delivery',
            'Supplier shall issue the final delivery notice without delay.'
        );

        Test.startTest();
        SpecialTermClausePublicationService.PublishResult result = SpecialTermClausePublicationService.publish(original.Clause__c, request);
        Test.stopTest();

        System.assertEquals(2, result.termCount);
        System.assertEquals(6, result.occurrenceCount);
        System.assertEquals('Approved', result.status);
        Special_Term_Clause__c clauseRow = [SELECT Name,Category__c,Latest_Approved_Version_Number__c FROM Special_Term_Clause__c WHERE Id = :original.Clause__c];
        System.assertEquals('Shared Delivery Notice Updated', clauseRow.Name);
        System.assertEquals('Delivery', clauseRow.Category__c);
        System.assertEquals(2, clauseRow.Latest_Approved_Version_Number__c);
        System.assertEquals('Superseded', [SELECT Status__c FROM Special_Term_Clause_Version__c WHERE Id = :original.Id].Status__c);
        System.assertEquals('Approved', [SELECT Status__c FROM Special_Term_Clause_Version__c WHERE Id = :result.versionId].Status__c);
        Set<Id> affectedTermIds = new Set<Id>{ first.Id, second.Id };
        for (Special_Term__c term : [SELECT Id,Current_Revision__c,Terms_Text__c,Special_Remark_in_Confirmation__c,Special_Remark_in_Nomination__c FROM Special_Term__c WHERE Id IN :affectedTermIds]) {
            System.assert(term.Terms_Text__c.contains('final delivery notice without delay'));
            System.assert(term.Special_Remark_in_Confirmation__c.contains('final delivery notice without delay'));
            System.assert(term.Special_Remark_in_Nomination__c.contains('final delivery notice without delay'));
            System.assertNotEquals(term.Id == first.Id ? firstRevision : secondRevision, term.Current_Revision__c);
        }
        System.assertEquals(6, [SELECT COUNT() FROM Special_Term_Clause_Assignment__c WHERE Clause__c = :original.Clause__c AND State__c = 'Active' AND Clause_Version__c = :result.versionId]);
        System.assertEquals(6, [SELECT COUNT() FROM Special_Term_Clause_Assignment__c WHERE Clause__c = :original.Clause__c AND State__c = 'Historical' AND Clause_Version__c = :original.Id]);
        System.assertEquals('Superseded', [SELECT Status__c FROM Special_Term_Revision__c WHERE Id = :firstRevision].Status__c);
        System.assertEquals('Superseded', [SELECT Status__c FROM Special_Term_Revision__c WHERE Id = :secondRevision].Status__c);
        Special_Term_Rule__c retainedRule = [SELECT Id,Country__c,LastModifiedDate FROM Special_Term_Rule__c WHERE Special_Term__c = :first.Id LIMIT 1];
        System.assertEquals(originalRule.Id, retainedRule.Id);
        System.assertEquals('CHINA', retainedRule.Country__c);
        System.assertEquals(2, [SELECT COUNT() FROM Special_Term_Revision_Rule__c WHERE Special_Term_Revision__r.Special_Term__c = :first.Id AND Special_Term_Revision__r.Status__c = 'Active']);
    }

    @isTest static void blocksPendingRevisionAndRollsBackEveryWrite() {
        Special_Term_Clause_Version__c original = approvedVersion('Blocked Publication Clause', 'Supplier shall retain the approved wording.');
        Special_Term__c term = activateTerm(original, 'Pending', false);
        Database.insert(new Special_Term_Revision__c(Special_Term__c = term.Id, Revision_Number__c = 2, Status__c = 'Draft', Revision_Reason__c = 'Unresolved user draft', Proposed_By_Email__c = 'user@example.com'), AccessLevel.SYSTEM_MODE);
        SpecialTermClausePublicationService.PreviewResult preview = SpecialTermClausePublicationService.preview(original.Clause__c);
        System.assertEquals(1, preview.blockers.size());
        System.assertEquals('PENDING_WHOLE_TERM_REVISION', preview.blockers[0].code);
        try {
            SpecialTermClausePublicationService.publish(original.Clause__c, requestFrom(preview, 'Blocked Publication Updated', 'Other', 'Supplier shall use changed wording.'));
            System.assert(false, 'Pending whole-term revisions must block global publication.');
        } catch (SpecialTermClausePublicationService.PublicationException error) {
            System.assert(error.getMessage().contains('Resolve the saved whole-term revision'));
        }
        System.assertEquals(1, [SELECT COUNT() FROM Special_Term_Clause_Version__c WHERE Clause__c = :original.Clause__c]);
        System.assertEquals('Approved', [SELECT Status__c FROM Special_Term_Clause_Version__c WHERE Id = :original.Id].Status__c);
    }

    @isTest static void rejectsStaleImpactAndPublishesZeroUseClause() {
        Special_Term_Clause_Version__c stale = approvedVersion('Stale Publication Clause', 'Supplier shall keep the initial notice.');
        SpecialTermClausePublicationService.PreviewResult stalePreview = SpecialTermClausePublicationService.preview(stale.Clause__c);
        Database.update(new Special_Term_Clause__c(Id = stale.Clause__c, Category__c = 'Delivery'), AccessLevel.SYSTEM_MODE);
        try {
            SpecialTermClausePublicationService.publish(stale.Clause__c, requestFrom(stalePreview, 'Stale Publication Updated', 'Delivery', 'Supplier shall issue a revised notice.'));
            System.assert(false, 'Stale publication must fail.');
        } catch (SpecialTermClausePublicationService.PublicationException error) {
            System.assert(error.getMessage().contains('changed'));
        }
        System.assertEquals(1, [SELECT COUNT() FROM Special_Term_Clause_Version__c WHERE Clause__c = :stale.Clause__c]);

        Special_Term_Clause_Version__c unused = approvedVersion('Unused Publication Clause', 'Supplier shall keep the unused wording.');
        SpecialTermClausePublicationService.PreviewResult unusedPreview = SpecialTermClausePublicationService.preview(unused.Clause__c);
        System.assertEquals(0, unusedPreview.termCount);
        SpecialTermClausePublicationService.PublishResult result = SpecialTermClausePublicationService.publish(
            unused.Clause__c,
            requestFrom(unusedPreview, 'Unused Publication Updated', 'Other', 'Supplier shall keep the revised unused wording.')
        );
        System.assertEquals(0, result.termCount);
        System.assertEquals(0, result.occurrenceCount);
        System.assertEquals(2, [SELECT COUNT() FROM Special_Term_Clause_Version__c WHERE Clause__c = :unused.Clause__c]);
    }

    @isTest static void restPreviewReturnsIdentifiersAndImpactOnly() {
        Special_Term_Clause_Version__c original = approvedVersion('REST Publication Clause', 'Supplier shall provide the REST notice.');
        RestRequest request = new RestRequest();
        request.httpMethod = 'POST';
        request.requestURI = '/services/apexrest/fcos/special-term-clauses/' + original.Clause__c + '/publication-preview';
        request.requestBody = Blob.valueOf('{}');
        RestContext.request = request;
        RestContext.response = new RestResponse();
        SpecialTermClausePublicationRest.execute();
        SpecialTermClausePublicationService.PreviewResult response =
            (SpecialTermClausePublicationService.PreviewResult) JSON.deserialize(
                RestContext.response.responseBody.toString(),
                SpecialTermClausePublicationService.PreviewResult.class
            );
        System.assertEquals(true, response.success);
        System.assertEquals(200, RestContext.response.statusCode);
        String serialized = JSON.serialize(response);
        System.assert(serialized.contains(String.valueOf(original.Clause__c)));
        System.assert(serialized.contains('impactHash'));
    }

    @isTest static void restPublishesZeroUseClauseAndRejectsUnknownAction() {
        Special_Term_Clause_Version__c original = approvedVersion('REST Publish Clause', 'Supplier shall provide the original REST wording.');
        SpecialTermClausePublicationService.PreviewResult preview = SpecialTermClausePublicationService.preview(original.Clause__c);
        SpecialTermClausePublicationService.PublishRequest publishRequest = requestFrom(
            preview,
            'REST Publish Updated',
            'Other',
            'Supplier shall provide the updated REST wording.'
        );
        RestRequest request = new RestRequest();
        request.httpMethod = 'POST';
        request.requestURI = '/services/apexrest/fcos/special-term-clauses/' + original.Clause__c + '/publish-everywhere';
        request.requestBody = Blob.valueOf(JSON.serialize(publishRequest));
        RestContext.request = request;
        RestContext.response = new RestResponse();
        SpecialTermClausePublicationRest.execute();
        System.assertEquals(200, RestContext.response.statusCode);
        SpecialTermClausePublicationService.PublishResult published =
            (SpecialTermClausePublicationService.PublishResult) JSON.deserialize(
                RestContext.response.responseBody.toString(),
                SpecialTermClausePublicationService.PublishResult.class
            );
        System.assertEquals(0, published.termCount);

        RestContext.request = new RestRequest();
        RestContext.request.httpMethod = 'POST';
        RestContext.request.requestURI = '/services/apexrest/fcos/special-term-clauses/' + original.Clause__c + '/unknown';
        RestContext.request.requestBody = Blob.valueOf('{}');
        RestContext.response = new RestResponse();
        SpecialTermClausePublicationRest.execute();
        System.assertEquals(409, RestContext.response.statusCode);
        System.assert(RestContext.response.responseBody.toString().contains('SPECIAL_TERMS_GLOBAL_PUBLICATION_REJECTED'));
    }
}
