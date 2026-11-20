public class InvoiceController {
    private static final String BUYER_CHARGE_REMINDER_SUBJECT = 'Buyer charge reminder sent ';
    private static final String BUYER_CHARGE_REMINDER_RESULT = 'Buyer charge reminder sent.';
    @TestVisible private static Messaging.SingleEmailMessage capturedBuyerChargeReminder;
    @TestVisible private static Set<Id> buyerChargeReminderFixtureTraderIds;
    @TestVisible private static Boolean failBuyerChargeReminderForTest = false;

    @AuraEnabled
    public static FcosTradeDocumentService.DocumentReview previewTradingDocument(Id stemId,List<Id> lineIds) {
        return FcosTradeDocumentService.previewForLegacyController(stemId,'Sell',null,lineIds);
    }

    @AuraEnabled(cacheable=false)
    public static VariableChargeInvoiceReadinessService.Readiness getVariableChargeInvoiceReadiness(String stemId) {
        return VariableChargeInvoiceReadinessService.getBuyerReadiness(stemId);
    }

    @AuraEnabled(cacheable=false)
    public static VariableChargeInvoiceReadinessService.Readiness getBuyerInvoiceTabReadiness(String stemId) {
        Id sourceStemId = requireBuyerInvoiceStemRead(stemId);
        return VariableChargeInvoiceReadinessService.getBuyerInvoiceTabReadiness(String.valueOf(sourceStemId));
    }

    @AuraEnabled
    public static String sendBuyerChargeReminder(String stemId, String requestId) {
        Id sourceStemId = requireBuyerInvoiceStemRead(stemId);
        if (String.isBlank(requestId) || !Pattern.matches('[a-zA-Z0-9_-]{16,100}', requestId)) {
            throw invoiceSaveError('The reminder request is invalid. Refresh the Invoice tab and try again.');
        }
        Id actorId = UserInfo.getUserId();
        List<UserRecordAccess> access = [
            SELECT RecordId, HasEditAccess FROM UserRecordAccess
            WHERE UserId = :actorId AND RecordId = :sourceStemId
        ];
        if (access.isEmpty() || !access[0].HasEditAccess || !STEM__c.SObjectType.getDescribe().isUpdateable()) {
            throw invoiceSaveError('You need edit access to this STEM to send a buyer charge reminder.');
        }

        STEM__c stem;
        try {
            // Approval and invoice writers also lock the STEM before rechecking eligibility.
            stem = [SELECT Id, KeyStem__c, Name FROM STEM__c WHERE Id = :sourceStemId FOR UPDATE];
        } catch (QueryException problem) {
            throw invoiceSaveError('The STEM could not be locked. Try sending the reminder again.');
        }

        String requestDigest = EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256',
            Blob.valueOf(String.valueOf(stem.Id) + '|' + String.valueOf(actorId) + '|' + requestId)));
        String taskSubject = BUYER_CHARGE_REMINDER_SUBJECT + requestDigest;
        String taskHeader = 'FCOS buyer charge reminder v1\nRequest SHA-256: ' + requestDigest + '\n';
        List<Task> previous = [
            SELECT Id, Description, IsClosed FROM Task
            WHERE WhatId = :stem.Id AND CreatedById = :actorId AND Subject = :taskSubject
            LIMIT 2 ALL ROWS
        ];
        if (!previous.isEmpty()) {
            if (previous.size() != 1 || !previous[0].IsClosed || previous[0].Description == null
                || !previous[0].Description.startsWith(taskHeader)) {
                throw invoiceSaveError('Salesforce could not verify the previous reminder result. Ask an administrator to check the activity on this STEM.');
            }
            return BUYER_CHARGE_REMINDER_RESULT;
        }

        VariableChargeInvoiceReadinessService.Readiness readiness =
            VariableChargeInvoiceReadinessService.getBuyerInvoiceTabReadiness(String.valueOf(stem.Id));
        if (readiness.pendingBuyerApproval != true || readiness.blockingBuyerSupplierIds == null
            || readiness.blockingBuyerSupplierIds.isEmpty()) {
            throw invoiceSaveError('A buyer charge approval reminder is no longer available. Refresh the Invoice tab.');
        }

        Map<Id, Account> suppliers = new Map<Id, Account>([
            SELECT Id, Name FROM Account WHERE Id IN :readiness.blockingBuyerSupplierIds
        ]);
        List<String> supplierNames = new List<String>();
        for (Id supplierId : readiness.blockingBuyerSupplierIds) {
            if (!suppliers.containsKey(supplierId)) {
                throw invoiceSaveError('Salesforce could not verify an exact blocked supplier. Refresh the Invoice tab.');
            }
            supplierNames.add(suppliers.get(supplierId).Name);
        }
        supplierNames.sort();
        List<String> recipientIds = resolveBuyerChargeReminderTraders(stem.Id, suppliers);
        String stemNumber = String.isBlank(stem.KeyStem__c) ? stem.Name : stem.KeyStem__c;
        String supplierSummary = String.join(supplierNames, ', ');
        Messaging.SingleEmailMessage email = new Messaging.SingleEmailMessage();
        email.setToAddresses(recipientIds);
        email.setSubject('Buyer charge approval pending for STEM ' + stemNumber);
        email.setPlainTextBody('The final Buyer Invoice is blocked pending buyer charge approval for STEM '
            + stemNumber + '.\n\nSuppliers awaiting approval: ' + supplierSummary
            + '\n\nOpen the Variable Charges task in FCOS and review the Buyer Leg.\n' + readiness.fcosUrl);
        email.setSaveAsActivity(false);

        Savepoint beforeReminder = Database.setSavepoint();
        try {
            insert new Task(WhatId = stem.Id, OwnerId = actorId, Subject = taskSubject, Status = 'Completed',
                Priority = 'Normal', ActivityDate = Date.today(), Description = taskHeader
                    + 'Blocked suppliers: ' + supplierSummary + '\nSalesforce recipient IDs: ' + String.join(recipientIds, ', '));
            if (Test.isRunningTest()) {
                if (failBuyerChargeReminderForTest) throw new BuyerChargeReminderEmailException();
                capturedBuyerChargeReminder = email;
            } else {
                Messaging.SendEmailResult[] results = Messaging.sendEmail(new Messaging.SingleEmailMessage[]{email});
                if (results.size() != 1 || !results[0].isSuccess()) {
                    throw invoiceSaveError('Salesforce could not send the reminder. Try again or contact your Salesforce administrator.');
                }
            }
        } catch (Exception problem) {
            Database.rollback(beforeReminder);
            if (problem instanceof AuraHandledException) throw problem;
            throw invoiceSaveError('Salesforce could not record and send the reminder. Try again or contact your Salesforce administrator.');
        }
        return BUYER_CHARGE_REMINDER_RESULT;
    }

    private class BuyerChargeReminderEmailException extends Exception {}

    private static Id requireBuyerInvoiceStemRead(String stemId) {
        Id sourceStemId;
        try {
            sourceStemId = Id.valueOf(stemId);
            if (sourceStemId != null && sourceStemId.getSObjectType() == STEM__c.SObjectType) {
                List<STEM__c> readable = [SELECT Id FROM STEM__c WHERE Id = :sourceStemId WITH USER_MODE];
                if (!readable.isEmpty()) return sourceStemId;
            }
        } catch (Exception problem) {
            // Malformed IDs and inaccessible records receive the same response.
        }
        throw invoiceSaveError('Open a STEM you have permission to access before checking the Buyer Invoice.');
    }

    private static List<String> resolveBuyerChargeReminderTraders(Id stemId, Map<Id, Account> suppliers) {
        Set<Id> supplierIds = suppliers.keySet();
        List<Nomination__c> confirmations = new List<Nomination__c>();
        Map<Id, List<Nomination__c>> supplierNominations = new Map<Id, List<Nomination__c>>();
        for (Id supplierId : supplierIds) supplierNominations.put(supplierId, new List<Nomination__c>());
        Set<String> traderNames = new Set<String>();
        for (Nomination__c nomination : [
            SELECT Account__c, RecordTypeId, Buyer_Supplier_Trader__c
            FROM Nomination__c WHERE STEM__c = :stemId AND Deprecated__c = false
                AND (RecordTypeId = :FCBStatic.BUYER_NOMINATION_RT_ID
                    OR (RecordTypeId = :FCBStatic.SUPPLIER_NOMINATION_RT_ID AND Account__c IN :supplierIds))
        ]) {
            if (nomination.RecordTypeId == FCBStatic.BUYER_NOMINATION_RT_ID) {
                confirmations.add(nomination);
            } else {
                supplierNominations.get(nomination.Account__c).add(nomination);
            }
            String name = normalizeReminderTraderIdentity(nomination.Buyer_Supplier_Trader__c);
            // The document email formula also returns a mailbox when the assignment is blank or shared.
            if (name != null && name != 'others') traderNames.add(name);
        }
        if (confirmations.size() != 1) {
            throw invoiceSaveError('The Buyer Trader requires one active Buyer Confirmation. Resolve the assignment before sending the reminder.');
        }
        Map<String, Set<Id>> usersByName = new Map<String, Set<Id>>();
        Map<Id, String> emailByUser = new Map<Id, String>();
        for (User trader : [
            SELECT Id, Name, Email FROM User WHERE IsActive = true AND UserType = 'Standard'
                AND Name IN :traderNames
        ]) {
            // Salesforce exposes User setup records to Apex tests even with SeeAllData disabled.
            if (Test.isRunningTest() && buyerChargeReminderFixtureTraderIds != null
                && !buyerChargeReminderFixtureTraderIds.contains(trader.Id)) continue;
            String name = normalizeReminderTraderIdentity(trader.Name);
            if (!usersByName.containsKey(name)) usersByName.put(name, new Set<Id>());
            usersByName.get(name).add(trader.Id);
            emailByUser.put(trader.Id, normalizeReminderTraderIdentity(trader.Email));
        }

        Set<Id> recipientUsers = new Set<Id>{resolveReminderRole(confirmations, 'Buyer Trader', usersByName)};
        for (Id supplierId : supplierIds) {
            recipientUsers.add(resolveReminderRole(supplierNominations.get(supplierId),
                'Supplier Trader for ' + suppliers.get(supplierId).Name, usersByName));
        }
        Set<String> recipientEmails = new Set<String>();
        List<String> recipientIds = new List<String>();
        for (Id userId : recipientUsers) {
            String email = emailByUser.get(userId);
            if (String.isBlank(email)) {
                throw invoiceSaveError('An assigned Salesforce user has no email address. Resolve the trader assignment before sending the reminder.');
            }
            if (!recipientEmails.add(email)) {
                throw invoiceSaveError('Two assigned Salesforce users share an email address. Resolve the trader assignments before sending the reminder.');
            }
            recipientIds.add(String.valueOf(userId));
        }
        recipientIds.sort();
        if (recipientIds.size() > 100) {
            throw invoiceSaveError('The reminder exceeds the Salesforce recipient limit.');
        }
        return recipientIds;
    }

    private static Id resolveReminderRole(List<Nomination__c> nominations, String role, Map<String, Set<Id>> usersByName) {
        Set<Id> resolved = new Set<Id>();
        for (Nomination__c nomination : nominations) {
            String name = normalizeReminderTraderIdentity(nomination.Buyer_Supplier_Trader__c);
            Set<Id> matches = usersByName.get(name);
            if (matches == null || matches.size() != 1) {
                throw invoiceSaveError(role + ' must resolve to one active internal Salesforce user before sending the reminder.');
            }
            resolved.addAll(matches);
        }
        if (resolved.size() != 1) {
            throw invoiceSaveError(role + ' is missing or conflicting on the active nomination. Resolve the assignment before sending the reminder.');
        }
        return new List<Id>(resolved)[0];
    }

    private static String normalizeReminderTraderIdentity(String value) {
        return String.isBlank(value) ? null : value.trim().toLowerCase();
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
    public static Invoice__c saveFinalBuyerInvoicePdf(
        Id stemId, List<String> extraIds, Date invoiceDate, Date deliveryDate, Date invoiceDueDate, String body
    ) {
        if (extraIds == null || extraIds.isEmpty() || String.isBlank(body)) {
            throw invoiceSaveError('Select the invoice lines and provide the PDF before saving.');
        }
        STEM__c lockedStem = [SELECT Id FROM STEM__c WHERE Id = :stemId FOR UPDATE];
        List<Id> selected = new List<Id>();
        for (String lineId : extraIds) selected.add(Id.valueOf(lineId));
        List<STEM_Line_Item__c> issuedProducts = [
            SELECT Buyer_Invoice__r.Name FROM STEM_Line_Item__c
            WHERE Id IN :selected AND STEM__c = :lockedStem.Id
            AND Buyer_Invoice__r.File__c != null AND Buyer_Invoice__r.Proforma__c = false
            AND Buyer_Invoice__r.Deprecated__c = false LIMIT 1
        ];
        List<STEM_Extra_Cost__c> issuedCharges = [
            SELECT Buyer_Invoice__r.Name FROM STEM_Extra_Cost__c
            WHERE Id IN :selected AND STEM__c = :lockedStem.Id
            AND Buyer_Invoice__r.File__c != null AND Buyer_Invoice__r.Proforma__c = false
            AND Buyer_Invoice__r.Deprecated__c = false LIMIT 1
        ];
        if (!issuedProducts.isEmpty() || !issuedCharges.isEmpty()) {
            String existing = issuedProducts.isEmpty()
                ? issuedCharges[0].Buyer_Invoice__r.Name : issuedProducts[0].Buyer_Invoice__r.Name;
            throw invoiceSaveError('A selected line is already on invoice ' + existing + '. Open it in the Invoices tab.');
        }

        // The locked STEM serializes issuance. An exception rolls back the invoice, file and line updates together.
        Savepoint beforeInvoice = Database.setSavepoint();
        try {
            Invoice__c invoice = createInvoice(String.valueOf(stemId), extraIds, false, false,
                invoiceDate, deliveryDate, invoiceDueDate);
            attachInvoicePdf(invoice.Id, invoice.Name, extraIds, body, false, null, true);
            return invoice;
        } catch (Exception error) {
            Database.rollback(beforeInvoice);
            if (error instanceof AuraHandledException) throw error;
            throw invoiceSaveError('Salesforce could not save the invoice PDF. ' + error.getMessage());
        }
    }

    private static AuraHandledException invoiceSaveError(String message) {
        AuraHandledException error = new AuraHandledException(message);
        error.setMessage(message);
        return error;
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
        if(!currentInvoices.isEmpty()){
            List<Invoice__c> buffInvoices = new List<Invoice__c>();
            for(Integer i = 0; i < currentInvoices.size(); i++){
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
        attachInvoicePdf(invoiceId, invoiceVersionName, extraIds, body, createProforma, reviewedFxFingerprint, false);
    }

    private static void attachInvoicePdf(String invoiceId, String invoiceVersionName, List<String> extraIds,
        String body, Boolean createProforma, String reviewedFxFingerprint, Boolean justCreatedUnderLock) {
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
        if (!justCreatedUnderLock) {
            MasterContractInvoiceReadinessService.assertPersistedInvoicesAllowed(new Set<Id>{Id.valueOf(invoiceId)});
            VariableChargeInvoiceReadinessService.assertPersistedInvoicesAllowed(new Set<Id>{Id.valueOf(invoiceId)});
        }
        // The atomic path already checked both gates while inserting this invoice under the STEM lock.
        // Both paths still recheck readiness in InvoiceTrigger when assigning the file.

        ContentVersion contentVersion = new ContentVersion();
        contentVersion.PathOnClient = '/' + invoiceVersionName + '.pdf';
        contentVersion.Title = invoiceVersionName + '.pdf';
        contentVersion.VersionData = documentBody;
        contentVersion.FirstPublishLocationId = invoiceId;
        insert contentVersion;
        Id documentId = [SELECT ContentDocumentId FROM ContentVersion WHERE Id = :contentVersion.Id].ContentDocumentId;
        List<ContentDocumentLink> extraLinks = new List<ContentDocumentLink>();
        system.debug(extraIds);
        for(String extraId: extraIds){
            extraLinks.add(new ContentDocumentLink(LinkedEntityId = extraId, ContentDocumentId = documentId));
        }
        insert extraLinks;
        //Setting File refference for Invoice record
        Decimal totalAmount = linkInvoiceLines(productLines, chargeLines, invoiceId, createProforma);
        Invoice__c invoice = new Invoice__c(Id = invoiceId, File__c = Url.getOrgDomainURL().toExternalForm() + '/' + documentId, Amount__c = totalAmount);
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
