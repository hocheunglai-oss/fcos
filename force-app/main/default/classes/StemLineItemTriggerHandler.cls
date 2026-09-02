public class StemLineItemTriggerHandler {
   public static void createCashflows(Map<Id, STEM_Line_Item__c> stemLineItemMap, Map<Id, STEM_Line_Item__c> oldStemLineItemMap){
        String supplierInvoiceRecordTypeId = Schema.SObjectType.Cashflow__c.getRecordTypeInfosByName().get('Supplier Invoice').getRecordTypeId();
        List<String> stemIds = new List<String>();
        List<String> supplierIds = new List<String>();
        List<String> oldSupplierIds = new List<String>();
        for(STEM_Line_Item__c stemLineItem: stemLineItemMap.values()){
            stemIds.add(stemLineItem.STEM__c);
            supplierIds.add(stemLineItem.Original_Supplier__c);
            if(oldStemLineItemMap != null){
              oldSupplierIds.add(oldStemLineItemMap.get(stemLineItem.Id).Original_Supplier__c);
            }
        }
        List<Cashflow__c> cashflows = [SELECT Id, Account__c, STEM__c, STEM_Line_Item__c, Pay_Term__c, Supplier_Invoice__c FROM Cashflow__c
                                       WHERE STEM__c IN: stemIds AND RecordTypeId =: supplierInvoiceRecordTypeId
                                       AND (Account__c IN: supplierIds OR Account__c IN: oldSupplierIds)];
        Map<String, Cashflow__c> cashflowMap = new Map<String, Cashflow__c>();
        for(Cashflow__c cashflow: cashflows){
            cashflowMap.put(cashflow.STEM__c + ',' + cashflow.Account__c + ',' + cashflow.Pay_Term__c + ',' + cashflow.Supplier_Invoice__c, cashflow);
        }
        Map<String, List<STEM_Line_Item__c>> supplierToStemLineItemMap = new Map<String, List<STEM_Line_Item__c>>();
        for(STEM_Line_Item__c stemLineItem: stemLineItemMap.values()){
            if(supplierToStemLineItemMap.get(stemLineItem.STEM__c + ',' + stemLineItem.Original_Supplier__c + ',' + stemLineItem.Payment_Term__c + ',' + stemLineItem.Supplier_Invoice__c) != null){
                supplierToStemLineItemMap.get(stemLineItem.STEM__c + ',' + stemLineItem.Original_Supplier__c + ',' + stemLineItem.Payment_Term__c + ',' + stemLineItem.Supplier_Invoice__c).add(stemLineItem);
            } else{
                supplierToStemLineItemMap.put(stemLineItem.STEM__c + ',' + stemLineItem.Original_Supplier__c + ',' + stemLineItem.Payment_Term__c + ',' + stemLineItem.Supplier_Invoice__c, new List<STEM_Line_Item__c>{stemLineItem});
            }
        }
        cashflows = new List<Cashflow__c>();
        STEM_Line_Item__c referencedStemLineItem;
        for(String supplierAndStemId: supplierToStemLineItemMap.keySet()){
            referencedStemLineItem = supplierToStemLineItemMap.get(supplierAndStemId)[0];

            if(cashflowMap.get(supplierAndStemId) == null){
                cashflows.add(new Cashflow__c(STEM__c = referencedStemLineItem.STEM__c,
                                                Account__c = referencedStemLineItem.Original_Supplier__c,
                                              STEM_Line_Item__c = referencedStemLineItem.Id,
                                              Pay_Term__c = referencedStemLineItem.Payment_Term__c,
                                                RecordTypeId = supplierInvoiceRecordTypeId));
            }
        }
        insert cashflows;
        update cashflowMap.values();
    }

    public static void setPortAndVessel(List<STEM_Line_Item__c> stemLineItems){
        List<String> stemIds = new List<String>();
        for(STEM_Line_Item__c stemLineItem: stemLineItems){
            stemIds.add(stemLineItem.STEM__c);
        }
        List<STEM__c> stems = [SELECT Id, Port__c, Vessel__c FROM STEM__c WHERE ID In: stemIds];
        for(STEM_Line_Item__c stemLineItem: stemLineItems){
            for(STEM__c stem: stems){
                if(stemLineItem.STEM__c == stem.Id){
                    stemLineItem.Port__c = stem.Port__c;
                    stemLineItem.Vessel__c = stem.Vessel__c;
                }
            }
        }
    }

    public static void createNomination(Map<Id, STEM_Line_Item__c> stemLineItemMap){
        Set<Id> supplierIds = new Set<Id>();
        Set<Id> stemIds = new Set<Id>();
        for(STEM_Line_Item__c stemLineItem: stemLineItemMap.values()){
            supplierIds.add(stemLineItem.Original_Supplier__c);
            stemIds.add(stemLineItem.STEM__c);
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
                        for(STEM_Line_Item__c stemLineItem: stemLineItemMap.values()){
                            if(nomination.STEM__c == stemLineItem.STEM__c && nomination.Account__c == stemLineItem.Original_Supplier__c && nomination.Payment_Term__c == stemLineItem.Payment_Term__c){
                                   nomination.PDF__c = nomination.PDF__c == '🟢'
                                    ? '🟡'
                                    : nomination.PDF__c == '⚫'
                                        ? '🔴'
                                        : nomination.PDF__c;
                                nomination.Sent__c = nomination.Sent__c == '🟢' ? '🟡' : nomination.Sent__c;
                                nomination.Received__c = nomination.Received__c == '🟢' ? '🟡' : nomination.Received__c;
                                nominationsToUpdate.put(nomination.Id, nomination);
                            }
                            if(confirmation.STEM__c == stemLineItem.STEM__c){
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
                    for(STEM_Line_Item__c stemLineItem: stemLineItemMap.values()){
                        if(confirmation.STEM__c == stemLineItem.STEM__c && stemLineItem.Original_Supplier__c != null){
                           nominationsToInsert.add(new Nomination__c(
                                                Name = 'Nomination to ' + stemLineItem.Supplier_Name__c,
                                                Buyer_Confirmation__c = confirmation.Id,
                                                Port__c = confirmation.Port__c,
                                                Account__c = stemLineItem.Original_Supplier__c,
                                                RecordTypeId = FCBStatic.NOMINATION_SUPPLIER_RT_IT,
                                                Expected_Delivery_Date__c = confirmation.Expected_Delivery_Date__c,
                                                Enquiry__c = confirmation.Enquiry__c,
                                                STEM__c = stemLineItem.STEM__c,
                                                RefCode__c = confirmation.RefCode__c,
                                                Supplier_RefCode_Index__c = refCodeIndex,
                                                   Payment_Term__c = stemLineItem.Payment_Term__c
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

    public static void updateNominations(Map<Id, STEM_Line_Item__c> stemLineItemMap, Map<Id, STEM_Line_Item__c> oldStemLineItems){
        Set<Id> stemIds = new Set<Id>();
        for(STEM_Line_Item__c stemLineItem: stemLineItemMap.values()){
            if(stemLineItem.Quantity__c != oldStemLineItems.get(stemLineItem.Id).Quantity__c || stemLineItem.Is_Quantity_Range__c != oldStemLineItems.get(stemLineItem.Id).Is_Quantity_Range__c ||
               stemLineItem.Quantity_Max__c != oldStemLineItems.get(stemLineItem.Id).Quantity_Max__c || stemLineItem.Unit_of_Measure__c != oldStemLineItems.get(stemLineItem.Id).Unit_of_Measure__c ||
               stemLineItem.Unit_Buy_At__c != oldStemLineItems.get(stemLineItem.Id).Unit_Buy_At__c || stemLineItem.Expected_Delivery_Date__c != oldStemLineItems.get(stemLineItem.Id).Expected_Delivery_Date__c ||
               stemLineItem.Payment_Term__c != oldStemLineItems.get(stemLineItem.Id).Payment_Term__c || stemLineItem.Product__c != oldStemLineItems.get(stemLineItem.Id).Product__c ||
               stemLineItem.Partial_CIA__c != oldStemLineItems.get(stemLineItem.Id).Partial_CIA__c || stemLineItem.Partial_Lumpsum_Buy_At__c != oldStemLineItems.get(stemLineItem.Id).Partial_Lumpsum_Buy_At__c ||
               stemLineItem.Port__c != oldStemLineItems.get(stemLineItem.Id).Port__c || (stemLineItem.Original_Supplier__c != oldStemLineItems.get(stemLineItem.Id).Original_Supplier__c &&
               !oldStemLineItems.get(stemLineItem.Id).Unspecified_Supplier__c)){
                stemIds.add(stemLineItem.STEM__c);
            }
        }
        if(!stemIds.isEmpty()){
            List<Nomination__c> confirmations = [SELECT Id, STEM__c, Port__c, Expected_Delivery_Date__c, Enquiry__c, RefCode__c, PDF__c, Sent__c, Received__c, Payment_Term__c,
                                               (SELECT Id, PDF__c, Sent__c, Received__c, STEM__c, Account__c, Supplier_RefCode_Index__c, Payment_Term__c FROM SupplierNominations__r WHERE Deprecated__c = false ORDER By Supplier_RefCode_Index__c)
                                               FROM Nomination__c WHERE STEM__c =: stemIds AND Deprecated__c = false AND RecordTypeId =: FCBStatic.NOMINATION_BUYER_RT_IT];
            Map<String, Boolean> nominationExist = new Map<String, Boolean>();
            List<Nomination__c> nominationsToInsert = new List<Nomination__c>();
            List<Nomination__c> nominationsToUpdate = new List<Nomination__c>();
            for(Nomination__c confirmation: confirmations){
                for(Nomination__c nomination: confirmation.SupplierNominations__r){
                    for(STEM_Line_Item__c stemLineItem: stemLineItemMap.values()){
                         if(nomination.STEM__c == stemLineItem.STEM__c && nomination.Account__c == stemLineItem.Original_Supplier__c && nomination.Payment_Term__c == stemLineItem.Payment_Term__c){
                             nomination.PDF__c = nomination.PDF__c == '🟢'
                                    ? '🟡'
                                    : nomination.PDF__c == '⚫'
                                        ? '🔴'
                                        : nomination.PDF__c;
                            nomination.Sent__c = nomination.Sent__c == '🟢' ? '🟡' : nomination.Sent__c;
                            nomination.Received__c = nomination.Received__c == '🟢' ? '🟡' : nomination.Received__c;
                        }
                        if(stemLineItem.Original_Supplier__c != oldStemLineItems.get(stemLineItem.Id).Original_Supplier__c){
                            if(nomination.STEM__c == stemLineItem.STEM__c && nomination.Account__c == oldStemLineItems.get(stemLineItem.Id).Original_Supplier__c){
                                nomination.PDF__c = nomination.PDF__c == '🟢'
                                    ? '🟡'
                                    : nomination.PDF__c == '⚫'
                                        ? '🔴'
                                        : nomination.PDF__c;
                                nomination.Sent__c = nomination.Sent__c == '🟢' ? '🟡' : nomination.Sent__c;
                                nomination.Received__c = nomination.Received__c == '🟢' ? '🟡' : nomination.Received__c;
                            }
                        }
                        if(stemLineItem.Payment_Term__c != oldStemLineItems.get(stemLineItem.Id).Payment_Term__c){
                            if(nomination.STEM__c == stemLineItem.STEM__c && nomination.Account__c == stemLineItem.Original_Supplier__c
                               && nomination.Payment_Term__c == oldStemLineItems.get(stemLineItem.Id).Payment_Term__c){
                                   nomination.PDF__c = nomination.PDF__c == '🟢'
                                    ? '🟡'
                                    : nomination.PDF__c == '⚫'
                                        ? '🔴'
                                        : nomination.PDF__c;
                                nomination.Sent__c = nomination.Sent__c == '🟢' ? '🟡' : nomination.Sent__c;
                                nomination.Received__c = nomination.Received__c == '🟢' ? '🟡' : nomination.Received__c;
                                nomination.Payment_Term__c = stemLineItem.Payment_Term__c;
                            }
                        }
                    }
                    nominationExist.put(nomination.STEM__c + ',' + nomination.Account__c + ',' + nomination.Payment_Term__c, true);
                    nominationsToUpdate.add(nomination);
                }
            }
            for(Nomination__c confirmation: confirmations){
                for(STEM_Line_Item__c stemLineItem: stemLineItemMap.values()){
                    if(nominationExist.get(stemLineItem.STEM__c + ',' + stemLineItem.Original_Supplier__c + ',' + stemLineItem.Payment_Term__c) == null
                       && stemLineItem.Original_Supplier__c != null
                       && !oldStemLineItems.get(stemLineItem.Id).Unspecified_Supplier__c){
                        Integer refCodeIndex = confirmation.SupplierNominations__r.size() > 0
                                                ? confirmation.SupplierNominations__r.get(confirmation.SupplierNominations__r.size() - 1).Supplier_RefCode_Index__c.intValue() + 1
                                                : 1;
                        nominationsToInsert.add(new Nomination__c(
                                                Name = 'Nomination to ' + stemLineItem.Supplier_Name__c,
                                                Buyer_Confirmation__c = confirmation.Id,
                                                Port__c = confirmation.Port__c,
                                                Account__c = stemLineItem.Original_Supplier__c,
                                                RecordTypeId = FCBStatic.NOMINATION_SUPPLIER_RT_IT,
                                                Expected_Delivery_Date__c = confirmation.Expected_Delivery_Date__c,
                                                Enquiry__c = confirmation.Enquiry__c,
                                                STEM__c = stemLineItem.STEM__c,
                                                RefCode__c = confirmation.RefCode__c,
                                                Supplier_RefCode_Index__c = refCodeIndex,
                                                //Offer_Line_Item__c = li.OfferLineItem,
                                                Payment_Term__c = stemLineItem.Payment_Term__c
                        ));
                    }
                }
            }
            insert nominationsToInsert;
            update nominationsToUpdate;
            System.enqueueJob(new EnsureNominationsJob(stemIds));
        }
    }

    public static void updateConfirmations(Map<Id, STEM_Line_Item__c> stemLineItemMap, Map<Id, STEM_Line_Item__c> oldStemLineItems){
        Set<String> stemIds = new Set<String>();
        for(STEM_Line_Item__c stemLineItem: stemLineItemMap.values()){
            if(stemLineItem.Quantity__c != oldStemLineItems.get(stemLineItem.Id).Quantity__c || stemLineItem.Is_Quantity_Range__c != oldStemLineItems.get(stemLineItem.Id).Is_Quantity_Range__c ||
               stemLineItem.Quantity_Max__c != oldStemLineItems.get(stemLineItem.Id).Quantity_Max__c || stemLineItem.Unit_of_Measure__c != oldStemLineItems.get(stemLineItem.Id).Unit_of_Measure__c ||
               stemLineItem.Unit_Sell_At__c != oldStemLineItems.get(stemLineItem.Id).Unit_Sell_At__c || stemLineItem.Original_Supplier__c != oldStemLineItems.get(stemLineItem.Id).Original_Supplier__c ||
               stemLineItem.Product__c != oldStemLineItems.get(stemLineItem.Id).Product__c){
                stemIds.add(stemLineItem.STEM__c);
            }
        }
        system.debug(stemIds);
        if(!stemIds.isEmpty()){
            List<Nomination__c> confirmations = [SELECT Id, STEM__c, PDF__c, Sent__c, Received__c
                                                 FROM Nomination__c WHERE STEM__c =: stemIds AND Deprecated__c = false AND RecordTypeId =: FCBStatic.NOMINATION_BUYER_RT_IT];
            for(Nomination__c confirmation: confirmations){
                for(STEM_Line_Item__c stemLineItem: stemLineItemMap.values()){
                    if(confirmation.STEM__c == stemLineItem.STEM__c){
                        confirmation.PDF__c = confirmation.PDF__c == '🟢' ? '🟡' : confirmation.PDF__c;
                        confirmation.Sent__c = confirmation.Sent__c == '🟢' ? '🟡' : confirmation.Sent__c;
                        confirmation.Received__c = confirmation.Received__c == '🟢' ? '🟡' : confirmation.Received__c;
                    }
                }
            }
            update confirmations;
        }
    }

    public static void updateNominationUnspecifiedSupplier(Map<Id, STEM_Line_Item__c> stemLineItemMap, Map<Id, STEM_Line_Item__c> oldStemLineItems){
        Set<String> stemIds = new Set<String>();
        Set<String> supplierIds = new Set<String>();
        for(STEM_Line_Item__c stemLineItem: stemLineItemMap.values()){
            if((stemLineItem.Original_Supplier__c != oldStemLineItems.get(stemLineItem.Id).Original_Supplier__c &&
               oldStemLineItems.get(stemLineItem.Id).Unspecified_Supplier__c)){
                stemIds.add(stemLineItem.STEM__c);
                supplierIds.add(oldStemLineItems.get(stemLineItem.Id).Original_Supplier__c);
            }
        }
        if(!stemIds.isEmpty()){
            List<Nomination__c> nominations = [SELECT Id, STEM__c, Account__c, Payment_Term__c
                                                 FROM Nomination__c WHERE STEM__c =: stemIds AND Account__c IN: supplierIds AND Deprecated__c = false AND RecordTypeId =: FCBStatic.NOMINATION_SUPPLIER_RT_IT];
            Map<String, List<Nomination__c>> nominationMap = new Map<String, List<Nomination__c>>();
            for(Nomination__c nomination: nominations){
                if(nominationMap.get(nomination.STEM__c + ',' + nomination.Account__c) == null){
                    nominationMap.put(nomination.STEM__c + ',' + nomination.Account__c, new List<Nomination__c>());
                }
                nominationMap.get(nomination.STEM__c + ',' + nomination.Account__c).add(nomination);
            }
            Map<String, Boolean> lineItemExist = new Map<String, Boolean>();
            for(STEM_Line_Item__c stemLineItem: [SELECT Id, STEM__c, Original_Supplier__c FROM STEM_Line_Item__c WHERE Id NOT IN: stemLineItemMap.keySet() AND STEM__c IN: stemIds AND Original_Supplier__c IN: supplierIds]){
                lineItemExist.put(stemLineItem.STEM__c + ',' + stemLineItem.Original_Supplier__c, true);
            }
            for(STEM_Extra_Cost__c stemExtraCost: [SELECT Id, STEM__c, Supplier__c FROM STEM_Extra_Cost__c WHERE STEM_Line_Item__c NOT IN: stemLineItemMap.keySet() AND STEM__c IN: stemIds AND Supplier__c IN: supplierIds]){
               lineItemExist.put(stemExtraCost.STEM__c + ',' + stemExtraCost.Supplier__c, true);
            }
            for(STEM_Line_Item__c stemLineItem: stemLineItemMap.values()){
                if(nominationMap.get(stemLineItem.STEM__c + ',' + oldStemLineItems.get(stemLineItem.Id).Original_Supplier__c).size() == 1
                   && lineItemExist.get(stemLineItem.STEM__c + ',' + oldStemLineItems.get(stemLineItem.Id).Original_Supplier__c) == null){
                    nominationMap.get(stemLineItem.STEM__c + ',' + oldStemLineItems.get(stemLineItem.Id).Original_Supplier__c)[0].Account__c = stemLineItem.Original_Supplier__c;
                }
            }
            update nominations;
        }
    }

    public static void updateDisputes(List<STEM_Line_Item__c> stemLineItems, Map<Id, STEM_Line_Item__c> oldStemLineItemMap){
        Set<String> stemIds = new Set<String>();
        for(STEM_Line_Item__c stemLineItem: stemLineItems){
            if(stemLineItem.Original_Supplier__c != oldStemLineItemMap.get(stemLineItem.Id).Original_Supplier__c ||
               stemLineItem.Payment_Term__c != oldStemLineItemMap.get(stemLineItem.Id).Payment_Term__c){
                stemIds.add(stemLineItem.STEM__c);
            }
        }
        if(!stemIds.isEmpty()){
            List<Dispute__c> disputes = [SELECT Id, Supplier__c, Payment_Term__c, STEM__c FROM Dispute__c WHERE STEM__c IN: stemIds];
            for(Dispute__c dispute: disputes){
                for(STEM_Line_Item__c stemLineItem: stemLineItems){
                    if(dispute.STEM__c == stemLineItem.STEM__c && dispute.Supplier__c == oldStemLineItemMap.get(stemLineItem.Id).Original_Supplier__c){
                        dispute.Supplier__c = stemLineItem.Original_Supplier__c;
                    }
                    if(dispute.STEM__c == stemLineItem.STEM__c && dispute.Supplier__c == oldStemLineItemMap.get(stemLineItem.Id).Original_Supplier__c && dispute.Payment_Term__c == oldStemLineItemMap.get(stemLineItem.Id).Payment_Term__c){
                        dispute.Payment_Term__c = stemLineItem.Payment_Term__c;
                    }
                }
            }
            if(!disputes.isEmpty()){
                update disputes;
            }
        }
    }

    public static void createReconfirmTasks(List<STEM_Line_Item__c> stemLineItems, Map<Id, STEM_Line_Item__c> oldStemLineItemMap, TriggerOperation operation){
        Set<String> stemIds = new Set<String>();
        for(STEM_Line_Item__c stemLineItem: stemLineItems){
            if(operation == TriggerOperation.AFTER_INSERT){
                if(stemLineItem.Payment_Term__c == 'CIA'){
                    stemIds.add(stemLineItem.STEM__c);
                }
            } else{
                if((stemLineItem.Payment_Term__c == 'CIA' || stemLineItem.Partial_CIA__c)
                   && (stemLineItem.Original_Supplier__c != oldStemLineItemMap.get(stemLineItem.Id).Original_Supplier__c
                   || stemLineItem.Payment_Term__c != oldStemLineItemMap.get(stemLineItem.Id).Payment_Term__c
                   || stemLineItem.Partial_CIA__c != oldStemLineItemMap.get(stemLineItem.Id).Partial_CIA__c)){
                    stemIds.add(stemLineItem.STEM__c);
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
                for (STEM_Line_Item__c stemLineItem : stemLineItems) {
                    if(stemLineItem.STEM__c == stem.Id && (stemLineItem.Payment_Term__c == 'CIA' || stemLineItem.Partial_CIA__c)){
                        taskMap.put(stem.Id + '-' + stemLineItem.Original_Supplier__c, new Task(
                                    WhatId = stem.Enquiry__c,
                                    Subject = 'CIA Reconfirm Task - Added',
                                    Status = 'Open',
                                    Priority = 'Normal',
                                    IsReminderSet = true,
                                    ReminderDateTime = Datetime.now(),
                                    Description = 'Intended Payment Date is missing for STEM: ' + stem.Name + ' - SUPPLIER: ' + stemLineItem.Supplier_Name__c,
                                    Reconfirm_Unique_Key__c = stem.Id + '-' + stemLineItem.Original_Supplier__c,
                                    OwnerId = userIdMap.size() > 1 ? UserInfo.getUserId() : userIdMap.get('Vincent Lee')
                        ));
                    }
                }
            }
            upsert taskMap.values() Reconfirm_Unique_Key__c;
        }
    }

    public static void changeProductExtraCostInfo(Map<Id, STEM_Line_Item__c> stemLineItemMap, Map<Id, STEM_Line_Item__c> oldStemLineItems){
        Set<String> stemLineItemIds = new Set<String>();
        for(STEM_Line_Item__c stemLineItem: stemLineItemMap.values()){
            if(stemLineItem.Original_Supplier__c != oldStemLineItems.get(stemLineItem.Id).Original_Supplier__c
               || stemLineItem.Port__c != oldStemLineItems.get(stemLineItem.Id).Port__c || stemLineItem.Input__c != oldStemLineItems.get(stemLineItem.Id).Input__c){
                stemLineItemIds.add(stemLineItem.Id);
            }
        }
        if(!stemLineItemIds.isEmpty()){
            List<STEM_Extra_Cost__c> stemExtraCosts = [SELECT Id, Supplier__c, Port__c, STEM_Line_Item__c, Input__c FROM STEM_Extra_Cost__c WHERE STEM_Line_Item__c IN: stemLineItemIds];
            for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts){
                stemExtraCost.Supplier__c = stemLineItemMap.get(stemExtraCost.STEM_Line_Item__c).Original_Supplier__c;
                stemExtraCost.Port__c = stemLineItemMap.get(stemExtraCost.STEM_Line_Item__c).Port__c;
                stemExtraCost.Input__c = stemLineItemMap.get(stemExtraCost.STEM_Line_Item__c).Input__c != oldStemLineItems.get(stemExtraCost.STEM_Line_Item__c).Input__c
                    ? stemLineItemMap.get(stemExtraCost.STEM_Line_Item__c).Input__c
                    : stemExtraCost.Input__c;
            }
            ContextManager.avoidSTEMExtraCostFiring = true;
            update stemExtraCosts;
            ContextManager.avoidSTEMExtraCostFiring = false;
        }
    }

    public static void updateIsChangedCSVField(List<STEM_Line_Item__c> stemLineItems, Map<Id, STEM_Line_Item__c> oldStemLineItemMap){
        for(STEM_Line_Item__c stemLineItem: stemLineItems){
            STEM_Line_Item__c oldSTemLineItem = oldStemLineItemMap.get(stemLineItem.Id);
            if(stemLineItem.Is_Purchase_CSV_Exported__c && (stemLineItem.Subtotal_Buy_At__c != oldSTemLineItem.Subtotal_Buy_At__c
                                                            || stemLineItem.Original_Supplier__c != oldSTemLineItem.Original_Supplier__c)){
                stemLineItem.Is_Purchase_CSV_Info_Changed__c = true;
                if(stemLineItem.Original_Supplier__c != oldSTemLineItem.Original_Supplier__c){
                    stemLineItem.Refcode_Index__c = null;
                }
            }
            if(stemLineItem.Is_Buyer_Purchase_Comm_Exported__c && (stemLineItem.Buyers_Brokers_Commission_Per_Unit__c != oldSTemLineItem.Buyers_Brokers_Commission_Per_Unit__c
                                                            || stemLineItem.Quantity_Delivered_Per_BDN__c != oldSTemLineItem.Quantity_Delivered_Per_BDN__c
                                                            || stemLineItem.Quantity__c != oldSTemLineItem.Quantity__c
                                                            || (stemLineItem.Buyer_Broker__c == oldSTemLineItem.Supplier_Broker__c
                                                                && (stemLineItem.Suppliers_Brokers_Commission_Per_Unit__c != oldSTemLineItem.Suppliers_Brokers_Commission_Per_Unit__c
                                                                   || stemLineItem.Supplier_Broker__c != oldSTemLineItem.Supplier_Broker__c)))){
                stemLineItem.Is_Buyer_Purchase_Comm_Info_Changed__c = true;
            }
            if(stemLineItem.Is_Supplier_Purchase_Comm_Exported__c && (stemLineItem.Suppliers_Brokers_Commission_Per_Unit__c != oldSTemLineItem.Suppliers_Brokers_Commission_Per_Unit__c
                                                            || stemLineItem.Quantity_Delivered_Per_BDN__c != oldSTemLineItem.Quantity_Delivered_Per_BDN__c
                                                            || stemLineItem.Quantity__c != oldSTemLineItem.Quantity__c
                                                            || stemLineItem.Supplier_Broker__c != oldSTemLineItem.Supplier_Broker__c
                                                            || (stemLineItem.Buyer_Broker__c == oldSTemLineItem.Supplier_Broker__c
                                                                && stemLineItem.Buyers_Brokers_Commission_Per_Unit__c != oldSTemLineItem.Buyers_Brokers_Commission_Per_Unit__c))){
                stemLineItem.Is_Supplier_Purchase_Comm_Info_Changed__c = true;
                if(stemLineItem.Supplier_Broker__c != oldSTemLineItem.Supplier_Broker__c){
                    stemLineItem.Supplier_Broker_Refcode_Index__c = null;
                }
            }
        }
    }

    public static void updateRelatedRecordsIsChangedCSvField(List<STEM_Line_Item__c> stemLineItems, Map<Id, STEM_Line_Item__c> oldStemLineItemMap){
        List<Id> stemIds = new List<Id>();
        List<Id> oldSupplierIds = new List<Id>();
        List<Id> oldSupplierBrokerIds = new List<Id>();
        for(STEM_Line_Item__c stemLineItem: stemLineItems){
            STEM_Line_Item__c oldSTemLineItem = oldStemLineItemMap.get(stemLineItem.Id);
            if(stemLineItem.Original_Supplier__c != oldSTemLineItem.Original_Supplier__c){
                stemIds.add(stemLineItem.STEM__c);
                oldSupplierIds.add(oldSTemLineItem.Original_Supplier__c);
            }
            if(stemLineItem.Supplier_Broker__c != oldSTemLineItem.Supplier_Broker__c){
                stemIds.add(stemLineItem.STEM__c);
                oldSupplierBrokerIds.add(oldSTemLineItem.Supplier_Broker__c);
            }
        }
        if(!stemIds.isEmpty()){
            List<STEM_Line_Item__c> currentStemLineItems = [SELECT Id, Is_Purchase_CSV_Info_Changed__c, Is_Supplier_Purchase_Comm_Info_Changed__c, Is_Buyer_Purchase_Comm_Info_Changed__c,
                                                        Is_Purchase_CSV_Exported__c, Is_Supplier_Purchase_Comm_Exported__c, Is_Buyer_Purchase_Comm_Exported__c,
                                                        Supplier_Broker__c, Original_Supplier__c, STEM__r.Buyer_Broker__c
                                                        FROM STEM_Line_Item__c WHERE STEM__c IN: stemIds AND Id NOT IN: oldStemLineItemMap.keySet()
                                                        AND (Is_Purchase_CSV_Exported__c = true OR Is_Supplier_Purchase_Comm_Exported__c = true OR Is_Buyer_Purchase_Comm_Exported__c = true)];
            for(STEM_Line_Item__c currenStemLineItem: currentStemLineItems){
                if(currenStemLineItem.Is_Purchase_CSV_Exported__c){
                       currenStemLineItem.Is_Purchase_CSV_Info_Changed__c = true;
                }
                if(currenStemLineItem.Is_Supplier_Purchase_Comm_Exported__c){
                    currenStemLineItem.Is_Supplier_Purchase_Comm_Info_Changed__c = true;
                }
                if(currenStemLineItem.Is_Buyer_Purchase_Comm_Exported__c){
                    currenStemLineItem.Is_Buyer_Purchase_Comm_Info_Changed__c = true;
                }
            }
               ContextManager.avoidSTEMLineItemFiring = true;
            update currentStemLineItems;
            ContextManager.avoidSTEMLineItemFiring = false;
            List<STEM_Extra_Cost__c> currentSupplierStemExtraCosts = [SELECT Id, Is_Purchase_CSV_Info_Changed__c, Is_Purchase_CSV_Exported__c
                                                                        FROM STEM_Extra_Cost__c WHERE STEM__c IN: stemIds AND Is_Purchase_CSV_Exported__c = true];
            if(!currentSupplierStemExtraCosts.isEmpty()){
                for(STEM_Extra_Cost__c currentSupplierStemExtraCost: currentSupplierStemExtraCosts){
                    currentSupplierStemExtraCost.Is_Purchase_CSV_Info_Changed__c = true;
                }
                ContextManager.avoidSTEMExtraCostFiring = true;
                update currentSupplierStemExtraCosts;
                ContextManager.avoidSTEMExtraCostFiring = false;
            }
            List<MYOB_Invoice__c> myobInvoices = [SELECT Id, Account__c, STEM__c, Is_Changed__c
                                                  FROM MYOB_Invoice__c WHERE STEM__c IN: stemIds];
            for(MYOB_Invoice__c myobInvoice: myobInvoices){
                if(oldSupplierIds.contains(myobInvoice.Account__c) || oldSupplierBrokerIds.contains(myobInvoice.Account__c)){
                       myobInvoice.Is_Changed__c = true;
                }
            }
            update myobInvoices;
        }
    }

    public static void defineCommissionChanged(List<STEM_Line_Item__c> stemLineItems, Map<Id, STEM_Line_Item__c> oldStemLineItemMap, TriggerOperation operation){
        Set<Id> stemIds = new Set<Id>();
        for(STEM_Line_Item__c stemLineItem: stemLineItems){
            if(operation == TriggerOperation.AFTER_INSERT){
                if(stemLineItem.Buyers_Brokers_Commission_Per_Unit__c != null || stemLineItem.Suppliers_Brokers_Commission_Per_Unit__c != null){
                    stemIds.add(stemLineItem.STEM__c);
                }
            } else{
               if(stemLineItem.Supplier_Broker__c != oldStemLineItemMap.get(stemLineItem.Id).Supplier_Broker__c
                   || stemLineItem.Buyers_Brokers_Commission_Per_Unit__c != oldStemLineItemMap.get(stemLineItem.Id).Buyers_Brokers_Commission_Per_Unit__c
                   || stemLineItem.Suppliers_Brokers_Commission_Per_Unit__c != oldStemLineItemMap.get(stemLineItem.Id).Suppliers_Brokers_Commission_Per_Unit__c
                   || stemLineItem.Quantity__c != oldStemLineItemMap.get(stemLineItem.Id).Quantity__c
                   || stemLineItem.Quantity_Delivered_Per_BDN__c != oldStemLineItemMap.get(stemLineItem.Id).Quantity_Delivered_Per_BDN__c){
                    stemIds.add(stemLineItem.STEM__c);
                }
            }
        }
        if(!stemIds.isEmpty()){
            updateCommissionInvoiceAmount(stemIds);
        }
    }

    public static void updateCommissionInvoiceAmount(Set<Id> stemIds){
        if(stemIds.isEmpty()) return;

        List<STEM_Line_Item__c> currentStemLineItems = [
            SELECT Id, STEM__r.Buyer_Broker__c, Supplier_Broker__c, STEM__c,
                   Buyers_Brokers_Commission_Per_Unit__c, Suppliers_Brokers_Commission_Per_Unit__c,
                   Quantity__c, Quantity_Delivered_Per_BDN__c,
                   (SELECT Id, STEM_Buyer_Broker__r.Buyer_Broker__c, Commission__c
                    FROM STEM_Line_Item_Buyer_Brokers__r)
            FROM STEM_Line_Item__c
            WHERE STEM__c IN :stemIds
        ];

        Map<Id, Commission_Invoice__c> commissionInvoiceMap =
            new Map<Id, Commission_Invoice__c>([
                SELECT Id, Broker__c, Calculated_Amount__c, STEM__c
                FROM Commission_Invoice__c
                WHERE STEM__c IN :stemIds
            ]);

        Map<String, Decimal> commissionInvoiceAmountMap = new Map<String, Decimal>();

        for(STEM_Line_Item__c line : currentStemLineItems){
            Decimal qty = line.Quantity_Delivered_Per_BDN__c != null
                ? line.Quantity_Delivered_Per_BDN__c
                : line.Quantity__c;

            if(line.Supplier_Broker__c != null && line.Suppliers_Brokers_Commission_Per_Unit__c != null){
                String key = line.STEM__c + ',' + line.Supplier_Broker__c;
                commissionInvoiceAmountMap.put(
                    key,
                    (commissionInvoiceAmountMap.get(key) == null ? 0 : commissionInvoiceAmountMap.get(key))
                    + qty * line.Suppliers_Brokers_Commission_Per_Unit__c
                );
            }

            if(line.STEM__r.Buyer_Broker__c != null && line.Buyers_Brokers_Commission_Per_Unit__c != null){
                String key = line.STEM__c + ',' + line.STEM__r.Buyer_Broker__c;
                commissionInvoiceAmountMap.put(
                    key,
                    (commissionInvoiceAmountMap.get(key) == null ? 0 : commissionInvoiceAmountMap.get(key))
                    + qty * line.Buyers_Brokers_Commission_Per_Unit__c
                );
            }

            for(STEM_Line_Item_Buyer_Broker__c bb : line.STEM_Line_Item_Buyer_Brokers__r){
                if(bb.STEM_Buyer_Broker__r.Buyer_Broker__c != null && bb.Commission__c != null){
                    String key = line.STEM__c + ',' + bb.STEM_Buyer_Broker__r.Buyer_Broker__c;
                    commissionInvoiceAmountMap.put(
                        key,
                        (commissionInvoiceAmountMap.get(key) == null ? 0 : commissionInvoiceAmountMap.get(key))
                        + qty * bb.Commission__c
                    );
                }
            }
        }

        for(Commission_Invoice__c invoice : commissionInvoiceMap.values()){
            invoice.Calculated_Amount__c =
                commissionInvoiceAmountMap.get(invoice.STEM__c + ',' + invoice.Broker__c);
        }

        update commissionInvoiceMap.values();
        PaidAmountService.updatePaidAmount(commissionInvoiceMap.keySet());
    }

    public static void updateInput(List<STEM_Line_Item__c> stemLineItems, Map<Id, STEM_Line_Item__c> oldStemLineItems){
        for(STEM_Line_Item__c stemLineItem: stemLineItems){
            STEM_Line_Item__c oldStemLineItem = oldStemLineItems.get(stemLineItem.Id);
            if(stemLineItem.Total_Price__c != oldStemLineItem.Total_Price__c){
                  stemLineItem.Input__c = '🟡';
            }
            if(stemLineItem.Total_Cost__c != oldStemLineItem.Total_Cost__c){
                  stemLineItem.Supplier_Input__c = '🟡';
            }
            if(stemLineItem.Supplier_Invoice__c == null){
                stemLineItem.Supplier_Issued__c = false;
                stemLineItem.Supplier_Input__c = '🔴';
            }
        }
    }

    public static void recalculateAmounts(List<STEM_Line_Item__c> stemLineItems, Map<Id, STEM_Line_Item__c> oldStemLineItems){
        List<Id> invoiceIds = new List<Id>();
        for(STEM_Line_Item__c stemLineItem: stemLineItems){
            STEM_Line_Item__c oldStemLineItem = oldStemLineItems.get(stemLineItem.Id);
            if(stemLineItem.Total_Price__c != oldStemLineItem.Total_Price__c || stemLineItem.Cancelled__c != oldStemLineItem.Cancelled__c){
                invoiceIds.add(stemLineItem.Buyer_Invoice__c);
            }
        }
        if(!invoiceIds.isEmpty()){
            PaidAmountService.recalculateInvoiceAmount(invoiceIds);
        }
    }

    public static void setCalculatedAmountForSupplierInvoice(List<STEM_Line_Item__c> stemLineItems){
        List<String> supplierIds = new List<String>();
        List<String> stemIds = new List<String>();
        for(STEM_Line_Item__c stemLineItem : stemLineItems){
            if(stemLineItem.Original_Supplier__c != null){
                supplierIds.add(stemLineItem.Original_Supplier__c);
                stemIds.add(stemLineItem.STEM__c);
            }
        }
        List<Supplier_Invoice__c> supplierInvoices = [SELECT Id, Calculated_Amount__c, Supplier__c FROM Supplier_Invoice__c WHERE Supplier__c In :supplierIds AND STEM__c IN: stemIds];
        update supplierInvoices;
    }

    public static void updateUninvoicedPayments(List<STEM_Line_Item__c> stemLineItems, Map<Id, STEM_Line_Item__c> oldStemLineItemMap, TriggerOperation operation){
        Id payableRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Payable').getRecordTypeId();
        Set<String> stemIds = new Set<String>();
        Set<String> supplierIds = new Set<String>();
        if (operation == TriggerOperation.AFTER_DELETE) {
            for(STEM_Line_Item__c oldStemLineItem: oldStemLineItemMap.values()){
                stemIds.add(oldStemLineItem.STEM__c);
                supplierIds.add(oldStemLineItem.Original_Supplier__c);
            }
        } else {
            for(STEM_Line_Item__c stemLineItem: stemLineItems){
                if(operation == TriggerOperation.AFTER_INSERT){
                    stemIds.add(stemLineItem.STEM__c);
                    supplierIds.add(stemLineItem.Original_Supplier__c);
                } else{
                    if(stemLineItem.Quantity__c != oldStemLineItemMap.get(stemLineItem.Id).Quantity__c || stemLineItem.Is_Quantity_Range__c != oldStemLineItemMap.get(stemLineItem.Id).Is_Quantity_Range__c ||
                        stemLineItem.Quantity_Max__c != oldStemLineItemMap.get(stemLineItem.Id).Quantity_Max__c || stemLineItem.Quantity_Delivered_per_Bdn__c != oldStemLineItemMap.get(stemLineItem.Id).Quantity_Delivered_per_Bdn__c ||
                        stemLineItem.Unit_Buy_At__c != oldStemLineItemMap.get(stemLineItem.Id).Unit_Buy_At__c || stemLineItem.Original_Supplier__c != oldStemLineItemMap.get(stemLineItem.Id).Original_Supplier__c ||
                        stemLineItem.Cancelled__c != oldStemLineItemMap.get(stemLineItem.Id).Cancelled__c){
                         stemIds.add(stemLineItem.STEM__c);
                         supplierIds.add(stemLineItem.Original_Supplier__c);
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

    public static void calculateSubtotals(List<STEM_Line_Item__c> stemLineItems){
        for(STEM_Line_Item__c stemLineItem: stemLineItems){
            stemLineItem.Subtotal_Sell_At__c = stemLineItem.Total_Price__c + stemLineItem.Total_Extra_Sell_At__c;
            stemLineItem.Subtotal_Buy_At__c = stemLineItem.Total_Cost__c + stemLineItem.Total_Extra_Buy_At__c;
        }
    }

    public static void resetPaymentTerm(Map<Id, STEM_Line_Item__c> stemLineItemMap, Map<Id, STEM_Line_Item__c> oldStemLineItemMap){
        Set<String> supplierIds = new Set<String>();
        Set<String> stemIds = new Set<String>();
        for(STEM_Line_Item__c stemLineItem : stemLineItemMap.values()){
            if(stemLineItem.Payment_Term__c != oldStemLineItemMap.get(stemLineItem.Id).Payment_Term__c){
                supplierIds.add(stemLineItem.Original_Supplier__c);
                stemIds.add(stemLineItem.STEM__c);
            }

        }
        if(!stemIds.isEmpty()){
            List<Supplier_Invoice__c> supplierInvoices = [SELECT Id, Invoice_Amount__c, Supplier__c, Payment_Term__c, STEM__c
                                                          FROM Supplier_Invoice__c WHERE Supplier__c IN :supplierIds AND STEM__c IN: stemIds];
            List<STEM_Extra_Cost__c> stemExtraCosts = [SELECT Id, Supplier__c, Payment_Term__c, STEM__c, STEM_Line_Item__c
                                                       FROM STEM_Extra_Cost__c WHERE Supplier__c IN :supplierIds AND STEM__c IN: stemIds];
            for(STEM_Line_Item__c sli: stemLineItemMap.values()){
                for(Supplier_Invoice__c supplierInvoice: supplierInvoices){
                    if(sli.Supplier_Invoice__c == supplierInvoice.Id){
                        supplierInvoice.Payment_Term__c = sli.Payment_Term__c;
                    }
                }
                for(STEM_Extra_Cost__c sec: stemExtraCosts){
                    if(sli.Id == sec.STEM_Line_Item__c){
                        sec.Payment_Term__c = sli.Payment_Term__c;
                    }
                }
            }
            ContextManager.avoidSTEMExtraCostFiring = true;
            update stemExtraCosts;
            ContextManager.avoidSTEMExtraCostFiring = false;
            ContextManager.avoidSupplierInvoiceFiring = true;
            update supplierInvoices;
            ContextManager.avoidSupplierInvoiceFiring = false;
        }
    }

    public static void deleteDepositPayments(List<STEM_Line_Item__c> stemLineItems, Map<Id, STEM_Line_Item__c> oldStemLineItemMap){
        Set<Id> supplierIds = new Set<Id>();
        Set<Id> oldSupplierIds = new Set<Id>();
        Set<Id> stemIds = new Set<Id>();
        for(STEM_Line_Item__c stemLineItem : stemLineItems){
            if(stemLineItem.Payment_Term__c != oldStemLineItemMap.get(stemLineItem.Id).Payment_Term__c && oldStemLineItemMap.get(stemLineItem.Id).Payment_Term__c == 'Deposit'){
                supplierIds.add(stemLineItem.Original_Supplier__c);
                stemIds.add(stemLineItem.STEM__c);
                oldSupplierIds.add(oldStemLineItemMap.get(stemLineItem.Id).Original_Supplier__c);
            }

        }
        if(!stemIds.isEmpty()){
            // DepositCalculationService already reads the same scoped payments and
            // deletes any row no longer backed by a Deposit line. Avoiding a duplicate
            // query/delete here keeps payment-term changes within Salesforce limits.
            DepositCalculationService.calculateDeposits(stemIds, supplierIds, oldSupplierIds);
        }
    }

    public static void deleteDepositPayments(List<STEM_Line_Item__c> stemLineItems){
        Set<Id> supplierIds = new Set<Id>();
        Set<Id> stemIds = new Set<Id>();
        for(STEM_Line_Item__c stemLineItem : stemLineItems){
            if(stemLineItem.Payment_Term__c == 'Deposit'){
                supplierIds.add(stemLineItem.Original_Supplier__c);
                stemIds.add(stemLineItem.STEM__c);
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

    public static void createDepositPayment(List<STEM_Line_Item__c> stemLineItems, Map<Id, STEM_Line_Item__c> oldStemLineItemMap, TriggerOperation operation){
        Set<Id> stemIds = new Set<Id>();
        Set<Id> supplierIds = new Set<Id>();
        Set<Id> oldSupplierIds = new Set<Id>();
        for(STEM_Line_Item__c stemLineItem: stemLineItems){
            if(operation == TriggerOperation.AFTER_INSERT) {
                if(stemLineItem.Payment_Term__c == 'Deposit'){
                   stemIds.add(stemLineItem.STEM__c);
                    supplierIds.add(stemLineItem.Original_Supplier__c);
                }
            } else if(stemLineItem.Payment_Term__c == 'Deposit'
               && (stemLineItem.Total_Cost__c != oldStemLineItemMap.get(stemLineItem.Id).Total_Cost__c
                   || stemLineItem.Total_Cost__c != oldStemLineItemMap.get(stemLineItem.Id).Total_Cost__c
                   || stemLineItem.Quantity_Delivered_Per_BDN__c != oldStemLineItemMap.get(stemLineItem.Id).Quantity_Delivered_Per_BDN__c
                   || stemLineItem.Is_Quantity_Range__c != oldStemLineItemMap.get(stemLineItem.Id).Is_Quantity_Range__c
                   || stemLineItem.Quantity_Max__c != oldStemLineItemMap.get(stemLineItem.Id).Quantity_Max__c
                   || stemLineItem.Total_Cost__c != oldStemLineItemMap.get(stemLineItem.Id).Total_Cost__c
                   || stemLineItem.Original_Supplier__c != oldStemLineItemMap.get(stemLineItem.Id).Original_Supplier__c
                   || stemLineItem.Payment_Term__c != oldStemLineItemMap.get(stemLineItem.Id).Payment_Term__c
                   || stemLineItem.Supplier_Issued__c != oldStemLineItemMap.get(stemLineItem.Id).Supplier_Issued__c)){
                stemIds.add(stemLineItem.STEM__c);
                supplierIds.add(stemLineItem.Original_Supplier__c);
                oldSupplierIds.add(oldStemLineItemMap.get(stemLineItem.Id).Original_Supplier__c);
            }
        }
        if(!stemIds.isEmpty()){
            DepositCalculationService.calculateDeposits(stemIds, supplierIds, oldSupplierIds);
        }
    }

    public static void sendBdnCompanyAlert(List<STEM_Line_Item__c> stemLineItems, Map<Id, STEM_Line_Item__c> oldStemLineItemMap){
        List<Id> stemIds = new List<Id>();
        for(STEM_Line_Item__c stemLineItem: stemLineItems){
            if(stemLineItem.BDN_Company__c != oldStemLineItemMap.get(stemLineItem.Id).BDN_Company__c){
                stemIds.add(stemLineItem.STEM__c);
            }
        }
        if(!stemIds.isEmpty()){
            Map<Id, STEM__c> stemMap = new Map<Id, STEM__c>([SELECT Id, Name, Delivery_Date__c, Expected_Delivery_Date__c FROM STEM__c WHERE Id IN: stemIds]);
            String textBody = '';
            Messaging.SingleEmailMessage mail = new Messaging.SingleEmailMessage();
            mail.setToAddresses(new List<String>{'general@cosulich.com.hk'});
            mail.setSenderDisplayName('FRATELLI COSULICH');
            mail.setSubject('Salesforce Alert: BDN Change');
            String htmlBody = '<html><body>';
            for (STEM_Line_Item__c stemLineItem : stemLineItems) {
                if (stemLineItem.BDN_Company__c != oldStemLineItemMap.get(stemLineItem.Id).BDN_Company__c) {
                    htmlBody += '<p>';
                    htmlBody += 'STEM: <a href="' + Url.getOrgDomainURL().toExternalForm() + '/' + stemLineItem.STEM__c + '">' + stemMap.get(stemLineItem.STEM__c).Name + '</a><br>';

                    if (stemMap.get(stemLineItem.STEM__c).Delivery_Date__c != null) {
                        htmlBody += 'Delivery Date: ' + stemMap.get(stemLineItem.STEM__c).Delivery_Date__c.format() + '<br>';
                    } else {
                        htmlBody += 'Expected Delivery Date: ' + stemMap.get(stemLineItem.STEM__c).Expected_Delivery_Date__c.format() + '<br>';
                    }

                    htmlBody += 'Previous BDN Company: ' + oldStemLineItemMap.get(stemLineItem.Id).BDN_Company__c + '<br>';
                    htmlBody += 'New BDN Company: ' + stemLineItem.BDN_Company__c + '<br>';
                    htmlBody += 'Changes made by: ' + UserInfo.getName() + '<br>';
                    htmlBody += '</p>';
                }
            }

            htmlBody += '</body></html>';

            mail.setHtmlBody(htmlBody);
            Messaging.sendEmail(new Messaging.SingleEmailMessage[] { mail });
        }

    }

    public static Boolean shouldApplyEnquirySpecialTerms(List<STEM_Line_Item__c> stemLineItems, Map<Id, STEM_Line_Item__c> oldStemLineItems) {
        if (oldStemLineItems == null) return true;
        for (STEM_Line_Item__c stemLineItem : stemLineItems) {
            STEM_Line_Item__c oldStemLineItem = oldStemLineItems.get(stemLineItem.Id);
            if (oldStemLineItem == null) return true;
            Boolean paymentTermChanged = stemLineItem.Payment_Term__c != oldStemLineItem.Payment_Term__c;
            Boolean ruleIdentityChanged = stemLineItem.STEM__c != oldStemLineItem.STEM__c
                || stemLineItem.Original_Supplier__c != oldStemLineItem.Original_Supplier__c
                || stemLineItem.Product__c != oldStemLineItem.Product__c
                || stemLineItem.Port__c != oldStemLineItem.Port__c;
            // Existing behavior is retained for all ordinary updates. A payment-term
            // change cannot alter Account/Product/Port rule applicability, and skipping
            // its five rule queries leaves room for mandatory invoice invalidation.
            if (!paymentTermChanged || ruleIdentityChanged) return true;
        }
        return false;
    }

    public static void applyEnquirySpecialTerms(List<STEM_Line_Item__c> stemLineItems) {
        Map<Id, List<Enquiry_Special_Term__c>> enquirySpecialTermsToCreate = new Map<Id, List<Enquiry_Special_Term__c>>();
        Set<String> supplierIds = new Set<String>();
        Set<String> portIds = new Set<String>();
        Set<String> stemIds = new Set<String>();
        Set<String> productIds = new Set<String>();
        Set<String> portCountries = new Set<String>();
        Map<String, STEM_Line_Item__c> stemLineItemByStemId = new Map<String, STEM_Line_Item__c>();
        Map<String, List<STEM_Line_Item__c>> stemLineItemsByStemId = new Map<String, List<STEM_Line_Item__c>>();
        Map<STEM_Line_Item__c, String> countryByStemLineItem = new Map<STEM_Line_Item__c, String>();
        Map<String, STEM_Line_Item__c> stemLineItemByPortId = new Map<String, STEM_Line_Item__c>();
        Set<String> enquiryIds = new Set<String>();
        for (STEM_Line_Item__c stemLineItem : stemLineItems) {
            portIds.add(stemLineItem.Port__c);
            stemIds.add(stemLineItem.STEM__c);
            productIds.add(stemLineItem.Product__c);
            stemLineItemByPortId.put(stemLineItem.Port__c, stemLineItem);
            stemLineItemByStemId.put(stemLineItem.STEM__c, stemLineItem);
            if(stemLineItemsByStemId.get(stemLineItem.STEM__c) == null){
                stemLineItemsByStemId.put(stemLineItem.STEM__c, new List<STEM_Line_Item__c>());
            }
            stemLineItemsByStemId.get(stemLineItem.STEM__c).add(stemLineItem);
            if (stemLineItem.Original_Supplier__c != null) {
                supplierIds.add(stemLineItem.Original_Supplier__c);
            }
        }

        for (Port__c port : [SELECT Id, Country__c FROM Port__c WHERE Id IN :portIds]) {
            portCountries.add(port.Country__c);
            countryByStemLineItem.put(stemLineItemByPortId.get(port.Id), port.Country__c);
        }
        Map<STEM_Line_Item__c, String> enquiryIdByStemLineItem = new Map<STEM_Line_Item__c, String>();
        for (STEM__c s : [SELECT Id, Enquiry__c FROM STEM__c WHERE Id IN :stemIds]) {
            enquiryIds.add(s.Enquiry__c);
            // enquiryIdByStemLineItem.put(stemLineItemByStemId.get(q.Id), q.OpportunityId);
            for(STEM_Line_Item__c sli : stemLineItemsByStemId.get(s.Id)){
                enquiryIdByStemLineItem.put(sli, s.Enquiry__c);
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
            for (STEM_Line_Item__c sli : stemLineItems) {
                String enquiryId = enquiryIdByStemLineItem.get(sli);
                if (!String.isEmpty(str.Account__c) && !String.isEmpty(sli.Original_Supplier__c)
                                                    && str.Account__c.equals(sli.Original_Supplier__c) && str.Supplier_Buyer__c == 'Supplier') {
                    // base case, this supplier ALWAYS gets this rule
                    if (String.isEmpty(str.Product__c) && String.isEmpty(str.Port__c) && String.isEmpty(str.Country__c)) {
                        enquirySpecialTermsToCreate = addEnquirySpecialTerms(enquirySpecialTermsToCreate, str, enquiryId, sli.Id, 'Supplier is: ' + str.Account__r.Name);
                    }

                    // supplier & product
                    if (String.isEmpty(str.Port__c) && String.isEmpty(str.Country__c)
                                                    && !String.isEmpty(str.Product__c) && str.Product__c.equals(sli.Product__c)) {
                        enquirySpecialTermsToCreate = addEnquirySpecialTerms(enquirySpecialTermsToCreate, str, enquiryId, sli.Id,
                                                                                'Supplier is: ' + str.Account__r.Name + ', Product is: ' + str.Product__r.Name);
                    }

                    // supplier & product & port or port's country
                    if (((!String.isEmpty(str.Port__c) && str.Port__c.equals(sli.Port__c)) || (!String.isEmpty(str.Country__c) && str.Country__c.equals(countryByStemLineItem.get(sli))))
                        && (!String.isEmpty(str.Product__c) && str.Product__c.equals(sli.Product__c))) {
                        if (!String.isEmpty(str.Port__c) && str.Port__c.equals(sli.Port__c)) {
                            enquirySpecialTermsToCreate = addEnquirySpecialTerms(enquirySpecialTermsToCreate, str, enquiryId, sli.Id,
                                                                                    'Supplier is: ' + str.Account__r.Name + ', Product is: '
                                                                                    + str.Product__r.Name + ' Port is ' + str.Port__r.Name);
                        } else {
                            enquirySpecialTermsToCreate = addEnquirySpecialTerms(enquirySpecialTermsToCreate, str, enquiryId, sli.Id,
                                                                                    'Supplier is: ' + str.Account__r.Name + ', Product is: ' + str.Product__r.Name
                                                                                    + ' Port\'s Country is ' + str.Country__c);
                        }
                    }

                    // supplier & port or port's country
                    if ((!String.isEmpty(str.Port__c) && str.Port__c.equals(sli.Port__c))
                                                        || (!String.isEmpty(str.Country__c) && str.Country__c.equals(countryByStemLineItem.get(sli)))) {
                        if (!String.isEmpty(str.Port__c) && str.Port__c.equals(sli.Port__c)) {
                            enquirySpecialTermsToCreate = addEnquirySpecialTerms(enquirySpecialTermsToCreate, str, enquiryId, sli.Id,
                                                                                    'Supplier is: ' + str.Account__r.Name + ' Port is ' + str.Port__r.Name);
                        } else {
                            enquirySpecialTermsToCreate = addEnquirySpecialTerms(enquirySpecialTermsToCreate, str, enquiryId, sli.Id,
                                                                                    'Supplier is: ' + str.Account__r.Name + ' Port\'s Country is ' + str.Country__c);
                        }
                    }
                }

                // PRODUCT matches special terms rule
                if (!String.isEmpty(str.Product__c) && !String.isEmpty(sli.Product__c) && str.Product__c.equals(sli.Product__c)) {
                    // base case, this PRODUCT ALWAYS gets this rule
                    if (String.isEmpty(str.Port__c) && String.isEmpty(str.Country__c)) {
                        enquirySpecialTermsToCreate = addEnquirySpecialTerms(enquirySpecialTermsToCreate, str, enquiryId, sli.Id,
                                                                                'Product is: ' + str.Product__r.Name);
                    }

                    // product and port or country
                    if ((!String.isEmpty(str.Port__c) && str.Port__c.equals(sli.Port__c)) ||
                        (!String.isEmpty(str.Country__c) && str.Country__c.equals(countryByStemLineItem.get(sli)))) {
                        if (!String.isEmpty(str.Port__c) && str.Port__c.equals(sli.Port__c)) {
                            enquirySpecialTermsToCreate= addEnquirySpecialTerms(enquirySpecialTermsToCreate, str, enquiryId, sli.Id,
                                                                                'Product is: ' + str.Product__r.Name + ' Port is ' + str.Port__r.Name);
                        } else {
                            enquirySpecialTermsToCreate= addEnquirySpecialTerms(enquirySpecialTermsToCreate, str, enquiryId, sli.Id,
                                                                                'Product is: ' + str.Product__r.Name + ' Port\'s Country is ' + str.Country__c);
                        }
                    }
                }

                // PORT OR PORT\'s Country
                if((!String.isEmpty(str.Port__c) || !String.isEmpty(str.Country__c))
                                                    && String.isEmpty(str.Account__c)
                                                    && String.isEmpty(str.Product__c)) {
                    if (!String.isEmpty(str.Port__c) && str.Port__c.equals(sli.Port__c)) {
                        enquirySpecialTermsToCreate = addEnquirySpecialTerms(enquirySpecialTermsToCreate, str, enquiryId, sli.Id,
                                                                                'Port is ' + str.Port__r.Name);
                    }

                    if (!String.isEmpty(str.Country__c) && str.Country__c.equals(countryByStemLineItem.get(sli))) {
                        enquirySpecialTermsToCreate= addEnquirySpecialTerms(enquirySpecialTermsToCreate, str, enquiryId, sli.Id,
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
         * Creating junction object between StemLineItem and Enquiry_Special_Term__c
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
                                                                                       STEM_Line_Item__c = key,
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

    public static void deprecateNomination(Map<Id, STEM_Line_Item__c> stemLineItemMap){
        Set<Id> supplierIds = new Set<Id>();
        Set<Id> stemIds = new Set<Id>();
        Set<String> paymentTerms = new Set<String>();
        for(STEM_Line_Item__c stemLineItem: stemLineItemMap.values()){
            supplierIds.add(stemLineItem.Original_Supplier__c);
               stemIds.add(stemLineItem.STEM__c);
            paymentTerms.add(stemLineItem.Payment_Term__c);
        }
        List<STEM_Line_Item__c> sameSupplierStemLineItems = [SELECT Id FROM STEM_Line_Item__c WHERE STEM__c IN: stemIds AND Original_Supplier__c IN: supplierIds AND Payment_Term__c IN: paymentTerms];
        List<STEM_Extra_Cost__c> sameSupplierStemExtraCosts = [SELECT Id FROM STEM_Extra_Cost__c
                                                               WHERE STEM__c IN: stemIds and Supplier__c IN: supplierIds AND Payment_Term__c IN: paymentTerms AND Id NOT IN: stemLineItemMap.keySet()];
        List<Nomination__c> nominations = [SELECT Id, PDF__c, Deprecated__c, STEM__c, Account__c, Sent__c, Received__c, RecordTypeId, Payment_Term__c FROM Nomination__c WHERE STEM__c IN: stemIds];
        if(sameSupplierStemLineItems.isEmpty() && sameSupplierStemExtraCosts.isEmpty()){
            for(Nomination__c nomination: nominations){
                for(STEM_Line_Item__c stemLineItem: stemLineItemMap.values()){
                    if(nomination.STEM__c == stemLineItem.STEM__c && nomination.Account__c == stemLineItem.Original_Supplier__c && nomination.Payment_Term__c == stemLineItem.Payment_Term__c){
                        nomination.Deprecated__c = true;
                    }
                    if(nomination.STEM__c == stemLineItem.STEM__c && nomination.RecordTypeId == FCBStatic.NOMINATION_BUYER_RT_IT){
                        nomination.PDF__c = nomination.PDF__c == '🟢'
                                    ? '🟡'
                                    : nomination.PDF__c == '⚫'
                                        ? '🔴'
                                        : nomination.PDF__c;
                        nomination.Sent__c = nomination.Sent__c == '🟢' ? '🟡' : nomination.Sent__c;
                        nomination.Received__c = nomination.Received__c == '🟢' ? '🟡' : nomination.Received__c;
                    }
                }
            }
        } else{
            for(Nomination__c nomination: nominations){
                for(STEM_Line_Item__c stemLineItem: stemLineItemMap.values()){
                    if(nomination.STEM__c == stemLineItem.STEM__c && nomination.Account__c == stemLineItem.Original_Supplier__c && nomination.Payment_Term__c == stemLineItem.Payment_Term__c){
                        nomination.PDF__c = nomination.PDF__c == '🟢'
                                    ? '🟡'
                                    : nomination.PDF__c == '⚫'
                                        ? '🔴'
                                        : nomination.PDF__c;
                        nomination.Sent__c = nomination.Sent__c == '🟢' ? '🟡' : nomination.Sent__c;
                        nomination.Received__c = nomination.Received__c == '🟢' ? '🟡' : nomination.Received__c;
                    }
                    if(nomination.STEM__c == stemLineItem.STEM__c && nomination.RecordTypeId == FCBStatic.NOMINATION_BUYER_RT_IT){
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

    public static void deleteContentDocuments(Map<Id, STEM_Line_Item__c> stemLineItemMap) {
        List<ContentDocumentLink> contentDocumentLinkList =[SELECT Id, ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId In: stemLineItemMap.keySet()];
        List<Id> docIdList = new List<Id>();
        for(ContentDocumentLink cdl: ContentDocumentLinkList){
            docIdList.add(cdl.ContentDocumentId);
        }
        List<ContentDocument> conDocList =[SELECT Id FROM ContentDocument where Id IN: docIdList];

        delete conDocList;
    }

    public static void deleteExtraCosts(Map<Id, STEM_Line_Item__c> stemLineItemMap) {
        List<STEM_Extra_Cost__c> extraCosts = [SELECT Id FROM STEM_Extra_Cost__c WHERE STEM_Line_Item__c In: stemLineItemMap.keySet()];

        delete extraCosts;
    }
}
