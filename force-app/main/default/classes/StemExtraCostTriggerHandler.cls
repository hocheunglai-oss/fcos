/**
 * StemExtraCostTriggerHandler
 */
public class StemExtraCostTriggerHandler {
    /**
     * passQuantityBDN
     * When updating the STEM Line Items the Quantity Delivered Per BDN
     * is set to the same [jB]
     */
    public static void passQuantityBDN(List<STEM_Extra_Cost__c> stemExtraCostList) {
        Set<String> stemLineItemIds = new Set<String>();
        for (STEM_Extra_Cost__c cost : stemExtraCostList) {
            if (cost.STEM_Line_Item__c != null) {
                stemLineItemIds.add(cost.STEM_Line_Item__c);
            } else {
                //set Applicable Quantity
                cost.Quantity__c = cost.Quantity_Delivered_Per_BDN__c;
            }
        }

        List<STEM_Line_Item__c> stemLineItemList = [SELECT id ,Quantity_Delivered_Per_BDN__c
                                                                                                FROM STEM_Line_Item__c
                                                                                                WHERE Id IN :stemLineItemIds];
        if (!stemLineItemList.isEmpty()) {
            for (STEM_Line_Item__c stemLineItem : stemLineItemList) {
                for (STEM_Extra_Cost__c stemExtraCost : stemExtraCostList) {
                    if(!stemExtraCost.Fixed__c && stemExtraCost.STEM_Line_Item__c == stemLineItem.Id){
                        stemExtraCost.Quantity_Delivered_Per_BDN__c = stemLineItem.Quantity_Delivered_Per_BDN__c;
                    }
                }
            }
        }
    }

    public static void setPortAndVessel(List<STEM_Extra_Cost__c> stemExtraCosts){
        List<String> stemIds = new List<String>();
        for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts){
            stemIds.add(stemExtraCost.STEM__c);
        }
        List<STEM__c> stems = [SELECT Id, Port__c, Vessel__c FROM STEM__c WHERE ID In: stemIds];
        for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts){
            for(STEM__c stem: stems){
                if(stemExtraCost.STEM__c == stem.Id){
                    stemExtraCost.Port__c = stem.Port__c;
                    stemExtraCost.Vessel__c = stem.Vessel__c;
                }
            }
        }
    }

    public static void createNomination(Map<Id, STEM_Extra_Cost__c> stemExtraCostMap){
        Set<Id> supplierIds = new Set<Id>();
        Set<Id> stemIds = new Set<Id>();
        for(STEM_Extra_Cost__c stemExtraCost: stemExtraCostMap.values()){
            supplierIds.add(stemExtraCost.Supplier__c);
            stemIds.add(stemExtraCost.STEM__c);
        }
        if(!supplierIds.isEmpty()){
            List<Nomination__c> confirmations = [SELECT Id, Port__c, Expected_Delivery_Date__c, Enquiry__c, STEM__c, RefCode__c, PDF__c, Sent__c, Received__c, Payment_Term__c,
                                                 (SELECT Id, Account__c, STEM__c, PDF__c, Sent__c, Received__c, Supplier_RefCode_Index__c, Payment_Term__c FROM SupplierNominations__r WHERE Deprecated__c = false ORDER By Supplier_RefCode_Index__c)
                                                 FROM Nomination__c WHERE STEM__c IN: stemIds AND RecordTypeId =: FCBStatic.NOMINATION_BUYER_RT_IT AND Deprecated__c = false];
            List<Nomination__c> nominationsToInsert = new List<Nomination__c>();
            Map<Id, Nomination__c> nominationsToUpdate = new Map<Id, Nomination__c>();
            for(Nomination__c confirmation: confirmations){
                Boolean createNewNomination = true;
                for(Nomination__c nomination: confirmation.SupplierNominations__r){
                    if(supplierIds.contains(nomination.Account__c)){
                        for(STEM_Extra_Cost__c stemExtraCost: stemExtraCostMap.values()){
                            if(nomination.STEM__c == stemExtraCost.STEM__c && nomination.Account__c == stemExtraCost.Supplier__c && nomination.Payment_Term__c == stemExtraCost.Payment_Term__c){
                                   nomination.PDF__c = nomination.PDF__c == '🟢'
                                    ? '🟡'
                                    : nomination.PDF__c == '⚫'
                                        ? '🔴'
                                        : nomination.PDF__c;
                                nomination.Sent__c = nomination.Sent__c == '🟢' ? '🟡' : nomination.Sent__c;
                                nomination.Received__c = nomination.Received__c == '🟢' ? '🟡' : nomination.Received__c;
                                nominationsToUpdate.put(nomination.Id, nomination);
                            }
                            if(confirmation.STEM__c == stemExtraCost.STEM__c){
                                confirmation.PDF__c = confirmation.PDF__c == '🟢' ? '🟡' : confirmation.PDF__c;
                                confirmation.Sent__c = confirmation.Sent__c == '🟢' ? '🟡' : confirmation.Sent__c;
                                confirmation.Received__c = confirmation.Received__c == '🟢' ? '🟡' : confirmation.Received__c;
                            }
                        }
                        createNewNomination = false;
                    }
                }
                nominationsToUpdate.put(confirmation.Id, confirmation);
                if(createNewNomination){
                    Integer refCodeIndex = confirmation.SupplierNominations__r.size() > 0
                                            ? confirmation.SupplierNominations__r.get(confirmation.SupplierNominations__r.size() - 1).Supplier_RefCode_Index__c.intValue() + 1
                                            : 1;
                    for(STEM_Extra_Cost__c stemExtraCost: stemExtraCostMap.values()){
                        if(confirmation.STEM__c == stemExtraCost.STEM__c && stemExtraCost.Supplier__c != null){
                           nominationsToInsert.add(new Nomination__c(
                                                Name = 'Nomination to ' + stemExtraCost.Supplier_Name__c,
                                                Buyer_Confirmation__c = confirmation.Id,
                                                Port__c = confirmation.Port__c,
                                                Account__c = stemExtraCost.Supplier__c,
                                                RecordTypeId = FCBStatic.NOMINATION_SUPPLIER_RT_IT,
                                                Expected_Delivery_Date__c = confirmation.Expected_Delivery_Date__c,
                                                Enquiry__c = confirmation.Enquiry__c,
                                                STEM__c = stemExtraCost.STEM__c,
                                                RefCode__c = confirmation.RefCode__c,
                                                Supplier_RefCode_Index__c = refCodeIndex,
                                                   Payment_Term__c = stemExtraCost.Payment_Term__c
                                                //Offer_Line_Item__c = li.OfferLineItem,
                            ));
                            refCodeIndex++;
                        }
                    }
                }
            }
            update nominationsToUpdate.values();
            insert nominationsToInsert;
            System.enqueueJob(new EnsureNominationsJob(stemIds));
        }
    }

    public static void updateNominationForSTEMCharge(Map<Id, STEM_Extra_Cost__c> stemExtraCostMap, Map<Id, STEM_Extra_Cost__c> oldStemExtraCostMap){
        Set<Id> supplierIds = new Set<Id>();
        Set<Id> stemIds = new Set<Id>();
        for (STEM_Extra_Cost__c stemExtraCost : stemExtraCostMap.values()) {
            STEM_Extra_Cost__c oldRec = oldStemExtraCostMap.get(stemExtraCost.Id);
            Boolean isChanged =
                ( (stemExtraCost.Quantity__c ?? 0) != (oldRec.Quantity__c ?? 0) ) ||
                ( (stemExtraCost.Quantity_Range_Max__c ?? 0) != (oldRec.Quantity_Range_Max__c ?? 0) ) ||
                ( stemExtraCost.Fixed__c != oldRec.Fixed__c ) ||
                ( stemExtraCost.Is_Quantity_Range__c != oldRec.Is_Quantity_Range__c ) ||
                ( (stemExtraCost.Lumpsum_Cost__c ?? 0) != (oldRec.Lumpsum_Cost__c ?? 0) ) ||
                ( (stemExtraCost.Minimum_Buy_At__c ?? 0) != (oldRec.Minimum_Buy_At__c ?? 0) ) ||
                ( stemExtraCost.Payment_Term__c != oldRec.Payment_Term__c ) ||
                ( stemExtraCost.Unit_of_Measure__c != oldRec.Unit_of_Measure__c ) ||
                ( (stemExtraCost.Unit_Cost__c ?? 0) != (oldRec.Unit_Cost__c ?? 0) ) ||
                (
                    stemExtraCost.Supplier__c != oldRec.Supplier__c &&
                    !oldRec.Unspecified_Supplier__c
                );

            if (isChanged) {
                supplierIds.add(stemExtraCost.Supplier__c);
                stemIds.add(stemExtraCost.STEM__c);
            }
        }
        if(!stemIds.isEmpty() && !supplierIds.isEmpty()){
            List<Nomination__c> confirmations = [SELECT Id, STEM__c, Port__c, Expected_Delivery_Date__c, Enquiry__c, RefCode__c, PDF__c, Sent__c, Received__c, Payment_Term__c,
                                               (SELECT Id, PDF__c, Sent__c, Received__c, STEM__c, Account__c, Supplier_RefCode_Index__c, RecordTypeId, Payment_Term__c FROM SupplierNominations__r WHERE Deprecated__c = false ORDER By Supplier_RefCode_Index__c)
                                               FROM Nomination__c WHERE STEM__c =: stemIds AND Deprecated__c = false AND RecordTypeId =: FCBStatic.NOMINATION_BUYER_RT_IT];
            List<Nomination__c> nominationsToInsert = new List<Nomination__c>();
            Map<Id, Nomination__c> nominationsToUpdate = new Map<Id, Nomination__c>();
            Map<String, Boolean> nominationExist = new Map<String, Boolean>();
            for(Nomination__c confirmation: confirmations){
                for(Nomination__c nomination: confirmation.SupplierNominations__r){
                    for(STEM_Extra_Cost__c stemExtraCost: stemExtraCostMap.values()){
                        if(nomination.STEM__c == stemExtraCost.STEM__c && nomination.Account__c == stemExtraCost.Supplier__c && nomination.Payment_Term__c == stemExtraCost.Payment_Term__c){
                            nomination.PDF__c = nomination.PDF__c == '🟢'
                                    ? '🟡'
                                    : nomination.PDF__c == '⚫'
                                        ? '🔴'
                                        : nomination.PDF__c;
                            nomination.Sent__c = nomination.Sent__c == '🟢' ? '🟡' : nomination.Sent__c;
                            nomination.Received__c = nomination.Received__c == '🟢' ? '🟡' : nomination.Received__c;
                        }
                        if(stemExtraCost.Supplier__c != oldStemExtraCostMap.get(stemExtraCost.Id).Supplier__c){
                            if(nomination.STEM__c == stemExtraCost.STEM__c && nomination.Account__c == oldStemExtraCostMap.get(stemExtraCost.Id).Supplier__c){
                                nomination.PDF__c = nomination.PDF__c == '🟢'
                                    ? '🟡'
                                    : nomination.PDF__c == '⚫'
                                        ? '🔴'
                                        : nomination.PDF__c;
                                nomination.Sent__c = nomination.Sent__c == '🟢' ? '🟡' : nomination.Sent__c;
                                nomination.Received__c = nomination.Received__c == '🟢' ? '🟡' : nomination.Received__c;
                            }
                        }
                        if(stemExtraCost.Payment_Term__c != oldStemExtraCostMap.get(stemExtraCost.Id).Payment_Term__c){
                            if(nomination.STEM__c == stemExtraCost.STEM__c && nomination.Account__c == stemExtraCost.Supplier__c
                               && nomination.Payment_Term__c == oldStemExtraCostMap.get(stemExtraCost.Id).Payment_Term__c){
                                   nomination.PDF__c = nomination.PDF__c == '🟢'
                                    ? '🟡'
                                    : nomination.PDF__c == '⚫'
                                        ? '🔴'
                                        : nomination.PDF__c;
                                nomination.Sent__c = nomination.Sent__c == '🟢' ? '🟡' : nomination.Sent__c;
                                nomination.Received__c = nomination.Received__c == '🟢' ? '🟡' : nomination.Received__c;
                                nomination.Payment_Term__c = stemExtraCost.Payment_Term__c;
                            }
                        }
                    }
                    nominationExist.put(nomination.STEM__c + ',' + nomination.Account__c + ',' + nomination.Payment_Term__c, true);
                    nominationsToUpdate.put(nomination.Id, nomination);
                }
            }
            for(Nomination__c confirmation: confirmations){
                for(STEM_Extra_Cost__c stemExtraCost: stemExtraCostMap.values()){
                    if(nominationExist.get(stemExtraCost.STEM__c + ',' + stemExtraCost.Supplier__c + ',' + stemExtraCost.Payment_Term__c) == null && stemExtraCost.Supplier__c != null){
                        Integer refCodeIndex = confirmation.SupplierNominations__r.size() > 0
                                                ? confirmation.SupplierNominations__r.get(confirmation.SupplierNominations__r.size() - 1).Supplier_RefCode_Index__c.intValue() + 1
                                                : 1;
                        nominationsToInsert.add(new Nomination__c(
                                                Name = 'Nomination to ' + stemExtraCost.Supplier_Name__c,
                                                Buyer_Confirmation__c = confirmation.Id,
                                                Port__c = confirmation.Port__c,
                                                Account__c = stemExtraCost.Supplier__c,
                                                RecordTypeId = FCBStatic.NOMINATION_SUPPLIER_RT_IT,
                                                Expected_Delivery_Date__c = confirmation.Expected_Delivery_Date__c,
                                                Enquiry__c = confirmation.Enquiry__c,
                                                STEM__c = stemExtraCost.STEM__c,
                                                RefCode__c = confirmation.RefCode__c,
                                                Supplier_RefCode_Index__c = refCodeIndex,
                                                //Offer_Line_Item__c = li.OfferLineItem,
                                                Payment_Term__c = stemExtraCost.Payment_Term__c
                        ));
                    }
                }
            }
            insert nominationsToInsert;
            update nominationsToUpdate.values();
            System.enqueueJob(new EnsureNominationsJob(stemIds));
        }
    }

    public static void updateConfirmations(Map<Id, STEM_Extra_Cost__c> stemExtraCostMap, Map<Id, STEM_Extra_Cost__c> oldStemExtraCostMap){
        Set<String> stemIds = new Set<String>();
        for (STEM_Extra_Cost__c stemExtraCost : stemExtraCostMap.values()) {
            STEM_Extra_Cost__c oldRec = oldStemExtraCostMap.get(stemExtraCost.Id);
            Boolean isChanged =
                ( (stemExtraCost.Quantity__c ?? 0) != (oldRec.Quantity__c ?? 0) ) ||
                ( (stemExtraCost.Quantity_Range_Max__c ?? 0) != (oldRec.Quantity_Range_Max__c ?? 0) ) ||
                ( stemExtraCost.Fixed__c != oldRec.Fixed__c ) ||
                ( stemExtraCost.Is_Quantity_Range__c != oldRec.Is_Quantity_Range__c ) ||
                ( (stemExtraCost.Lumpsum_Price__c ?? 0) != (oldRec.Lumpsum_Price__c ?? 0) ) ||
                ( (stemExtraCost.Minimum_Sell_At__c ?? 0) != (oldRec.Minimum_Sell_At__c ?? 0) ) ||
                ( stemExtraCost.Unit_of_Measure__c != oldRec.Unit_of_Measure__c ) ||
                ( (stemExtraCost.Unit_Price__c ?? 0) != (oldRec.Unit_Price__c ?? 0) ) ||
                ( stemExtraCost.Product2Id__c != oldRec.Product2Id__c ) ||
                ( stemExtraCost.Supplier__c != oldRec.Supplier__c );

            if (isChanged) {
                stemIds.add(stemExtraCost.STEM__c);
            }
        }
        if(!stemIds.isEmpty()){
            List<Nomination__c> confirmations = [SELECT Id, STEM__c, PDF__c, Sent__c, Received__c
                                                 FROM Nomination__c WHERE STEM__c =: stemIds AND Deprecated__c = false AND RecordTypeId =: FCBStatic.NOMINATION_BUYER_RT_IT];
            for(Nomination__c confirmation: confirmations){
                for(STEM_Extra_Cost__c stemExtraCost: stemExtraCostMap.values()){
                    if(confirmation.STEM__c == stemExtraCost.STEM__c){
                        confirmation.PDF__c = confirmation.PDF__c == '🟢' ? '🟡' : confirmation.PDF__c;
                        confirmation.Sent__c = confirmation.Sent__c == '🟢' ? '🟡' : confirmation.Sent__c;
                        confirmation.Received__c = confirmation.Received__c == '🟢' ? '🟡' : confirmation.Received__c;
                    }
                }
            }
            update confirmations;
        }
    }

    public static void deprecateNomination(Map<Id, STEM_Extra_Cost__c> stemExtraCostMap){
        Set<Id> supplierIds = new Set<Id>();
        Set<Id> stemIds = new Set<Id>();
        Set<String> paymentTerms = new Set<String>();
        for(STEM_Extra_Cost__c stemExtraCost: stemExtraCostMap.values()){
            supplierIds.add(stemExtraCost.Supplier__c);
               stemIds.add(stemExtraCost.STEM__c);
            paymentTerms.add(stemExtraCost.Payment_Term__c);
        }
        List<STEM_Line_Item__c> sameSupplierStemLineItems = [SELECT Id FROM STEM_LIne_Item__c WHERE STEM__c IN: stemIds AND Original_Supplier__c IN: supplierIds AND Payment_Term__c IN: paymentTerms];
        List<STEM_Extra_Cost__c> sameSupplierStemExtraCosts = [SELECT Id FROM STEM_Extra_Cost__c
                                                               WHERE STEM__c IN: stemIds and Supplier__c IN: supplierIds AND Payment_Term__c IN: paymentTerms AND Id NOT IN: stemExtraCostMap.keySet()];
        List<Nomination__c> nominations = [SELECT Id, PDF__c, Deprecated__c, STEM__c, Account__c, Sent__c, Received__c, RecordTypeId, Payment_Term__c FROM Nomination__c WHERE STEM__c IN: stemIds];
        if(sameSupplierStemLineItems.isEmpty() && sameSupplierStemExtraCosts.isEmpty()){
            for(Nomination__c nomination: nominations){
                for(STEM_Extra_Cost__c stemExtraCost: stemExtraCostMap.values()){
                    if(nomination.STEM__c == stemExtraCost.STEM__c && nomination.Account__c == stemExtraCost.Supplier__c && nomination.Payment_Term__c == stemExtraCost.Payment_Term__c){
                        nomination.Deprecated__c = true;
                    }
                    if(nomination.STEM__c == stemExtraCost.STEM__c && nomination.RecordTypeId == FCBStatic.NOMINATION_BUYER_RT_IT){
                        nomination.PDF__c = nomination.PDF__c == '🟢' ? '🟡' : nomination.PDF__c;
                        nomination.Sent__c = nomination.Sent__c == '🟢' ? '🟡' : nomination.Sent__c;
                        nomination.Received__c = nomination.Received__c == '🟢' ? '🟡' : nomination.Received__c;
                    }
                }
            }
        } else{
            for(Nomination__c nomination: nominations){
                for(STEM_Extra_Cost__c stemExtraCost: stemExtraCostMap.values()){
                    if(nomination.STEM__c == stemExtraCost.STEM__c && nomination.Account__c == stemExtraCost.Supplier__c && nomination.Payment_Term__c == stemExtraCost.Payment_Term__c){
                        nomination.PDF__c = nomination.PDF__c == '🟢'
                                    ? '🟡'
                                    : nomination.PDF__c == '⚫'
                                        ? '🔴'
                                        : nomination.PDF__c;
                        nomination.Sent__c = nomination.Sent__c == '🟢' ? '🟡' : nomination.Sent__c;
                        nomination.Received__c = nomination.Received__c == '🟢' ? '🟡' : nomination.Received__c;
                    }
                    if(nomination.STEM__c == stemExtraCost.STEM__c && nomination.RecordTypeId == FCBStatic.NOMINATION_BUYER_RT_IT){
                        nomination.PDF__c = nomination.PDF__c == '🟢' ? '🟡' : nomination.PDF__c;
                        nomination.Sent__c = nomination.Sent__c == '🟢' ? '🟡' : nomination.Sent__c;
                        nomination.Received__c = nomination.Received__c == '🟢' ? '🟡' : nomination.Received__c;
                    }
                }
            }
        }
        update nominations;
        System.enqueueJob(new EnsureNominationsJob(stemIds));
    }

    public static void updateNominationUnspecifiedSupplier(Map<Id, STEM_Extra_Cost__c> stemExtraCostMap, Map<Id, STEM_Extra_Cost__c> oldStemExtraCostMap){
        Set<String> stemIds = new Set<String>();
        Set<String> supplierIds = new Set<String>();
        for(STEM_Extra_Cost__c stemExtraCost: stemExtraCostMap.values()){
            if((stemExtraCost.Supplier__c != oldStemExtraCostMap.get(stemExtraCost.Id).Supplier__c &&
               oldStemExtraCostMap.get(stemExtraCost.Id).Unspecified_Supplier__c)){
                stemIds.add(stemExtraCost.STEM__c);
                supplierIds.add(oldStemExtraCostMap.get(stemExtraCost.Id).Supplier__c);
            }
        }
        if(!stemIds.isEmpty()){
            List<Nomination__c> nominations = [SELECT Id, STEM__c, Account__c
                                                 FROM Nomination__c WHERE STEM__c =: stemIds AND Account__c IN: supplierIds AND Deprecated__c = false AND RecordTypeId =: FCBStatic.NOMINATION_SUPPLIER_RT_IT];
            Map<String, List<Nomination__c>> nominationMap = new Map<String, List<Nomination__c>>();
            for(Nomination__c nomination: nominations){
                if(nominationMap.get(nomination.STEM__c + ',' + nomination.Account__c) == null){
                    nominationMap.put(nomination.STEM__c + ',' + nomination.Account__c, new List<Nomination__c>());
                }
                nominationMap.get(nomination.STEM__c + ',' + nomination.Account__c).add(nomination);
            }
            Map<String, Boolean> lineItemExist = new Map<String, Boolean>();
            for(STEM_Line_Item__c stemLineItem: [SELECT Id, STEM__c, Original_Supplier__c FROM STEM_Line_Item__c WHERE STEM__c IN: stemIds AND Original_Supplier__c IN: supplierIds]){
                lineItemExist.put(stemLineItem.STEM__c + ',' + stemLineItem.Original_Supplier__c, true);
            }
            for(STEM_Extra_Cost__c stemExtraCost: [SELECT Id, STEM__c, Supplier__c FROM STEM_Extra_Cost__c WHERE Id NOT IN: stemExtraCostMap.keySet() AND STEM__c IN: stemIds AND Supplier__c IN: supplierIds]){
               lineItemExist.put(stemExtraCost.STEM__c + ',' + stemExtraCost.Supplier__c, true);
            }
            for(STEM_Extra_Cost__c stemExtraCost: stemExtraCostMap.values()){
                if(nominationMap.get(stemExtraCost.STEM__c + ',' + oldStemExtraCostMap.get(stemExtraCost.Id).Supplier__c).size() == 1
                   && lineItemExist.get(stemExtraCost.STEM__c + ',' + oldStemExtraCostMap.get(stemExtraCost.Id).Supplier__c) == null){
                    nominationMap.get(stemExtraCost.STEM__c + ',' + oldStemExtraCostMap.get(stemExtraCost.Id).Supplier__c)[0].Account__c = stemExtraCost.Supplier__c;
                }
            }
            update nominations;
        }
    }

    public static void updateDisputes(List<STEM_Extra_Cost__c> stemExtraCosts, Map<Id, STEM_Extra_Cost__c> oldStemExtraCostMap){
        Set<String> stemIds = new Set<String>();
        for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts){
            if(stemExtraCost.Supplier__c != oldStemExtraCostMap.get(stemExtraCost.Id).Supplier__c ||
               stemExtraCost.Payment_Term__c != oldStemExtraCostMap.get(stemExtraCost.Id).Payment_Term__c){
                stemIds.add(stemExtraCost.STEM__c);
            }
        }
        if(!stemIds.isEmpty()){
            List<Dispute__c> disputes = [SELECT Id, Supplier__c, Payment_Term__c, STEM__c FROM Dispute__c WHERE STEM__c IN: stemIds];
            for(Dispute__c dispute: disputes){
                for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts){
                    if(dispute.STEM__c == stemExtraCost.STEM__c && dispute.Supplier__c == oldStemExtraCostMap.get(stemExtraCost.Id).Supplier__c){
                        dispute.Supplier__c = stemExtraCost.Supplier__c;
                    }
                    if(dispute.STEM__c == stemExtraCost.STEM__c && dispute.Supplier__c == oldStemExtraCostMap.get(stemExtraCost.Id).Supplier__c && dispute.Payment_Term__c == oldStemExtraCostMap.get(stemExtraCost.Id).Payment_Term__c){
                        dispute.Payment_Term__c = stemExtraCost.Payment_Term__c;
                    }
                }
            }
            if(!disputes.isEmpty()){
                update disputes;
            }
        }
    }

    public static void createReconfirmTasks(List<STEM_Extra_Cost__c> stemExtraCosts, Map<Id, STEM_Extra_Cost__c> oldStemExtraCostMap, TriggerOperation operation){
        Set<String> stemIds = new Set<String>();
        for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts){
            if(operation == TriggerOperation.AFTER_INSERT){
                if(stemExtraCost.Payment_Term__c == 'CIA' && stemExtraCost.RecordTypeId == FCBStatic.STEM_CHARGE_RT_ID){
                    stemIds.add(stemExtraCost.STEM__c);
                }
            } else{
                if(stemExtraCost.Payment_Term__c == 'CIA' && stemExtraCost.RecordTypeId == FCBStatic.STEM_CHARGE_RT_ID
                   && (stemExtraCost.Supplier__c != oldStemExtraCostMap.get(stemExtraCost.Id).Supplier__c
                   || stemExtraCost.Payment_Term__c != oldStemExtraCostMap.get(stemExtraCost.Id).Payment_Term__c)){
                    stemIds.add(stemExtraCost.STEM__c);
                }
            }
        }
        if(!stemIds.isEmpty()){
            List<STEM__c> stems = [SELECT Id, Enquiry__c, Name FROM STEM__c WHERE Id IN: stemIds];
            Map<String, Id> userIdMap = new Map<String, Id>();
            for (User user : [SELECT Id, Name FROM User WHERE Id =: UserInfo.getUserId() OR Name = 'Vincent Lee']) {
                userIdMap.put(user.Name, user.Id);
            }
            Map<String, Task> taskMap = new Map<String, Task>();
            for (STEM__c stem : stems) {
                for (STEM_Extra_Cost__c stemExtraCost : stemExtraCosts) {
                    if(stemExtraCost.STEM__c == stem.Id && stemExtraCost.Payment_Term__c == 'CIA'){
                        taskMap.put(stem.Id + '-' + stemExtraCost.Supplier__c, new Task(
                                    WhatId = stem.Enquiry__c,
                                    Subject = 'CIA Reconfirm Task - Added',
                                    Status = 'Open',
                                    Priority = 'Normal',
                                    IsReminderSet = true,
                                    ReminderDateTime = Datetime.now(),
                                    Description = 'Intended Payment Date is missing for STEM: ' + stem.Name + ' - SUPPLIER: ' + stemExtraCost.Supplier_Name__c,
                                    Reconfirm_Unique_Key__c = stem.Id + '-' + stemExtraCost.Supplier__c,
                                    OwnerId = userIdMap.size() > 1 ? UserInfo.getUserId() : userIdMap.get('Vincent Lee')
                        ));
                    }
                }
            }
            upsert taskMap.values() Reconfirm_Unique_Key__c;
        }
    }

    public static void updateIsChangedCSVField(List<STEM_Extra_Cost__c> stemExtraCosts, Map<Id, STEM_Extra_Cost__c> oldStemExtraCostMap){
        for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts){
            STEM_Extra_Cost__c oldStemExtraCost = oldstemExtraCostMap.get(stemExtraCost.Id);
            if(stemExtraCost.Is_Purchase_CSV_Exported__c && (stemExtraCost.Line_Total_Buy__c != oldStemExtraCost.Line_Total_Buy__c
                                                            || stemExtraCost.Supplier__c != oldStemExtraCost.Supplier__c)){
                stemExtraCost.Is_Purchase_CSV_Info_Changed__c = true;
                if(stemExtraCost.Supplier__c != oldStemExtraCost.Supplier__c){
                    stemExtraCost.Refcode_Index__c = null;
                }
            }
        }
    }

    public static void updateRelatedRecordsIsChangedCSvField(List<STEM_Extra_Cost__c> stemExtraCosts, Map<Id, STEM_Extra_Cost__c> oldStemExtraCostMap){
        List<Id> oldSupplierIds = new List<Id>();
        List<Id> stemIds = new List<Id>();
        for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts){
            STEM_Extra_Cost__c oldStemExtraCost = oldstemExtraCostMap.get(stemExtraCost.Id);
            if(stemExtraCost.Supplier__c != oldStemExtraCost.Supplier__c){
                oldSupplierIds.add(oldStemExtraCost.Supplier__c);
                stemIds.add(stemExtraCost.STEM__c);
            }
        }
        if(!stemIds.isEmpty()){
            List<STEM_Line_Item__c> oldSupplierStemLineItems = [SELECT Id, Is_Purchase_CSV_Info_Changed__c
                                                                FROM STEM_Line_Item__c WHERE STEM__c IN: stemIds AND Original_Supplier__c IN: oldSupplierIds];
            if(!oldSupplierStemLineItems.isEmpty()){
                for(STEM_Line_Item__c oldSupplierStemLineItem: oldSupplierStemLineItems){
                    oldSupplierStemLineItem.Is_Purchase_CSV_Info_Changed__c = true;
                }
                ContextManager.avoidSTEMLineItemFiring = true;
                update oldSupplierStemLineItems;
                ContextManager.avoidSTEMLineItemFiring = false;
            }
            List<STEM_Extra_Cost__c> oldSupplierStemExtraCosts = [SELECT Id, Is_Purchase_CSV_Info_Changed__c
                                                                  FROM STEM_Extra_Cost__c WHERE STEM__c IN: stemIds AND Supplier__c IN: oldSupplierIds
                                                                  AND Id NOT IN: oldStemExtraCostMap.keySet()];
            if(!oldSupplierStemExtraCosts.isEmpty()){
                for(STEM_Extra_Cost__c oldSupplierStemExtraCost: oldSupplierStemExtraCosts){
                    oldSupplierStemExtraCost.Is_Purchase_CSV_Info_Changed__c = true;
                }
                ContextManager.avoidSTEMExtraCostFiring = true;
                update oldSupplierStemExtraCosts;
                ContextManager.avoidSTEMExtraCostFiring = false;
            }
            List<MYOB_Invoice__c> myobInvoices = [SELECT Id, Account__c, STEM__c, Is_Changed__c
                                                  FROM MYOB_Invoice__c WHERE STEM__c IN: stemIds];
            for(MYOB_Invoice__c myobInvoice: myobInvoices){
                if(oldSupplierIds.contains(myobInvoice.Account__c)){
                       myobInvoice.Is_Changed__c = true;
                }
            }
        }
    }

    public static void recalculateAmounts(List<STEM_Extra_Cost__c> stemExtraCosts, Map<Id, STEM_Extra_Cost__c> oldStemExtraCosts){
        List<Id> invoiceIds = new List<Id>();
        for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts){
            STEM_Extra_Cost__c oldStemExtraCost = oldStemExtraCosts.get(stemExtraCost.Id);
            if(stemExtraCost.Line_Total__c != oldStemExtraCost.Line_Total__c || stemExtraCost.Cancelled__c != oldStemExtraCost.Cancelled__c){
                invoiceIds.add(stemExtraCost.Buyer_Invoice__c);
            }
        }
        if(!invoiceIds.isEmpty()){
            PaidAmountService.recalculateInvoiceAmount(invoiceIds);
        }
    }

    public static void updateUninvoicedPayments(List<STEM_Extra_Cost__c> stemExtraCosts, Map<Id, STEM_Extra_Cost__c> oldStemExtraCostMap, TriggerOperation operation){
        Id payableRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Payable').getRecordTypeId();
        Set<String> stemIds = new Set<String>();
        Set<String> supplierIds = new Set<String>();
        if (operation == TriggerOperation.AFTER_DELETE) {
            for(STEM_Extra_Cost__c oldStemExtraCost: oldStemExtraCostMap.values()){
                stemIds.add(oldStemExtraCost.STEM__c);
                supplierIds.add(oldStemExtraCost.Supplier__c);
            }
        } else{
            for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts){
                if(operation == TriggerOperation.AFTER_INSERT){
                    stemIds.add(stemExtraCost.STEM__c);
                    supplierIds.add(stemExtraCost.Supplier__c);
                }else{
                    if(stemExtraCost.Quantity__c != oldStemExtraCostMap.get(stemExtraCost.Id).Quantity__c || stemExtraCost.Is_Quantity_Range__c != oldStemExtraCostMap.get(stemExtraCost.Id).Is_Quantity_Range__c ||
                       stemExtraCost.Quantity_Range_Max__c != oldStemExtraCostMap.get(stemExtraCost.Id).Quantity_Range_Max__c || stemExtraCost.Lumpsum_Cost__c != oldStemExtraCostMap.get(stemExtraCost.Id).Lumpsum_Cost__c ||
                       stemExtraCost.Supplier__c != oldStemExtraCostMap.get(stemExtraCost.Id).Supplier__c || stemExtraCost.Cancelled__c != oldStemExtraCostMap.get(stemExtraCost.Id).Cancelled__c){
                        stemIds.add(stemExtraCost.STEM__c);
                        supplierIds.add(stemExtraCost.Supplier__c);
                    }
                }
            }
        }

        if(!stemIds.isEmpty()){
            List<Payment__c> payments = [SELECT Id FROM Payment__c WHERE STEM__c IN: stemIds AND Account__c IN: supplierIds AND Supplier_Invoice__c = null AND RecordTypeId =: payableRecordTypeId AND Is_Deposit__c = false];
            if(!payments.isEmpty()){
                update payments;
            }
        }
    }

    public static void countLineTotalSell(List<STEM_Extra_Cost__c> stemExtraCosts){
        for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts){
            if(stemExtraCost.Nundination_Type__c == 'Buy'){
                stemExtraCost.Line_Total__c = 0;
            } else if(stemExtraCost.Fixed__c){
                stemExtraCost.Line_Total__c = stemExtraCost.Lumpsum_Price__c != null ? stemExtraCost.Lumpsum_Price__c : 0;
            } else{
                 if(stemExtraCost.Quantity_Delivered_Per_BDN__c == null && (stemExtraCost.Quantity__c * stemExtraCost.Unit_Price__c > stemExtraCost.Minimum_Sell_At__c || stemExtraCost.Minimum_Sell_At__c == null)){
                    stemExtraCost.Line_Total__c = stemExtraCost.Quantity__c * stemExtraCost.Unit_Price__c;
                } else if(stemExtraCost.Quantity_Delivered_Per_BDN__c != null && (stemExtraCost.Quantity_Delivered_Per_BDN__c * stemExtraCost.Unit_Price__c > stemExtraCost.Minimum_Sell_At__c || stemExtraCost.Minimum_Sell_At__c == null)){
                    stemExtraCost.Line_Total__c = stemExtraCost.Quantity_Delivered_Per_BDN__c * stemExtraCost.Unit_Price__c;
                } else {
                    stemExtraCost.Line_Total__c = stemExtraCost.Minimum_Sell_At__c;
                }
            }
        }
    }

    public static void countLineTotalBuy(List<STEM_Extra_Cost__c> stemExtraCosts){
        for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts){
            if(stemExtraCost.Nundination_Type__c == 'Sell'){
                stemExtraCost.Line_Total_Buy__c = 0;
            } else if(stemExtraCost.Fixed__c){
                stemExtraCost.Line_Total_Buy__c = stemExtraCost.Lumpsum_Cost__c != null ? stemExtraCost.Lumpsum_Cost__c : 0;
            } else{
                 if(stemExtraCost.Quantity_Delivered_Per_BDN__c == null && (stemExtraCost.Quantity__c * stemExtraCost.Unit_Cost__c > stemExtraCost.Minimum_Buy_At__c || stemExtraCost.Minimum_Buy_At__c == null)){
                    stemExtraCost.Line_Total_Buy__c = stemExtraCost.Quantity__c * stemExtraCost.Unit_Cost__c;
                } else if(stemExtraCost.Quantity_Delivered_Per_BDN__c != null && (stemExtraCost.Quantity_Delivered_Per_BDN__c * stemExtraCost.Unit_Cost__c > stemExtraCost.Minimum_Buy_At__c || stemExtraCost.Minimum_Buy_At__c == null)){
                    stemExtraCost.Line_Total_Buy__c = stemExtraCost.Quantity_Delivered_Per_BDN__c * stemExtraCost.Unit_Cost__c;
                } else {
                    stemExtraCost.Line_Total_Buy__c = stemExtraCost.Minimum_Buy_At__c;
                }
            }
        }
    }

    public static void setCalculatedAmountForSupplierInvoice(List<STEM_Extra_Cost__c> stemExtraCosts){
        List<String> supplierIds = new List<String>();
        List<String> stemIds = new List<String>();
        for(STEM_Extra_Cost__c stemExtraCost : stemExtraCosts){
            if(stemExtraCost.Supplier__c != null){
                supplierIds.add(stemExtraCost.Supplier__c);
                stemIds.add(stemExtraCost.STEM__c);
            }
        }
        List<Supplier_Invoice__c> supplierInvoices = [SELECT Id, Calculated_Amount__c, Supplier__c FROM Supplier_Invoice__c WHERE Supplier__c In :supplierIds AND STEM__c IN: stemIds];
        update supplierInvoices;
    }

    public static void updateInput(List<STEM_Extra_Cost__c> stemExtraCosts, Map<Id, STEM_Extra_Cost__c> oldStemExtraCosts){
        for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts){
            STEM_Extra_Cost__c oldStemExtraCost = oldStemExtraCosts.get(stemExtraCost.Id);
            if(stemExtraCost.Quantity_Delivered_Per_BDN__c != oldStemExtraCost.Quantity_Delivered_Per_BDN__c || stemExtraCost.Unit_Cost__c != oldStemExtraCost.Unit_Cost__c
              || stemExtraCost.Unit_Price__c != oldStemExtraCost.Unit_Price__c || stemExtraCost.Lumpsum_Cost__c != oldStemExtraCost.Lumpsum_Cost__c || stemExtraCost.Lumpsum_Price__c != oldStemExtraCost.Lumpsum_Price__c
              || stemExtraCost.Minimum_Buy_At__c != oldStemExtraCost.Minimum_Buy_At__c || stemExtraCost.Minimum_Sell_At__c != oldStemExtraCost.Minimum_Sell_At__c){
                  stemExtraCost.Input__c = '🟡';
            }
            if(stemExtraCost.Supplier_Invoice__c == null){
                stemExtraCost.Supplier_Issued__c = false;
                stemExtraCost.Supplier_Input__c = '🔴';
            }
            if(stemExtraCost.Line_Total_Buy__c != oldStemExtraCost.Line_Total_Buy__c){
                stemExtraCost.Supplier_Input__c = '🟡';
            }
        }
    }

    public static void setTotalSellBuyAt(Map<Id, STEM_Extra_Cost__c> stemExtraCosts){
        String productChargeRecordTypeId = Schema.SObjectType.STEM_Extra_Cost__c.getRecordTypeInfosByName().get('Product Charge').getRecordTypeId();
        List<String> stemLineItemIds = new List<String>();
        for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts.values()){
            stemLineItemIds.add(stemExtraCost.STEM_Line_Item__c);
        }
        List<STEM_Line_Item__c> stemLineItems = [SELECT Id, Original_Supplier__c, Total_Price__c, Total_Cost__c, Total_Extra_Buy_At__c, Total_Extra_Sell_At__c, STEM__r.Delivery_Date__c
                                                 FROM STEM_Line_Item__c
                                                 WHERE Id IN: stemLineItemIds];
        stemExtraCosts = new Map<Id, STEM_Extra_Cost__c>([SELECT Id, Supplier__c, STEM_Line_Item__c, Line_Total__c, Line_Total_Buy__c
                                                          FROM STEM_Extra_Cost__c
                                                          WHERE STEM_Line_Item__c IN: stemLineItemIds AND RecordTypeId =: productChargeRecordTypeId]);
        for(STEM_Line_Item__c stemLineItem: stemLineItems){
            Decimal totalBuyAt = 0, totalSellAt = 0;
            for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts.values()){
                if(stemLineItem.Id == stemExtraCost.STEM_Line_Item__c){
                    totalSellAt += stemExtraCost.Line_Total__c;
                    totalBuyAt += stemExtraCost.Line_Total_Buy__c;
                }
            }
            stemLineItem.Total_Extra_Buy_At__c = totalBuyAt;
            stemLineItem.Total_Extra_Sell_At__c = totalSellAt;
            stemLineItem.Subtotal_Sell_At__c = stemLineItem.Total_Price__c + stemLineItem.Total_Extra_Sell_At__c;
            stemLineItem.Subtotal_Buy_At__c = stemLineItem.Total_Cost__c + stemLineItem.Total_Extra_Buy_At__c;
        }
        ContextManager.avoidSTEMLineItemFiring = true;
        update stemLineItems;
        ContextManager.avoidSTEMLineItemFiring = false;
    }

    public static void createCashflows(Map<Id, STEM_Extra_Cost__c> stemExtraCostMap, Map<Id, STEM_Extra_Cost__c> oldStemExtraCostMap){
        String stemChargeRecordTypeId = Schema.SObjectType.STEM_Extra_Cost__c.getRecordTypeInfosByName().get('STEM Charge').getRecordTypeId();
        String supplierInvoiceRecordTypeId = Schema.SObjectType.Cashflow__c.getRecordTypeInfosByName().get('Supplier Invoice').getRecordTypeId();
        List<String> stemIds = new List<String>();
        List<String> supplierIds = new List<String>();
        List<String> oldSupplierIds = new List<String>();
        for(STEM_Extra_Cost__c stemExtraCost: stemExtraCostMap.values()){
            stemIds.add(stemExtraCost.STEM__c);
            supplierIds.add(stemExtraCost.Supplier__c);
            if(oldStemExtraCostMap != null){
              oldSupplierIds.add(oldStemExtraCostMap.get(stemExtraCost.Id).Supplier__c);
            }
        }
        List<Cashflow__c> cashflows = [SELECT Id, STEM__c, Account__c, STEM_Extra_Cost__c, Pay_Term__c, Supplier_Invoice__c FROM Cashflow__c
                                       WHERE STEM__c IN: stemIds AND RecordTypeId =: supplierInvoiceRecordTypeId
                                       AND (Account__c IN: supplierIds OR Account__c IN: oldSupplierIds)];
        Map<String, Cashflow__c> cashflowMap = new Map<String, Cashflow__c>();
        for(Cashflow__c cashflow: cashflows){
            cashflowMap.put(cashflow.STEM__c + ',' + cashflow.Account__c + ',' + cashflow.Pay_Term__c + ',' + cashflow.Supplier_Invoice__c, cashflow);
        }

        Map<String, List<STEM_Extra_Cost__c>> supplierToStemExtraCostMap = new Map<String, List<STEM_Extra_Cost__c>>();
        for(STEM_Extra_Cost__c stemExtraCost: stemExtraCostMap.values()){
            if(supplierToStemExtraCostMap.get(stemExtraCost.STEM__c + ',' + stemExtraCost.Supplier__c + ',' + stemExtraCost.Payment_Term__c + ',' + stemExtraCost.Supplier_Invoice__c) != null){
                supplierToStemExtraCostMap.get(stemExtraCost.STEM__c + ',' + stemExtraCost.Supplier__c + ',' + stemExtraCost.Payment_Term__c + ',' + stemExtraCost.Supplier_Invoice__c).add(stemExtraCost);
            } else{
                supplierToStemExtraCostMap.put(stemExtraCost.STEM__c + ',' + stemExtraCost.Supplier__c + ',' + stemExtraCost.Payment_Term__c + ',' + stemExtraCost.Supplier_Invoice__c, new List<STEM_Extra_Cost__c>{stemExtraCost});
            }
        }
        cashflows = new List<Cashflow__c>();
        STEM_Extra_Cost__c referencedStemExtraCost;
        for(String supplierAndStemId: supplierToStemExtraCostMap.keySet()){
            referencedStemExtraCost = supplierToStemExtraCostMap.get(supplierAndStemId)[0];
            if(cashflowMap.get(supplierAndStemId) == null){
                cashflows.add(new Cashflow__c(STEM__c = referencedStemExtraCost.STEM__c,
                                                Account__c = referencedStemExtraCost.Supplier__c,
                                                RecordTypeId = supplierInvoiceRecordTypeId,
                                              Pay_Term__c = referencedStemExtraCost.Payment_Term__c,
                                              STEM_Extra_Cost__c = referencedStemExtraCost.Id));
            }
        }
        insert cashflows;
        update cashflowMap.values();
    }

    public static void createDepositPayment(List<STEM_Extra_Cost__c> stemExtraCosts, Map<Id, STEM_Extra_Cost__c> oldStemExtraCostMap, TriggerOperation operation){
        Set<Id> stemIds = new Set<Id>();
        Set<Id> supplierIds = new Set<Id>();
        Set<Id> oldSupplierIds = new Set<Id>();
        for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts){
            if(operation == TriggerOperation.AFTER_INSERT) {
                if(stemExtraCost.Payment_Term__c == 'Deposit'){
                    stemIds.add(stemExtraCost.STEM__c);
                    supplierIds.add(stemExtraCost.Supplier__c);
                }
            } else if(stemExtraCost.Payment_Term__c == 'Deposit'
               && (stemExtraCost.Line_Total_Buy__c != oldStemExtraCostMap.get(stemExtraCost.Id).Line_Total_Buy__c
                || stemExtraCost.Fixed__c != oldStemExtraCostMap.get(stemExtraCost.Id).Fixed__c
                || stemExtraCost.Quantity__c != oldStemExtraCostMap.get(stemExtraCost.Id).Quantity__c
                || stemExtraCost.Quantity_Range_Max__c != oldStemExtraCostMap.get(stemExtraCost.Id).Quantity_Range_Max__c
                || stemExtraCost.Unit_Cost__c != oldStemExtraCostMap.get(stemExtraCost.Id).Unit_Cost__c
                || stemExtraCost.Minimum_Buy_At__c != oldStemExtraCostMap.get(stemExtraCost.Id).Minimum_Buy_At__c
                || stemExtraCost.Quantity_Delivered_Per_BDN__c != oldStemExtraCostMap.get(stemExtraCost.Id).Quantity_Delivered_Per_BDN__c
                || stemExtraCost.Is_Quantity_Range__c != oldStemExtraCostMap.get(stemExtraCost.Id).Is_Quantity_Range__c
                || stemExtraCost.Supplier__c != oldStemExtraCostMap.get(stemExtraCost.Id).Supplier__c
                || stemExtraCost.Payment_Term__c != oldStemExtraCostMap.get(stemExtraCost.Id).Payment_Term__c
                || stemExtraCost.Supplier_Issued__c != oldStemExtraCostMap.get(stemExtraCost.Id).Supplier_Issued__c)){
                stemIds.add(stemExtraCost.STEM__c);
                supplierIds.add(stemExtraCost.Supplier__c);
                oldSupplierIds.add(oldStemExtraCostMap.get(stemExtraCost.Id).Supplier__c);
            }
        }
        if(!stemIds.isEmpty()){
            DepositCalculationService.calculateDeposits(stemIds, supplierIds, oldSupplierIds);
        }
    }

    public static void deleteDepositPayments(List<STEM_Extra_Cost__c> stemExtraCosts, Map<Id, STEM_Extra_Cost__c> oldStemExtraCostMap){
        Set<Id> supplierIds = new Set<Id>();
        Set<Id> oldSupplierIds = new Set<Id>();
        Set<Id> stemIds = new Set<Id>();
        for(STEM_Extra_Cost__c stemExtraCost : stemExtraCosts){
            if(stemExtraCost.Payment_Term__c != oldStemExtraCostMap.get(stemExtraCost.Id).Payment_Term__c && oldStemExtraCostMap.get(stemExtraCost.Id).Payment_Term__c == 'Deposit'){
                supplierIds.add(stemExtraCost.Supplier__c);
                stemIds.add(stemExtraCost.STEM__c);
                oldSupplierIds.add(oldStemExtraCostMap.get(stemExtraCost.Id).Supplier__c);
            }
        }

        if(!stemIds.isEmpty()){
            Id payableRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Payable').getRecordTypeId();
            List<Payment__c> depositPayments = [SELECT Id FROM Payment__c
                                                WHERE Account__c IN :supplierIds AND STEM__c IN: stemIds AND Is_Deposit__c = true AND RecordTypeId =: payableRecordTypeId];
            delete depositPayments;
            if(!stemIds.isEmpty()){
                DepositCalculationService.calculateDeposits(stemIds, supplierIds, oldSupplierIds);
            }
        }
    }

    public static void deleteDepositPayments(List<STEM_Extra_Cost__c> stemExtraCosts){
        Set<Id> supplierIds = new Set<Id>();
        Set<Id> stemIds = new Set<Id>();
        for(STEM_Extra_Cost__c stemExtraCost : stemExtraCosts){
            if(stemExtraCost.Payment_Term__c == 'Deposit'){
                supplierIds.add(stemExtraCost.Supplier__c);
                stemIds.add(stemExtraCost.STEM__c);
            }
        }

        if(!stemIds.isEmpty()){
            Id payableRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Payable').getRecordTypeId();
            List<Payment__c> paymentsToDelete = [SELECT Id, Account__c, STEM__c, Supplier_Invoice__c
                                                 FROM Payment__c
                                                 WHERE STEM__c IN: stemIds AND Is_Deposit__c = true AND Account__c IN: supplierIds
                                                 AND Supplier_Invoice__c = null AND RecordTypeId =: payableRecordTypeId];
            delete paymentsToDelete;
            DepositCalculationService.calculateDeposits(stemIds, supplierIds, new Set<Id>());
        }
    }

    public static void applyEnquirySpecialTerms(List<STEM_Extra_Cost__c> stemExtraCosts) {
        Map<Id, List<Enquiry_Special_Term__c>> enquirySpecialTermsToCreate = new Map<Id, List<Enquiry_Special_Term__c>>();
        Set<String> supplierIds = new Set<String>();
        Set<String> portIds = new Set<String>();
        Set<String> stemIds = new Set<String>();
        Set<String> productIds = new Set<String>();
        Set<String> portCountries = new Set<String>();
        Map<String, STEM_Extra_Cost__c> stemExtraCostByStemId = new Map<String, STEM_Extra_Cost__c>();
        Map<String, List<STEM_Extra_Cost__c>> stemExtraCostsByStemId = new Map<String, List<STEM_Extra_Cost__c>>();
        Map<STEM_Extra_Cost__c, String> countryByStemExtraCost = new Map<STEM_Extra_Cost__c, String>();
        Map<String, STEM_Extra_Cost__c> stemExtraCostByPortId = new Map<String, STEM_Extra_Cost__c>();
        Set<String> enquiryIds = new Set<String>();
        for (STEM_Extra_Cost__c stemExtraCost : stemExtraCosts) {
            portIds.add(stemExtraCost.Port__c);
            stemIds.add(stemExtraCost.STEM__c);
            productIds.add(stemExtraCost.Product2Id__c);
            stemExtraCostByPortId.put(stemExtraCost.Port__c, stemExtraCost);
            stemExtraCostByStemId.put(stemExtraCost.STEM__c, stemExtraCost);
            if(stemExtraCostsByStemId.get(stemExtraCost.STEM__c) == null){
                stemExtraCostsByStemId.put(stemExtraCost.STEM__c, new List<STEM_Extra_Cost__c>());
            }
            stemExtraCostsByStemId.get(stemExtraCost.STEM__c).add(stemExtraCost);
            if (stemExtraCost.Supplier__c != null) {
                supplierIds.add(stemExtraCost.Supplier__c);
            }
        }

        for (Port__c port : [SELECT Id, Country__c FROM Port__c WHERE Id IN :portIds]) {
            portCountries.add(port.Country__c);
            countryByStemExtraCost.put(stemExtraCostByPortId.get(port.Id), port.Country__c);
        }
        Map<STEM_Extra_Cost__c, String> enquiryIdByStemExtraCost = new Map<STEM_Extra_Cost__c, String>();
        for (STEM__c s : [SELECT Id, Enquiry__c FROM STEM__c WHERE Id IN :stemIds]) {
            enquiryIds.add(s.Enquiry__c);
            // enquiryIdByStemExtraCost.put(stemExtraCostByStemId.get(q.Id), q.OpportunityId);
            for(STEM_Extra_Cost__c sec : stemExtraCostsByStemId.get(s.Id)){
                enquiryIdByStemExtraCost.put(sec, s.Enquiry__c);
            }
        }

        for (Special_Term_Rule__c str : [SELECT Id, Special_Term__c, Special_Term__r.Name, Port__c,
                                                Port__r.Name, Port__r.Country__c, Port__r.Offshore__c, Account__c,
                                                Account__r.Name, Country__c,  Product__r.Name, Product__c,
                                                Supplier_Buyer__c
                                            FROM Special_Term_Rule__c WHERE Port__c IN :portIds
                                            OR Product__c IN :productIds
                                            OR Account__c IN :supplierIds
                                            OR Country__c IN :portCountries]) {
            for (STEM_Extra_Cost__c sec : stemExtraCosts) {
                String enquiryId = enquiryIdByStemExtraCost.get(sec);
                if (!String.isEmpty(str.Account__c) && !String.isEmpty(sec.Supplier__c)
                                                    && str.Account__c.equals(sec.Supplier__c) && str.Supplier_Buyer__c == 'Supplier') {
                    // base case, this supplier ALWAYS gets this rule
                    if (String.isEmpty(str.Product__c) && String.isEmpty(str.Port__c) && String.isEmpty(str.Country__c)) {
                        enquirySpecialTermsToCreate = addEnquirySpecialTerms(enquirySpecialTermsToCreate, str, enquiryId, sec.Id, 'Supplier is: ' + str.Account__r.Name);
                    }

                    // supplier & product
                    if (String.isEmpty(str.Port__c) && String.isEmpty(str.Country__c)
                                                    && !String.isEmpty(str.Product__c) && str.Product__c.equals(sec.Product2Id__c)) {
                        enquirySpecialTermsToCreate = addEnquirySpecialTerms(enquirySpecialTermsToCreate, str, enquiryId, sec.Id,
                                                                                'Supplier is: ' + str.Account__r.Name + ', Product is: ' + str.Product__r.Name);
                    }

                    // supplier & product & port or port's country
                    if (((!String.isEmpty(str.Port__c) && str.Port__c.equals(sec.Port__c)) || (!String.isEmpty(str.Country__c) && str.Country__c.equals(countryByStemExtraCost.get(sec))))
                        && (!String.isEmpty(str.Product__c) && str.Product__c.equals(sec.Product2Id__c))) {
                        if (!String.isEmpty(str.Port__c) && str.Port__c.equals(sec.Port__c)) {
                            enquirySpecialTermsToCreate = addEnquirySpecialTerms(enquirySpecialTermsToCreate, str, enquiryId, sec.Id,
                                                                                    'Supplier is: ' + str.Account__r.Name + ', Product is: '
                                                                                    + str.Product__r.Name + ' Port is ' + str.Port__r.Name);
                        } else {
                            enquirySpecialTermsToCreate = addEnquirySpecialTerms(enquirySpecialTermsToCreate, str, enquiryId, sec.Id,
                                                                                    'Supplier is: ' + str.Account__r.Name + ', Product is: ' + str.Product__r.Name
                                                                                    + ' Port\'s Country is ' + str.Country__c);
                        }
                    }

                    // supplier & port or port's country
                    if ((!String.isEmpty(str.Port__c) && str.Port__c.equals(sec.Port__c))
                                                        || (!String.isEmpty(str.Country__c) && str.Country__c.equals(countryByStemExtraCost.get(sec)))) {
                        if (!String.isEmpty(str.Port__c) && str.Port__c.equals(sec.Port__c)) {
                            enquirySpecialTermsToCreate = addEnquirySpecialTerms(enquirySpecialTermsToCreate, str, enquiryId, sec.Id,
                                                                                    'Supplier is: ' + str.Account__r.Name + ' Port is ' + str.Port__r.Name);
                        } else {
                            enquirySpecialTermsToCreate = addEnquirySpecialTerms(enquirySpecialTermsToCreate, str, enquiryId, sec.Id,
                                                                                    'Supplier is: ' + str.Account__r.Name + ' Port\'s Country is ' + str.Country__c);
                        }
                    }
                }

                // PRODUCT matches special terms rule
                if (!String.isEmpty(str.Product__c) && !String.isEmpty(sec.Product2Id__c) && str.Product__c.equals(sec.Product2Id__c)) {
                    // base case, this PRODUCT ALWAYS gets this rule
                    if (String.isEmpty(str.Port__c) && String.isEmpty(str.Country__c)) {
                        enquirySpecialTermsToCreate = addEnquirySpecialTerms(enquirySpecialTermsToCreate, str, enquiryId, sec.Id,
                                                                                'Product is: ' + str.Product__r.Name);
                    }

                    // product and port or country
                    if ((!String.isEmpty(str.Port__c) && str.Port__c.equals(sec.Port__c)) ||
                        (!String.isEmpty(str.Country__c) && str.Country__c.equals(countryByStemExtraCost.get(sec)))) {
                        if (!String.isEmpty(str.Port__c) && str.Port__c.equals(sec.Port__c)) {
                            enquirySpecialTermsToCreate= addEnquirySpecialTerms(enquirySpecialTermsToCreate, str, enquiryId, sec.Id,
                                                                                'Product is: ' + str.Product__r.Name + ' Port is ' + str.Port__r.Name);
                        } else {
                            enquirySpecialTermsToCreate= addEnquirySpecialTerms(enquirySpecialTermsToCreate, str, enquiryId, sec.Id,
                                                                                'Product is: ' + str.Product__r.Name + ' Port\'s Country is ' + str.Country__c);
                        }
                    }
                }

                // PORT OR PORT\'s Country
                if((!String.isEmpty(str.Port__c) || !String.isEmpty(str.Country__c))
                                                    && String.isEmpty(str.Account__c)
                                                    && String.isEmpty(str.Product__c)) {
                    if (!String.isEmpty(str.Port__c) && str.Port__c.equals(sec.Port__c)) {
                        enquirySpecialTermsToCreate = addEnquirySpecialTerms(enquirySpecialTermsToCreate, str, enquiryId, sec.Id,
                                                                                'Port is ' + str.Port__r.Name);
                    }

                    if (!String.isEmpty(str.Country__c) && str.Country__c.equals(countryByStemExtraCost.get(sec))) {
                        enquirySpecialTermsToCreate= addEnquirySpecialTerms(enquirySpecialTermsToCreate, str, enquiryId, sec.Id,
                                                                            'Port\'s Country is ' + str.Country__c);
                    }
                }
            }
        }

        Map<String, Enquiry_Special_Term__c> existingEstByEnquiryId = new Map<String, Enquiry_Special_Term__c>();
        for(Enquiry_Special_Term__c existingEst : [SELECT Enquiry__c, Special_Term__c
                                                                    FROM Enquiry_Special_Term__c
                                                                    WHERE Enquiry__c IN :enquiryIds]){
            String uniqueKey = existingEst.Enquiry__c+''+existingEst.Special_Term__c;
            if(existingEstByEnquiryId.get(uniqueKey) == null){
                existingEstByEnquiryId.put(uniqueKey, existingEst);
            }
        }


        // Map the newly created Special Terms By Enquiry
        Map<String, Enquiry_Special_Term__c> newEstByEnquiryId = new Map<String, Enquiry_Special_Term__c>();

        //Creating new Enquiry_Special_Term__c
        for (List<Enquiry_Special_Term__c> newEstList : enquirySpecialTermsToCreate.values()) {
            for(Enquiry_Special_Term__c newEst : newEstList){
               String uniqueKey = newEst.Enquiry__c+''+newEst.Special_Term__c;
                if(existingEstByEnquiryId.get(uniqueKey) == null){
                    newEstByEnquiryId.put(uniqueKey, newEst);
                }
            }
        }

        if(!newEstByEnquiryId.keyset().isEmpty()) {
            ContextManager.avoidEnquirySpecialTermFiring = true;
            upsert newEstByEnquiryId.values();
            ContextManager.avoidEnquirySpecialTermFiring = false;
        }


        /*
         * Creating junction object between StemExtraCost and Enquiry_Special_Term__c
         *
         *
         * */
        existingEstByEnquiryId.putAll(newEstByEnquiryId);
        Map<String, Special_Terms_Link__c> links = new Map<String,Special_Terms_Link__c>();
        for (Id key : enquirySpecialTermsToCreate.keySet()) {
            List<Enquiry_Special_Term__c> newEstList = enquirySpecialTermsToCreate.get(key);
            for(Enquiry_Special_Term__c newEst : newEstList){
                String uniqueKey = newEst.Enquiry__c+''+newEst.Special_Term__c;
                for(Enquiry_Special_Term__c existingEst: existingEstByEnquiryId.values()){
                    if(uniqueKey == existingEst.Enquiry__c+''+existingEst.Special_Term__c){
                        links.put(key + '' + existingEst.Id, new Special_Terms_Link__c(Enquiry_Special_Term__c = existingEst.Id,
                                                                                       STEM_Extra_Cost__c = key,
                                                                                       Unique_Key__c = key + '' + existingEst.Id));
                    }
                }
            }
        }

        //inserting Special_Terms_Link with condition that such junction object doesn't exist
        Map<String, Special_Terms_Link__c> existingLinks = new Map<String, Special_Terms_Link__c>([SELECT Id, Unique_Key__c
                                                                                                   FROM Special_Terms_Link__c
                                                                                                   WHERE Unique_Key__c In: links.keySet()]);
        for(String key: links.keySet()){
            for(Special_Terms_Link__c stl : existingLinks.values()){
                if(key == stl.Unique_Key__c) links.remove(key);
            }
        }

        if(!links.keySet().isEmpty()){
          insert links.values();
        }
    }


    private static Map<Id, List<Enquiry_Special_Term__c>> addEnquirySpecialTerms(Map<Id, List<Enquiry_Special_Term__c>> currentTerms,
                                                                        Special_Term_Rule__c str,
                                                                        String enquiryId,
                                                                        String offerLineItemId,
                                                                        String reason) {
            Set<String> specialTermsToAddIds = new Set<String>();
            for (List<Enquiry_Special_Term__c> estList : currentTerms.values()) {
                for(Enquiry_Special_Term__c est : estList){
                    specialTermsToAddIds.add(est.Special_Term__c);
                }
            }
            if (!specialTermsToAddIds.contains(str.Special_Term__c)) {
                if(currentTerms.containsKey(offerLineItemId)){
                    currentTerms.get(offerLineItemId).add(new Enquiry_Special_Term__c(Enquiry__c = enquiryId,
                                                             Offer_Line_Item__c = offerLineItemId,
                                                             Special_Term__c = str.Special_Term__c,
                                                             Reason__c = reason));
                }
                else{
                    currentTerms.put(offerLineItemId, new List<Enquiry_Special_Term__c>{new Enquiry_Special_Term__c(Enquiry__c = enquiryId,
                                                             Offer_Line_Item__c = offerLineItemId,
                                                             Special_Term__c = str.Special_Term__c,
                                                             Reason__c = reason)});
                }
            }
            return currentTerms;
    }

    public static void deleteCashflows(Map<Id, STEM_Extra_Cost__c> stemExtraCostMap){
        List<String> stemIds = new List<String>();
        List<String> supplierIds = new List<String>();
        for(STEM_Extra_Cost__c stemExtraCost: stemExtraCostMap.values()){
            stemIds.add(stemExtraCost.STEM__c);
            supplierIds.add(stemExtraCost.Supplier__c);
        }
        update [SELECT Id FROM Cashflow__c WHERE Account__c In: supplierIds AND STEM__c In: stemIds];
    }
}