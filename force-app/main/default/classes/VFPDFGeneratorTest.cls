@IsTest
private class VFPDFGeneratorTest {
    @TestSetup
    static void makeData() {
        TestDataFactory.prepareDataForNominationConfirmationFlow();
        List<Nomination__c> nominations = [SELECT Id, Enquiry__c, RecordTypeId, File__c, STEM__c FROM Nomination__c];
        Map<String, String> nominationIdAndRecordTypeToStemId = new Map<String, String>();
        for(Nomination__c nomination: nominations){
            nominationIdAndRecordTypeToStemId.put(nomination.Id + ',' + nomination.RecordTypeId, nomination.STEM__c);
        }
        VFPDFGenerator.generatePDFInNewContext(nominationIdAndRecordTypeToStemId);
    }

    @IsTest
    static void testGenerationNewPDFVersion() {
        Test.startTest();
        List<Nomination__c> nominations = [SELECT Id, Enquiry__c, RecordTypeId, File__c, STEM__c FROM Nomination__c];
        List<String> nominationIds = new List<String>();
        for(Nomination__c nomination: nominations){
            nominationIds.add(nomination.Id);
        }
        VFPDFGenerator.generateNewPDFVersion(nominationIds);
        List<ContentDocumentLink> files = [SELECT Id FROM ContentDocumentLink WHERE LinkedEntityId IN: nominationIds];
        System.assertEquals(2, files.size());
        Test.stopTest();
    }

    @isTest
    static void testDeleteContentDocuments(){
        Test.startTest();
        Map<Id, Nomination__c> nominations = new Map<Id, Nomination__c>([SELECT Id, Enquiry__c, RecordTypeId, File__c, STEM__c FROM Nomination__c]);
        delete nominations.values();
        system.assertEquals(0, [SELECT Id FROM ContentDocumentLink WHERE LinkedEntityId In: nominations.keySet()].size());
        Test.stopTest();
    }
}