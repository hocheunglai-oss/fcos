public without sharing class SpecialTermClauseCompiler {
    public static final String TERMS_TEXT = 'Terms Text';
    public static final String CONFIRMATION_REMARK = 'Confirmation Remark';
    public static final String NOMINATION_REMARK = 'Nomination Remark';
    public static final Set<String> PROJECTIONS = new Set<String>{ TERMS_TEXT, CONFIRMATION_REMARK, NOMINATION_REMARK };

    public class Compilation {
        public String text;
        public String hash;

        public Compilation(String compiledText) {
            text = compiledText;
            hash = sha256(compiledText);
        }
    }

    public static String normalizeClauseText(String value) {
        String normalized = value == null ? '' : value.replace('\r\n', '\n').replace('\r', '\n').trim();
        while (normalized.contains('\n\n\n')) normalized = normalized.replace('\n\n\n', '\n\n');
        return normalized;
    }

    public static String sha256(String value) {
        return EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256', Blob.valueOf(value == null ? '' : value)));
    }

    public static Boolean hasTopLevelListMarker(String value) {
        String normalized = normalizeClauseText(value);
        if (String.isBlank(normalized)) return false;
        String firstLine = normalized.substringBefore('\n').trim();
        if (firstLine.startsWith('- ') || firstLine.startsWith('– ') || firstLine.startsWith('— ') || firstLine.startsWith('• ')) return true;
        return Pattern.matches('(?i)^(?:clause\\s+)?\\(?\\d+(?:\\.\\d+)*\\)?[.):]?[\\s\\t-]+.+$', firstLine);
    }

    public static String normalizeProjection(String value) {
        return PROJECTIONS.contains(value) ? value : TERMS_TEXT;
    }

    private static Compilation compileRows(List<Special_Term_Clause_Assignment__c> assignments, String style) {
        List<String> clauses = new List<String>();
        Integer expectedSequence = 1;
        for (Special_Term_Clause_Assignment__c assignment : assignments) {
            Integer sequence = Integer.valueOf(String.valueOf(assignment.Sequence__c));
            if (sequence != expectedSequence) throw new SpecialTermClauseException('Active clause sequence must be continuous from 1 within each projection.');
            if (!new Set<String>{ 'Approved', 'Superseded' }.contains(assignment.Clause_Version__r.Status__c) || assignment.Clause_Version__r.Clause__c != assignment.Clause__c) {
                throw new SpecialTermClauseException('Active clause assignments must reference retained approved wording from the same clause.');
            }
            String clauseText = normalizeClauseText(assignment.Clause_Version__r.Clause_Text__c);
            if (String.isBlank(clauseText)) throw new SpecialTermClauseException('Approved clause text cannot be blank.');
            if (hasTopLevelListMarker(clauseText)) throw new SpecialTermClauseException('Approved clause text cannot contain its own top-level list marker.');
            clauses.add(style == 'Hyphen' ? '- ' + clauseText : String.valueOf(expectedSequence) + '. ' + clauseText);
            expectedSequence++;
        }
        return new Compilation(String.join(clauses, style == 'Hyphen' ? '\n' : '\n\n'));
    }

    public static Map<Id, Map<String, Compilation>> compileAll(Set<Id> specialTermIds) {
        Map<Id, Map<String, List<Special_Term_Clause_Assignment__c>>> rowsByTerm = new Map<Id, Map<String, List<Special_Term_Clause_Assignment__c>>>();
        for (Id termId : specialTermIds) {
            Map<String, List<Special_Term_Clause_Assignment__c>> byProjection = new Map<String, List<Special_Term_Clause_Assignment__c>>();
            for (String projection : PROJECTIONS) byProjection.put(projection, new List<Special_Term_Clause_Assignment__c>());
            rowsByTerm.put(termId, byProjection);
        }
        if (!specialTermIds.isEmpty()) {
            Map<String, Object> binds = new Map<String, Object>{ 'termIds' => specialTermIds };
            List<Special_Term_Clause_Assignment__c> assignments = Database.queryWithBinds(
                'SELECT Id, Special_Term__c, Projection__c, Clause__c, Clause_Version__c, Sequence__c, ' +
                'Clause_Version__r.Clause__c, Clause_Version__r.Status__c, Clause_Version__r.Clause_Text__c ' +
                'FROM Special_Term_Clause_Assignment__c ' +
                'WHERE Special_Term__c IN :termIds AND State__c = \'Active\' ' +
                'ORDER BY Special_Term__c, Projection__c, Sequence__c, Id',
                binds,
                AccessLevel.SYSTEM_MODE
            );
            for (Special_Term_Clause_Assignment__c assignment : assignments) {
                String projection = normalizeProjection(assignment.Projection__c);
                rowsByTerm.get(assignment.Special_Term__c).get(projection).add(assignment);
            }
        }

        Map<Id, Special_Term__c> terms = specialTermIds.isEmpty() ? new Map<Id, Special_Term__c>() : new Map<Id, Special_Term__c>([
            SELECT Id, Confirmation_Clause_Style__c, Nomination_Clause_Style__c
            FROM Special_Term__c
            WHERE Id IN :specialTermIds
        ]);
        Map<Id, Map<String, Compilation>> result = new Map<Id, Map<String, Compilation>>();
        for (Id termId : specialTermIds) {
            Special_Term__c term = terms.get(termId);
            Map<String, Compilation> compiled = new Map<String, Compilation>();
            compiled.put(TERMS_TEXT, compileRows(rowsByTerm.get(termId).get(TERMS_TEXT), 'Numbered'));
            compiled.put(CONFIRMATION_REMARK, compileRows(rowsByTerm.get(termId).get(CONFIRMATION_REMARK), term?.Confirmation_Clause_Style__c == 'Numbered' ? 'Numbered' : 'Hyphen'));
            compiled.put(NOMINATION_REMARK, compileRows(rowsByTerm.get(termId).get(NOMINATION_REMARK), term?.Nomination_Clause_Style__c == 'Numbered' ? 'Numbered' : 'Hyphen'));
            result.put(termId, compiled);
        }
        return result;
    }

    public static Map<Id, Compilation> compile(Set<Id> specialTermIds) {
        Map<Id, Compilation> result = new Map<Id, Compilation>();
        Map<Id, Map<String, Compilation>> allCompilations = compileAll(specialTermIds);
        for (Id termId : allCompilations.keySet()) result.put(termId, allCompilations.get(termId).get(TERMS_TEXT));
        return result;
    }

    public class SpecialTermClauseException extends Exception {}
}