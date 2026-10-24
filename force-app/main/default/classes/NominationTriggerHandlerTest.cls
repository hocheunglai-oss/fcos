@IsTest
private class NominationTriggerHandlerTest {
    private static final String MISSING_STEM_MESSAGE =
        'Cannot create a STEM status: the nomination must reference an existing STEM.';

    @TestSetup
    static void makeParents() {
        TestDataFactory.insertPricebook('Standard Price Book', true);
        Port__c port = TestDataFactory.createTestPort('FCOS Nom parent port', 'CHINA', true);
        Vessel__c vessel = TestDataFactory.createTestVessel('FCOS nomination parent test vessel', '1234567', null, true);
        Id historicalType = Schema.SObjectType.STEM__c.getRecordTypeInfosByDeveloperName()
            .get('Historical').getRecordTypeId();
        List<STEM__c> stems = new List<STEM__c>();
        for (String marker : new List<String>{ 'A', 'B' }) {
            Account buyer = TestDataFactory.createTestAccount('FCOS nomination parent test buyer ' + marker, 'BUYER', true);
            Opportunity enquiry = TestDataFactory.createTestEnquiry(
                'FCOS nomination parent test enquiry ' + marker, buyer.Id, vessel.Id,
                'Offer Sent & Negotiation', Date.today(), true, Time.newInstance(1, 2, 3, 4), 10000
            );
            stems.add(new STEM__c(
                Name = 'FCOS NOMINATION PARENT TEST ' + marker,
                RecordTypeId = historicalType,
                Account__c = buyer.Id,
                Enquiry__c = enquiry.Id,
                Port__c = port.Id,
                Vessel__c = vessel.Id,
                Delivery_Date__c = Date.today(),
                Stem_Date__c = Date.today()
            ));
        }
        insert stems;
    }

    @IsTest
    static void ordinaryInsertLoadsParentNameFromLookup() {
        List<STEM__c> stems = parents();
        Nomination__c nomination = nominationFor(stems[0]);
        System.assertEquals(false, nomination.getPopulatedFieldsAsMap().containsKey('STEM__r'));

        Test.startTest();
        insert nomination;
        Test.stopTest();

        assertStatuses(new List<Nomination__c>{ nomination }, new Map<Id, STEM__c>(stems));
    }

    @IsTest
    static void bulkInsertPreservesSharedAndDistinctParentMappings() {
        List<STEM__c> stems = parents();
        List<Nomination__c> nominations = new List<Nomination__c>();
        // A per-nomination query would exceed the normal SOQL limit for this batch.
        for (Integer index = 0; index < 200; index++) {
            nominations.add(nominationFor(stems[Math.mod(index, stems.size())]));
        }

        Test.startTest();
        insert nominations;
        Test.stopTest();

        assertStatuses(nominations, new Map<Id, STEM__c>(stems));
    }

    @IsTest
    static void nullParentRollsBackTheWholeNormalInsert() {
        STEM__c stem = parents()[0];
        Nomination__c valid = nominationFor(stem);
        Nomination__c invalid = nominationFor(stem);
        invalid.STEM__c = null;
        Integer nominationsBefore = [SELECT COUNT() FROM Nomination__c];
        Integer statusesBefore = [SELECT COUNT() FROM STEM_Status__c];
        Boolean failed = false;

        Test.startTest();
        try {
            insert new List<Nomination__c>{ valid, invalid };
        } catch (DmlException error) {
            failed = true;
            System.assert(error.getMessage().contains(MISSING_STEM_MESSAGE), error.getMessage());
        }
        Test.stopTest();

        System.assertEquals(true, failed, 'A missing STEM must fail explicitly.');
        System.assertEquals(nominationsBefore, [SELECT COUNT() FROM Nomination__c]);
        System.assertEquals(statusesBefore, [SELECT COUNT() FROM STEM_Status__c]);
    }

    @IsTest
    static void unresolvedParentCannotInsertPartialStatuses() {
        List<STEM__c> stems = parents();
        Nomination__c valid = nominationFor(stems[0]);
        Nomination__c invalid = nominationFor(stems[1]);
        STEM__c unresolvedStem = stems[1];
        delete unresolvedStem;
        Integer statusesBefore = [SELECT COUNT() FROM STEM_Status__c];
        Boolean failed = false;

        Test.startTest();
        try {
            // Ordinary DML rejects an invalid lookup before after-insert; call the
            // handler directly to exercise its independent missing-parent guard.
            NominationTriggerHandler.createStemStatuses(new List<Nomination__c>{ valid, invalid });
        } catch (Exception error) {
            failed = true;
            System.assertEquals(MISSING_STEM_MESSAGE, error.getMessage());
        }
        Test.stopTest();

        System.assertEquals(true, failed, 'An unresolved STEM must fail explicitly.');
        System.assertEquals(statusesBefore, [SELECT COUNT() FROM STEM_Status__c]);
    }

    @IsTest
    static void ordinaryDeleteRemovesOnlyLinkedNominationDocuments() {
        Nomination__c nomination = nominationFor(parents()[0]);
        insert nomination;
        ContentVersion linked = new ContentVersion(
            Title = 'FCOS nomination linked test document',
            PathOnClient = 'nomination-linked-test.txt',
            VersionData = Blob.valueOf('Disposable nomination document'),
            FirstPublishLocationId = nomination.Id
        );
        ContentVersion unrelated = new ContentVersion(
            Title = 'FCOS unrelated test document',
            PathOnClient = 'nomination-unrelated-test.txt',
            VersionData = Blob.valueOf('Unrelated document must remain')
        );
        insert new List<ContentVersion>{ linked, unrelated };
        Id linkedDocumentId = [SELECT ContentDocumentId FROM ContentVersion WHERE Id = :linked.Id].ContentDocumentId;
        Id unrelatedDocumentId = [SELECT ContentDocumentId FROM ContentVersion WHERE Id = :unrelated.Id].ContentDocumentId;
        System.assertEquals(1, [SELECT COUNT() FROM ContentDocumentLink
            WHERE LinkedEntityId = :nomination.Id AND ContentDocumentId = :linkedDocumentId]);

        Test.startTest();
        delete nomination;
        Test.stopTest();

        System.assertEquals(0, [SELECT COUNT() FROM Nomination__c WHERE Id = :nomination.Id]);
        System.assertEquals(0, [SELECT COUNT() FROM ContentDocument WHERE Id = :linkedDocumentId],
            'Ordinary nomination deletion must remove its linked document.');
        System.assertEquals(1, [SELECT COUNT() FROM ContentDocument WHERE Id = :unrelatedDocumentId],
            'Deleting a nomination must preserve unrelated documents.');
    }

    private static List<STEM__c> parents() {
        return [
            SELECT Id, Name, Account__c, Enquiry__c, Port__c
            FROM STEM__c
            WHERE Name LIKE 'FCOS NOMINATION PARENT TEST %'
            ORDER BY Name
        ];
    }

    private static Nomination__c nominationFor(STEM__c stem) {
        return new Nomination__c(
            RecordTypeId = Schema.SObjectType.Nomination__c.getRecordTypeInfosByDeveloperName()
                .get('Buyer').getRecordTypeId(),
            STEM__c = stem.Id,
            Account__c = stem.Account__c,
            Enquiry__c = stem.Enquiry__c,
            Port__c = stem.Port__c,
            Expected_Delivery_Date__c = Date.today(),
            Deprecated__c = false
        );
    }

    private static void assertStatuses(List<Nomination__c> nominations, Map<Id, STEM__c> stemsById) {
        Map<Id, Nomination__c> nominationsById = new Map<Id, Nomination__c>(nominations);
        Set<Id> nominationIds = nominationsById.keySet();
        List<STEM_Status__c> statuses = [
            SELECT Id, Name, Nomination__c, STEM__c, Enquiry__c, Account__c
            FROM STEM_Status__c
            WHERE Nomination__c IN :nominationIds
        ];
        System.assertEquals(nominations.size(), statuses.size());
        Set<Id> seen = new Set<Id>();
        for (STEM_Status__c status : statuses) {
            System.assertEquals(false, seen.contains(status.Nomination__c), 'Each nomination gets exactly one status.');
            seen.add(status.Nomination__c);
            Nomination__c nomination = nominationsById.get(status.Nomination__c);
            System.assertNotEquals(null, nomination);
            System.assertEquals(nomination.Id, status.Nomination__c);
            System.assertEquals(nomination.STEM__c, status.STEM__c);
            System.assertEquals(nomination.Enquiry__c, status.Enquiry__c);
            System.assertEquals(nomination.Account__c, status.Account__c);
            System.assertEquals(stemsById.get(nomination.STEM__c).Name, status.Name);
        }
    }
}
