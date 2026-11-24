@IsTest
private class KoreaDeskStemMembershipTest {
    @IsTest
    static void reportsGeographyAndExplicitBuyerChoices() {
        TestDataFactory.insertPricebook('Standard Price Book', true);
        Account singaporeBuyer = TestDataFactory.createTestAccount(
            'FRATELLI COSULICH BUNKERS (S) PTE LTD', 'BUYER', true
        );
        Account otherBuyer = TestDataFactory.createTestAccount('Other Korea Desk Test Buyer', 'BUYER', true);
        Port__c korea = TestDataFactory.createTestPort('Korea Desk Test Korea', activeKoreaCountry(), true);
        Port__c singapore = TestDataFactory.createTestPort('Korea Desk Test Singapore', 'SINGAPORE', true);
        Vessel__c vessel = TestDataFactory.createTestVessel('Korea Desk Vessel', '9876543', otherBuyer.Id, true);
        Opportunity singaporeEnquiry = enquiry(singaporeBuyer, vessel);
        Opportunity otherEnquiry = enquiry(otherBuyer, vessel);
        List<STEM__c> fixtures = new List<STEM__c>{
            stem('Korean historical', otherEnquiry, korea, null),
            stem('Singapore buyer Yes', singaporeEnquiry, singapore, 'Yes'),
            stem('Singapore buyer No', singaporeEnquiry, singapore, 'No'),
            stem('Singapore buyer unreviewed', singaporeEnquiry, singapore, null),
            stem('Other buyer outside Korea', otherEnquiry, singapore, 'Yes')
        };
        Test.startTest();
        insert as system fixtures;
        Map<Id, STEM__c> results = new Map<Id, STEM__c>([
            SELECT Id, Korea_Desk__c, Korea_Desk_Member__c FROM STEM__c WHERE Id IN :fixtures WITH SYSTEM_MODE
        ]);
        Assert.isNull(results.get(fixtures[0].Id).Korea_Desk__c, 'Keep the historical choice blank.');
        List<Boolean> expected = new List<Boolean>{true, true, false, false, false};
        for (Integer i = 0; i < fixtures.size(); i++) {
            Assert.areEqual(expected[i], results.get(fixtures[i].Id).Korea_Desk_Member__c, fixtures[i].Name);
        }
        Id changedId = fixtures[1].Id;
        STEM__c changed = new STEM__c(Id = changedId, Korea_Desk__c = 'No');
        update as system changed;
        changed = [SELECT Korea_Desk_Member__c FROM STEM__c WHERE Id = :changedId WITH SYSTEM_MODE];
        Assert.isFalse(changed.Korea_Desk_Member__c);
        Test.stopTest();
    }

    private static Opportunity enquiry(Account buyer, Vessel__c vessel) {
        return TestDataFactory.createTestEnquiry(
            buyer.Name, buyer.Id, vessel.Id, 'Offer Sent & Negotiation', Date.today(), true,
            Time.newInstance(1, 2, 3, 4), 10000
        );
    }

    private static String activeKoreaCountry() {
        for (Schema.PicklistEntry country : Port__c.Country__c.getDescribe().getPicklistValues()) {
            if (country.isActive() && (country.getValue() == 'KOREA' || country.getValue() == 'KOREA, REPUBLIC OF')) {
                return country.getValue();
            }
        }
        Assert.fail('The org needs an active South Korea country value to create the test port.');
        return null;
    }

    private static STEM__c stem(String name, Opportunity parent, Port__c port, String choice) {
        return new STEM__c(
            Name = 'FCOS Korea Desk ' + name,
            RecordTypeId = FCBStatic.HISTORICAL_STEM_RT_ID,
            Account__c = parent.AccountId,
            Enquiry__c = parent.Id,
            Port__c = port.Id,
            Vessel__c = parent.Vessel__c,
            Delivery_Date__c = Date.today(),
            Stem_Date__c = Date.today(),
            Korea_Desk__c = choice
        );
    }
}
