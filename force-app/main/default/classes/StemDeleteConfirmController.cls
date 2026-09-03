public with sharing class StemDeleteConfirmController {
    private final ApexPages.StandardController standardController;
    private final Id stemId;

    public STEM__c stem { get; private set; }
    public List<STEM_Variable_Charge_Supplier__c> variableChargeSuppliers { get; private set; }

    @TestVisible
    private static Boolean forceFailureAfterVariableChargeDelete = false;

    public StemDeleteConfirmController(ApexPages.StandardController controller) {
        standardController = controller;
        stemId = controller.getId();
        variableChargeSuppliers = new List<STEM_Variable_Charge_Supplier__c>();

        if (stemId == null) {
            ApexPages.addMessage(new ApexPages.Message(
                ApexPages.Severity.ERROR,
                'The STEM could not be identified. Return to the STEM and try Delete again.'
            ));
            return;
        }

        List<STEM__c> stems = [
            SELECT Id, Name, Enquiry__c
            FROM STEM__c
            WHERE Id = :stemId
            LIMIT 1
        ];
        if (stems.isEmpty()) {
            ApexPages.addMessage(new ApexPages.Message(
                ApexPages.Severity.ERROR,
                'This STEM no longer exists or is not available to you.'
            ));
            return;
        }

        stem = stems[0];
        variableChargeSuppliers = [
            SELECT Id, Name, Supplier__c, Supplier__r.Name,
                   Supplier_Status__c, Buyer_Charge_Status__c
            FROM STEM_Variable_Charge_Supplier__c
            WHERE STEM__c = :stemId
            ORDER BY Name
        ];
    }

    public Boolean getHasVariableChargeSuppliers() {
        return !variableChargeSuppliers.isEmpty();
    }

    public PageReference deleteStemAndVariableCharges() {
        if (stemId == null || stem == null) return null;
        if (!Schema.sObjectType.STEM__c.isDeletable()) {
            ApexPages.addMessage(new ApexPages.Message(
                ApexPages.Severity.ERROR,
                'You do not have permission to delete this STEM.'
            ));
            return null;
        }

        Savepoint deleteSavepoint = Database.setSavepoint();
        try {
            STEM__c lockedStem = [
                SELECT Id, Enquiry__c
                FROM STEM__c
                WHERE Id = :stemId
                LIMIT 1
                FOR UPDATE
            ];
            List<STEM_Variable_Charge_Supplier__c> linkedVariableCharges = [
                SELECT Id
                FROM STEM_Variable_Charge_Supplier__c
                WHERE STEM__c = :stemId
                FOR UPDATE
            ];

            if (!linkedVariableCharges.isEmpty()) delete linkedVariableCharges;
            if (Test.isRunningTest() && forceFailureAfterVariableChargeDelete) {
                throw new StemDeleteException('Forced transactional rollback test.');
            }
            delete lockedStem;

            PageReference destination = lockedStem.Enquiry__c == null
                ? new PageReference('/lightning/o/STEM__c/list')
                : new PageReference('/lightning/r/Opportunity/' + lockedStem.Enquiry__c + '/view');
            destination.setRedirect(true);
            return destination;
        } catch (Exception error) {
            Database.rollback(deleteSavepoint);
            ApexPages.addMessage(new ApexPages.Message(
                ApexPages.Severity.ERROR,
                'Nothing was deleted. Salesforce could not delete the STEM and its Variable Charges together: '
                    + userFacingMessage(error)
            ));
            return null;
        }
    }

    public PageReference cancel() {
        return standardController.cancel();
    }

    private static String userFacingMessage(Exception error) {
        if (error instanceof DmlException) {
            DmlException dmlError = (DmlException) error;
            if (dmlError.getNumDml() > 0) return dmlError.getDmlMessage(0);
        }
        return error.getMessage();
    }

    private class StemDeleteException extends Exception {}
}
