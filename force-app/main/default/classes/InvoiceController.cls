public class InvoiceController {
    @AuraEnabled(cacheable=false)
    public static ShipAgentInvoiceReadinessService.Readiness getShipAgentInvoiceReadiness(String stemId) {
        return ShipAgentInvoiceReadinessService.getReadiness(stemId);
    }

    @AuraEnabled
    public static STEM__c getStemInfo(String stemId){
        Id receivableRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Receivable').getRecordTypeId();
        Id bankChargeRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Bank Charge').getRecordTypeId();
        Id writeOffRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Write Off').getRecordTypeId();
        return [SELECT Id, Account__r.Name, Contact__c, Contact__r.Name, Account__r.Payment_Terms__c, Account__r.Imported_Address__c,
                                    Account__r.Attn_Override__c, Account__r.Attn__c,
                                    KeyStem__c, Invoice_Date__c,
                                    Contact__r.Salutation, Vessel__r.Name, Vessel__r.IMO__c, Payment_Term__c, Account__r.Interest_Rate__c,
                                    Port__r.Name, Account__r.Chop_Type__c, Agent__c, ETA_ETB__c, Pumping_Completion_Date__c,
                                    Invoice_Due_Date__c, Account__r.Banking_Preference__c, Delivery_Date__c,
                                    Buyer_Broker__c, Buyer_Broker__r.Name, Buyer_Broker__r.Imported_Address__c, Buyer_Broker__r.Email_Invoice__c,
                                    Buyer_Broker__r.Invoice_Format__c, PO_Voyage_Number__c, Mailing_Requirement__c, Account__r.Chop_Type_Buyer_Invoice__c,
                                    Buyer_Broker__r.Attn_Override__c, Buyer_Broker__r.Attn__c, Buyer_Broker__r.Default_Contact__c, Buyer_Broker__r.Default_Contact__r.Name, Buyer_Broker__r.Default_Contact__r.Salutation,
                                    Partial_CIA__c, Partial_Lumpsum_Sell_At__c,
                                    ETA_Start_Date__c, ETA_End_Date__c,
                                    ETB_Start_Date__c, ETB_End_Date__c,
                                    ETD_Start_Date__c, ETD_End_Date__c,
                                    ETCD_Start_Date__c, ETCD_End_Date__c,
                                    (SELECT Id, Amount__c, Date__c FROM Payments__r WHERE RecordTypeId =: receivableRecordTypeId OR RecordTypeId =: writeOffRecordTypeId OR RecordTypeId =: bankChargeRecordTypeId)
                            FROM STEM__c WHERE Id = :stemId LIMIT 1];
    }

    @AuraEnabled
    public static Payment_Term__c getPaymentTerm(String paymentTerm){
        return [SELECT Id, Name, Description__c FROM Payment_Term__c WHERE Name =: paymentTerm LIMIT 1];
    }

    @AuraEnabled
    public static DBS_Bank__c getDBSInfo(){
        return DBS_Bank__c.getOrgDefaults();
    }

    @AuraEnabled
    public static UBS_Bank__c getUBSInfo(){
        return UBS_Bank__c.getOrgDefaults();
    }

    @AuraEnabled
    public static Invoice__c createInvoice(String stemId, List<String> extraIds, Boolean createProforma, Boolean isCreditNote, Date invoiceDate, Date deliveryDate, Date invoiceDueDate){
        if (createProforma != true && isCreditNote != true) {
            ShipAgentInvoiceReadinessService.assertFinalBuyerInvoiceAllowed(Id.valueOf(stemId));
        }
           STEM__c stem = [SELECT Id, KeyStem__c, Invoice_Date__c, Total__c, Mailing_Requirement__c, Acknowledge_Receipt__c,
                        (SELECT Id, Refcode_Index__c FROM Invoices__r ORDER By Refcode_Index__c)
                        FROM STEM__c WHERE Id =: stemId LIMIT 1];
        List<Invoice__c> currentInvoices = new List<Invoice__c>();
        if(createProforma){
            currentInvoices = [SELECT Id, Name, STEM__c, Deprecated__c FROM Invoice__c
                                                                       WHERE STEM__c =: stemId AND Name LIKE 'INV-P%' ORDER BY Name];
        } else if(isCreditNote){
            currentInvoices = [SELECT Id, Name, STEM__c, Deprecated__c FROM Invoice__c
                                                                       WHERE STEM__c =: stemId AND Name LIKE '%-CN-%' ORDER BY Name];
        }else{
            currentInvoices = [SELECT Id, Name, STEM__c, Deprecated__c FROM Invoice__c
                                                                       WHERE STEM__c =: stemId AND Name LIKE '%-INV-%' ORDER BY Name];
        }

        Integer invoiceVersionNumber;
        String invoiceVersionName = '';
        List<List<Invoice__c>> invoicesList = new List<List<Invoice__c>>();
        List<String> invoicesIds = new List<String>();
        if(!currentInvoices.isEmpty()){
            List<Invoice__c> buffInvoices = new List<Invoice__c>();
            for(Integer i = 0; i < currentInvoices.size(); i++){
                invoicesIds.add(currentInvoices.get(i).Id);
                if(i == 0){
                   buffInvoices.add(currentInvoices.get(i));
                   continue;
                }
                if(currentInvoices.get(i - 1).Name.substringBefore('(') == currentInvoices.get(i).Name.substringBefore('(')){
                    buffInvoices.add(currentInvoices.get(i));
                } else {
                    invoicesList.add(buffInvoices);
                    buffInvoices = new List<Invoice__c>{currentInvoices.get(i)};
                }
            }
            invoicesList.add(buffInvoices);
        }

        //Setting name for new version of Invoice
        for(List<Invoice__c> invoiceVersions: invoicesList){
            if(invoiceVersions.get(invoiceVersions.size() - 1).Deprecated__c == true){
                invoiceVersionNumber = invoiceVersions.get(invoiceVersions.size() - 1).Name.substringBetween(' ',',') != null
                                        ? Integer.valueOf(invoiceVersions.get(invoiceVersions.size() - 1).Name.substringBetween(' ',',')) + 1
                                        : 2;
                invoiceVersionName = invoiceVersions.get(invoiceVersions.size() - 1).Name.substringBefore('(') + '(version ' + invoiceVersionNumber + ', ' + Date.today().format() + ')';
                break;
            }
        }

        List<ContentVersion> versions = [SELECT Id, Title, FileType, VersionData, isLatest, ContentDocumentId, FileExtension, FirstPublishLocationId
                                         FROM ContentVersion where isLatest = true AND FirstPublishLocationId In: invoicesIds];

        //Creating Invoice object
        if(Test.isRunningTest()){
            stem.KeyStem__c = 'HK230000T';
        }

        String chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        if(invoiceVersionNumber == null){
            invoiceVersionNumber = currentInvoices.size() > 0
                ? createProforma
                    ? Integer.valueOf(currentInvoices.get(invoicesList.size() - 1).Name.substringAfterLast('P')) + 1
                    : Integer.valueOf(currentInvoices.get(invoicesList.size() - 1).Name.substringAfterLast('-')) + 1
                : 1;
            if(createProforma){
                invoiceVersionName = invoiceVersionName != '' ? invoiceVersionName : 'INV-P' + invoiceVersionNumber;
            } else if(isCreditNote){
                invoiceVersionName = invoiceVersionName != '' ? invoiceVersionName : stem.KeyStem__c.substring(4) + '-CN-' + invoiceVersionNumber;
            }else{
                invoiceVersionName = invoiceVersionName != '' ? invoiceVersionName : stem.KeyStem__c.substring(4) + '-INV-' + invoiceVersionNumber;
            }
        }

        String base = stem.KeyStem__c.substring(4, stem.KeyStem__c.length() - 1);
        String refcodeIndex;
        if(stem.Invoices__r.size() == 0){
            refcodeIndex = base + 'SA';
        } else{
            String lastRefcodeIndex = stem.Invoices__r[stem.Invoices__r.size() - 1].Refcode_Index__c;
            String lastChar = lastRefcodeIndex.substring(lastRefcodeIndex.length() - 1);

            Integer lastCharIndex = chars.indexOf(lastChar);
            String nextChar = (lastCharIndex == 25) ? 'A' : chars.substring(lastCharIndex + 1, lastCharIndex + 2);
            refcodeIndex = base + 'S' + nextChar;
        }

        Invoice__c invoice = new Invoice__c(Name = invoiceVersionName,
                                            STEM__c = stemId,
                                            Invoice_Date__c = invoiceDate,
                                            Proforma__c = createProforma,
                                            Delivery_Date__c = deliveryDate,
                                            Invoice_Due_Date__c = invoiceDueDate,
                                            Refcode_Index__c = refcodeIndex
                                           );
        insert invoice;
        createAcknowledgeReceiptTask(stem, invoice);
        return invoice;
    }

    private static void createAcknowledgeReceiptTask(STEM__c stem, Invoice__c invoice){
        if(stem.Mailing_Requirement__c != null){
            if(stem.Mailing_Requirement__c.contains('-1') && !stem.Acknowledge_Receipt__c){
                Map<String, Id> userIdMap = new Map<String, Id>();
                for (User user : [SELECT Id, Name FROM User WHERE IsActive = true]) {
                    userIdMap.put(user.Name, user.Id);
                }
                Nomination__c confirmation = [SELECT Id, STEM__c, Account__c, Buyer_Supplier_Trader__c
                                       FROM Nomination__c WHERE STEM__c =: stem.Id
                                       AND Deprecated__c = false AND RecordTypeId =: FCBStatic.BUYER_NOMINATION_RT_ID];
                String description = stem.Mailing_Requirement__c.contains('-1a')
                    ? 'For this Buyer, we require their acknowledgement by Email'
                    : stem.Mailing_Requirement__c.contains('-1b')
                      ? 'For this Buyer, we require their acknowledgement by WeChat'
                      : 'For this Buyer, we require their acknowledgement';
                Task task = new Task(
                             WhatId = stem.Id,
                             Subject = 'Invoice Receipt Acknowledgment from Buyer',
                             Status = 'Open',
                             Priority = 'Normal',
                             IsReminderSet = true,
                              ActivityDate = invoice.Invoice_Date__c,
                             ReminderDateTime = Date.today(),
                             Description = description,
                             OwnerId = runningInASandbox ? userIdMap.get('Production Support') : userIdMap.get('Accounts')
                );
                insert task;
            }
        }
    }

    public static Boolean runningInASandbox {
        get {
            if (runningInASandbox == null) {
                runningInASandbox = [SELECT IsSandbox FROM Organization LIMIT 1].IsSandbox;
            }
            return runningInASandbox;
        }
        set;
    }

    @AuraEnabled
    public static void generateInvoicePDF(String invoiceId, String invoiceVersionName, List<String> extraIds, String body, Boolean createProforma){
        ShipAgentInvoiceReadinessService.assertPersistedInvoicesAllowed(new Set<Id>{Id.valueOf(invoiceId)});
        ContentVersion contentVersion = new ContentVersion();
        contentVersion.PathOnClient = '/' + invoiceVersionName + '.pdf';
        contentVersion.Title = invoiceVersionName + '.pdf';
        contentVersion.VersionData = EncodingUtil.base64Decode(body);
        contentVersion.FirstPublishLocationId = invoiceId;
        insert contentVersion;
        ContentDocumentLink cdl = [SELECT Id, LinkedEntityId, ContentDocumentId FROM ContentDocumentLink where LinkedEntityId =: invoiceId];
        List<ContentDocumentLink> extraLinks = new List<ContentDocumentLink>();
        system.debug(extraIds);
        for(String extraId: extraIds){
            extraLinks.add(new ContentDocumentLink(LinkedEntityId = extraId, ContentDocumentId = cdl.ContentDocumentId));
        }
        insert extraLinks;
        //Setting File refference for Invoice record
        Decimal totalAmount = updateStemLineItemandExtraCosts(extraIds, invoiceId, createProforma);
        Invoice__c invoice = new Invoice__c(Id = invoiceId, File__c = Url.getOrgDomainURL().toExternalForm() + '/' + cdl.ContentDocumentId, Amount__c = totalAmount);
        update invoice;
    }

    public static Decimal updateStemLineItemandExtraCosts(List<String> extraId, String invoiceId, Boolean createProforma){
        Decimal totalAmount = 0;
        List<STEM_Line_Item__c> stemLineItems = [SELECT Id, Input__c, Issued__c, Total_Price__c, Buyer_Invoice__c FROM STEM_Line_Item__c WHERE Id IN: extraId];
        for(STEM_Line_Item__c stemLineItem : stemLineItems){
            totalAmount += stemLineItem.Total_Price__c;
            stemLineItem.Input__c = createProforma ? '🟠' : '🟢';
            stemLineItem.Buyer_Invoice__c = invoiceId;
            stemLineItem.Issued__c = true;
        }
        ContextManager.avoidSTEMLineItemFiring = true;
        update stemLineItems;
        ContextManager.avoidSTEMLineItemFiring = false;

        List<STEM_Extra_Cost__c> stemExtraCosts = [SELECT Id, Input__c, Issued__c, RecordTypeId, Line_Total__c, Buyer_Invoice__c FROM STEM_Extra_Cost__c WHERE Id In: extraId AND Line_Total__c != null];
        for(STEM_Extra_Cost__c stemExtraCost : stemExtraCosts){
            totalAmount += stemExtraCost.Line_Total__c;
            stemExtraCost.Input__c = createProforma ? '🟠' : '🟢';
            stemExtraCost.Buyer_Invoice__c = invoiceId;
            stemExtraCost.Issued__c = true;
        }
        ContextManager.avoidSTEMExtraCostFiring = true;
        update stemExtraCosts;
        ContextManager.avoidSTEMExtraCostFiring = false;
        return totalAmount;
    }

    @AuraEnabled
    public static List<String> getBDNBase64Strings(List<String> entityIds){
        List<String> contentDocumentIds = new List<String>();
        for(ContentDocumentLink cdLink: [SELECT Id, ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId IN: entityIds AND ContentDocument.Title LIKE '%BDN%']){
            contentDocumentIds.add(cdLink.ContentDocumentId);
        }
        List<String> contentDocumentBase64Strings = new List<String>();
        for(ContentVersion cv: [SELECT Id, VersionData FROM ContentVersion WHERE ContentDocumentId IN: contentDocumentIds AND IsLatest = true]){
            contentDocumentBase64Strings.add(EncodingUtil.base64Encode(cv.VersionData));
        }
        return contentDocumentBase64Strings;
    }

    @AuraEnabled
    public static void updateStemDeliveryDate(String stemId){
        STEM__c stem = [SELECT Id, Quote__c, Delivery_Date__c,
                        (SELECT Id, Issued__c FROM STEM_Extra_Costs__r)
                        FROM STEM__c WHERE Id =: stemId];
        Boolean allIssuedTrue = true;

        for (STEM_Extra_Cost__c extraCost : stem.STEM_Extra_Costs__r) {
            if (extraCost.Issued__c != true) {
                allIssuedTrue = false;
                break;
            }
        }
        if(allIssuedTrue){
            stem.Delivery_Date__c = null;
            update stem;
        }
    }

    @AuraEnabled
    public static void upsertLastInvoiceForm(Last_Invoice_Form__c lastInvoiceForm){
        upsert lastInvoiceForm;
    }
}