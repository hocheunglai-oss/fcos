public without sharing class SpecialTermClausePublicationService {
    public class PublicationException extends Exception {}

    public class VersionSummary {
        public String id;
        public Integer revisionNumber;
        public String clauseText;
        public String proposedShortName;
        public String proposedCategory;
        public String status;
        public String lastModifiedAt;
    }

    public class OccurrenceSummary {
        public String projection;
        public Integer sequence;
        public String sourceVersionId;
        public Integer sourceRevisionNumber;
    }

    public class TermSummary {
        public String termId;
        public String termName;
        public String lastModifiedAt;
        public List<OccurrenceSummary> occurrences = new List<OccurrenceSummary>();
    }

    public class Blocker {
        public String code;
        public String message;
        public String termId;
        public String termName;
        public String revisionId;
        public String revisionStatus;
    }

    public class PreviewResult {
        public Boolean success = true;
        public String clauseId;
        public String shortName;
        public String category;
        public String status;
        public String clauseLastModifiedAt;
        public String impactHash;
        public Integer termCount = 0;
        public Integer occurrenceCount = 0;
        public Integer projectedDmlRows = 0;
        public Map<String, Integer> projectionCounts = new Map<String, Integer>();
        public Map<String, Integer> sourceVersionCounts = new Map<String, Integer>();
        public VersionSummary latestApprovedVersion;
        public VersionSummary draftVersion;
        public List<TermSummary> terms = new List<TermSummary>();
        public List<Blocker> blockers = new List<Blocker>();
    }

    public class PublishRequest {
        public String baseVersionId;
        public String draftVersionId;
        public String shortName;
        public String category;
        public String clauseText;
        public String reason;
        public String approverEmail;
        public String expectedImpactHash;
        public String expectedClauseLastModifiedAt;
        public String expectedBaseVersionLastModifiedAt;
        public String expectedDraftVersionLastModifiedAt;
    }

    public class PublishResult {
        public Boolean success = true;
        public String clauseId;
        public String versionId;
        public Integer revisionNumber;
        public String status;
        public Integer termCount;
        public Integer occurrenceCount;
        public List<String> termIds = new List<String>();
    }

    private class PublicationContext {
        public Special_Term_Clause__c clause;
        public List<Special_Term_Clause_Version__c> versions = new List<Special_Term_Clause_Version__c>();
        public Special_Term_Clause_Version__c latestApproved;
        public Special_Term_Clause_Version__c draft;
        public List<Special_Term_Clause_Assignment__c> sourceAssignments = new List<Special_Term_Clause_Assignment__c>();
        public List<Special_Term__c> terms = new List<Special_Term__c>();
        public List<Special_Term_Clause_Assignment__c> assignments = new List<Special_Term_Clause_Assignment__c>();
        public List<Special_Term_Rule__c> rules = new List<Special_Term_Rule__c>();
        public List<Special_Term_Revision__c> currentRevisions = new List<Special_Term_Revision__c>();
        public List<Special_Term_Revision__c> pendingRevisions = new List<Special_Term_Revision__c>();
        public List<Special_Term_Clause_Consolidation__c> consolidations = new List<Special_Term_Clause_Consolidation__c>();
        public Set<Id> termIds = new Set<Id>();
    }

    private static final Set<String> CATEGORIES = new Set<String>{
        'Delivery', 'Quantity and Measurement', 'Quality and Claims', 'Pricing and Payment',
        'Cancellation and Penalties', 'Product and Specification', 'Operations and Logistics',
        'Compliance and Warranty', 'Contract Priority', 'Other'
    };
    private static final Set<String> PENDING_REVISION_STATUSES = new Set<String>{ 'Draft', 'In Review', 'Approved' };
    private static final Integer SAFE_DML_ROW_LIMIT = 8000;
    private static final Integer SAFE_QUERY_ROW_LIMIT = 12000;

    private static void require(Boolean condition, String message) {
        if (!condition) throw new PublicationException(message);
    }

    private static String timestamp(Datetime value) {
        return value == null ? '' : value.formatGmt('yyyy-MM-dd\'T\'HH:mm:ss.SSS\'Z\'');
    }

    private static Boolean matchesExpected(Datetime live, String expected) {
        if (live == null || String.isBlank(expected)) return false;
        return expected == String.valueOfGmt(live)
            || expected == live.formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'')
            || expected == timestamp(live);
    }

    private static String normalizedShortName(String value) {
        String normalized = String.isBlank(value) ? '' : value.trim().replaceAll('\\s+', ' ');
        List<String> words = String.isBlank(normalized) ? new List<String>() : normalized.split(' ');
        require(normalized.length() >= 3 && words.size() >= 3 && words.size() <= 7, 'Clause short name must contain 3 to 7 concise, action-oriented words.');
        require(!Pattern.matches('^\\d+[.):].*$', normalized), 'Clause short name must not begin with a number.');
        return normalized;
    }

    private static String shortNameKey(String value) {
        return normalizedShortName(value).toLowerCase();
    }

    private static String normalizedClauseText(String value) {
        String normalized = SpecialTermClauseCompiler.normalizeClauseText(value);
        require(!String.isBlank(normalized) && normalized.length() >= 3, 'Clause text must contain at least three characters.');
        require(!SpecialTermClauseCompiler.hasTopLevelListMarker(normalized), 'Clause text cannot contain its own top-level number or hyphen marker.');
        return normalized;
    }

    private static String canonicalTextKey(String value) {
        return SpecialTermClauseCompiler.sha256(normalizedClauseText(value).toLowerCase().replaceAll('\\s+', ' ').trim());
    }

    private static String querySuffix(Boolean lockRows) {
        return lockRows ? ' FOR UPDATE' : '';
    }

    private static String ordered(String orderBy, Boolean lockRows) {
        return lockRows ? '' : ' ORDER BY ' + orderBy;
    }

    private static PublicationContext loadContext(Id clauseId, Boolean lockRows) {
        require(clauseId != null, 'Clause is required.');
        PublicationContext context = new PublicationContext();
        String suffix = querySuffix(lockRows);
        List<Special_Term_Clause__c> clauseRows = Database.query(
            'SELECT Id,Name,Short_Name_Key__c,Canonical_Text_Key__c,Category__c,Status__c,Latest_Approved_Version_Number__c,Last_Approved_At__c,LastModifiedDate '
            + 'FROM Special_Term_Clause__c WHERE Id = :clauseId' + suffix
        );
        require(!clauseRows.isEmpty(), 'Clause no longer exists.');
        context.clause = clauseRows[0];
        context.versions = Database.query(
            'SELECT Id,Clause__c,Revision_Number__c,Clause_Text__c,Content_Hash__c,Status__c,Revision_Reason__c,Proposed_By_Email__c,'
            + 'Proposed_Short_Name__c,Proposed_Category__c,Approved_By_Email__c,Approved_At__c,Approval_Reason__c,LastModifiedDate '
            + 'FROM Special_Term_Clause_Version__c WHERE Clause__c = :clauseId' + ordered('Revision_Number__c DESC,Id', lockRows) + suffix
        );
        for (Special_Term_Clause_Version__c version : context.versions) {
            if (context.latestApproved == null && version.Status__c == 'Approved') context.latestApproved = version;
            if (context.draft == null && version.Status__c == 'Draft') context.draft = version;
        }
        context.sourceAssignments = Database.query(
            'SELECT Id,Special_Term__c,Projection__c,Sequence__c,Clause__c,Clause_Version__c,Clause_Version__r.Revision_Number__c,LastModifiedDate '
            + 'FROM Special_Term_Clause_Assignment__c WHERE Clause__c = :clauseId AND State__c = \'Active\''
            + ordered('Special_Term__c,Projection__c,Sequence__c,Id', lockRows) + suffix
        );
        for (Special_Term_Clause_Assignment__c assignment : context.sourceAssignments) context.termIds.add(assignment.Special_Term__c);
        if (!context.termIds.isEmpty()) {
            Set<Id> termIds = context.termIds;
            context.terms = Database.query(
                'SELECT Id,Name,Approval_Status__c,Current_Revision__c,Clause_Structure_Status__c,Confirmation_Clause_Status__c,Nomination_Clause_Status__c,'
                + 'Confirmation_Clause_Style__c,Nomination_Clause_Style__c,Terms_Text__c,Special_Remark_in_Confirmation__c,Special_Remark_in_Nomination__c,'
                + 'Original_Terms_Text__c,Original_Confirmation_Remark__c,Original_Nomination_Remark__c,LastModifiedDate '
                + 'FROM Special_Term__c WHERE Id IN :termIds' + ordered('Id', lockRows) + suffix
            );
            context.assignments = Database.query(
                'SELECT Id,Special_Term__c,Projection__c,Sequence__c,Clause__c,Clause_Version__c,Clause_Version__r.Revision_Number__c,LastModifiedDate '
                + 'FROM Special_Term_Clause_Assignment__c WHERE Special_Term__c IN :termIds AND State__c = \'Active\''
                + ordered('Special_Term__c,Projection__c,Sequence__c,Id', lockRows) + suffix
            );
            context.rules = Database.query(
                'SELECT Id,Special_Term__c,Supplier_Buyer__c,Account__c,Port__c,Product__c,Country__c,Priority__c,LastModifiedDate '
                + 'FROM Special_Term_Rule__c WHERE Special_Term__c IN :termIds' + ordered('Special_Term__c,Priority__c,Id', lockRows) + suffix
            );
            Set<Id> currentRevisionIds = new Set<Id>();
            for (Special_Term__c term : context.terms) if (term.Current_Revision__c != null) currentRevisionIds.add(term.Current_Revision__c);
            if (!currentRevisionIds.isEmpty()) {
                context.currentRevisions = Database.query(
                    'SELECT Id,Special_Term__c,Revision_Number__c,Status__c,LastModifiedDate FROM Special_Term_Revision__c '
                    + 'WHERE Id IN :currentRevisionIds' + ordered('Id', lockRows) + suffix
                );
            }
            Set<String> pendingStatuses = PENDING_REVISION_STATUSES;
            context.pendingRevisions = Database.query(
                'SELECT Id,Special_Term__c,Revision_Number__c,Status__c,LastModifiedDate FROM Special_Term_Revision__c '
                + 'WHERE Special_Term__c IN :termIds AND Status__c IN :pendingStatuses' + ordered('Special_Term__c,Revision_Number__c,Id', lockRows) + suffix
            );
        }
        context.consolidations = Database.query(
            'SELECT Id,Source_Clause__c,Replacement_Clause__c,Status__c,LastModifiedDate FROM Special_Term_Clause_Consolidation__c '
            + 'WHERE (Source_Clause__c = :clauseId OR Replacement_Clause__c = :clauseId) '
            + 'AND Status__c IN (\'Relinking\',\'Paused\',\'Ready to Retire\')' + ordered('Id', lockRows) + suffix
        );
        return context;
    }

    private static String impactHash(PublicationContext context) {
        List<String> rows = new List<String>();
        rows.add('clause|' + context.clause.Id + '|' + context.clause.Name + '|' + context.clause.Category__c + '|'
            + context.clause.Short_Name_Key__c + '|' + context.clause.Canonical_Text_Key__c + '|'
            + context.clause.Status__c + '|' + String.valueOf(context.clause.LastModifiedDate.getTime()));
        for (Special_Term_Clause_Version__c version : context.versions) rows.add('version|' + version.Id + '|' + version.Status__c + '|' + String.valueOf(version.Revision_Number__c) + '|' + String.valueOf(version.LastModifiedDate.getTime()));
        for (Special_Term__c term : context.terms) rows.add('term|' + term.Id + '|' + term.Approval_Status__c + '|' + term.Current_Revision__c + '|' + String.valueOf(term.LastModifiedDate.getTime()));
        for (Special_Term_Clause_Assignment__c assignment : context.assignments) rows.add('assignment|' + assignment.Id + '|' + assignment.Special_Term__c + '|' + assignment.Projection__c + '|' + assignment.Sequence__c + '|' + assignment.Clause__c + '|' + assignment.Clause_Version__c + '|' + String.valueOf(assignment.LastModifiedDate.getTime()));
        for (Special_Term_Rule__c rule : context.rules) rows.add('rule|' + rule.Id + '|' + rule.Special_Term__c + '|' + String.valueOf(rule.LastModifiedDate.getTime()));
        for (Special_Term_Revision__c revision : context.currentRevisions) rows.add('currentRevision|' + revision.Id + '|' + revision.Special_Term__c + '|' + revision.Status__c + '|' + String.valueOf(revision.LastModifiedDate.getTime()));
        for (Special_Term_Revision__c revision : context.pendingRevisions) rows.add('pendingRevision|' + revision.Id + '|' + revision.Special_Term__c + '|' + revision.Status__c + '|' + String.valueOf(revision.LastModifiedDate.getTime()));
        for (Special_Term_Clause_Consolidation__c consolidation : context.consolidations) rows.add('consolidation|' + consolidation.Id + '|' + consolidation.Status__c + '|' + String.valueOf(consolidation.LastModifiedDate.getTime()));
        rows.sort();
        return SpecialTermClauseCompiler.sha256(String.join(rows, '\n'));
    }

    private static VersionSummary versionSummary(Special_Term_Clause_Version__c version) {
        if (version == null) return null;
        VersionSummary result = new VersionSummary();
        result.id = version.Id;
        result.revisionNumber = Integer.valueOf(String.valueOf(version.Revision_Number__c));
        result.clauseText = version.Clause_Text__c;
        result.proposedShortName = version.Proposed_Short_Name__c;
        result.proposedCategory = version.Proposed_Category__c;
        result.status = version.Status__c;
        result.lastModifiedAt = timestamp(version.LastModifiedDate);
        return result;
    }

    private static Blocker blocker(String code, String message, Special_Term__c term, Special_Term_Revision__c revision) {
        Blocker result = new Blocker();
        result.code = code;
        result.message = message;
        if (term != null) { result.termId = term.Id; result.termName = term.Name; }
        if (revision != null) { result.revisionId = revision.Id; result.revisionStatus = revision.Status__c; }
        return result;
    }

    private static PreviewResult buildPreview(PublicationContext context) {
        PreviewResult result = new PreviewResult();
        result.clauseId = context.clause.Id;
        result.shortName = context.clause.Name;
        result.category = context.clause.Category__c;
        result.status = context.clause.Status__c;
        result.clauseLastModifiedAt = timestamp(context.clause.LastModifiedDate);
        result.latestApprovedVersion = versionSummary(context.latestApproved);
        result.draftVersion = versionSummary(context.draft);
        result.termCount = context.termIds.size();
        result.occurrenceCount = context.sourceAssignments.size();
        result.impactHash = impactHash(context);
        result.projectedDmlRows = (3 * context.assignments.size()) + (2 * context.rules.size()) + (3 * context.terms.size()) + 3;

        Map<Id, Special_Term__c> termsById = new Map<Id, Special_Term__c>(context.terms);
        Map<Id, Special_Term_Revision__c> currentById = new Map<Id, Special_Term_Revision__c>(context.currentRevisions);
        Map<Id, TermSummary> termSummaries = new Map<Id, TermSummary>();
        for (Special_Term__c term : context.terms) {
            TermSummary summary = new TermSummary();
            summary.termId = term.Id;
            summary.termName = term.Name;
            summary.lastModifiedAt = timestamp(term.LastModifiedDate);
            termSummaries.put(term.Id, summary);
            Special_Term_Revision__c current = currentById.get(term.Current_Revision__c);
            Boolean fullyStructured = term.Approval_Status__c == 'Approved' && term.Current_Revision__c != null
                && current?.Status__c == 'Active'
                && term.Clause_Structure_Status__c == 'Active'
                && term.Confirmation_Clause_Status__c == 'Active'
                && term.Nomination_Clause_Status__c == 'Active';
            if (!fullyStructured) result.blockers.add(blocker('TERM_NOT_FULLY_STRUCTURED', 'The affected Special Term is not a complete active structured revision.', term, current));
        }
        for (Special_Term_Clause_Assignment__c assignment : context.sourceAssignments) {
            OccurrenceSummary occurrence = new OccurrenceSummary();
            occurrence.projection = assignment.Projection__c;
            occurrence.sequence = Integer.valueOf(String.valueOf(assignment.Sequence__c));
            occurrence.sourceVersionId = assignment.Clause_Version__c;
            occurrence.sourceRevisionNumber = Integer.valueOf(String.valueOf(assignment.Clause_Version__r.Revision_Number__c));
            termSummaries.get(assignment.Special_Term__c).occurrences.add(occurrence);
            result.projectionCounts.put(assignment.Projection__c, (result.projectionCounts.get(assignment.Projection__c) == null ? 0 : result.projectionCounts.get(assignment.Projection__c)) + 1);
            String versionKey = String.valueOf(occurrence.sourceRevisionNumber);
            result.sourceVersionCounts.put(versionKey, (result.sourceVersionCounts.get(versionKey) == null ? 0 : result.sourceVersionCounts.get(versionKey)) + 1);
        }
        result.terms.addAll(termSummaries.values());
        result.terms.sort(new TermSummaryComparator());
        for (Special_Term_Revision__c pending : context.pendingRevisions) {
            Special_Term__c term = termsById.get(pending.Special_Term__c);
            result.blockers.add(blocker('PENDING_WHOLE_TERM_REVISION', 'Resolve the saved whole-term revision before publishing this clause globally.', term, pending));
        }
        if (context.clause.Status__c != 'Active') result.blockers.add(blocker('CLAUSE_NOT_ACTIVE', 'Only an active approved clause can be published globally.', null, null));
        if (context.latestApproved == null) result.blockers.add(blocker('APPROVED_VERSION_MISSING', 'The clause has no current approved version.', null, null));
        if (!context.consolidations.isEmpty()) result.blockers.add(blocker('CONSOLIDATION_OPEN', 'Resolve or cancel the open clause consolidation before publishing another version.', null, null));
        Integer queriedRows = context.versions.size() + context.terms.size() + context.assignments.size() + context.rules.size() + context.currentRevisions.size() + context.pendingRevisions.size() + context.consolidations.size();
        if (result.projectedDmlRows > SAFE_DML_ROW_LIMIT || queriedRows > SAFE_QUERY_ROW_LIMIT) result.blockers.add(blocker('SALESFORCE_LIMIT', 'The global update exceeds the safe Salesforce transaction limit and cannot be partially published.', null, null));
        return result;
    }

    private class TermSummaryComparator implements Comparator<TermSummary> {
        public Integer compare(TermSummary left, TermSummary right) {
            String leftName = left.termName == null ? '' : left.termName.toLowerCase();
            String rightName = right.termName == null ? '' : right.termName.toLowerCase();
            return leftName.compareTo(rightName);
        }
    }

    public static PreviewResult preview(Id clauseId) {
        return buildPreview(loadContext(clauseId, false));
    }

    private static void validateUniqueIdentity(Id clauseId, String nameKey, String canonicalKey) {
        require([SELECT COUNT() FROM Special_Term_Clause__c WHERE Id != :clauseId AND Short_Name_Key__c = :nameKey] == 0, 'Another clause already uses this short name.');
        require([SELECT COUNT() FROM Special_Term_Clause__c WHERE Id != :clauseId AND Canonical_Text_Key__c = :canonicalKey] == 0, 'Equivalent clause wording already exists in the Clause Bank.');
    }

    private static Map<Id, Integer> nextRevisionNumbers(Set<Id> termIds) {
        Map<Id, Integer> result = new Map<Id, Integer>();
        for (Id termId : termIds) result.put(termId, 1);
        for (AggregateResult row : [SELECT Special_Term__c termId,MAX(Revision_Number__c) maximum FROM Special_Term_Revision__c WHERE Special_Term__c IN :termIds GROUP BY Special_Term__c]) {
            result.put((Id) row.get('termId'), Integer.valueOf(String.valueOf(row.get('maximum'))) + 1);
        }
        return result;
    }

    public static PublishResult publish(Id clauseId, PublishRequest request) {
        require(request != null, 'Publication request is required.');
        require(!String.isBlank(request.reason) && request.reason.trim().length() >= 3, 'A publication reason is required.');
        require(!String.isBlank(request.approverEmail), 'Approver identity is required.');
        Savepoint checkpoint = Database.setSavepoint();
        try {
            PublicationContext context = loadContext(clauseId, true);
            PreviewResult previewResult = buildPreview(context);
            if (!previewResult.blockers.isEmpty()) throw new PublicationException(previewResult.blockers[0].message);
            require(!String.isBlank(request.expectedImpactHash) && request.expectedImpactHash == previewResult.impactHash, 'The affected Special Terms changed after review. Review the impact again before publishing.');
            require(context.latestApproved != null && request.baseVersionId == context.latestApproved.Id, 'The approved clause version changed after review.');
            require(matchesExpected(context.clause.LastModifiedDate, request.expectedClauseLastModifiedAt), 'The clause changed after it was opened.');
            require(matchesExpected(context.latestApproved.LastModifiedDate, request.expectedBaseVersionLastModifiedAt), 'The approved clause version changed after it was opened.');
            if (context.draft == null) require(String.isBlank(request.draftVersionId), 'A different Draft clause version is now available.');
            else {
                require(request.draftVersionId == context.draft.Id, 'The Draft clause version changed after review.');
                require(matchesExpected(context.draft.LastModifiedDate, request.expectedDraftVersionLastModifiedAt), 'The Draft clause version changed after it was opened.');
            }

            String shortName = normalizedShortName(request.shortName);
            String clauseText = normalizedClauseText(request.clauseText);
            String category = String.isBlank(request.category) ? 'Other' : request.category;
            require(CATEGORIES.contains(category), 'Select an active clause category.');
            String nameKey = shortNameKey(shortName);
            String canonicalKey = canonicalTextKey(clauseText);
            validateUniqueIdentity(clauseId, nameKey, canonicalKey);

            Special_Term_Clause_Version__c published = context.draft;
            if (published == null) {
                Integer nextNumber = context.versions.isEmpty() ? 1 : Integer.valueOf(String.valueOf(context.versions[0].Revision_Number__c)) + 1;
                published = new Special_Term_Clause_Version__c(
                    Clause__c = clauseId, Revision_Number__c = nextNumber, Clause_Text__c = clauseText,
                    Status__c = 'Draft', Revision_Reason__c = request.reason, Proposed_By_Email__c = request.approverEmail,
                    Proposed_Short_Name__c = shortName, Proposed_Category__c = category, Draft_Source__c = 'Manual'
                );
                Database.insert(published, AccessLevel.SYSTEM_MODE);
            } else {
                published.Clause_Text__c = clauseText;
                published.Revision_Reason__c = request.reason;
                published.Proposed_By_Email__c = request.approverEmail;
                published.Proposed_Short_Name__c = shortName;
                published.Proposed_Category__c = category;
                Database.update(published, AccessLevel.SYSTEM_MODE);
            }
            Database.update(new Special_Term_Clause_Version__c(Id = context.latestApproved.Id, Status__c = 'Superseded'), AccessLevel.SYSTEM_MODE);
            published.Status__c = 'Approved';
            published.Approved_By_Email__c = request.approverEmail;
            published.Approved_At__c = System.now();
            published.Approval_Reason__c = request.reason;
            Database.update(published, AccessLevel.SYSTEM_MODE);
            Database.update(new Special_Term_Clause__c(
                Id = clauseId, Name = shortName, Short_Name_Key__c = nameKey, Canonical_Text_Key__c = canonicalKey,
                Category__c = category, Status__c = 'Active', Latest_Approved_Version_Number__c = published.Revision_Number__c,
                Last_Approved_At__c = System.now(), Retirement_Reason__c = null, Replacement_Clause__c = null
            ), AccessLevel.SYSTEM_MODE);

            Map<Id, Integer> revisionNumbers = nextRevisionNumbers(context.termIds);
            Map<Id, Special_Term__c> termsById = new Map<Id, Special_Term__c>(context.terms);
            List<Special_Term_Revision__c> revisions = new List<Special_Term_Revision__c>();
            for (Id termId : context.termIds) {
                Special_Term__c term = termsById.get(termId);
                revisions.add(new Special_Term_Revision__c(
                    Special_Term__c = termId, Revision_Number__c = revisionNumbers.get(termId), Status__c = 'Draft',
                    Revision_Reason__c = request.reason, Proposed_By_Email__c = request.approverEmail,
                    Confirmation_Style__c = term.Confirmation_Clause_Style__c == 'Numbered' ? 'Numbered' : 'Hyphen',
                    Nomination_Style__c = term.Nomination_Clause_Style__c == 'Numbered' ? 'Numbered' : 'Hyphen',
                    Prior_Confirmation_Style__c = term.Confirmation_Clause_Style__c == 'Numbered' ? 'Numbered' : 'Hyphen',
                    Prior_Nomination_Style__c = term.Nomination_Clause_Style__c == 'Numbered' ? 'Numbered' : 'Hyphen'
                ));
            }
            if (!revisions.isEmpty()) Database.insert(revisions, AccessLevel.SYSTEM_MODE);
            Map<Id, Special_Term_Revision__c> revisionByTerm = new Map<Id, Special_Term_Revision__c>();
            for (Special_Term_Revision__c revision : revisions) revisionByTerm.put(revision.Special_Term__c, revision);

            List<Special_Term_Revision_Clause__c> revisionClauses = new List<Special_Term_Revision_Clause__c>();
            List<Special_Term_Clause_Assignment__c> newAssignments = new List<Special_Term_Clause_Assignment__c>();
            for (Special_Term_Clause_Assignment__c assignment : context.assignments) {
                Id versionId = assignment.Clause__c == clauseId ? published.Id : assignment.Clause_Version__c;
                revisionClauses.add(new Special_Term_Revision_Clause__c(
                    Special_Term_Revision__c = revisionByTerm.get(assignment.Special_Term__c).Id,
                    Clause__c = assignment.Clause__c, Clause_Version__c = versionId, Projection__c = assignment.Projection__c,
                    Sequence__c = assignment.Sequence__c, State__c = 'Proposed'
                ));
                newAssignments.add(new Special_Term_Clause_Assignment__c(
                    Special_Term__c = assignment.Special_Term__c, Clause__c = assignment.Clause__c, Clause_Version__c = versionId,
                    Projection__c = assignment.Projection__c, Sequence__c = assignment.Sequence__c, State__c = 'Active'
                ));
            }
            if (!revisionClauses.isEmpty()) Database.insert(revisionClauses, AccessLevel.SYSTEM_MODE);

            List<Special_Term_Revision_Rule__c> revisionRules = new List<Special_Term_Revision_Rule__c>();
            Map<Id, Integer> ruleSequenceByTerm = new Map<Id, Integer>();
            for (Special_Term_Rule__c rule : context.rules) {
                Integer sequence = (ruleSequenceByTerm.get(rule.Special_Term__c) == null ? 0 : ruleSequenceByTerm.get(rule.Special_Term__c)) + 1;
                ruleSequenceByTerm.put(rule.Special_Term__c, sequence);
                for (String snapshotType : new List<String>{ 'Baseline', 'Proposed' }) revisionRules.add(new Special_Term_Revision_Rule__c(
                    Special_Term_Revision__c = revisionByTerm.get(rule.Special_Term__c).Id, Special_Term_Rule__c = rule.Id,
                    Snapshot_Type__c = snapshotType, Sequence__c = sequence, Audience__c = rule.Supplier_Buyer__c,
                    Account__c = rule.Account__c, Port__c = rule.Port__c, Product__c = rule.Product__c,
                    Country__c = rule.Country__c, Priority__c = rule.Priority__c,
                    Source_Last_Modified__c = rule.LastModifiedDate, State__c = 'Proposed'
                ));
            }
            if (!revisionRules.isEmpty()) Database.insert(revisionRules, AccessLevel.SYSTEM_MODE);

            SpecialTermAssignmentHandler.suppressRecompile = true;
            SpecialTermRevisionHandler.allowLifecycleUpdate = true;
            SpecialTermRevisionClauseHandler.allowLifecycleUpdate = true;
            SpecialTermRevisionRuleHandler.allowLifecycleUpdate = true;
            SpecialTermTriggerHandler.allowCompiledProjectionUpdate = true;
            SpecialTermTriggerHandler.allowRevisionLifecycleUpdate = true;
            try {
                for (Special_Term_Clause_Assignment__c assignment : context.assignments) assignment.State__c = 'Historical';
                if (!context.assignments.isEmpty()) Database.update(context.assignments, AccessLevel.SYSTEM_MODE);
                if (!newAssignments.isEmpty()) Database.insert(newAssignments, AccessLevel.SYSTEM_MODE);
                Map<Id, Map<String, SpecialTermClauseCompiler.Compilation>> compiled = SpecialTermClauseCompiler.compileAll(context.termIds);

                for (Special_Term_Revision__c current : context.currentRevisions) current.Status__c = 'Superseded';
                if (!context.currentRevisions.isEmpty()) Database.update(context.currentRevisions, AccessLevel.SYSTEM_MODE);
                for (Special_Term_Revision_Clause__c row : revisionClauses) row.State__c = 'Active';
                if (!revisionClauses.isEmpty()) Database.update(revisionClauses, AccessLevel.SYSTEM_MODE);
                for (Special_Term_Revision_Rule__c row : revisionRules) row.State__c = 'Active';
                if (!revisionRules.isEmpty()) Database.update(revisionRules, AccessLevel.SYSTEM_MODE);

                for (Special_Term_Revision__c revision : revisions) {
                    Map<String, SpecialTermClauseCompiler.Compilation> termCompiled = compiled.get(revision.Special_Term__c);
                    revision.Status__c = 'Active';
                    revision.Approved_By_Email__c = request.approverEmail;
                    revision.Approved_At__c = System.now();
                    revision.Approval_Reason__c = request.reason;
                    revision.Compiled_Hash__c = SpecialTermClauseCompiler.sha256(
                        termCompiled.get(SpecialTermClauseCompiler.TERMS_TEXT).text + '\n'
                        + termCompiled.get(SpecialTermClauseCompiler.CONFIRMATION_REMARK).text + '\n'
                        + termCompiled.get(SpecialTermClauseCompiler.NOMINATION_REMARK).text
                    );
                }
                if (!revisions.isEmpty()) Database.update(revisions, AccessLevel.SYSTEM_MODE);

                List<Special_Term__c> termUpdates = new List<Special_Term__c>();
                for (Id termId : context.termIds) {
                    Map<String, SpecialTermClauseCompiler.Compilation> termCompiled = compiled.get(termId);
                    termUpdates.add(new Special_Term__c(
                        Id = termId, Approval_Status__c = 'Approved', Current_Revision__c = revisionByTerm.get(termId).Id,
                        Terms_Text__c = termCompiled.get(SpecialTermClauseCompiler.TERMS_TEXT).text,
                        Clause_Compiled_Hash__c = termCompiled.get(SpecialTermClauseCompiler.TERMS_TEXT).hash,
                        Special_Remark_in_Confirmation__c = termCompiled.get(SpecialTermClauseCompiler.CONFIRMATION_REMARK).text,
                        Confirmation_Compiled_Hash__c = termCompiled.get(SpecialTermClauseCompiler.CONFIRMATION_REMARK).hash,
                        Special_Remark_in_Nomination__c = termCompiled.get(SpecialTermClauseCompiler.NOMINATION_REMARK).text,
                        Nomination_Compiled_Hash__c = termCompiled.get(SpecialTermClauseCompiler.NOMINATION_REMARK).hash
                    ));
                }
                if (!termUpdates.isEmpty()) Database.update(termUpdates, AccessLevel.SYSTEM_MODE);
            } finally {
                SpecialTermAssignmentHandler.suppressRecompile = false;
                SpecialTermRevisionHandler.allowLifecycleUpdate = false;
                SpecialTermRevisionClauseHandler.allowLifecycleUpdate = false;
                SpecialTermRevisionRuleHandler.allowLifecycleUpdate = false;
                SpecialTermTriggerHandler.allowCompiledProjectionUpdate = false;
                SpecialTermTriggerHandler.allowRevisionLifecycleUpdate = false;
            }

            PublishResult result = new PublishResult();
            result.clauseId = clauseId;
            result.versionId = published.Id;
            result.revisionNumber = Integer.valueOf(String.valueOf(published.Revision_Number__c));
            result.status = 'Approved';
            result.termCount = context.termIds.size();
            result.occurrenceCount = context.sourceAssignments.size();
            for (Id termId : context.termIds) result.termIds.add(termId);
            result.termIds.sort();
            return result;
        } catch (Exception error) {
            Database.rollback(checkpoint);
            if (error instanceof PublicationException) throw error;
            throw new PublicationException(error.getMessage());
        }
    }
}
