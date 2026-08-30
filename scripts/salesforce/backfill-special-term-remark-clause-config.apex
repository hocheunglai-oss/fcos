List<Special_Term__c> updates = [
    SELECT Id,
        Clause_Structure_Status__c,
        Confirmation_Clause_Status__c,
        Confirmation_Clause_Style__c,
        Nomination_Clause_Status__c,
        Nomination_Clause_Style__c
    FROM Special_Term__c
    WHERE Clause_Structure_Status__c = null
        OR Confirmation_Clause_Status__c = null
        OR Confirmation_Clause_Style__c = null
        OR Nomination_Clause_Status__c = null
        OR Nomination_Clause_Style__c = null
    FOR UPDATE
];

for (Special_Term__c term : updates) {
    if (term.Clause_Structure_Status__c == null) term.Clause_Structure_Status__c = 'Legacy';
    if (term.Confirmation_Clause_Status__c == null) term.Confirmation_Clause_Status__c = 'Legacy';
    if (term.Confirmation_Clause_Style__c == null) term.Confirmation_Clause_Style__c = 'Hyphen';
    if (term.Nomination_Clause_Status__c == null) term.Nomination_Clause_Status__c = 'Legacy';
    if (term.Nomination_Clause_Style__c == null) term.Nomination_Clause_Style__c = 'Hyphen';
}

if (!updates.isEmpty()) update updates;
System.debug(LoggingLevel.INFO, 'FCOS remark clause configuration backfilled: ' + updates.size());
