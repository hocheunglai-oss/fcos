public without sharing class AccountReassignBatch implements Database.Batchable<SObject> {

    private Id oldAccountId;
    private Id newAccountId;
    private List<LookupTarget> targets;
    private Integer currentIndex;

    public class LookupTarget {
        public String objectName;
        public String fieldName;
        public LookupTarget(String objectName, String fieldName) {
            this.objectName = objectName;
            this.fieldName = fieldName;
        }
    }

    public AccountReassignBatch(Id oldAccountId, Id newAccountId, List<LookupTarget> targets, Integer currentIndex) {
        this.oldAccountId = oldAccountId;
        this.newAccountId = newAccountId;
        this.targets = targets;
        this.currentIndex = currentIndex;
    }

    public Database.QueryLocator start(Database.BatchableContext bc) {
        if (targets.isEmpty()) {
            System.debug('No targets found, returning empty query.');
            return Database.getQueryLocator('SELECT Id FROM Account WHERE Id = null');
        }

        LookupTarget target = targets[currentIndex];
        String soql = 'SELECT Id FROM ' + target.objectName +
                      ' WHERE ' + target.fieldName + ' = :oldAccountId';

        System.debug('Starting batch for object: ' + target.objectName +
                     ', field: ' + target.fieldName +
                     ', oldAccountId: ' + oldAccountId +
                     ', newAccountId: ' + newAccountId);

        return Database.getQueryLocator(soql);
    }

    public void execute(Database.BatchableContext bc, List<SObject> scope) {
        if (scope.isEmpty()) {
            System.debug('No records found in this scope for ' + targets[currentIndex].objectName + '.' + targets[currentIndex].fieldName);
            return;
        }

        LookupTarget target = targets[currentIndex];
        System.debug('Processing ' + scope.size() + ' records for ' +
                     target.objectName + '.' + target.fieldName);

        for (SObject rec : scope) {
            rec.put(target.fieldName, newAccountId);
            if (target.objectName == 'Opportunity' && Schema.SObjectType.Opportunity.fields.Allow_Closed_Won_Update__c != null) {
                rec.put('Allow_Closed_Won_Update__c', true);
            }
        }

        ContextManager.skipTriggers = true;
        try {
            update scope;
            if (target.objectName == 'Opportunity') {
                for (SObject rec : scope) rec.put('Allow_Closed_Won_Update__c', false);
                update scope;
            }
            System.debug('Updated ' + scope.size() + ' records for ' +
                         target.objectName + '.' + target.fieldName);
        } catch (Exception e) {
            System.debug('Error updating records: ' + e.getMessage());
            throw e;
        } finally {
            ContextManager.skipTriggers = false;
        }
    }

    public void finish(Database.BatchableContext bc) {
        LookupTarget target = targets[currentIndex];
        System.debug('Finished object: ' + target.objectName +
                     ', field: ' + target.fieldName);

        currentIndex++;
        if (currentIndex < targets.size()) {
            System.debug('Moving to next target index: ' + currentIndex);
            Database.executeBatch(
                new AccountReassignBatch(oldAccountId, newAccountId, targets, currentIndex),
                200
            );
        } else {
            System.debug('All lookups processed successfully.');
            Validation_Rule_Utility__c validationRuleUtility = Validation_Rule_Utility__c.getOrgDefaults();
        	validationRuleUtility.Bypass__c = false;
            validationRuleUtility.SetupOwnerId = UserInfo.getOrganizationId();
        	upsert validationRuleUtility;
        }
    }
}
