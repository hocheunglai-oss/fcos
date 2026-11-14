public class InvoiceController {
    @AuraEnabled
    public static FcosTradeDocumentService.DocumentReview previewTradingDocument(Id stemId,List<Id> lineIds) {
        return FcosTradeDocumentService.previewForLegacyController(stemId,'Sell',null,lineIds);
    }

    @AuraEnabled(cacheable=false)
    public static VariableChargeInvoiceReadinessService.Readiness getVariableChargeInvoiceReadiness(String stemId) {
        return VariableChargeInvoiceReadinessService.getBuyerReadiness(stemId);
    }

    @AuraEnabled(cacheable=false)
    public static MasterContractInvoiceReadinessService.Readiness getMasterContractInvoiceReadiness(String stemId) {
        return MasterContractInvoiceReadinessService.getBuyerReadiness(stemId);
    }

    // Compatibility wrapper for the previous production LWC during the controlled cutover.
    @AuraEnabled(cacheable=false)
    public static VariableChargeInvoiceReadinessService.Readiness getShipAgentInvoiceReadiness(String stemId) {
        return getVariableChargeInvoiceReadiness(stemId);
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
        return createInvoiceFromSelection(stemId,extraIds,createProforma,isCreditNote,invoiceDate,deliveryDate,invoiceDueDate,null);
    }

    @AuraEnabled
    public static Invoice__c createReviewedInvoice(String stemId, List<String> extraIds, Boolean createProforma, Boolean isCreditNote, Date invoiceDate, Date deliveryDate, Date invoiceDueDate, String reviewedFxFingerprint){
        if(String.isBlank(reviewedFxFingerprint)) throw new AuraHandledException('Review the exact native invoice lines before creating the invoice.');
        return createInvoiceFromSelection(stemId,extraIds,createProforma,isCreditNote,invoiceDate,deliveryDate,invoiceDueDate,reviewedFxFingerprint);
    }

    private static Invoice__c createInvoiceFromSelection(String stemId, List<String> extraIds, Boolean createProforma, Boolean isCreditNote, Date invoiceDate, Date deliveryDate, Date invoiceDueDate, String reviewedFxFingerprint){
        Id sourceStemId=Id.valueOf(stemId);
        STEM__c lockedStem=[SELECT Id FROM STEM__c WHERE Id=:sourceStemId FOR UPDATE];
        Boolean managedSelection=FcosTradeDocumentService.buyerSideIsManaged(lockedStem.Id)
            || FcosTradeDocumentService.hasReissueSelection(lockedStem.Id,'Sell',extraIds);
        if(createProforma==true && managedSelection)
            throw new AuraHandledException('Native proforma finalization is not enabled. Use the confirmed native invoice workflow.');
        FcosTradeDocumentService.DocumentReview nativeReview;
        if(managedSelection) {
            requireTradingFxInvoiceEntry();
            if(isCreditNote==true) throw new AuraHandledException('Select the original HKD invoice in the native credit workflow so its original rate is retained.');
            if(String.isBlank(reviewedFxFingerprint) || extraIds==null || extraIds.isEmpty())
                throw new AuraHandledException('Review the exact native invoice lines before creating the invoice.');
            List<Id> selectedFxLines=new List<Id>();
            for(String lineId:extraIds) selectedFxLines.add(Id.valueOf(lineId));
            nativeReview=FcosTradeDocumentService.preview(lockedStem.Id,'Sell',null,selectedFxLines);
            assertNativeCreateReview(nativeReview,reviewedFxFingerprint,selectedFxLines);
        } else if(String.isNotBlank(reviewedFxFingerprint)) {
            throw new AuraHandledException('The selected lines are no longer a managed invoice. Reopen the invoice to review its currency.');
        }
        MasterContractInvoiceReadinessService.assertBuyerAllowed(Id.valueOf(stemId));
        if (createProforma != true && isCreditNote != true) {
            VariableChargeInvoiceReadinessService.assertFinalBuyerInvoiceAllowed(Id.valueOf(stemId));
            if (invoiceDueDate == null) {
                throw new AuraHandledException('Enter the Invoice Due Date before creating the final Buyer Invoice.');
            }
            Integer productLineCount = [
                SELECT COUNT() FROM STEM_Line_Item__c
                WHERE STEM__c = :stemId AND Cancelled__c = false
            ];
            if (productLineCount > 0 && deliveryDate == null) {
                throw new AuraHandledException('A product-bearing STEM requires its Delivery Date before the final Buyer Invoice can be created.');
            }
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
        if(nativeReview!=null) {
            invoice.Amount__c=nativeReview.usdTotal;
            Map<String,Object> presentation=(Map<String,Object>)JSON.deserializeUntyped(FcosNativeInvoiceController.capturePresentation(Id.valueOf(stemId)));
            presentation.put('customerPo',refcodeIndex+' '+String.valueOf(presentation.get('vessel')));
            invoice.Document_Presentation_JSON__c=JSON.serialize(presentation);
            FcosTradeDocumentService.applySnapshot(invoice,nativeReview);
        }
        insert invoice;
        if(nativeReview!=null) FcosTradeDocumentLineService.persist(invoice,nativeReview);
        createAcknowledgeReceiptTask(stem, invoice);
        return invoice;
    }

    @TestVisible private static void assertNativeCreateReview(FcosTradeDocumentService.DocumentReview review,String fingerprint,List<Id> selectedIds) {
        Set<Id> expectedIds=new Set<Id>(selectedIds);
        Set<Id> reviewedIds=new Set<Id>();
        if(review!=null && review.lines!=null) {
            for(FcosTradeDocumentService.Line line:review.lines) if(line!=null && line.id!=null) reviewedIds.add(line.id);
        }
        Boolean managedReview=review!=null && (review.currencyCode=='HKD' || review.reissueOfId!=null
            || (review.currencyCode=='USD' && review.sideId!=null && review.confirmedAt!=null));
        if(!managedReview || String.isBlank(fingerprint)
            || review.fingerprint!=fingerprint || expectedIds.isEmpty() || expectedIds.size()!=selectedIds.size()
            || review.lines==null || reviewedIds.size()!=review.lines.size()
            || expectedIds.size()!=reviewedIds.size() || !expectedIds.containsAll(reviewedIds))
            throw new AuraHandledException('The selected native invoice lines or FX changed. Reopen the invoice to review them.');
    }

    private static void createAcknowledgeReceiptTask(STEM__c stem, Invoice__c invoice){
        if(stem.Mailing_Requirement__c != null){
            if(stem.Mailing_Requirement__c.contains('-1') && !stem.Acknowledge_Receipt__c){
                Map<String, Id> userIdMap = new Map<String, Id>();
                for (User user : [SELECT Id, Name FROM User WHERE IsActive = true]) {
                    userIdMap.put(user.Name, user.Id);
                }
                List<Nomination__c> confirmations = [SELECT Id, STEM__c, Account__c, Buyer_Supplier_Trader__c
                                       FROM Nomination__c WHERE STEM__c =: stem.Id
                                       AND Deprecated__c = false AND RecordTypeId =: FCBStatic.BUYER_NOMINATION_RT_ID
                                       ORDER BY LastModifiedDate DESC LIMIT 1];
                Id taskOwnerId;
                if (!confirmations.isEmpty()) taskOwnerId = userIdMap.get(confirmations[0].Buyer_Supplier_Trader__c);
                if (taskOwnerId == null) taskOwnerId = runningInASandbox ? userIdMap.get('Production Support') : userIdMap.get('Accounts');
                if (taskOwnerId == null) taskOwnerId = UserInfo.getUserId();
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
                             OwnerId = taskOwnerId
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

    public static void generateInvoicePDF(String invoiceId, String invoiceVersionName, List<String> extraIds, String body, Boolean createProforma) {
        generateInvoicePDF(invoiceId,invoiceVersionName,extraIds,body,createProforma,null);
    }
    @AuraEnabled
    public static void generateInvoicePDF(String invoiceId, String invoiceVersionName, List<String> extraIds, String body, Boolean createProforma, String reviewedFxFingerprint){
        Invoice__c sourceInvoice=[SELECT Id,STEM__c,Document_Currency__c,Document_FX_Fingerprint__c,Document_FX_Side__c,Document_FX_Confirmed_At__c,Reissue_Of_Invoice__c,Original_Invoice__c,Final_Of_Proforma__c,Proforma__c,File__c FROM Invoice__c WHERE Id=:invoiceId];
        Boolean managedDocument=FcosTradeDocumentService.isManagedDocument(sourceInvoice);
        Blob documentBody;
        if(managedDocument) {
            if(!String.isBlank(sourceInvoice.File__c)) return;
            requireTradingFxInvoiceEntry();
            PageReference nativePage=Page.FcosNativeInvoice;nativePage.getParameters().put('id',invoiceId);
            documentBody=Test.isRunningTest()?Blob.valueOf('Native invoice test PDF'):nativePage.getContentAsPDF();
        } else documentBody=EncodingUtil.base64Decode(body);
        Id invoiceStemId=sourceInvoice.STEM__c;
        FcosTradeDocumentService.DocumentReview fxReview;
        // Serialize generation with currency confirmation. The rollout switch
        // cannot erase an existing confirmed side or selected reissue evidence.
        List<STEM__c> lockedStems=[SELECT Id FROM STEM__c WHERE Id=:invoiceStemId FOR UPDATE];
        List<Id> fxLineIds=new List<Id>();for(String lineId:extraIds) fxLineIds.add((Id)lineId);
        if(managedDocument) fxReview=FcosTradeDocumentService.preview(invoiceStemId,'Sell',null,fxLineIds);
        else if(FcosTradeDocumentService.buyerSideIsManaged(invoiceStemId)
            || FcosTradeDocumentService.hasReissueSelection(invoiceStemId,'Sell',extraIds))
            throw new AuraHandledException('Use the reviewed native invoice workflow for a confirmed currency side or reissue.');
        if(managedDocument) {
            Invoice__c lockedInvoice=[SELECT File__c,Document_FX_Fingerprint__c,Proforma__c FROM Invoice__c WHERE Id=:invoiceId FOR UPDATE];
            if(!String.isBlank(lockedInvoice.File__c)) return;
            assertNativeGenerationReview(sourceInvoice,lockedInvoice,fxReview,reviewedFxFingerprint,createProforma);
        }
        List<STEM_Line_Item__c> productLines=[
            SELECT Id, Input__c, Issued__c, Total_Price__c, Buyer_Invoice__c FROM STEM_Line_Item__c
            WHERE STEM__c=:invoiceStemId AND Id IN :fxLineIds
        ];
        List<STEM_Extra_Cost__c> chargeLines=[
            SELECT Id, Input__c, Issued__c, Line_Total__c, Buyer_Invoice__c FROM STEM_Extra_Cost__c
            WHERE STEM__c=:invoiceStemId AND Id IN :fxLineIds
        ];
        if(productLines.size()+chargeLines.size()!=fxLineIds.size())
            throw new AuraHandledException('Every invoice line must belong to this STEM.');
        MasterContractInvoiceReadinessService.assertPersistedInvoicesAllowed(new Set<Id>{Id.valueOf(invoiceId)});
        VariableChargeInvoiceReadinessService.assertPersistedInvoicesAllowed(new Set<Id>{Id.valueOf(invoiceId)});
        ContentVersion contentVersion = new ContentVersion();
        contentVersion.PathOnClient = '/' + invoiceVersionName + '.pdf';
        contentVersion.Title = invoiceVersionName + '.pdf';
        contentVersion.VersionData = documentBody;
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
        Decimal totalAmount = linkInvoiceLines(productLines, chargeLines, invoiceId, createProforma);
        Invoice__c invoice = new Invoice__c(Id = invoiceId, File__c = Url.getOrgDomainURL().toExternalForm() + '/' + cdl.ContentDocumentId, Amount__c = totalAmount);
        if (managedDocument) {
            invoice.Amount__c=fxReview.usdTotal;
            FcosTradeDocumentService.applySnapshot(invoice,fxReview);
        }
        update invoice;
        if(managedDocument) FcosTradeDocumentLineService.persist(invoice,fxReview);
    }

    private static void requireTradingFxInvoiceEntry() {
        if(!FcosCompanyFxRateService.enabled() || !FeatureManagement.checkPermission('Fcos_Trading_FX_Entry'))
            throw new AuraHandledException('Trading FX invoice entry is not enabled for this user.');
    }

    @TestVisible private static void assertNativeGenerationReview(Invoice__c sourceInvoice, Invoice__c lockedInvoice,
        FcosTradeDocumentService.DocumentReview fxReview, String reviewedFxFingerprint, Boolean createProforma) {
            if(sourceInvoice==null || lockedInvoice==null || fxReview==null || String.isBlank(reviewedFxFingerprint)
                || String.isBlank(sourceInvoice.Document_FX_Fingerprint__c)
                || !FcosTradeDocumentService.isManagedDocument(sourceInvoice) || fxReview.currencyCode!=sourceInvoice.Document_Currency__c || fxReview.fingerprint!=reviewedFxFingerprint
                || fxReview.fingerprint!=sourceInvoice.Document_FX_Fingerprint__c
                || lockedInvoice.Document_FX_Fingerprint__c!=sourceInvoice.Document_FX_Fingerprint__c
                || lockedInvoice.Proforma__c!=createProforma)
                throw new AuraHandledException('The saved native invoice no longer matches the reviewed lines and document type. Refresh the document workflow before generating.');
    }

    private static Decimal linkInvoiceLines(List<STEM_Line_Item__c> stemLineItems,
            List<STEM_Extra_Cost__c> stemExtraCosts, String invoiceId, Boolean createProforma) {
        Decimal totalAmount = 0;
        for(STEM_Line_Item__c stemLineItem : stemLineItems){
            totalAmount += stemLineItem.Total_Price__c;
            stemLineItem.Input__c = createProforma ? '🟠' : '🟢';
            stemLineItem.Buyer_Invoice__c = invoiceId;
            stemLineItem.Issued__c = true;
        }
        ContextManager.avoidSTEMLineItemFiring = true;
        update stemLineItems;
        ContextManager.avoidSTEMLineItemFiring = false;

        List<STEM_Extra_Cost__c> pricedCharges = new List<STEM_Extra_Cost__c>();
        for(STEM_Extra_Cost__c stemExtraCost : stemExtraCosts){
            if(stemExtraCost.Line_Total__c==null) continue;
            totalAmount += stemExtraCost.Line_Total__c;
            stemExtraCost.Input__c = createProforma ? '🟠' : '🟢';
            stemExtraCost.Buyer_Invoice__c = invoiceId;
            stemExtraCost.Issued__c = true;
            pricedCharges.add(stemExtraCost);
        }
        ContextManager.avoidSTEMExtraCostFiring = true;
        update pricedCharges;
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
