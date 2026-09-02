public class NominationTriggerHandler {
    public static void deprecateNomination(List<Nomination__c> nominations){
        Set<String> stemIds = new Set<String>();
        Set<String> accountIds = new Set<String>();
        for(Nomination__c nomination: nominations){
            stemIds.add(nomination.STEM__c);
            accountIds.add(nomination.Account__c);
        }
        Map<String, Boolean> lineItemExist = new Map<String, Boolean>();
        Map<String, Boolean> hasLineItem = new Map<String, Boolean>();
        Map<String, Boolean> hasExtraCost = new Map<String, Boolean>();
        Map<String, Boolean> hasNonTrusteeExtraCost = new Map<String, Boolean>();
        for(STEM_Line_Item__c stemLineItem: [SELECT Id, STEM__c, Original_Supplier__c, Original_Supplier__r.Name, Payment_Term__c FROM STEM_Line_Item__c WHERE STEM__c IN: stemIds AND Original_Supplier__c IN: accountIds]){
            String key = stemLineItem.STEM__c + ',' + stemLineItem.Original_Supplier__c + ',' + stemLineItem.Payment_Term__c;
            lineItemExist.put(key, true);
            if(stemLineItem.Original_Supplier__r.Name == FCBStatic.FCBS_NAME){
                hasLineItem.put(key, true);
            }
        }
        for(STEM_Extra_Cost__c stemExtraCost: [SELECT Id, STEM__c, Supplier__c, Supplier__r.Name, Payment_Term__c, Product2Id__c, Product2Id__r.Name FROM STEM_Extra_Cost__c WHERE STEM__c IN: stemIds AND Supplier__c IN: accountIds]){
            String key = stemExtraCost.STEM__c + ',' + stemExtraCost.Supplier__c + ',' + stemExtraCost.Payment_Term__c;
            lineItemExist.put(key, true);
            if(stemExtraCost.Supplier__r.Name == FCBStatic.FCBS_NAME){
                hasExtraCost.put(key, true);

                if (stemExtraCost.Product2Id__c != null && stemExtraCost.Product2Id__r.Name != FCBStatic.TRUSTEE_SERVICE) {
                    hasNonTrusteeExtraCost.put(key, true);
                }
            }

        }
        for(Nomination__c nomination: nominations){
            String key = nomination.STEM__c + ',' + nomination.Account__c + ',' + nomination.Payment_Term__c;
            if(lineItemExist.get(key) == null && !nomination.Unspecified_Account__c && nomination.RecordTypeId == FCBStatic.NOMINATION_SUPPLIER_RT_IT && !nomination.Deprecated__c){
                nomination.Deprecated__c = true;
            }

            Boolean hasLI = hasLineItem.containsKey(key);
            Boolean hasEC = hasExtraCost.containsKey(key);
            Boolean hasNonTrusteeEC = hasNonTrusteeExtraCost.containsKey(key);
            if (!hasLI && hasEC && !hasNonTrusteeEC) {
                nomination.PDF__c = '⚫';
            }
        }
    }
    /*
    public static void assignSupplierNomination(List<Nomination__c> nominations) {
        Set<Id> stemIds = new Set<Id>();
        Set<Id> accountIds = new Set<Id>();
        Map<String, Id> nominationMap = new Map<String, Id>();
        for (Nomination__c nomination : nominations) {
            if (nomination.STEM__c != null && nomination.Account__c != null && nomination.Payment_Term__c != null && nomination.RecordTypeId == FCBStatic.NOMINATION_SUPPLIER_RT_IT && !nomination.Deprecated__c) {
                stemIds.add(nomination.STEM__c);
                accountIds.add(nomination.Account__c);
                String key = nomination.STEM__c + ',' + nomination.Account__c + ',' + nomination.Payment_Term__c;
                nominationMap.put(key, nomination.Id);
            }
        }

        List<STEM_Line_Item__c> lineItemsToUpdate = new List<STEM_Line_Item__c>();
        for (STEM_Line_Item__c line : [
            SELECT Id, STEM__c, Original_Supplier__c, Payment_Term__c, Supplier_Nomination__c
            FROM STEM_Line_Item__c
            WHERE STEM__c IN :stemIds AND Original_Supplier__c IN :accountIds
        ]) {
            String key = line.STEM__c + ',' + line.Original_Supplier__c + ',' + line.Payment_Term__c;
            if (nominationMap.containsKey(key)) {
                Id relatedNomId = nominationMap.get(key);
                if (line.Supplier_Nomination__c != relatedNomId) {
                    line.Supplier_Nomination__c = relatedNomId;
                    lineItemsToUpdate.add(line);
                }
            }
        }

        List<STEM_Extra_Cost__c> extraCostsToUpdate = new List<STEM_Extra_Cost__c>();
        for (STEM_Extra_Cost__c cost : [
            SELECT Id, STEM__c, Supplier__c, Payment_Term__c, Supplier_Nomination__c
            FROM STEM_Extra_Cost__c
            WHERE STEM__c IN :stemIds AND Supplier__c IN :accountIds
        ]) {
            String key = cost.STEM__c + ',' + cost.Supplier__c + ',' + cost.Payment_Term__c;
            if (nominationMap.containsKey(key)) {
                Id relatedNomId = nominationMap.get(key);
                if (cost.Supplier_Nomination__c != relatedNomId) {
                    cost.Supplier_Nomination__c = relatedNomId;
                    extraCostsToUpdate.add(cost);
                }
            }
        }

        if (!lineItemsToUpdate.isEmpty()){
            ContextManager.avoidSTEMLineItemFiring = true;
            update lineItemsToUpdate;
            ContextManager.avoidSTEMLineItemFiring = false;
        }
        if (!extraCostsToUpdate.isEmpty()){
            ContextManager.avoidSTEMExtraCostFiring = true;
            update extraCostsToUpdate;
            ContextManager.avoidSTEMExtraCostFiring = false;
        }
    }
*/

    public static void createStemStatuses(List<Nomination__c> nominations){
        List<STEM_Status__c> stemStatuses = new List<STEM_Status__c>();
        for(Nomination__c nomination : nominations){
            stemStatuses.add(new STEM_Status__c(
                Nomination__c = nomination.Id,
                STEM__c = nomination.STEM__c,
                Enquiry__c = nomination.Enquiry__c,
                Name = nomination.STEM__r.Name,
                Account__c = nomination.Account__c
            ));
        }
        insert stemStatuses;
    }

    public static void deleteContentDocuments(Map<Id, Nomination__c> nominationMap) {
        List<ContentDocumentLink> contentDocumentLinkList =[SELECT Id, ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId In: nominationMap.keySet()];
        List<Id> docIdList = new List<Id>();
        for(ContentDocumentLink cdl: ContentDocumentLinkList){
            docIdList.add(cdl.ContentDocumentId);
        }
        List<ContentDocument> conDocList = [SELECT Id FROM ContentDocument where Id IN: docIdList];
        delete conDocList;
    }
}