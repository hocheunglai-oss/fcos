public class EnsureNominationsJob implements Queueable {

    private Set<Id> stemIds;

    public EnsureNominationsJob(Set<Id> stemIds) {
        this.stemIds = stemIds;
    }

    public void execute(QueueableContext ctx) {

        Map<String, SupplierKey> keyMap = new Map<String, SupplierKey>();

        for (STEM_Extra_Cost__c ec : [
            SELECT STEM__c, Supplier__c, Payment_Term__c
            FROM STEM_Extra_Cost__c
            WHERE STEM__c IN :stemIds
                AND Supplier__c != null
                AND Supplier__r.Inactive_Suspended__c = false
                AND Payment_Term__c != null
                AND Cancelled__c = false
        ]) {
            keyMap.put(key(ec.STEM__c, ec.Supplier__c, ec.Payment_Term__c),new SupplierKey(ec.STEM__c, ec.Supplier__c, ec.Payment_Term__c));
        }

        for (STEM_Line_Item__c li : [
            SELECT STEM__c, Original_Supplier__c, Payment_Term__c
            FROM STEM_Line_Item__c
            WHERE STEM__c IN :stemIds
                AND Original_Supplier__c != null
                AND Original_Supplier__r.Inactive_Suspended__c = false
                AND Payment_Term__c != null
                AND Cancelled__c = false
        ]) {
            keyMap.put(key(li.STEM__c, li.Original_Supplier__c, li.Payment_Term__c),new SupplierKey(li.STEM__c, li.Original_Supplier__c, li.Payment_Term__c));
        }

        if (keyMap.isEmpty()) return;

        List<Nomination__c> confirmations = [SELECT Id, STEM__c, Port__c, Expected_Delivery_Date__c, Enquiry__c, RefCode__c,
                                             (SELECT Id, STEM__c, Account__c, Payment_Term__c, Supplier_RefCode_Index__c, Deprecated__c FROM SupplierNominations__r WHERE Deprecated__c = false ORDER BY Supplier_Refcode__c) 
                                             FROM Nomination__c
                                             WHERE STEM__c IN :stemIds
                                             AND Deprecated__c = false
                                             AND RecordTypeId = :FCBStatic.NOMINATION_BUYER_RT_IT];

        Set<String> existingKeys = new Set<String>();
        Map<String, List<Nomination__c>> nominationsByKey = new Map<String, List<Nomination__c>>();

        for (Nomination__c conf : confirmations) {
            for (Nomination__c n : conf.SupplierNominations__r) {
                String k = key(n.STEM__c, n.Account__c, n.Payment_Term__c);
                existingKeys.add(k);

                if (!nominationsByKey.containsKey(k)) {
                    nominationsByKey.put(k, new List<Nomination__c>());
                }
                nominationsByKey.get(k).add(n);
            }
        }

        List<Nomination__c> toInsert = new List<Nomination__c>();

        for (Nomination__c conf : confirmations) {
            for (SupplierKey info : keyMap.values()) {

                if (conf.STEM__c != info.stemId) continue;

                String k = key(info.stemId, info.supplierId, info.paymentTerm);
                if (existingKeys.contains(k)) continue;

                Integer refIndex =
                    conf.SupplierNominations__r.isEmpty()
                        ? 1
                        : conf.SupplierNominations__r[
                            conf.SupplierNominations__r.size() - 1
                          ].Supplier_RefCode_Index__c.intValue() + 1;

                toInsert.add(new Nomination__c(
                    Name = 'Nomination',
                    Buyer_Confirmation__c = conf.Id,
                    Port__c = conf.Port__c,
                    Account__c = info.supplierId,
                    RecordTypeId = FCBStatic.NOMINATION_SUPPLIER_RT_IT,
                    Expected_Delivery_Date__c = conf.Expected_Delivery_Date__c,
                    Enquiry__c = conf.Enquiry__c,
                    STEM__c = info.stemId,
                    RefCode__c = conf.RefCode__c,
                    Supplier_RefCode_Index__c = refIndex,
                    Payment_Term__c = info.paymentTerm
                ));

                existingKeys.add(k);
            }
        }

        List<Nomination__c> toUpdate = new List<Nomination__c>();

        for (String k : nominationsByKey.keySet()) {
            List<Nomination__c> listNoms = nominationsByKey.get(k);
			
            if (listNoms.size() <= 1){
                toUpdate.addAll(listNoms);
                continue;
            } 
            Boolean keepOne = true;
            for (Nomination__c n : listNoms) {
                if (keepOne) {
                    keepOne = false;
                    continue;
                }
                n.Deprecated__c = true;
            }
            toUpdate.addAll(listNoms);
        }

        if (!toInsert.isEmpty()) {
            insert toInsert;
        }

        if (!toUpdate.isEmpty()) {
            system.debug(toUpdate);
            update toUpdate;
        }
    }

    private static String key(Id stemId, Id supplierId, String paymentTerm) {
        return stemId + '_' + supplierId + '_' + paymentTerm;
    }

    private class SupplierKey {
        Id stemId;
        Id supplierId;
        String paymentTerm;

        SupplierKey(Id stemId, Id supplierId, String paymentTerm) {
            this.stemId = stemId;
            this.supplierId = supplierId;
            this.paymentTerm = paymentTerm;
        }
    }
}
