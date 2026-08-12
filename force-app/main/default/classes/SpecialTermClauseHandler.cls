public class SpecialTermClauseHandler {
    public static void beforeDelete(List<Special_Term_Clause__c> clauses) {
        for (Special_Term_Clause__c clause : clauses) {
            if (clause.Status__c != 'Draft') clause.addError('Approved and retired clause identities must be retained.');
        }
    }
}