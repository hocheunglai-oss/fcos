@IsTest
private class StemExtraCostSwapsNormalizationTest {
    @IsTest
    static void normalizesOnlyExactSwapsProduct() {
        Product2 swaps = new Product2(Name = 'SWAPS', IsActive = true);
        Product2 other = new Product2(Name = 'OTHER CHARGE', IsActive = true);
        insert new List<Product2>{ swaps, other };

        STEM_Extra_Cost__c swapsCost = new STEM_Extra_Cost__c(
            Product2Id__c = swaps.Id,
            Quantity__c = 12,
            Quantity_Delivered_Per_BDN__c = 9,
            Unit_of_Measure__c = 'MT'
        );
        STEM_Extra_Cost__c otherCost = new STEM_Extra_Cost__c(
            Product2Id__c = other.Id,
            Quantity__c = 12,
            Quantity_Delivered_Per_BDN__c = 9,
            Unit_of_Measure__c = 'MT'
        );

        Test.startTest();
        StemExtraCostTriggerHandler.normalizeSwapsQuantityAndUnit(
            new List<STEM_Extra_Cost__c>{ swapsCost, otherCost }
        );
        Test.stopTest();

        System.assertEquals(0, swapsCost.Quantity__c);
        System.assertEquals(0, swapsCost.Quantity_Delivered_Per_BDN__c);
        System.assertEquals('1.', swapsCost.Unit_of_Measure__c);
        System.assertEquals(12, otherCost.Quantity__c);
        System.assertEquals(9, otherCost.Quantity_Delivered_Per_BDN__c);
        System.assertEquals('MT', otherCost.Unit_of_Measure__c);
    }
}
