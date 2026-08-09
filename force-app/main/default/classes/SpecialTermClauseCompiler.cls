public without sharing class SpecialTermClauseCompiler {
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

    public static Map<Id, Compilation> compile(Set<Id> specialTermIds) {
        Map<Id, List<Special_Term_Clause_Assignment__c>> byTerm = new Map<Id, List<Special_Term_Clause_Assignment__c>>();
        for (Id termId : specialTermIds) byTerm.put(termId, new List<Special_Term_Clause_Assignment__c>());
        if (!specialTermIds.isEmpty()) {
            Map<String, Object> binds = new Map<String, Object>{ 'termIds' => specialTermIds };
            List<Special_Term_Clause_Assignment__c> assignments = Database.queryWithBinds(
                'SELECT Id, Special_Term__c, Clause__c, Clause_Version__c, Sequence__c, ' +
                'Clause_Version__r.Clause__c, Clause_Version__r.Status__c, Clause_Version__r.Clause_Text__c ' +
                'FROM Special_Term_Clause_Assignment__c ' +
                'WHERE Special_Term__c IN :termIds AND State__c = \'Active\' ' +
                'ORDER BY Special_Term__c, Sequence__c, Id',
                binds,
                AccessLevel.SYSTEM_MODE
            );
            for (Special_Term_Clause_Assignment__c assignment : assignments) {
                byTerm.get(assignment.Special_Term__c).add(assignment);
            }
        }

        Map<Id, Compilation> result = new Map<Id, Compilation>();
        for (Id termId : specialTermIds) {
            List<String> clauses = new List<String>();
            Integer expectedSequence = 1;
            for (Special_Term_Clause_Assignment__c assignment : byTerm.get(termId)) {
                Integer sequence = Integer.valueOf(String.valueOf(assignment.Sequence__c));
                if (sequence != expectedSequence) {
                    throw new SpecialTermClauseException('Active clause sequence must be continuous from 1.');
                }
                if (!new Set<String>{ 'Approved', 'Superseded' }.contains(assignment.Clause_Version__r.Status__c) || assignment.Clause_Version__r.Clause__c != assignment.Clause__c) {
                    throw new SpecialTermClauseException('Active clause assignments must reference retained approved wording from the same clause.');
                }
                String clauseText = normalizeClauseText(assignment.Clause_Version__r.Clause_Text__c);
                if (String.isBlank(clauseText)) throw new SpecialTermClauseException('Approved clause text cannot be blank.');
                clauses.add(String.valueOf(expectedSequence) + '. ' + clauseText);
                expectedSequence++;
            }
            result.put(termId, new Compilation(String.join(clauses, '\n\n')));
        }
        return result;
    }

    public class SpecialTermClauseException extends Exception {}
}
