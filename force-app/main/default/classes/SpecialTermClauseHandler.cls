public class SpecialTermClauseHandler {
    public static void beforeUpdate(List<Special_Term_Clause__c> clauses, Map<Id, Special_Term_Clause__c> oldMap) {
        Set<Id> retiringIds = new Set<Id>();
        for (Special_Term_Clause__c clause : clauses) {
            Special_Term_Clause__c prior = oldMap.get(clause.Id);
            if (prior.Status__c != 'Retired' && clause.Status__c == 'Retired') retiringIds.add(clause.Id);
        }
        if (retiringIds.isEmpty()) return;
        Set<Id> blockedIds = new Set<Id>();
        for (Special_Term_Clause_Assignment__c assignment : [
            SELECT Clause__c FROM Special_Term_Clause_Assignment__c WHERE Clause__c IN :retiringIds AND State__c = 'Active'
        ]) blockedIds.add(assignment.Clause__c);
        for (Special_Term_Revision_Clause__c revisionClause : [
            SELECT Clause__c FROM Special_Term_Revision_Clause__c
            WHERE Clause__c IN :retiringIds AND Special_Term_Revision__r.Status__c IN ('Draft', 'In Review')
        ]) blockedIds.add(revisionClause.Clause__c);
        for (Special_Term_Clause_Consolidation__c consolidation : [
            SELECT Source_Clause__c FROM Special_Term_Clause_Consolidation__c
            WHERE Source_Clause__c IN :retiringIds AND Status__c IN ('Relinking', 'Paused', 'Ready to Retire')
        ]) blockedIds.add(consolidation.Source_Clause__c);
        for (Special_Term_Clause__c clause : clauses) if (blockedIds.contains(clause.Id)) clause.addError('A clause cannot be retired while live or pending Special Term references or an open consolidation remain.');
    }

    public static void beforeDelete(List<Special_Term_Clause__c> clauses) {
        for (Special_Term_Clause__c clause : clauses) {
            if (clause.Status__c != 'Draft') clause.addError('Approved and retired clause identities must be retained.');
        }
    }
}
