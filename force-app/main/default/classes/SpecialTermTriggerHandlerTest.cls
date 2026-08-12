@isTest
public class SpecialTermTriggerHandlerTest {
    @isTest static void testUpdateSpecialRemarks() {
        Special_Term__c supplierTerm = new Special_Term__c(
            Name = 'Test OffshorePortSupplierTerm',
            Terms_Text__c = 'TEST',
            Clause_Structure_Status__c = 'Legacy',
            Add_to_Confirmation__c = true,
            Add_to_Nomination__c = true
        );
        insert supplierTerm;
        supplierTerm = [SELECT Special_Remark_in_Confirmation__c, Special_Remark_in_Nomination__c FROM Special_Term__c WHERE Id = :supplierTerm.Id];
        System.assertEquals('- Test OffshorePortSupplierTerm', supplierTerm.Special_Remark_in_Confirmation__c);
        System.assertEquals('- Test OffshorePortSupplierTerm', supplierTerm.Special_Remark_in_Nomination__c);
    }

    @isTest static void validatesEmptyStructuredTermsAndRollback() {
        String emptyHash = SpecialTermClauseCompiler.sha256('');
        Special_Term__c structured = new Special_Term__c(
            Name = 'Empty structured term',
            Terms_Text__c = '',
            Clause_Compiled_Hash__c = emptyHash,
            Clause_Structure_Status__c = 'Active',
            Original_Terms_Text__c = ''
        );
        Database.insert(structured, AccessLevel.SYSTEM_MODE);

        structured.Clause_Structure_Status__c = 'Legacy';
        structured.Clause_Compiled_Hash__c = null;
        Database.update(structured, AccessLevel.SYSTEM_MODE);

        Special_Term__c invalid = new Special_Term__c(
            Name = 'Invalid empty structured term',
            Terms_Text__c = 'Free-form wording',
            Clause_Compiled_Hash__c = emptyHash,
            Clause_Structure_Status__c = 'Active'
        );
        try {
            Database.insert(invalid, AccessLevel.SYSTEM_MODE);
            System.assert(false, 'A new structured term must be empty.');
        } catch (DmlException error) {
            System.assert(error.getMessage().contains('empty compiled clause set'));
        }
    }
}