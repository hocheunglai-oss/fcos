public class StemTriggerHandler {

    public static void validateBuyerBrokerSelection(List<STEM__c> stems, Map<Id, STEM__c> oldStemMap) {
        Set<Id> changedBrokerIds = new Set<Id>();
        for (STEM__c stem : stems) {
            STEM__c oldStem = oldStemMap == null ? null : oldStemMap.get(stem.Id);
            if (stem.Buyer_Broker__c != null
                && (oldStem == null || stem.Buyer_Broker__c != oldStem.Buyer_Broker__c)) {
                changedBrokerIds.add(stem.Buyer_Broker__c);
            }
        }
        if (changedBrokerIds.isEmpty()) return;

        Map<Id, Account> brokers = new Map<Id, Account>([
            SELECT Id, RecordTypeId, Inactive_Suspended__c, Is_Broker__c
            FROM Account
            WHERE Id IN :changedBrokerIds
        ]);
        for (STEM__c stem : stems) {
            STEM__c oldStem = oldStemMap == null ? null : oldStemMap.get(stem.Id);
            if (stem.Buyer_Broker__c == null
                || (oldStem != null && stem.Buyer_Broker__c == oldStem.Buyer_Broker__c)) {
                continue;
            }
            Account broker = brokers.get(stem.Buyer_Broker__c);
            if (broker == null || broker.Inactive_Suspended__c == true
                || (broker.RecordTypeId != FCBStatic.BROKER_ACCOUNT_RT_ID && broker.Is_Broker__c != true)) {
                stem.Buyer_Broker__c.addError('Choose an active Account that is a Broker or has Is Broker selected.');
            }
        }
    }

    public static void updateVesselAndPort(List<STEM__c> stemList, Map<Id, STEM__c> oldStemMap) {
        Id originatedRecordTypeId = Schema.SObjectType.STEM__c.getRecordTypeInfosByName().get('Originated').getRecordTypeId();
        Id stemChargeRecordTypeId = Schema.SObjectType.STEM_Extra_Cost__c.getRecordTypeInfosByName().get('STEM Charge').getRecordTypeId();

        Set<Id> enquiryIds = new Set<Id>();
        Map<Id, String> oppIdToVessel = new Map<Id, String>();
        Map<Id, String> oppIdToPort = new Map<Id, String>();
        Map<Id, String> quoteIdToAccount = new Map<Id, String>();
        Map<Id, STEM__c> stemsToUpdateChildren = new Map<Id, STEM__c>();

        for(STEM__c stem : stemList) {
            STEM__c oldStem = oldStemMap.get(stem.Id);
            if(stem.RecordTypeId == originatedRecordTypeId){
                if((stem.Vessel__c != oldStem.Vessel__c || stem.Port__c != oldStem.Port__c || stem.Account__c != oldStem.Account__c)
                    && stem.Enquiry__c != null){
                    enquiryIds.add(stem.Enquiry__c);
                }
                if(stem.Vessel__c != oldStem.Vessel__c && stem.Enquiry__c != null){
                    oppIdToVessel.put(stem.Enquiry__c, stem.Vessel__c);
                }
                if(stem.Port__c != oldStem.Port__c && stem.Enquiry__c != null){
                    oppIdToPort.put(stem.Enquiry__c, stem.Port__c);
                }
                // Master Contract STEMs intentionally have no Quote/Offer lineage.
                if(stem.Account__c != oldStem.Account__c && stem.Quote__c != null){
                    quoteIdToAccount.put(stem.Quote__c, stem.Account__c);
                }

                stemsToUpdateChildren.put(stem.Id, stem);
            }
        }
        if(!enquiryIds.isEmpty()){
            List<Opportunity> enquiries = [SELECT Id, Vessel__c, Allow_Closed_Won_Update__c FROM Opportunity WHERE Id IN :enquiryIds];

            for(Opportunity opp : enquiries) {
                opp.Allow_Closed_Won_Update__c = true;
            }
            ContextManager.avoidEnquiryFiring = true;
            update enquiries;
            ContextManager.avoidEnquiryFiring = false;

            if(!oppIdToVessel.isEmpty()){
                for(Opportunity opp : enquiries) {
                    opp.Vessel__c = oppIdToVessel.get(opp.Id);
                }
                update enquiries;
            }
            if(!quoteIdToAccount.isEmpty()){
                List<Quote> quotes = [SELECT Id, Enquiry_Broker__c FROM Quote WHERE Id IN :quoteIdToAccount.keySet()];
                List<Broker_Enquiry__c> enquiryBrokers = new List<Broker_Enquiry__c>();
                for(Quote quote: quotes) {
                    enquiryBrokers.add(new Broker_Enquiry__c(Id = quote.Enquiry_Broker__c, Buyer__c = quoteIdToAccount.get(quote.Id)));
                }

                update enquiryBrokers;
            }
            if(!oppIdToVessel.isEmpty() || !oppIdToPort.isEmpty()){
                List<STEM_Line_Item__c> lineItemsToUpdate = new List<STEM_Line_Item__c>();
                List<STEM_Extra_Cost__c> extraCostsToUpdate = new List<STEM_Extra_Cost__c>();

                List<STEM_Line_Item__c> lineItems = [SELECT Id, STEM__c, Vessel__c, Port__c, Product__c, Original_Supplier__c, Offer_Line_Item__r.Opportunity_Line_Item__c FROM STEM_Line_Item__c WHERE STEM__c IN :stemsToUpdateChildren.keySet()];

                List<STEM_Extra_Cost__c> extraCosts = [SELECT Id, STEM__c, Vessel__c, Port__c, Product2Id__c, Supplier__c, Offer_Line_Item__r.Opportunity_Line_Item__c FROM STEM_Extra_Cost__c WHERE STEM__c IN :stemsToUpdateChildren.keySet()];

                Set<Id> opportunityLineItemIds = new Set<Id>();
                for(STEM_Line_Item__c sli : lineItems) {
                    STEM__c parentStem = stemsToUpdateChildren.get(sli.STEM__c);
                    sli.Vessel__c = parentStem.Vessel__c;
                    sli.Port__c = parentStem.Port__c;
                    lineItemsToUpdate.add(sli);
                    if(!oppIdToPort.isEmpty() && sli.Offer_Line_Item__r != null
                        && sli.Offer_Line_Item__r.Opportunity_Line_Item__c != null){
                        opportunityLineItemIds.add(sli.Offer_Line_Item__r.Opportunity_Line_Item__c);
                    }
                }

                for(STEM_Extra_Cost__c sec : extraCosts) {
                    STEM__c parentStem = stemsToUpdateChildren.get(sec.STEM__c);
                    sec.Vessel__c = parentStem.Vessel__c;
                    sec.Port__c = parentStem.Port__c;
                    extraCostsToUpdate.add(sec);
                    if(!oppIdToPort.isEmpty() && sec.Offer_Line_Item__r != null
                        && sec.Offer_Line_Item__r.Opportunity_Line_Item__c != null){
                        opportunityLineItemIds.add(sec.Offer_Line_Item__r.Opportunity_Line_Item__c);
                    }
                }

                if (!lineItemsToUpdate.isEmpty()){
                    ContextManager.avoidSTEMLineItemFiring = true;
                    update lineItemsToUpdate;
                    ContextManager.avoidSTEMLineItemFiring = false;
                    StemLineItemTriggerHandler.applyEnquirySpecialTerms(lineItemsToUpdate);
                }
                if (!extraCostsToUpdate.isEmpty()){
                    ContextManager.avoidSTEMExtraCostFiring = true;
                    update extraCostsToUpdate;
                    ContextManager.avoidSTEMExtraCostFiring = false;
                    StemExtraCostTriggerHandler.applyEnquirySpecialTerms(extraCostsToUpdate);
                }
                if(!oppIdToPort.isEmpty() && !opportunityLineItemIds.isEmpty()){
                    List<OpportunityLineItem> enquiryLineItems = [SELECT Id, Port__c, OpportunityId FROM OpportunityLineItem WHERE Id IN :opportunityLineItemIds];
                    for(OpportunityLineItem enqLineItem : enquiryLineItems) {
                        enqLineItem.Port__c = oppIdToPort.get(enqLineItem.OpportunityId);
                    }
                    update enquiryLineItems;
                }
            }

            for(Opportunity opp : enquiries) {
                opp.Allow_Closed_Won_Update__c = false;
            }
            ContextManager.avoidEnquiryFiring = true;
            update enquiries;
            ContextManager.avoidEnquiryFiring = false;
        }

    }

    public static void passBuyersPayTermDate(List<STEM__c> stemList) {
        Id originatedRecordTypeId = Schema.SObjectType.STEM__c.getRecordTypeInfosByName().get('Originated').getRecordTypeId();
        for (STEM__c stem : stemList) {
            if(stem.RecordTypeId == originatedRecordTypeId && stem.Delivery_Date__c != null) {
                stem.Buyer_Pay_Term_Date__c = stem.Delivery_Date__c.addDays(29);
            }
        }
    }

    public static void setInvoiceStatus(List<STEM__c> stemList){
        for(STEM__c stem: stemList){
            if(stem.Invoice_Quantity__c > 0){
                stem.Invoice_Status__c = 'Invoiced';
            } else if(stem.Not_Cancelled_STEM_Line_Item_Quantity__c == 0 && stem.Not_Cancelled_STEM_Extra_Cost_Quantity__c == 0){
                stem.Invoice_Status__c = 'Cancelled';
            } else{
                stem.Invoice_Status__c = 'Un-Invoiced';
            }
        }
    }

    public static void sendCompeletedNotification(List<STEM__c> stemList, Map<Id, STEM__c> oldStemMap){
        Id originatedRecordTypeId = Schema.SObjectType.STEM__c.getRecordTypeInfosByName().get('Originated').getRecordTypeId();
        Set<Id> stemIds = new Set<Id>();
        for(STEM__c stem: stemList){
            if(stem.Acknowledge_Receipt__c != oldStemMap.get(stem.Id).Acknowledge_Receipt__c && stem.Acknowledge_Receipt__c && stem.RecordTypeId == originatedRecordTypeId){
                stemIds.add(stem.Id);
            }
        }

        if(!stemIds.isEmpty()){
            String text = 'Invoice Receipt Acknowledgment from Buyer';
            CustomNotificationType notificationType = [SELECT Id, DeveloperName
                                                      FROM CustomNotificationType
                                                      WHERE DeveloperName='All_Users_Notification'];
            List<Task> tasks = [SELECT Id, Status, OwnerId, WhatId FROM Task WHERE WhatId IN: stemIds];
            Set<Id> users = new Set<Id>{UserInfo.getUserId()};
            for(Task task: tasks){
                task.Status = 'Completed';
                ReconfirmProcessing.notifyUsers(new Set<STring>{UserInfo.getUserId(), task.OwnerId}, task.WhatId, notificationType.Id, text, 'Completed');
            }
               update tasks;
        }
    }


    public static void resetPsprs(List<STEM__c> stemList, Map<Id, STEM__c> oldStemMap){
        Id originatedRecordTypeId = Schema.SObjectType.STEM__c.getRecordTypeInfosByName().get('Originated').getRecordTypeId();
        Set<Id> accountIds = new Set<Id>();
        for(STEM__c stem: stemList){
            if(stem.Account__c != oldStemMap.get(stem.Id).Account__c && stem.RecordTypeId == originatedRecordTypeId){
                accountIds.add(stem.Account__c);
            }
        }

        Map<Id, String> accountPSPRSMap = new Map<Id, String>();
        if(!accountIds.isEmpty()){
            for(Account account: [SELECT Id, PSPRS__c FROM Account WHERE Id IN: accountIds]){
                accountPSPRSMap.put(account.Id, account.PSPRS__c);
            }
            for(STEM__c stem: stemList){
                if(stem.Account__c != oldStemMap.get(stem.Id).Account__c && stem.RecordTypeId == originatedRecordTypeId){
                    stem.PSPRS__c = accountPSPRSMap.get(stem.Account__c);
                }
            }
        }
    }

    public static void updateDisputes(List<STEM__c> stemList, Map<Id, STEM__c> oldStemMap){
        Id originatedRecordTypeId = Schema.SObjectType.STEM__c.getRecordTypeInfosByName().get('Originated').getRecordTypeId();
        Set<String> stemIds = new Set<String>();
        for(STEM__c stem: stemList){
            if(stem.Account__c != oldStemMap.get(stem.Id).Account__c && stem.RecordTypeId == originatedRecordTypeId){
                stemIds.add(stem.Id);
            }
        }
        if(!stemIds.isEmpty()){
            List<Dispute__c> disputes = [SELECT Id, Buyer__c, STEM__c FROM Dispute__c WHERE STEM__c IN: stemIds];
            for(Dispute__c dispute: disputes){
                for(STEM__c stem: stemList){
                    if(dispute.STEM__c == stem.Id && dispute.Buyer__c == oldStemMap.get(stem.Id).Account__c){
                        dispute.Buyer__c = stem.Account__c;
                    }
                }
            }
            if(!disputes.isEmpty()){
                update disputes;
            }
        }
    }

    public static void setExpectedDeliveryDate(List<STEM__c> stemList){
        for(STEM__c stem: stemList){
            if(Test.isRunningTest()){
                return;
            }
            if (stem.ETA_ETB__c == 'ETA') {
                stem.Expected_Delivery_Date__c = stem.ETA_Start_Date__c;
            } else if (stem.ETA_ETB__c == 'ETB') {
                stem.Expected_Delivery_Date__c = stem.ETB_Start_Date__c;
            } else if (stem.ETA_ETB__c == 'PROMPT') {
                stem.Expected_Delivery_Date__c = Date.today();
            }
        }
    }

    public static void removeBuyerBrokerRefcodeIndex(List<STEM__c> stems, Map<Id, STEM__c> oldStemMap){
        for(STEM__c stem: stems){
            STEM__c oldStem = oldStemMap.get(stem.Id);
            if(stem.Buyer_Broker__c != oldStem.Buyer_Broker__c){
                stem.Buyer_Broker_Refcode_Index__c = null;
            }
        }
    }

    public static void updateIsChangedCSVField(List<STEM__c> stems, Map<Id, STEM__c> oldStemMap){
        Map<String, String> stemLineItemBuyerBrokerMap = new Map<String, String>();
        Map<String, String> oldStemLineItemBuyerBrokerMap = new Map<String, String>();
        Set<String> stemIds = new Set<String>();
        for(STEM__c stem: stems){
            if(stem.RecordTypeId == FCBStatic.ORIGINATED_STEM_RT_ID){
                STEM__c oldStem = oldStemMap.get(stem.Id);
                if(stem.Buyer_Broker__c != oldStem.Buyer_Broker__c){
                    stemLineItemBuyerBrokerMap.put(stem.Id, stem.Buyer_Broker__c);
                    oldStemLineItemBuyerBrokerMap.put(stem.Id, oldStem.Buyer_Broker__c);
                }
                if(stem.Account__c != oldStem.Account__c){
                    stemIds.add(stem.Id);
                }
            }
        }
        if(!stemIds.isEmpty()){
            List<Invoice__c> invoices = [SELECT Id, Is_CSV_Info_Changed__c FROM Invoice__c WHERE STEM__c IN: stemIds AND Exported__c = true];
            for(Invoice__c invoice: invoices){
                invoice.Is_CSV_Info_Changed__c = true;
            }
            ContextManager.avoidInvoiceFiring = true;
            update invoices;
            ContextManager.avoidInvoiceFiring = false;
        }
        if(!stemLineItemBuyerBrokerMap.isEmpty()){
            List<STEM_Line_Item__c> stemLineItems = [SELECT Id, STEM__c, Is_Buyer_Purchase_Comm_Exported__c, Is_Buyer_Purchase_Comm_Info_Changed__c, Supplier_Broker__c,
                                                     Is_Supplier_Purchase_Comm_Exported__c, Is_Supplier_Purchase_Comm_Info_Changed__c
                                                        FROM STEM_Line_Item__c
                                                        WHERE STEM__c IN: stemLineItemBuyerBrokerMap.keySet()
                                                     AND (STEM__r.Buyer_Broker__c IN: stemLineItemBuyerBrokerMap.values() OR STEM__r.Buyer_Broker__c IN: oldStemLineItemBuyerBrokerMap.values()) ];
            for(STEM_Line_Item__c stemLineItem: stemLineItems){
                if(stemLineItem.Is_Buyer_Purchase_Comm_Exported__c){
                    stemLineItem.Is_Buyer_Purchase_Comm_Info_Changed__c = true;
                }
                if(stemLineItem.Is_Supplier_Purchase_Comm_Exported__c && (stemLineItem.Supplier_Broker__c == stemLineItemBuyerBrokerMap.get(stemLineItem.STEM__c)
                                                                          || stemLineItem.Supplier_Broker__c == oldStemLineItemBuyerBrokerMap.get(stemLineItem.STEM__c))){
                    stemLineItem.Is_Supplier_Purchase_Comm_Info_Changed__c = true;
                }
            }
            ContextManager.avoidSTEMLineItemFiring = true;
            update stemLineItems;
            ContextManager.avoidSTEMLineItemFiring = false;
            List<MYOB_Invoice__c> myobInvoices = [SELECT Id, Account__c, STEM__c, Is_Changed__c
                                                  FROM MYOB_Invoice__c WHERE STEM__c IN: stemLineItemBuyerBrokerMap.keySet()];
            for(MYOB_Invoice__c myobInvoice: myobInvoices){
                if(stemLineItemBuyerBrokerMap.values().contains(myobInvoice.Account__c) || oldStemLineItemBuyerBrokerMap.values().contains(myobInvoice.Account__c)){
                       myobInvoice.Is_Changed__c = true;
                }
            }
        }
    }

    public static void updateNominations(Map<Id, STEM__c> stemMap, Map<Id, STEM__c> oldStemMap){
        Id originatedRecordTypeId = Schema.SObjectType.STEM__c.getRecordTypeInfosByName().get('Originated').getRecordTypeId();
        Set<String> stemIds = new Set<String>();
        Set<String> onlyConfirmationUpdateStemIds = new Set<String>();
        Set<String> onlyNominationUpdateStemIds = new Set<String>();
        for(STEM__c stem: stemMap.values()){
            if(stem.RecordTypeId == originatedRecordTypeId && (
               stem.ETA_ETB__c != oldStemMap.get(stem.Id).ETA_ETB__c || stem.ETA_Start_Date__c != oldStemMap.get(stem.Id).ETA_Start_Date__c
               || stem.ETA_Start_Time__c != oldStemMap.get(stem.Id).ETA_Start_Time__c || stem.ETA_End_Date__c != oldStemMap.get(stem.Id).ETA_End_Date__c
               || stem.ETA_End_Time__c != oldStemMap.get(stem.Id).ETA_End_Time__c || stem.ETB_Start_Date__c != oldStemMap.get(stem.Id).ETB_Start_Date__c
               || stem.ETB_Start_Time__c != oldStemMap.get(stem.Id).ETB_Start_Time__c || stem.ETB_End_Date__c != oldStemMap.get(stem.Id).ETB_End_Date__c
               || stem.ETB_End_Time__c != oldStemMap.get(stem.Id).ETB_End_Time__c || stem.ETD_Start_Date__c != oldStemMap.get(stem.Id).ETD_Start_Date__c
               || stem.ETD_Start_Time__c != oldStemMap.get(stem.Id).ETD_Start_Time__c || stem.ETD_End_Date__c != oldStemMap.get(stem.Id).ETD_End_Date__c
               || stem.ETD_End_Time__c != oldStemMap.get(stem.Id).ETD_End_Time__c || stem.ETCD_Start_Date__c != oldStemMap.get(stem.Id).ETCD_Start_Date__c
               || stem.ETCD_Start_Time__c != oldStemMap.get(stem.Id).ETCD_Start_Time__c || stem.ETCD_End_Date__c != oldStemMap.get(stem.Id).ETCD_End_Date__c
               || stem.ETCD_End_Time__c != oldStemMap.get(stem.Id).ETCD_End_Time__c || stem.Vessel__c != oldStemMap.get(stem.Id).Vessel__c
               || stem.Port__c != oldStemMap.get(stem.Id).Port__c)){
                stemIds.add(stem.Id);
            }
            if(stem.RecordTypeId == originatedRecordTypeId && stem.Agent__c != oldStemMap.get(stem.Id).Agent__c){
                onlyNominationUpdateStemIds.add(stem.Id);
            }
            if(stem.RecordTypeId == originatedRecordTypeId && (stem.Payment_Term__c != oldStemMap.get(stem.Id).Payment_Term__c
                                                              || stem.Partial_CIA__c != oldStemMap.get(stem.Id).Partial_CIA__c
                                                               || stem.Partial_Lumpsum_Sell_At__c != oldStemMap.get(stem.Id).Partial_Lumpsum_Sell_At__c)){
                onlyConfirmationUpdateStemIds.add(stem.Id);
            }
        }
        if(!stemIds.isEmpty() || !onlyConfirmationUpdateStemIds.isEmpty() || !onlyNominationUpdateStemIds.isEmpty()){
            List<Nomination__c> nominations = [SELECT Id, STEM__c, STEM__r.Payment_Term__c, Port__c, Expected_Delivery_Date__c, Enquiry__c, RefCode__c, PDF__c, Sent__c, Received__c,
                                               RecordTypeId
                                                  FROM Nomination__c WHERE (STEM__c IN: stemIds OR STEM__c IN: onlyConfirmationUpdateStemIds OR STEM__c IN: onlyNominationUpdateStemIds)
                                               AND Deprecated__c = false];
            for(Nomination__c nomination: nominations){
                if(onlyConfirmationUpdateStemIds.contains(nomination.STEM__c)){
                    if(nomination.RecordTypeId == FCBSTatic.BUYER_NOMINATION_RT_ID){
                        nomination.PDF__c = nomination.PDF__c == '🟢' ? '🟡' : nomination.PDF__c;
                        nomination.Sent__c = nomination.Sent__c == '🟢' ? '🟡' : nomination.Sent__c;
                        nomination.Received__c = nomination.Received__c == '🟢' ? '🟡' : nomination.Received__c;
                        nomination.Payment_Term__c = nomination.STEM__r.Payment_Term__c;
                    }
                }
                if(onlyNominationUpdateStemIds.contains(nomination.STEM__c)){
                    if(nomination.RecordTypeId == FCBSTatic.SUPPLIER_NOMINATION_RT_ID){
                        nomination.PDF__c = nomination.PDF__c == '🟢' ? '🟡' : nomination.PDF__c;
                        nomination.Sent__c = nomination.Sent__c == '🟢' ? '🟡' : nomination.Sent__c;
                        nomination.Received__c = nomination.Received__c == '🟢' ? '🟡' : nomination.Received__c;
                    }
                }
                if(stemIds.contains(nomination.STEM__c)){
                    nomination.PDF__c = nomination.PDF__c == '🟢' ? '🟡' : nomination.PDF__c;
                    nomination.Sent__c = nomination.Sent__c == '🟢' ? '🟡' : nomination.Sent__c;
                    nomination.Received__c = nomination.Received__c == '🟢' ? '🟡' : nomination.Received__c;
                }
            }
            update nominations;
        }
    }

    public static void updateConfirmationWhenBuyerIsChanged(Map<Id, STEM__c> stemMap, Map<Id, STEM__c> oldStemMap){
        Id originatedRecordTypeId = Schema.SObjectType.STEM__c.getRecordTypeInfosByName().get('Originated').getRecordTypeId();
        Set<String> stemIds = new Set<String>();
        for(STEM__c stem: stemMap.values()){
            if(stem.RecordTypeId == originatedRecordTypeId && stem.Account__c != oldStemMap.get(stem.Id).Account__c){
                stemIds.add(stem.Id);
            }
        }
        if(!stemIds.isEmpty()){
            List<Nomination__c> nominations = [SELECT Id, STEM__c, Account__c, File__c, PDF__c, Sent__c, Received__c
                                           FROM Nomination__c WHERE STEM__c In: stemIds AND RecordTypeId =: FCBStatic.NOMINATION_BUYER_RT_IT AND Deprecated__c = false];
            Set<String> nominationIds = new Set<String>();
            for(Nomination__c nomination: nominations){
                for(STEM__c stem: stemMap.values()){
                    if(nomination.STEM__c == stem.Id && nomination.Account__c == oldStemMap.get(stem.Id).Account__c){
                        nomination.Account__c = stem.Account__c;
                        nomination.PDF__c = nomination.PDF__c == '🟢' ? '🟡' : nomination.PDF__c;
                        nomination.Sent__c = nomination.Sent__c == '🟢' ? '🟡' : nomination.Sent__c;
                        nomination.Received__c = nomination.Received__c == '🟢' ? '🟡' : nomination.Received__c;

                        nominationIds.add(nomination.Id);
                    }
                }
            }
            update nominations;
        }
    }

    public static void setPaymentDelayForOriginatedStem(List<STEM__c> stemList){
        Id originatedRecordTypeId = Schema.SObjectType.STEM__c.getRecordTypeInfosByName().get('Originated').getRecordTypeId();
        List<String> stemIds = new List<String>();
        for(STEM__c stem: stemList){
            if(stem.RecordTypeId == originatedRecordTypeId){
                stemIds.add(stem.Id);
            }
        }
        if(!stemIds.isEmpty()){
            List<Payment__c> payments = [SELECT Id, Amount__c, Date__c, RecordType.Name, STEM__c FROM Payment__c WHERE RecordType.Name = 'Receivable' AND STEM__c IN: stemIds];

            for(STEM__c stem: stemList){
                if(stem.RecordTypeId == originatedRecordTypeId){
                    if(stem.Receivable_Balance__c <= 0){
                        stem.Payment_Delay__c = 0;
                        for(Payment__c payment: payments){
                            if(stem.Total_Invoice_Amount__c != 0 && stem.Invoice_Due_Date__c != null && payment.STEM__c == stem.Id) {
                              stem.Payment_Delay__c += (payment.Amount__c / stem.Total_Invoice_Amount__c) * payment.Date__c.daysBetween(stem.Invoice_Due_Date__c);
                            }
                        }
                    } else{
                        stem.Payment_Delay__c = null;
                    }
                }
            }
        }
    }

    public static void setPaymentDelayForHistoricalStem(List<STEM__c> stemList){
        Id historicalRecordTypeId = Schema.SObjectType.STEM__c.getRecordTypeInfosByName().get('Historical').getRecordTypeId();
        for(STEM__c stem: stemList){
            if(stem.RecordTypeId == historicalRecordTypeId && stem.Payment_Date__c != null && stem.Due_Date__c != null){
                stem.Payment_Delay__c = stem.Due_Date__c.daysBetween(stem.Payment_Date__c);
            }
        }
    }

    public static void createPaymentOverview(List<STEM__c> stemList){
        String receivableRecordTypeId = Schema.SObjectType.STEM_Payment_Overview__c.getRecordTypeInfosByName().get('Receivable').getRecordTypeId();
        String originatedSTEMRecordTypeId = Schema.SObjectType.STEM__c.getRecordTypeInfosByName().get('Originated').getRecordTypeId();
        List<STEM_Payment_Overview__c> paymentOverviews = new List<STEM_Payment_Overview__c>();
        for(STEM__c stem: stemList){
            if(stem.RecordTypeId == originatedSTEMRecordTypeId){
                paymentOverviews.add(new STEM_Payment_Overview__c(RecordTypeId = receivableRecordTypeId, STEM__c = stem.Id, Account__c = stem.Account__c));
            }
        }
        insert paymentOverviews;
    }

    public static void createCashflow(List<STEM__c> stemList){
        String buyerInvoiceRecordTypeId = Schema.SObjectType.Cashflow__c.getRecordTypeInfosByName().get('Buyer Invoice').getRecordTypeId();
        String originatedSTEMRecordTypeId = Schema.SObjectType.STEM__c.getRecordTypeInfosByName().get('Originated').getRecordTypeId();
        List<Cashflow__c> cashflows = new List<Cashflow__c>();
        for(STEM__c stem: stemList){
            if(stem.RecordTypeId == originatedSTEMRecordTypeId){
                cashflows.add(new Cashflow__c(STEM__c = stem.Id, Account__c = stem.Account__c, RecordTypeId = buyerInvoiceRecordTypeId));
            }
        }
        insert cashflows;
    }

    public static void updateCashflows(Map<Id, STEM__c> newStemMap, Map<Id, STEM__c> oldStemMap){
        String buyerInvoiceRecordTypeId = Schema.SObjectType.Cashflow__c.getRecordTypeInfosByName().get('Buyer Invoice').getRecordTypeId();
        String supplierInvoiceRecordTypeId = Schema.SObjectType.Cashflow__c.getRecordTypeInfosByName().get('Supplier Invoice').getRecordTypeId();
        List<String> stemIds = new List<String>();
        for(STEM__c stem: newStemMap.values()){
            if(oldStemMap.get(stem.Id).Account__c != stem.Account__c || (oldStemMap.get(stem.Id).Dispute_Status__c != stem.Dispute_Status__c && stem.Dispute_Status__c != 'No Dispute')){
                stemIds.add(stem.Id);
            }
        }
        if(!stemIds.isEmpty()){
            List<Cashflow__c> cashflows = [SELECT Id, RecordTypeId, STEM__c, Account__c FROM Cashflow__c WHERE STEM__c IN: stemIds
                                           AND (RecordTypeId =: buyerInvoiceRecordTypeId OR RecordTypeId =: supplierInvoiceRecordTypeId)];
            for(Cashflow__c cashflow: cashflows){
                if(cashflow.RecordTypeId == buyerInvoiceRecordTypeId){
                    cashflow.Account__c = newStemMap.get(cashFlow.STEM__c).Account__c;
                }
            }
            update cashflows;
        }
    }

    public static void updateLastPayments(List<STEM__c> stems, Map<Id, STEM__c> oldStemMap){
        String originatedSTEMRecordTypeId = Schema.SObjectType.STEM__c.getRecordTypeInfosByName().get('Originated').getRecordTypeId();
        Id receivableRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Receivable').getRecordTypeId();
        Id bankChargeRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Bank Charge').getRecordTypeId();
        Id writeOffRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Write Off').getRecordTypeId();
        Set<Id> stemIds = new Set<Id>();
        for (STEM__c stem : stems) {
            if (oldStemMap.containsKey(stem.Id) &&
                stem.RecordTypeId == originatedSTEMRecordTypeId &&
                (oldStemMap.get(stem.Id).Receivable_Balance__c != stem.Receivable_Balance__c ||
                oldStemMap.get(stem.Id).Account__c != stem.Account__c)) {
                stemIds.add(stem.Id);
            }
        }
        if(!stemIds.isEmpty()){
            Map<Id, List<Payment__c>> stemToPaymentsMap = new Map<Id, List<Payment__c>>();
            for (Payment__c payment : [
                SELECT Id, Amount__c, Is_Last__c, STEM__c, RecordTypeId, Account__c
                FROM Payment__c
                WHERE STEM__c IN :stemIds AND (RecordTypeId =: receivableRecordTypeId OR RecordTypeId =: bankChargeRecordTypeId OR RecordTypeId =: writeOffRecordTypeId)
                ORDER BY Date__c ASC
            ]) {
                if (!stemToPaymentsMap.containsKey(payment.STEM__c)) {
                    stemToPaymentsMap.put(payment.STEM__c, new List<Payment__c>());
                }
                stemToPaymentsMap.get(payment.STEM__c).add(payment);
            }
            List<Payment__c> paymentsToUpdate = new List<Payment__c>();
            for (STEM__c stem : stems) {
                if (stemToPaymentsMap.containsKey(stem.Id)) {
                    Decimal fixedAmountForLastPayment = 350;
                    Decimal balance = stem.Total_Invoice_Amount__c;
                    Decimal runningTotal = 0;
                    Boolean lastSet = false;
                    Payment__c lastReceivablePayment = null;

                    for (Payment__c payment : stemToPaymentsMap.get(stem.Id)) {
                        payment.Account__c = stem.Account__c;
                        if (!lastSet) {
                            runningTotal += payment.Amount__c;

                            if (runningTotal >= balance - fixedAmountForLastPayment) {
                                if (payment.RecordTypeId == bankChargeRecordTypeId && lastReceivablePayment != null) {
                                    lastReceivablePayment.Is_Last__c = true;
                                } else{
                                  payment.Is_Last__c = true;
                                }
                                lastSet = true;
                            } else {
                                payment.Is_Last__c = false;
                            }

                            if (payment.RecordTypeId == receivableRecordTypeId) {
                                lastReceivablePayment = payment;
                            }
                        } else {
                            payment.Is_Last__c = false;
                        }

                        paymentsToUpdate.add(payment);
                    }
                }
            }

            if (!paymentsToUpdate.isEmpty()) {
                ContextManager.avoidPaymentFiring = true;
                update paymentsToUpdate;
                ContextManager.avoidPaymentFiring = false;
            }
        }
    }

    public static void deleteDisputes(List<STEM__c> stemList){
        List<String> stemIds = new List<String>();
        for(STEM__c stem: stemList){
            if(stem.Dispute_Status__c == 'No Dispute'){
                stemIds.add(stem.Id);
            }
        }
        if(!stemIds.isEmpty()){
            delete [SELECT Id FROM Dispute__c WHERE STEM__c In: stemIds];
        }
    }

    public static void createMailingRecord(List<STEM__c> stemList){
        String originatedSTEMRecordTypeId = Schema.SObjectType.STEM__c.getRecordTypeInfosByName().get('Originated').getRecordTypeId();
        List<Mailing_Record__c> mailingRecords = new List<Mailing_Record__c>();
        for(STEM__c stem: stemList){
            if(stem.RecordTypeId == originatedSTEMRecordTypeId){
                mailingRecords.add(new Mailing_Record__c(Account__c = stem.Account__c, STEM__c = stem.Id));
            }
        }
        insert mailingRecords;
    }

    public static void deleteInvoices(Map<Id, STEM__c> stemMap){
        delete [SELECT Id FROM Invoice__c WHERE STEM__c IN: stemMap.keySet()];
    }

    public static void deleteVariableChargeSuppliers(Map<Id, STEM__c> stemMap){
        if(stemMap == null || stemMap.isEmpty()) return;
        delete [
            SELECT Id
            FROM STEM_Variable_Charge_Supplier__c
            WHERE STEM__c IN: stemMap.keySet()
        ];
    }

    public static void deleteStemPaymentOverviews(Map<Id, STEM__c> stemMap){
        delete [SELECT Id FROM STEM_Payment_Overview__c WHERE STEM__c IN: stemMap.keySet()];
    }

    public static void deleteCashflows(Map<Id, STEM__c> stemMap){
        delete [SELECT Id FROM Cashflow__c WHERE STEM__c In: stemMap.keySet()];
    }

    public static void deleteMailingRecords(Map<Id, STEM__c> stemMap){
        delete [SELECT Id FROM Mailing_Record__c WHERE STEM__c In: stemMap.keySet()];
    }

    public static void deleteStemStatuses(Map<Id, STEM__c> stemMap){
        delete [SELECT Id FROM Stem_Status__c WHERE STEM__c In: stemMap.keySet()];
    }

    public static void deleteDisputes(Map<Id, STEM__c> stemMap){
        delete [SELECT Id FROM Dispute__c WHERE STEM__c In: stemMap.keySet()];
    }

    public static void deleteCommissionInvoices(Map<Id, STEM__c> stemMap){
        delete [SELECT Id FROM Commission_Invoice__c WHERE STEM__c In: stemMap.keySet()];
    }

    public static void deleteContentDocuments(Map<Id, STEM__c> stemMap) {
        List<ContentDocumentLink> contentDocumentLinkList =[SELECT Id, ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId In: stemMap.keySet()];
        List<Id> docIdList = new List<Id>();
        for(ContentDocumentLink cdl: ContentDocumentLinkList){
            docIdList.add(cdl.ContentDocumentId);
        }
        List<ContentDocument> conDocList =[SELECT Id FROM ContentDocument where Id IN: docIdList];

        delete conDocList;
    }
}
