public with sharing class OverrideNewVesselController {
    @AuraEnabled(cacheable=true)
    public static List<Vessel__c> checkVesselsByIMO(String imo) {
        if (String.isBlank(imo)) return new List<Vessel__c>();
        return [SELECT Id, Name, IMO__c, Inactive__c FROM Vessel__c WHERE IMO__c = :imo];
    }
    @AuraEnabled
    public static Vessel__c createVessel(Vessel__c newVessel, List<Id> oldVesselIds) {
        validateNrt(newVessel);
        insert newVessel;
        if (oldVesselIds != null && !oldVesselIds.isEmpty() && String.isNotBlank(newVessel.IMO__c)) {
            List<Vessel__c> oldVessels = [SELECT Id, Inactive__c FROM Vessel__c WHERE Id IN :oldVesselIds];
            for (Vessel__c vessel : oldVessels) vessel.Inactive__c = true;
            if (!oldVessels.isEmpty()) update oldVessels;
        }
        return newVessel;
    }
    @AuraEnabled
    public static void updateExistingVessels(String vesselId, String imo) {
        if (String.isBlank(imo)) return;
        List<Vessel__c> vessels = [SELECT Id, Inactive__c FROM Vessel__c WHERE Id != :vesselId AND IMO__c = :imo];
        for (Vessel__c vessel : vessels) vessel.Inactive__c = true;
        if (!vessels.isEmpty()) update vessels;
    }
    private static void validateNrt(Vessel__c vessel) {
        if (vessel.NRT__c != null && (vessel.NRT__c <= 0 || vessel.NRT__c != vessel.NRT__c.setScale(0))) {
            AuraHandledException error = new AuraHandledException('Net Registered Tonnage (NRT) must be a positive whole number.');
            error.setMessage('Net Registered Tonnage (NRT) must be a positive whole number.');
            throw error;
        }
    }
}
