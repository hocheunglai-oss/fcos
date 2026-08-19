public with sharing class StemProcessingController {  
    @AuraEnabled
    public static List<Supplier_Invoice__c> getSupplierInvoicesForStem(String stemId) {
        return [SELECT Id, Name, STEM__c, STEM__r.KeyStem__c, STEM__r.Vessel__r.Name, STEM__r.Vessel__r.IMO__c, STEM__r.Port__r.Name, Invoice_Due_Date__c, Invoice_Amount__c,
                Supplier__c, Supplier__r.Name, Supplier__r.Inactive_Suspended__c, PSPRS__c, Supplier__r.BDN_Company__c,
                Beneficiary__c, Substitute_Supplier__c, Supplier__r.Bank_Details__c, Calculated_Amount__c, Payable_Balance__c, Sent_PSPRS__c, Supplier_Delivery_Date__c,
                Partial_CIA__c, Partial_Amount__c, Partial_Invoice_Due_Date__c, 
                (SELECT Id, Inputs__c, Product_Inputs__c, BDN_Number__c, STEM_Ref__c, Supplier_Name__c, Supplier_Invoice__c FROM PSPRS_Forms__r),
                (SELECT Id, Account__c, Account__r.Name, Amount__c, Date__c, Supplier_Invoice__r.Name, Bank__c, Is_Deposit__c, Volume_Discount__c FROM Payments__r),
                (SELECT Id, ContentDocumentId, ContentDocument.Title, LinkedEntityId FROM ContentDocumentLinks)
                    FROM Supplier_Invoice__c WHERE STEM__c = :stemId ORDER BY Supplier__r.Name];
    }
    
    @AuraEnabled
    public static STEM__c getStemInfo(String stemId){
        return [SELECT Id, Account__c, Account__r.Name, Payment_Term__c FROM STEM__c WHERE Id =: stemId LIMIT 1];
    }
    
    @AuraEnabled
    public static List<Supplier_Invoice__c> getEarliestSupplierDeliveryDate(String stemId){
        return [SELECT Id, Supplier_Delivery_Date__c FROM Supplier_Invoice__c WHERE STEM__c = :stemId ORDER BY Supplier_Delivery_Date__c];
    }

    @AuraEnabled
    public static List<Volume_Discount_Item__c> getVolumeDiscountInfo(String stemId){
        return [SELECT Id, STEM__c, Volume_Discount__c, Volume_Discount__r.Account__c, Volume_Discount__r.Account__r.Name, Quantity__c, Amount__c
                FROM Volume_Discount_Item__c WHERE STEM__c =: stemId];
    }

    @AuraEnabled(cacheable = true)
    public static List<STEM_Buyer_Broker__c> getStemBuyerBrokers(String stemId){
        return [SELECT Id, STEM__c, Buyer_Broker__c, Buyer_Broker__r.Name FROM STEM_Buyer_Broker__c WHERE STEM__c =: stemId ORDER BY CreatedDate];
    }
    
    @AuraEnabled
    public static List<STEM_Line_Item_Buyer_Broker__c> getStemLineItemBuyerBrokers(String stemLineItemId){
        return [SELECT Id, STEM_Line_Item__c, STEM_Buyer_Broker__c, STEM_Buyer_Broker__r.Name, Commission__c 
                FROM STEM_Line_Item_Buyer_Broker__c WHERE STEM_Line_Item__c =: stemLineItemId ORDER BY CreatedDate];
    }
    
    @AuraEnabled(cacheable = true)
    public static String getTraderText(String stemId){
        String traderText = '';
        List<Nomination__c> nominations = [SELECT Id, Buyer_Supplier_Trader__c, RecordTypeId, RecordType.Name, Account__c, Account__r.Name
                                           FROM Nomination__c 
                                           WHERE STEM__c =: stemId AND Deprecated__c = false AND Buyer_Supplier_Trader__c != null AND Buyer_Supplier_Trader__c != ''
                                           ORDER BY RecordType.Name];
        for(Nomination__c nomination: nominations){
            if(nomination.RecordTypeId == FCBStatic.BUYER_NOMINATION_RT_ID){
                traderText += 'BT: ' + nomination.Buyer_Supplier_Trader__c + '\n';
            } else{
                traderText += 'ST (' + nomination.Account__r.Name + ') : ' + nomination.Buyer_Supplier_Trader__c + '\n';
            }
        }
        return traderText.trim();
    }
    
    @AuraEnabled
    public static List<STEM_Line_Item__c> getBDNCompany(String stemId){
        return [SELECT Id, Original_Supplier__c, Product__r.Family, BDN_Company__c, Supplier_Invoice__c FROM STEM_Line_Item__c WHERE STEM__c =: stemId];
    } 
    
    @AuraEnabled
    public static Boolean isSameBdnItems(String recordId, String stemId, String supplierId, String bdnCompany){
        List<STEM_Line_Item__c> stemLineItems = [SELECT Id, STEM__c, Payment_Term__c 
                                                 FROM STEM_Line_Item__c WHERE Id !=: recordId AND STEM__c =: stemId AND Original_Supplier__c =: supplierId 
                                                 AND (Original_Supplier__r.BDN_Company__c =: bdnCompany OR BDN_Company__c =: bdnCompany)];
        List<STEM_Extra_Cost__c> stemExtraCosts = [SELECT Id, STEM__c, Payment_Term__c 
                                                   FROM STEM_Extra_Cost__c WHERE Id !=: recordId AND RecordTypeId =: FCBStatic.STEM_CHARGE_RT_ID AND STEM__c =: stemId AND Supplier__c =: supplierId];
        return !stemLineItems.isEmpty() || !stemExtraCosts.isEmpty();
    }
    
    @AuraEnabled
    public static void updateExistingPaymentTerms(String stemId, String supplierId, String bdnCompany, String paymentTerm){
        List<STEM_Line_Item__c> stemLineItems = [SELECT Id, STEM__c, Payment_Term__c 
                                                 FROM STEM_Line_Item__c WHERE STEM__c =: stemId AND Original_Supplier__c =: supplierId
                                                 AND (Original_Supplier__r.BDN_Company__c =: bdnCompany OR BDN_Company__c =: bdnCompany)];
        for(STEM_Line_Item__c stemLineItem: stemLineItems){
            stemLineItem.Payment_Term__c = paymentTerm;
        }
        update stemLineItems;
        List<STEM_Extra_Cost__c> stemExtraCosts = [SELECT Id, STEM__c, Payment_Term__c 
                                                   FROM STEM_Extra_Cost__c WHERE STEM__c =: stemId AND Supplier__c =: supplierId];
        for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts){
            stemExtraCost.Payment_Term__c = paymentTerm;
        }
        update stemExtraCosts;
    }
    
    @AuraEnabled
    public static void updateExistingPartialAmount(String stemId, String supplierId, Boolean partialCia, Decimal partialAmount){
        List<STEM_Line_Item__c> stemLineItems = [SELECT Id, STEM__c, Payment_Term__c 
                                                 FROM STEM_Line_Item__c WHERE STEM__c =: stemId AND Original_Supplier__c =: supplierId];
        for(STEM_Line_Item__c stemLineItem: stemLineItems){
            stemLineItem.Partial_CIA__c = partialCia;
            stemLineItem.Partial_Lumpsum_Buy_At__c = partialAmount;
        }
        update stemLineItems;
    }
    
	@AuraEnabled
    public static List<Payment__c> getUnassignedSupplierInvoicePayments(String stemId) {
        Id payableRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Payable').getRecordTypeId();
        Id commissionRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Commission').getRecordTypeId();
        return [SELECT Id, Account__c, Account__r.Name, Amount__c, Date__c, Supplier_Invoice__r.Name, Bank__c, Maximum_Amount__c
                FROM Payment__c WHERE ((RecordTypeId =: payableRecordTypeId AND Supplier_Invoice__c = NULL) OR (RecordTypeId =: commissionRecordTypeId AND Commission_Invoice__c = NULL)) AND STEM__c =: stemId ];
    }   
   
    @AuraEnabled(cacheable = true)
    public static List<Supplier_Invoice__c> getSupplierInvoicesOptions(String stemId) {
        return [SELECT Id, Name, STEM__c, Supplier__c, Invoice_Amount__c, Payable_Balance__c, PSPRS__c, Supplier_Delivery_Date__c,
                Invoice_Due_Date__c, Payment_Term__c
                FROM Supplier_Invoice__c WHERE STEM__c = :stemId];
    }
    
    @AuraEnabled
    public static String getDefaultSupplierPaymentTerm(String stemId, String supplierId){
        List<Account> suppliers = [SELECT Id, Supplier_Payment_Term__c FROM Account WHERE Id =: supplierId];
        List<STEM_Line_Item__c> stemLineItems = [SELECT Id, Payment_Term__c FROM STEM_Line_Item__c WHERE STEM__c =: stemId AND Original_Supplier__c =: supplierId];
        List<STEM_Extra_Cost__c> stemExtraCosts = [SELECT Id, Payment_Term__c FROM STEM_Extra_Cost__c WHERE STEM__c =: stemId AND Supplier__c =: supplierId];
        String supplierPaymentTerm;
        if(!stemLineItems.isEmpty()){
            supplierPaymentTerm = stemLineItems[0].Payment_Term__c;
        } else if(!stemExtraCosts.isEmpty()){
            supplierPaymentTerm = stemExtraCosts[0].Payment_Term__c;
        } else if(!suppliers.isEmpty()){
            supplierPaymentTerm = suppliers[0].Supplier_Payment_Term__c;
        }
        return supplierPaymentTerm;
    }
    
    @AuraEnabled
    public static List<Unofficial_Compensation__c> getUnofficialCompensation(String stemId, String stemLineItemId){
        if(stemLineItemId == null){
            return [SELECT Id, STEM__c, Account__c, Account__r.Name,  Account__r.Inactive_Suspended__c,  Account__r.BDN_Company__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Unit_of_Measure__c,
                   Unit_Price__c, Lumpsum_Price__c, Fixed__c, Product__c, Product__r.Name, Buyer_Supplier_Trader__c FROM Unofficial_Compensation__c WHERE STEM__c =: stemId];
        } else{
            return [SELECT Id, STEM__c, Account__c, Account__r.Name,  Account__r.Inactive_Suspended__c,  Account__r.BDN_Company__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Unit_of_Measure__c,
                   Unit_Price__c, Lumpsum_Price__c, Fixed__c, Product__c, Product__r.Name, Buyer_Supplier_Trader__c FROM Unofficial_Compensation__c WHERE STEM__c =: stemId AND STEM_Line_Item__c =: stemLineItemId];
        }
    }
    
    @AuraEnabled
    public static List<Account> getAllStemsAccounts(String stemId){
        Set<Id> accountIds = new Set<Id>();
        STEM__c stem = [SELECT Id, Account__c, Buyer_Broker__c FROM STEM__c WHERE Id =: stemId LIMIT 1];
        accountIds.add(stem.Account__c);
        accountIds.add(stem.Buyer_Broker__c);
        for(STEM_Line_Item__c stemLineItem: [SELECT Id, Original_Supplier__c, Supplier_Broker__c FROM STEM_Line_Item__c WHERE STEM__c =: stemId]){
            accountIds.add(stemLineItem.Original_Supplier__c);
        	accountIds.add(stemLineItem.Supplier_Broker__c);
        }
        for(STEM_Extra_Cost__c stemExtraCost: [SELECT Id, Supplier__c FROM STEM_Extra_Cost__c WHERE STEM__c =: stemId]){
            accountIds.add(stemExtraCost.Supplier__c);
        }
        for(STEM_Buyer_Broker__c stemBuyerBroker: [SELECT Id, Buyer_Broker__c FROM STEM_Buyer_Broker__c WHERE STEM__c =: stemId]){
            accountIds.add(stemBuyerBroker.Buyer_Broker__c);
        }
        return [SELECT Id, Name, (SELECT Id, Contact__c, Contact__r.Name, Status__c FROM Agreed_Compensations__r) FROM Account WHERE Id IN: accountIds];
    }
    
    @AuraEnabled
    public static void insertUnofficialCompensations(List<Unofficial_Compensation__c> records){
        insert records;
    }
    
    @AuraEnabled(cacheable = true)
	public static Map<String, String> getTraders() {
		Map<String, String> pickListValues = new Map<String, String>();
		Schema.DescribeFieldResult fieldResult = Unofficial_Compensation__c.Buyer_Supplier_Trader__c.getDescribe();
		List<Schema.PicklistEntry> picklistEntries = fieldResult.getPicklistValues();
		for (Schema.PicklistEntry picklistEntry : picklistEntries) {
			pickListValues.put(picklistEntry.getLabel(), picklistEntry.getValue());
		}
		return pickListValues;
	}
    
    @AuraEnabled(cacheable=true) 
    public static List<Consultation__c> getConsultations(String stemLineItemId) {
        return [SELECT Id, Name, Fee__c, STEM_Line_Item__c, Consultant__c, Consultant__r.Name FROM Consultation__c WHERE STEM_Line_Item__c = :stemLineItemId];
    }
    
    @AuraEnabled
    public static void sendDisputeEmail(Id stemId, List<Id> disputeIds){
        String textBody = '';
        Messaging.SingleEmailMessage mail = new Messaging.SingleEmailMessage();
        mail.setToAddresses(new List<String>{'vincent@cosulich.com.hk'}); 
        mail.setSenderDisplayName('FRATELLI COSULICH');
        List<Dispute__c> disputes = [SELECT Id, Buyer__c, Buyer__r.Name, Supplier__c, Supplier__r.Name, 
                                     		STEM__c, STEM__r.Name, STEM__r.Enquiry__r.Name, STEM__r.Account__r.Name, STEM__r.Expected_Delivery_Date__c, STEM__r.Payment_Term__c, Payment_Term__c,
                                     		STEM__r.Invoice_Due_Date__c, Status_Buyer__c, Status_Supplier__c,
                							Description_Buyer__c, Description_Supplier__c, FORMAT(Deduction_Amount_Supplier__c), Dispute_Status__c, Cashflow__r.Invoice_Due_Date__c
                					FROM Dispute__c WHERE Id IN: disputeIds];
        List<STEM_Line_Item__c> stemLineItems = [SELECT Id, Supplier_Invoice_Due_Date__c, QLIK_Supplier_Invoice_Due_Date__c, Original_Supplier__c, Payment_Term__c FROM STEM_Line_Item__c WHERE STEM__c =: stemId];
        List<STEM_Extra_Cost__c> stemExtraCosts = [SELECT Id, Supplier_Invoice_Due_Date__c, QLIK_Supplier_Invoice_Due_Date__c, Supplier__c, Payment_Term__c FROM STEM_Extra_Cost__c WHERE STEM__c =: stemId];
        Map<String, Date> supplierInvoiceDueDateMap = new Map<String, Date>();
        Map<String, Date> expectedSupplierInvoiceDueDateMap = new Map<String, Date>();
        for(STEM_Line_Item__c stemLineItem: stemLineItems){
            supplierInvoiceDueDateMap.put(stemLineItem.Original_Supplier__c + '_' + stemLineItem.Payment_Term__c, stemLineItem.Supplier_Invoice_Due_Date__c);
            expectedSupplierInvoiceDueDateMap.put(stemLineItem.Original_Supplier__c + '_' + stemLineItem.Payment_Term__c, stemLineItem.QLIK_Supplier_Invoice_Due_Date__c);
        }
        for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts){
            supplierInvoiceDueDateMap.put(stemExtraCost.Supplier__c + '_' + stemExtraCost.Payment_Term__c, stemExtraCost.Supplier_Invoice_Due_Date__c);
            expectedSupplierInvoiceDueDateMap.put(stemExtraCost.Supplier__c + '_' + stemExtraCost.Payment_Term__c, stemExtraCost.QLIK_Supplier_Invoice_Due_Date__c);
        }
        mail.setSubject('DISPUTE: ' + disputes[0].STEM__r.Enquiry__r.Name + ' - ' + disputes[0].STEM__r.Account__r.Name);
        textBody += '<html><head><style>td, th {border: 1px solid black;}</style></head><body><table style="border-collapse: collapse; border: 1px solid black; text-align: center">';
        textBody += '<thead><tr><th>Supplier</th><th>Supplier Invoice Due Date</th><th>Buyer Invoice Due Date</th><th>Dispute Type</th><th>Dispute Status With Supplier</th><th>Dispute Status With Buyer</th><th>Deduction Amount</th><th>Description Supplier</th><th>Description Buyer</th></tr></thead>';
        for(Dispute__c dispute: disputes){
            String supplierKey = dispute.Supplier__c + '_' + dispute.Payment_Term__c;
            Integer paymentTerm = dispute.STEM__r.Payment_Term__c.isNumeric() ? Integer.valueOf(dispute.STEM__r.Payment_Term__c) : 0;
            String supplierInvoiceDueDate = supplierInvoiceDueDateMap.get(supplierKey) != null 
                ? supplierInvoiceDueDateMap.get(supplierKey).format()
                : expectedSupplierInvoiceDueDateMap.get(supplierKey) != null 
                    ? expectedSupplierInvoiceDueDateMap.get(supplierKey).format()
                    : '';
            textBody += '<tr>';
        	textBody += dispute.Supplier__c != null ? '<td>' + dispute.Supplier__r.Name + '</td>' : '<td></td>';
            textBody += '<td>' + supplierInvoiceDueDate + '</td>';
            textBody += dispute.STEM__r.Invoice_Due_Date__c != null ? '<td>' + dispute.STEM__r.Invoice_Due_Date__c.format() + '</td>' : '<td>' + dispute.STEM__r.Expected_Delivery_Date__c.addDays(paymentTerm).format() + '</td>';
            textBody += '<td>' + dispute.Dispute_Status__c + '</td>';
            textBody += dispute.Status_Supplier__c != null ? '<td>' + dispute.Status_Supplier__c + '</td>' : '<td></td>';
            textBody += dispute.Status_Buyer__c != null ? '<td>' + dispute.Status_Buyer__c + '</td>' : '<td></td>';
			textBody += dispute.Deduction_Amount_Supplier__c != null ? '<td style="text-align: right;">$' + formatDecimal(dispute.Deduction_Amount_Supplier__c) + '</td>' : '<td></td>';
            textBody += dispute.Description_Supplier__c != null ? '<td>' + dispute.Description_Supplier__c + '</td>' : '<td></td>';
            textBody += dispute.Description_Buyer__c != null ? '<td>' + dispute.Description_Buyer__c + '</td>' : '<td></td>';
            textBody += '</tr>';
        }
        textBody += '</table>';
        String stemHyperlink = URL.getSalesforceBaseUrl().toExternalForm() + '/' + disputes[0].STEM__c;
        textBody += '<a href="' + stemHyperlink + '">' + stemHyperlink + '</a>';
        textBody += '</body></html>';
		mail.setHtmlBody(textBody);
        Messaging.sendEmail(new Messaging.SingleEmailMessage[] { mail });
    }
    
    public static String formatDecimal(Decimal input) {
        String formattedNumber = input.format();
        if (!formattedNumber.contains('.')) {
            formattedNumber += '.00';
        } else {
            String[] parts = formattedNumber.split('\\.');
            if (parts.size() == 1) {
                formattedNumber += '.00';
            } else if (parts[1].length() == 1) {
                formattedNumber += '0';
            }
        }

        return formattedNumber;
    }
    
    @AuraEnabled
    public static List<Dispute__c> getDisputeData(String stemId){
        return [SELECT Id, Buyer__c, Buyer__r.Name, Supplier__c, Supplier__r.Name, STEM__c, Status_Buyer__c, Status_Supplier__c,
                Description_Buyer__c, Description_Supplier__c, Deduction_Amount_Supplier__c, Payment_Term__c, Supplier_Key__c
                FROM Dispute__c WHERE STEM__c =: stemId];
    }
    
    @AuraEnabled
    public static void operateDisputes(String stemId, String buyerId, List<String> supplierKeys){
        String supplierInvoiceRecordTypeId = Schema.SObjectType.Cashflow__c.getRecordTypeInfosByName().get('Supplier Invoice').getRecordTypeId();
        List<Dispute__c> disputes = [SELECT Id, Buyer__c, Supplier__c, Status_Buyer__c, Description_Buyer__c, Status_Supplier__c, Description_Supplier__c, Payment_Term__c, Supplier_Key__c
                                     FROM Dispute__c WHERE STEM__c =: stemId];
        Map<String, Dispute__c> disputeMap = new Map<String, Dispute__c>();
    
        String buyerStatus = '';
        String buyerDescription = '';
    
        for (Dispute__c d : disputes) {
    
            String key = d.Supplier__c + '_' + d.Payment_Term__c;
            disputeMap.put(key, d);
    
            if (d.Buyer__c != null) {
                buyerStatus = d.Status_Buyer__c;
                buyerDescription = d.Description_Buyer__c;
            }
        }
    
        List<Dispute__c> disputesToUpsert = new List<Dispute__c>();
    
        // DELETE: convert supplierKeys to same format logic
        List<String> existingKeys = new List<String>();
        for (Dispute__c d : disputes) {
            existingKeys.add(d.Supplier__c + '_' + d.Payment_Term__c);
        }
    
        List<Dispute__c> disputesToDelete = [
            SELECT Id
            FROM Dispute__c
            WHERE STEM__c = :stemId
            AND Supplier_Key__c NOT IN :supplierKeys
        ];
    
        if (buyerId == null || buyerId == '') {
    
            for (String key : supplierKeys) {
    
                List<String> parts = key.split('_');
                String supplierId = parts[0];
                String paymentTerm = parts.size() > 1 ? parts[1] : null;
    
                if (!disputeMap.containsKey(key)) {
    
                    disputesToUpsert.add(new Dispute__c(
                        STEM__c = stemId,
                        Supplier__c = supplierId,
                        Payment_Term__c = paymentTerm,
                        Buyer__c = null,
                        Status_Buyer__c = '',
                        Description_Buyer__c = '',
                        Status_Supplier__c = 'Decision Pending'
                    ));
    
                } else {
    
                    Dispute__c existing = disputeMap.get(key);
    
                    disputesToUpsert.add(new Dispute__c(
                        Id = existing.Id,
                        STEM__c = stemId,
                        Supplier__c = supplierId,
                        Payment_Term__c = paymentTerm,
                        Buyer__c = null,
                        Status_Buyer__c = '',
                        Description_Buyer__c = ''
                    ));
                }
            }
    
        } else {
    
            if (!supplierKeys.isEmpty()) {
    
                for (String key : supplierKeys) {
    
                    List<String> parts = key.split('_');
                    String supplierId = parts[0];
                    String paymentTerm = parts.size() > 1 ? parts[1] : null;
    
                    Dispute__c existing = disputeMap.get(key);
    
                    disputesToUpsert.add(new Dispute__c(
                        Id = existing != null ? existing.Id : null,
                        STEM__c = stemId,
                        Supplier__c = supplierId,
                        Payment_Term__c = paymentTerm,
                        Buyer__c = buyerId,
                        Status_Buyer__c = buyerStatus != '' ? buyerStatus : 'No agreement yet',
                        Description_Buyer__c = buyerDescription != '' ? buyerDescription : '',
                        Status_Supplier__c = existing != null ? existing.Status_Supplier__c : 'Decision Pending',
                        Description_Supplier__c = existing != null ? existing.Description_Supplier__c : ''
                    ));
                }
    
            } else {
    
                Dispute__c existing = disputeMap.get(null);
    
                disputesToUpsert.add(new Dispute__c(
                    Id = existing != null ? existing.Id : null,
                    STEM__c = stemId,
                    Buyer__c = buyerId,
                    Status_Buyer__c = buyerStatus != '' ? buyerStatus : 'No agreement yet',
                    Description_Buyer__c = buyerDescription != '' ? buyerDescription : ''
                ));
            }
        }
    
        upsert disputesToUpsert;
        delete disputesToDelete;
    }
    
    @AuraEnabled
    public static List<Cashflow__c> getStemCashflows(String stemId){
        String supplierInvoiceRecordTypeId = Schema.SObjectType.Cashflow__c.getRecordTypeInfosByName().get('Supplier Invoice').getRecordTypeId();
        String buyerInvoiceRecordTypeId = Schema.SObjectType.Cashflow__c.getRecordTypeInfosByName().get('Buyer Invoice').getRecordTypeId();
        return [SELECT Id, Account__c, Account__r.Name, RecordType.Name FROM Cashflow__c
                WHERE STEM__c =: stemId AND (RecordTypeId =: supplierInvoiceRecordTypeId OR RecordTypeId =: buyerInvoiceRecordTypeId)];
    }
    
    @AuraEnabled(cacheable=true)
    public static List<SupplierInvoiceTemplate> getSupplierInvoiceTemplates(String stemId) {
        String stemChargeRecordTypeId = Schema.SObjectType.STEM_Extra_Cost__c.getRecordTypeInfosByName().get('STEM Charge').getRecordTypeId();
        List<SupplierInvoiceTemplate> supplierInvoiceTemplates = new List<SupplierInvoiceTemplate>();
        List<STEM_Line_Item__c> stemLineItems = [SELECT Id , Original_Supplier__r.Name, Original_Supplier__c, Original_Supplier__r.Bank_Details__c, Total_Cost__c, Refcode_Index__c,
                                                 BDN_Delivery_Date__c, Payment_Term__c, Product__r.Name, Supplier_Input__c, Supplier_Issued__c, Is_Purchase_CSV_Exported__c,
                                                 Is_Purchase_CSV_Info_Changed__c, Partial_CIA__c, Partial_Lumpsum_Buy_At__c, Is_Quantity_Range__c, Quantity_Delivered_Per_BDN__c,
                                                 (SELECT Id, Supplier__r.Name, Supplier__c, Supplier__r.Bank_Details__c, Unit_Cost__c, Is_Purchase_CSV_Info_Changed__c,
                                                  Quantity__c, Quantity_Delivered_Per_BDN__c, Payment_Term__c, Product2Id__r.Name, Line_Total_Buy__c,
                                                  Supplier_Input__c, Supplier_Issued__c, RecordType.Name, Is_Purchase_CSV_Exported__c, Refcode_Index__c
                    							  FROM STEM_Extra_Costs__r WHERE STEM__c = :stemId
                                                  AND Line_Total_Buy__c != 0 AND Line_Total_Buy__c != null AND Cancelled__c = false)
                    							 FROM STEM_Line_Item__c WHERE STEM__c = :stemId AND Cancelled__c = false AND Unit_Sell_At__c != 0];
        for(STEM_Line_Item__c sli : stemLineItems){
            supplierInvoiceTemplates.add(new SupplierInvoiceTemplate(sli.Id,
                                                                     sli.Original_Supplier__c,
                                                                     sli.Original_Supplier__r.Name,
                                                                     sli.Original_Supplier__r.Bank_Details__c,
                                                                     sli.Product__r.Name,
                                                                     sli.Total_Cost__c,
                                                                     sli.Is_Quantity_Range__c,
                                                                     sli.Quantity_Delivered_Per_BDN__c,
                                                                     sli.BDN_Delivery_Date__c,
                                                                     sli.Payment_Term__c, 
                                                                     sli.Supplier_Input__c,
                                                                     sli.Supplier_Issued__c,
                                                                     sli.Is_Purchase_CSV_Exported__c,
                                                                     sli.Is_Purchase_CSV_Info_Changed__c,
                                                                     sli.Refcode_Index__c,
                                                                     sli.Partial_CIA__c,
                                                                     sli.Partial_Lumpsum_Buy_At__c,
                                                                     'STEM Line Item'));
            for(STEM_Extra_Cost__c sec : sli.STEM_Extra_Costs__r){
                supplierInvoiceTemplates.add(new SupplierInvoiceTemplate(sec.Id,
                                                                         sec.Supplier__c,
                                                                         sec.Supplier__r.Name,
                                                                         sec.Supplier__r.Bank_Details__c,
                                                                         sec.Product2Id__r.Name,
                                                                         sec.Line_Total_Buy__c,
                                                                         sli.Is_Quantity_Range__c,
                                                                     	 sli.Quantity_Delivered_Per_BDN__c,
                                                                         null,
                                                                         sec.Payment_Term__c,
                                                                         sec.Supplier_Input__c,
                                                                         sec.Supplier_Issued__c,
                                                                         sec.Is_Purchase_CSV_Exported__c,
                                                                         sec.Is_Purchase_CSV_Info_Changed__c,
                                                                         sec.Refcode_Index__c,
                                                                         null,
                                                                         null,
                                                                         sec.RecordType.Name));
            }
        }
        List<STEM_Extra_Cost__c> stemExtraCosts = [SELECT Id , Supplier__r.Name, Supplier__c, Supplier__r.Bank_Details__c, Unit_Cost__c,
                                                  Quantity__c, Quantity_Delivered_Per_BDN__c, Payment_Term__c, Product2Id__r.Name, Line_Total_Buy__c,
                                                  Supplier_Input__c, Supplier_Issued__c, RecordType.Name, Is_Purchase_CSV_Exported__c, Refcode_Index__c, 
                                                  Is_Purchase_CSV_Info_Changed__c, Is_Quantity_Range__c
                    							  FROM STEM_Extra_Cost__c WHERE STEM__c = :stemId AND RecordTypeId =: stemChargeRecordTypeId
                                                  AND Line_Total_Buy__c != 0 AND Line_Total_Buy__c != null AND Cancelled__c = false];
        for(STEM_Extra_Cost__c sec : stemExtraCosts){
            supplierInvoiceTemplates.add(new SupplierInvoiceTemplate(sec.Id,
                                                                     sec.Supplier__c,
                                                                     sec.Supplier__r.Name,
                                                                     sec.Supplier__r.Bank_Details__c,
                                                                     sec.Product2Id__r.Name,
                                                                     sec.Line_Total_Buy__c,
                                                                     sec.Is_Quantity_Range__c,
                                                                     sec.Quantity_Delivered_Per_BDN__c,
                                                                     null,
                                                                     sec.Payment_Term__c,
                                                                     sec.Supplier_Input__c,
                                                                     sec.Supplier_Issued__c,
                                                                     sec.Is_Purchase_CSV_Exported__c,
                                                                     sec.Is_Purchase_CSV_Info_Changed__c,
                                                                     sec.Refcode_Index__c,
                                                                     null,
                                                                     null,
                                                                     sec.RecordType.Name));
        }
        return supplierInvoiceTemplates;
    }
    
    @AuraEnabled
    public static List<SupplierInvoiceTemplate> getUncreatedSupplierInvoices(String stemId) {
        String stemChargeRecordTypeId = Schema.SObjectType.STEM_Extra_Cost__c.getRecordTypeInfosByName().get('STEM Charge').getRecordTypeId();
        Map<String, SupplierInvoiceTemplate> templatesBySupplierAndTerm = new Map<String, SupplierInvoiceTemplate>();
    
        List<STEM_Line_Item__c> stemLineItems = [
            SELECT Id, Original_Supplier__r.Name, Original_Supplier__c, Original_Supplier__r.Bank_Details__c,
                   QLIK_Total_Cost__c, Refcode_Index__c, BDN_Delivery_Date__c, Payment_Term__c,
                   Product__r.Name, Supplier_Input__c, Supplier_Issued__c, Is_Purchase_CSV_Exported__c,
                   Is_Purchase_CSV_Info_Changed__c, Partial_CIA__c, Partial_Lumpsum_Buy_At__c,
                   Is_Quantity_Range__c, Quantity_Delivered_Per_BDN__c, STEM__r.Expected_Delivery_Date__c,
                   (SELECT Id, Supplier__r.Name, Supplier__c, Supplier__r.Bank_Details__c, Unit_Cost__c,
                           Is_Purchase_CSV_Info_Changed__c, Quantity__c, Quantity_Delivered_Per_BDN__c,
                           Payment_Term__c, Product2Id__r.Name, QLIK_Total_Cost__c, Supplier_Input__c,
                           Supplier_Issued__c, RecordType.Name, Is_Purchase_CSV_Exported__c, Refcode_Index__c,
                    	   STEM__r.Expected_Delivery_Date__c
                    FROM STEM_Extra_Costs__r
                    WHERE STEM__c = :stemId
                      AND Line_Total_Buy__c != 0 AND Line_Total_Buy__c != null AND Cancelled__c = false)
            FROM STEM_Line_Item__c
            WHERE STEM__c = :stemId
              AND Cancelled__c = false AND Unit_Sell_At__c != 0 AND Supplier_Invoice__c = null
        ];
    
        for (STEM_Line_Item__c sli : stemLineItems) {
            addToGroup(templatesBySupplierAndTerm, sli.Original_Supplier__c, sli.Original_Supplier__r.Name, sli.Original_Supplier__r.Bank_Details__c, sli.STEM__r.Expected_Delivery_Date__c, sli.Payment_Term__c, sli.QLIK_Total_Cost__c);
            for (STEM_Extra_Cost__c sec : sli.STEM_Extra_Costs__r) {
                addToGroup(templatesBySupplierAndTerm, sec.Supplier__c, sec.Supplier__r.Name, sec.Supplier__r.Bank_Details__c, sec.STEM__r.Expected_Delivery_Date__c, sec.Payment_Term__c, sec.QLIK_Total_Cost__c);
            }
        }
    
        List<STEM_Extra_Cost__c> stemExtraCosts = [
            SELECT Id, Supplier__r.Name, Supplier__c, Supplier__r.Bank_Details__c, Unit_Cost__c,
                   Quantity__c, Quantity_Delivered_Per_BDN__c, Payment_Term__c, Product2Id__r.Name,
                   QLIK_Total_Cost__c, Supplier_Input__c, Supplier_Issued__c, RecordType.Name,
                   Is_Purchase_CSV_Exported__c, Refcode_Index__c, Is_Purchase_CSV_Info_Changed__c,
                   Is_Quantity_Range__c, STEM__r.Expected_Delivery_Date__c
            FROM STEM_Extra_Cost__c
            WHERE STEM__c = :stemId
              AND RecordTypeId = :stemChargeRecordTypeId
              AND Line_Total_Buy__c != 0 AND Line_Total_Buy__c != null
              AND Cancelled__c = false AND Supplier_Invoice__c = null
        ];
    
        for (STEM_Extra_Cost__c sec : stemExtraCosts) {
            addToGroup(templatesBySupplierAndTerm, sec.Supplier__c, sec.Supplier__r.Name, sec.Supplier__r.Bank_Details__c, sec.STEM__r.Expected_Delivery_Date__c, sec.Payment_Term__c, sec.QLIK_Total_Cost__c);
        }
    
        return templatesBySupplierAndTerm.values();
    }
    
    private static void addToGroup(Map<String, SupplierInvoiceTemplate> groupMap, String supplierId, String supplierName, String bankDetails, Date expectedDeliveryDate, String paymentTerm, Decimal totalCost) {
        String key = supplierId + '|' + paymentTerm;
        if (groupMap.containsKey(key)) {
            groupMap.get(key).totalCost += (totalCost ?? 0);
        } else {
            SupplierInvoiceTemplate template = new SupplierInvoiceTemplate();
            template.supplierId = supplierId;
            template.supplierName = supplierName;
            template.bankDetails = bankDetails;
            template.bdnDeliveryDate = expectedDeliveryDate;
            template.paymentTerm = paymentTerm;
            template.totalCost = totalCost ?? 0;
            groupMap.put(key, template);
        }
    }
    
    @AuraEnabled(cacheable=true)
    public static List<STEM_Line_Item__c> getCommissionInvoiceTemplates(String stemId) {
        return [SELECT Id, Original_Supplier__r.Name, Original_Supplier__c, Original_Supplier__r.Bank_Details__c, Total_Cost__c, STEM__c, STEM__r.Buyer_Broker__c,
          		STEM__r.Buyer_Broker__r.Name, Supplier_Broker__c, Supplier_Broker__r.Name, Suppliers_Brokers_Commission_Lumpsum__c, Buyers_Brokers_Commission_Lumpsum__c,
                QLIK_Buyer_Broker_Commission_Lumpsum__c, STEM__r.Buyer_Broker__r.Hidden_Broker__c, STEM__r.Buyer_Broker__r.Hidden_Broker_Company__c,
                STEM__r.Buyer_Broker__r.Hidden_Commission__c, Supplier_Broker__r.Hidden_Broker__c, Supplier_Broker__r.Hidden_Broker_Company__c,
                Supplier_Broker__r.Hidden_Commission__c, Product__r.Name, STEM__r.Buyer_Broker__r.Bank_Details__c, QLIK_Supplier_Broker_Commission_Lumpsum__c, 
                Supplier_Broker__r.Bank_Details__c, Is_Buyer_Purchase_Comm_Exported__c, Is_Supplier_Purchase_Comm_Exported__c, STEM__r.Buyer_Broker_Refcode_Index__c,
                Supplier_Broker_Refcode_Index__c, Is_Supplier_Purchase_Comm_Info_Changed__c, Is_Buyer_Purchase_Comm_Info_Changed__c, QLIK_Multiple_Broker_Commission_Lumpsum__c,
                (SELECT Id, Commission__c, Commission_Lumpsum__c, QLIK_Commission_Lumpsum__c, STEM_Buyer_Broker__c, STEM_Buyer_Broker__r.Buyer_Broker__c, STEM_Buyer_Broker__r.Buyer_Broker__r.Name, 
                 STEM_Buyer_Broker__r.Buyer_Broker__r.Hidden_Broker__c, STEM_Buyer_Broker__r.Buyer_Broker__r.Hidden_Broker_Company__c,
                 STEM_Buyer_Broker__r.Buyer_Broker__r.Hidden_Commission__c, STEM_Buyer_Broker__r.Buyer_Broker__r.Bank_Details__c, STEM_Buyer_Broker__r.Refcode_Index__c,
                 STEM_Buyer_Broker__r.Exported__c, STEM_Buyer_Broker__r.Is_CSV_Info_Changed__c
                 FROM STEM_Line_Item_Buyer_Brokers__r) 
                FROM STEM_Line_Item__c WHERE STEM__c = :stemId AND Cancelled__c = false 
               ];
    }
    
    @AuraEnabled
    public static List<Commission_Invoice__c> getCommissionInvoices(String stemId){
        return [SELECT Id, Name, Broker__c, Broker__r.Name, Broker__r.BDN_Company__c, Invoice_Amount__c, Calculated_Amount__c, STEM__c, STEM__r.KeyStem__c, STEM__r.Vessel__r.Name,
                STEM__r.Port__r.Name, Broker__r.Inactive_Suspended__c, Payable_Balance__c,
                (SELECT Id, Amount__c, Date__c, Account__c, Account__r.Name, Bank__c FROM Payments__r),
                (SELECT Id, ContentDocumentId FROM ContentDocumentLinks)
               FROM Commission_Invoice__c WHERE STEM__c =: stemId ORDER BY Broker__r.Name];
    }
    
    @AuraEnabled
    public static List<STEM_Extra_Cost__c> getExtraCostsBySupplier(String stemId, String supplierId){
        return [SELECT Id, Supplier__c, RecordType.Name, Line_Total_Buy__c
               FROM STEM_Extra_Cost__c WHERE STEM__c =: stemId AND Supplier__c =: supplierId];
    }

    @AuraEnabled
    public static List<STEM_Extra_Cost__c> getExtraCost(String stemId ,String stemLineItemId) {
        List<STEM_Extra_Cost__c> extraCostList = new List<STEM_Extra_Cost__c>();
        String recordTypeId = Schema.SObjectType.STEM_Extra_Cost__c.getRecordTypeInfosByName().get('STEM Charge').getRecordTypeId();
        if(stemLineItemId != null){
        	extraCostList = [SELECT Type__c, Unit_Price__c, Line_Total__c, Quantity__c, Unit_of_Measure__c, Cancelled__c,
                             Minimum_Sell_At__c,Minimum_Buy_At__c ,Unit_Cost__c , STEM_Line_Item__r.Quantity_Delivered_Per_BDN__c,
                         	 Supplier__c, Supplier__r.Name, Supplier__r.Inactive_Suspended__c, Supplier__r.BDN_Company__c, Fixed__c,Lumpsum_Price__c,
                             Lumpsum_Cost__c, STEM__c ,Product2Id__r.Name ,Product2Id__c, STEM_Line_Item__r.Quantity__c, Quantity_Delivered_Per_BDN__c, Payment_Term__c
                         FROM STEM_Extra_Cost__c WHERE STEM_Line_Item__c = :stemLineItemId AND STEM__c =:stemId ORDER BY Offer_Line_item__r.Opportunity_Line_Item__r.RefCode__c NULLS LAST, Offer_Line_item__r.CreatedDate NULLS LAST, CreatedDate];
       }else{
           extraCostList = [SELECT Cancelled__c, Type__c, Unit_Price__c, Line_Total__c , Quantity__c, Unit_of_Measure__c, Minimum_Sell_At__c,Minimum_Buy_At__c ,Unit_Cost__c, Supplier__c, Supplier__r.Name,
           Supplier__r.Inactive_Suspended__c, Fixed__c,Lumpsum_Price__c ,Lumpsum_Cost__c, STEM__c ,Product2Id__r.Name ,Product2Id__c ,Quantity_Delivered_Per_BDN__c, Payment_Term__c, Supplier__r.BDN_Company__c
           FROM STEM_Extra_Cost__c WHERE STEM__c = :stemId AND RecordTypeId = :recordTypeId ORDER BY Offer_Line_item__r.Opportunity_Line_Item__r.RefCode__c NULLS LAST, Offer_Line_item__r.CreatedDate NULLS LAST, CreatedDate];
       }
        return extraCostList;
    }
    
    @AuraEnabled
    public static void updateCanceledItems(List<Id> stemLineItemIds){
        List<STEM_Line_Item__c> stemLineItems = [SELECT Id, Cancelled__c, 
                                                 (SELECT Id, Cancelled__c FROM STEM_Extra_Costs__r),
                                                 (SELECT Id, Cancelled__c FROM Unofficial_Compensations__r)
                                                 FROM STEM_Line_Item__c WHERE ID IN: stemLineItemIds];
        List<STEM_Extra_Cost__c> stemExtraCostsToUpdate = new List<STEM_Extra_Cost__c>();
        List<Unofficial_Compensation__c> uocToUpdate = new List<Unofficial_Compensation__c>();
        for(STEM_Line_Item__c stemLineItem: stemLineItems){
            stemLineItem.Cancelled__c = !stemLineItem.Cancelled__c;
            for(STEM_Extra_Cost__c stemExtraCost: stemLineItem.STEM_Extra_Costs__r){
                stemExtraCost.Cancelled__c = !stemExtraCost.Cancelled__c;
                stemExtraCostsToUpdate.add(stemExtraCost);
            }
            for(Unofficial_Compensation__c uoc: stemLineItem.Unofficial_Compensations__r){
                uoc.Cancelled__c = !uoc.Cancelled__c;
                uocToUpdate.add(uoc);
            }
        }
        update stemLineItems;
        update stemExtraCostsToUpdate;
        update uocToUpdate;
    }
    
    @AuraEnabled
    public static void updateCanceledExtraCosts(List<Id> stemExtraCostIds){
        List<STEM_Extra_Cost__c> stemExtraCosts = [SELECT Id, Cancelled__c FROM STEM_Extra_Cost__c WHERE ID IN: stemExtraCostIds];
        for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts){
            stemExtraCost.Cancelled__c = !stemExtraCost.Cancelled__c;
        }
        update stemExtraCosts;
    }

    @AuraEnabled
    public static void insertStemExtraCosts(List<STEM_Extra_Cost__c> stemExtraCosts) {
        insert stemExtraCosts;
    }

	@AuraEnabled
    public static void upsertStemExtraCosts(List<STEM_Extra_Cost__c> stemExtraCosts) {
        upsert stemExtraCosts;
    }
    
    @AuraEnabled
    public static void updateAllStemExtraCosts(List<STEM_Extra_Cost__c> stemExtraCosts) {
        update stemExtraCosts;
    }
    
    @AuraEnabled
    public static void updateProductExtraCosts(String stemLineItemId){
        update [SELECT Id FROM STEM_Extra_Cost__c WHERE STEM_Line_Item__c =: stemLineItemId];
    }
    
    @AuraEnabled
    public static void updateCompensations(String stemLineItemId){
        STEM_Line_Item__c stemLineItem = [SELECT Id, Quantity_Delivered_Per_BDN__c FROM STEM_Line_Item__c WHERE Id =: stemLineItemId];
        List<Unofficial_Compensation__c> compensations = [SELECT Id, Quantity_Delivered_Per_BDN__c FROM Unofficial_Compensation__c WHERE STEM_Line_Item__c =: stemLineItemId];
        for(Unofficial_Compensation__c compensation: compensations){
            compensation.Quantity_Delivered_Per_BDN__c = stemLineItem.Quantity_Delivered_Per_BDN__c;
            system.debug(compensation.Quantity_Delivered_Per_BDN__c);
        }
        update compensations;
    }
    
    @AuraEnabled(cacheable=true)
    public static List<ProductInfo> getProductInfo(String stemId){
        STEM__c stem = [SELECT Id, Invoice_Status__c FROM STEM__c WHERE Id =: stemId];
        List<STEM_Line_Item__c> stemLineItems = [SELECT Id, Product__r.Name,  Input__c, Issued__c, Quantity__c, Quantity_Delivered_Per_BDN__c,
                                                 Unit_Sell_At__c, Unit_of_Measure__c, Total_Price__c, BDN_Delivery_Date__c,
                                                 (SELECT Id, Product2Id__r.Name, Supplier__c, Input__c, Issued__c, Line_Total__c 
                                                  FROM STEM_Extra_Costs__r
                                                  WHERE Line_Total__c != 0 AND Line_Total__c != null AND Cancelled__c = false
                                                  ORDER BY Offer_Line_item__r.CreatedDate NULLS LAST, CreatedDate)
                                                 FROM STEM_Line_Item__c WHERE STEM__c = :stemId AND Unit_Buy_At__c != 0 AND Cancelled__c = false
                                                 ORDER BY Offer_Line_item__r.Opportunity_Line_Item__r.RefCode__c NULLS LAST, Offer_Line_item__r.CreatedDate NULLS LAST, CreatedDate];
        List<ProductInfo> productInfo = new List<ProductInfo>();
        for(STEM_Line_Item__c sli : stemLineItems){
            productInfo.add(new ProductInfo(sli.Id, sli.Product__r.Name, sli.Input__c, sli.Issued__c, String.valueof(sli.Unit_Sell_At__c),
                                            sli.Quantity_Delivered_Per_BDN__c  != null ? sli.Quantity_Delivered_Per_BDN__c : sli.Quantity__c,
                                            sli.Unit_of_Measure__c, sli.Total_Price__c, sli.BDN_Delivery_Date__c, 'STEM_Line_Item__c'));
            for(STEM_Extra_Cost__c sec: sli.STEM_Extra_Costs__r){
                productInfo.add(new ProductInfo(sec.Id, sec.Product2Id__r.Name, sec.Input__c, sec.Issued__c, null, null, null, sec.Line_Total__c, null, 'STEM_Extra_Cost__c'));
            }
        }
        List<STEM_Extra_Cost__c> stemExtraCosts = [SELECT Id, Product2Id__r.Name, Issued__c, Input__c, Line_Total__c
                                                   FROM STEM_Extra_Cost__c
                                                   WHERE RecordType.Name = 'STEM Charge' AND STEM__c = :stemId AND Line_Total__c != 0
                                                   AND Line_Total__c != null AND Cancelled__c = false
                                                   ORDER BY Offer_Line_item__r.CreatedDate NULLS LAST, CreatedDate];
        for(STEM_Extra_Cost__c sec : stemExtraCosts){
            productInfo.add(new ProductInfo(sec.Id, sec.Product2Id__r.Name, sec.Input__c, sec.Issued__c, null, null, null, sec.Line_Total__c, null, 'STEM_Extra_Cost__c'));
        }
        return productInfo;
    }

    
    @AuraEnabled(cacheable=true)
    public static Last_Invoice_Form__c getLastInvoiceForm(String stemId){
        List<Last_Invoice_Form__c> lastInvoiceForms = [SELECT Id, Attn__c, Info_Text__c, Products__c, Inputs__c, Total__c, STEM__c,
                                                       Vessel_Text__c, Today_Date__c, Buyer_Name__c, Broker_Name__c, Address__c
                                                       FROM Last_Invoice_Form__c WHERE STEM__c =: stemId ORDER BY CreatedDate DESC];
        if(lastInvoiceForms.isEmpty()){
			return null;
        } else{
            return lastInvoiceForms[0];
        }
    }
    
    @AuraEnabled(cacheable=true)
    public static List<Invoice__c> getInvoices(String stemId){
		return [SELECT Id, Name, File__c, Invoice_Date__c, Deprecated__c, Sent__c, Amount__c,
                Delivery_Date__c, Invoice_Due_Date__c, Pumping_Completion_Date__c, Proforma__c
                FROM Invoice__c WHERE STEM__c =: stemId ORDER BY CreatedDate];
    }
    
    @AuraEnabled
    public static STEM__c getStemPayments(String stemId){
        Id receivableRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Receivable').getRecordTypeId();
        Id bankChargeRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Bank Charge').getRecordTypeId();
        Id writeOffRecordTypeId = Schema.SObjectType.Payment__c.getRecordTypeInfosByName().get('Write Off').getRecordTypeId();
        return [SELECT Id, Name, Invoice_Due_Date__c, Total_Invoice_Amount__c, Receivable_Balance__c, Account__c, PSPRS__c, QLIK_STEM_Line_Item_Total_Price__c, QLIK_Costs_Total_Price__c,
                (SELECT Id, Amount__c, Date__c, RecordTypeId, RecordType.Name
                 FROM Payments__r WHERE RecordTypeId =: receivableRecordTypeId OR RecordTypeId =: bankChargeRecordTypeId OR RecordTypeId =: writeOffRecordTypeId),
                (SELECT Id, QLIK_Total_Price__c FROM STEM_Line_Items__r WHERE Cancelled__c = false AND Buyer_Invoice__c = null),
                (SELECT Id, QLIK_Total_Price__c FROM STEM_Extra_Costs__r WHERE Cancelled__c = false AND Buyer_Invoice__c = null)
                FROM STEM__c WHERE Id =: stemId LIMIT 1];
    }
    
    @AuraEnabled(cacheable=true)
    public static List<ProductInfo> getStemLineItemsAndExtraCosts(String stemId){
        List<STEM_Line_Item__c> stemLineItems = [SELECT Id, Product__c, Product__r.Name,  Original_Supplier__c, Original_Supplier__r.Name, Unit_Buy_At__c, Unit_Sell_At__c,
                                                 Quantity_Delivered_Per_BDN__c, Quantity__c, Total_Price__c, Total_Cost__c, Unit_of_Measure__c, Commission_Cost__c,
                                                 Buyers_Brokers_Commission_Per_Unit__c, Suppliers_Brokers_Commission_Per_Unit__c,
                                                 Buyers_Brokers_Commission_Lumpsum__c, Suppliers_Brokers_Commission_Lumpsum__c,
                                                 (SELECT Id, Product2Id__c, Product2Id__r.Name, Product2Id__r.Family, Supplier__c, Supplier__r.Name, Unit_Cost__c, Unit_Price__c,
                                                  Quantity_Delivered_Per_BDN__c, Quantity__c, Line_Total__c, Line_Total_Buy__c, Fixed__c, Lumpsum_Cost__c, Lumpsum_Price__c,
                                                  Minimum_Buy_At__c, Minimum_Sell_At__c, Unit_of_Measure__c
                                                  FROM STEM_Extra_Costs__r WHERE RecordType.Name = 'Product Charge' ORDER BY Offer_Line_item__r.CreatedDate NULLS LAST, CreatedDate),
                                                 (SELECT Id, Consultant__c, Consultant__r.Name, Fee__c FROM Consultations__r),
                                                 (SELECT Id, STEM_Line_Item__c, STEM_Line_Item__r.Product__r.Id, STEM_Line_Item__r.Product__r.Name,
                                                  STEM_Buyer_Broker__c, STEM_Buyer_Broker__r.Buyer_Broker__r.Name, Commission__c, Commission_Lumpsum__c, STEM_Line_Item__r.Unit_of_Measure__c
                                                  FROM STEM_Line_Item_Buyer_Brokers__r)
                                                 FROM STEM_Line_Item__c WHERE STEM__c = :stemId AND Cancelled__c = false ORDER BY Offer_Line_item__r.Opportunity_Line_Item__r.RefCode__c NULLS LAST, Offer_Line_item__r.CreatedDate NULLS LAST, CreatedDate];
        List<ProductInfo> productInfo = new List<ProductInfo>();
        for(STEM_Line_Item__c sli : stemLineItems){
            productInfo.add(new ProductInfo(sli.Id,
                                            'Product',
                                            sli.Product__r.Id,
                                            sli.Product__r.Name,
                                            'US$ '+ sli.Unit_Buy_At__c + '/' + sli.Unit_of_Measure__c,
                                            'US$ '+ sli.Unit_Sell_At__c + '/' + sli.Unit_of_Measure__c,
                                            sli.Quantity_Delivered_Per_BDN__c != null ? sli.Quantity_Delivered_Per_BDN__c  : sli.Quantity__c,
                                            sli.Unit_of_Measure__c,
                                            sli.Total_Price__c - sli.Total_Cost__c));
            productInfo.add(new ProductInfo(sli.Id,
                                            'Commission',
                                            sli.Product__r.Id,
                                            sli.Product__r.Name,
                                            'US$ ' + ((sli.Buyers_Brokers_Commission_Per_Unit__c != null ? sli.Buyers_Brokers_Commission_Per_Unit__c : 0) + (sli.Suppliers_Brokers_Commission_Per_Unit__c != null ? sli.Suppliers_Brokers_Commission_Per_Unit__c : 0)) + '/' + sli.Unit_of_Measure__c,
                                            'US$ 0.00/' + sli.Unit_of_Measure__c,
                                            sli.Quantity_Delivered_Per_BDN__c != null ? sli.Quantity_Delivered_Per_BDN__c  : sli.Quantity__c,
                                            sli.Unit_of_Measure__c,
                                            -1 * ((sli.Buyers_Brokers_Commission_Lumpsum__c != null ? sli.Buyers_Brokers_Commission_Lumpsum__c : 0) + (sli.Suppliers_Brokers_Commission_Lumpsum__c != null ? sli.Suppliers_Brokers_Commission_Lumpsum__c : 0))));
            for(STEM_Line_Item_Buyer_Broker__c stemLineItemBuyerBroker: sli.STEM_Line_Item_Buyer_Brokers__r){
               productInfo.add(new ProductInfo(sli.Id,
                                           	  'Commission',
                                              sli.Product__r.Id,
                                              sli.Product__r.Name,
                                              'US$ ' + (stemLineItemBuyerBroker.Commission__c != null ? stemLineItemBuyerBroker.Commission__c : 0) + '/' + sli.Unit_of_Measure__c,
                                              'US$ 0.00/' + sli.Unit_of_Measure__c,
                                              sli.Quantity_Delivered_Per_BDN__c != null ? sli.Quantity_Delivered_Per_BDN__c  : sli.Quantity__c,
                                              sli.Unit_of_Measure__c,
                                              -1 * (stemLineItemBuyerBroker.Commission_Lumpsum__c != null ? stemLineItemBuyerBroker.Commission_Lumpsum__c : 0))); 
            }
            
            for(STEM_Extra_Cost__c sec: sli.STEM_Extra_Costs__r){
                productInfo.add(new ProductInfo(sec.Id,
                                                'Product Charge',
                                            	sec.Product2Id__c,
                                            	sec.Product2Id__r.Name,
                                            	sec.Fixed__c ? 'US$ ' + (sec.Lumpsum_Cost__c != null ? String.valueOf(sec.Lumpsum_Cost__c) : '0.00') + ' Lumpsum' : sec.Minimum_Buy_At__c != null ? 'US$ ' + (sec.Unit_Cost__c != null ? String.valueOf(sec.Unit_Cost__c) : '0.00') + '/' + sec.Unit_of_Measure__c + ' min US$ ' + sec.Minimum_Buy_At__c : 'US$ ' + (sec.Unit_Cost__c != null ? String.valueOf(sec.Unit_Cost__c) : '0.00') + '/' + sec.Unit_of_Measure__c,
												sec.Fixed__c ? 'US$ ' + (sec.Lumpsum_Price__c != null ? String.valueOf(sec.Lumpsum_Price__c) : '0.00') + ' Lumpsum' : sec.Minimum_Sell_At__c != null ? 'US$ ' + (sec.Unit_Price__c != null ? String.valueOf(sec.Unit_Price__c) : '0.00') + '/' + sec.Unit_of_Measure__c + ' min US$ ' + sec.Minimum_Sell_At__c : 'US$ ' + (sec.Unit_Price__c != null ? String.valueOf(sec.Unit_Price__c) : '0.00')  + '/' + sec.Unit_of_Measure__c,
                                            	sec.Quantity_Delivered_Per_BDN__c != null && !sec.Fixed__c ? sec.Quantity_Delivered_Per_BDN__c : sec.Quantity__c,
                                                sec.Unit_of_Measure__c,
                                            	sec.Line_Total__c - sec.Line_Total_Buy__c));
            }
            for(Consultation__c consultation: sli.Consultations__r){
                productInfo.add(new ProductInfo(consultation.Id,
                                                'Consultation Fee',
                                                sli.Product__r.Id,
                                                sli.Product__r.Name,
                                                'US$ ' + consultation.Fee__c + '/' + sli.Unit_of_Measure__c, 
                                                'US$ 0',
                                                sli.Quantity_Delivered_Per_BDN__c != null ? sli.Quantity_Delivered_Per_BDN__c : sli.Quantity__c,
                                                sli.Unit_of_Measure__c,
                                                sli.Quantity_Delivered_Per_BDN__c != null ? -consultation.Fee__c * sli.Quantity_Delivered_Per_BDN__c : -consultation.Fee__c * sli.Quantity__c));
            }
        }
        List<STEM_Extra_Cost__c> stemExtraCosts = [SELECT Id, Product2Id__c, Product2Id__r.Name, Supplier__c, Supplier__r.Name, Unit_Cost__c, Unit_Price__c,
                                                   Quantity_Delivered_Per_BDN__c, Quantity__c, Line_Total__c, Line_Total_Buy__c,  Fixed__c, Lumpsum_Cost__c, Lumpsum_Price__c,
                                                   Minimum_Buy_At__c, Minimum_Sell_At__c, Unit_Of_Measure__c
                                                   FROM STEM_Extra_Cost__c
                                                   WHERE RecordType.Name = 'STEM Charge' AND STEM__c = :stemId AND Cancelled__c = false ORDER BY Offer_Line_item__r.Opportunity_Line_Item__r.RefCode__c NULLS LAST, Offer_Line_item__r.CreatedDate NULLS LAST, CreatedDate];
        for(STEM_Extra_Cost__c sec : stemExtraCosts){
            productInfo.add(new ProductInfo(sec.Id,
                                            'STEM Charge',
                                            sec.Product2Id__c,
                                            sec.Product2Id__r.Name,
                                            sec.Fixed__c ? 'US$ ' + (sec.Lumpsum_Cost__c != null ? String.valueOf(sec.Lumpsum_Cost__c) : '0.00') + ' Lumpsum' : sec.Minimum_Buy_At__c != null ? 'US$ ' + (sec.Unit_Cost__c != null ? String.valueOf(sec.Unit_Cost__c) : '0.00') + '/' + sec.Unit_of_Measure__c + ' min US$ ' + sec.Minimum_Buy_At__c : 'US$ ' + (sec.Unit_Cost__c != null ? String.valueOf(sec.Unit_Cost__c) : '0.00') + '/' + sec.Unit_of_Measure__c,
											sec.Fixed__c ? 'US$ ' + (sec.Lumpsum_Price__c != null ? String.valueOf(sec.Lumpsum_Price__c) : '0.00') + ' Lumpsum' : sec.Minimum_Sell_At__c != null ? 'US$ ' + (sec.Unit_Price__c != null ? String.valueOf(sec.Unit_Price__c) : '0.00') + '/' + sec.Unit_of_Measure__c + ' min US$ ' + sec.Minimum_Sell_At__c : 'US$ ' + (sec.Unit_Price__c != null ? String.valueOf(sec.Unit_Price__c) : '0.00')  + '/' + sec.Unit_of_Measure__c,
                                            sec.Quantity_Delivered_Per_BDN__c != null && !sec.Fixed__c ? sec.Quantity_Delivered_Per_BDN__c : sec.Quantity__c,
                                            sec.Unit_Of_Measure__c,
                                            sec.Line_Total__c - sec.Line_Total_Buy__c));
        }
        for(Volume_Discount_Item__c volumeDiscountItem: [SELECT Id, Volume_Discount__c, Amount__c, Quantity__c FROM Volume_Discount_Item__c WHERE STEM__c =: stemId]){
            productInfo.add(new ProductInfo(volumeDiscountItem.Id,
                                            'Volume Discount',
                                            volumeDiscountItem.Volume_Discount__c,
                                            'VOLUME DISCOUNT',
                                            'US$ ' + volumeDiscountItem.Amount__c + ' Lumpsum',
                                            'US$ 0 Lumpsum',
                                            volumeDiscountItem.Quantity__c,
                                            'MT',
                                            volumeDiscountItem.Amount__c));
        }
        return productInfo;
    }
    
    @AuraEnabled
    public static void updateExtraCostExportedField(List<String> recordIds, String stemId){
        List<STEM_Extra_Cost__c> stemExtraCosts = [SELECT Id, Is_Purchase_CSV_Exported__c, Is_Purchase_CSV_Info_Changed__c, Refcode_Index__c, STEM__c, Supplier__c 
                                                   FROM STEM_Extra_Cost__c WHERE Id IN: recordIds];
        for(STEM_Line_Item__c currentStemLineItem: [SELECT Id, Is_Purchase_CSV_Exported__c, Is_Purchase_CSV_Info_Changed__c, Refcode_Index__c, STEM__c, Original_Supplier__c 
                                             FROM STEM_Line_Item__c WHERE STEM__c =: stemId
                                             AND Is_Purchase_CSV_Exported__c = true]){
        	for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts){
            	stemExtraCost.Is_Purchase_CSV_Exported__c = true;
                stemExtraCost.Is_Purchase_CSV_Info_Changed__c = true;
        	}
        }
        for(STEM_Extra_Cost__c currentStemExtraCost: [SELECT Id, Is_Purchase_CSV_Exported__c, Is_Purchase_CSV_Info_Changed__c, Refcode_Index__c, STEM__c, Supplier__c 
                                             FROM STEM_Extra_Cost__c WHERE STEM__c =: stemId
                                             AND Is_Purchase_CSV_Exported__c = true AND Id NOT IN: recordIds]){
        	for(STEM_Extra_Cost__c stemExtraCost: stemExtraCosts){
            	stemExtraCost.Is_Purchase_CSV_Exported__c = true;
                stemExtraCost.Is_Purchase_CSV_Info_Changed__c = true;
        	}
        }
        ContextManager.avoidSTEMExtraCostFiring = true;
        update stemExtraCosts;
        ContextManager.avoidSTEMExtraCostFiring = false;
    }
    
    public class SupplierInvoiceTemplate {
        @AuraEnabled
        public String id;
        @AuraEnabled
        public String supplierId;
        @AuraEnabled
        public String supplierName;
        @AuraEnabled
        public String bankDetails;
        @AuraEnabled
        public String productName;
        @AuraEnabled
        public Decimal totalCost;
        @AuraEnabled
        public Boolean isQuantityRange;
        @AuraEnabled
        public Decimal quantityDeliveredPerBDN;
        @AuraEnabled
        public Date bdnDeliveryDate;
        @AuraEnabled
        public String paymentTerm;
        @AuraEnabled
        public String input;
        @AuraEnabled
        public Boolean issued;
        @AuraEnabled
        public Boolean exported;
        @AuraEnabled
        public Boolean isChanged;
        @AuraEnabled
        public String refcodeIndex;
        @AuraEnabled
        public Boolean partialCIA;
        @AuraEnabled
        public Decimal partialAmount;
        @AuraEnabled
        public String objectType;
        
        public SupplierInvoiceTemplate(){
            
        }
        
        public SupplierInvoiceTemplate(String Id, String supplierId, String supplierName, String bankDetails, String productName, Decimal totalCost,
                                       Boolean isQuantityRange, Decimal quantityDeliveredPerBDN,
                                       Date bdnDeliveryDate, String paymentTerm, String input, Boolean issued, Boolean exported, Boolean isChanged,
                                       String refcodeIndex, Boolean partialCIA, Decimal partialAmount, String objectType){
            this.id = Id;
            this.supplierId = supplierId;
            this.supplierName = supplierName;
            this.productName = productName;
            this.bankDetails = bankDetails;
            this.totalCost = totalCost;
           	this.isQuantityRange = isQuantityRange;
            this.quantityDeliveredPerBDN = quantityDeliveredPerBDN;
            this.bdnDeliveryDate = bdnDeliveryDate;
            this.paymentTerm = paymentTerm;
            this.input = input;
            this.issued = issued;
            this.exported = exported;
            this.isChanged = isChanged;
            this.refcodeIndex = refcodeIndex;
            this.partialCIA = partialCIA;
            this.partialAmount = partialAmount;
            this.objectType = objectType;
        }
    }

    public class ProductInfo {
        @AuraEnabled
        public String id;
        @AuraEnabled
        public String type;
        @AuraEnabled
        public String productId;
        @AuraEnabled
        public String productName;
        @AuraEnabled
        public String supplierId;
        @AuraEnabled
        public String supplierName;
        @AuraEnabled
        public String input;
        @AuraEnabled
        public Boolean issued;
        @AuraEnabled
        public String unitBuyAt;
        @AuraEnabled
        public String unitSellAt;
        @AuraEnabled
        public Decimal quantity;
        @AuraEnabled
        public String unitOfMeasure;
        @AuraEnabled
        public Decimal profit;
        @AuraEnabled
        public Decimal total;
        @AuraEnabled
        public Date bdnDeliveryDate;
        @AuraEnabled
        public String objectName;
        
        public ProductInfo(String Id, String productName, String input, Boolean issued, String unitSellAt, Decimal quantity, String unitOfMeasure, Decimal total, Date bdnDeliveryDate, String objectName){
            this.id = Id;
            this.productName = productName;
            this.input = input;
            this.unitSellAt = unitSellAt;
            this.issued = issued;
            this.quantity = quantity;
            this.unitOfMeasure = unitOfMeasure;
            this.total = total;
            this.bdnDeliveryDate = bdnDeliveryDate;
            this.objectName = objectName;
        }
        
        public ProductInfo(String Id, String type, String productId, String productName, String unitBuyAt, String unitSellAt, Decimal quantity, String unitOfMeasure, Decimal profit){
            this.id = Id;
            this.type = type;
            this.productId = productId;
            this.productName = productName;
            this.unitBuyAt = unitBuyAt;
            this.unitSellAt = unitSellAt;
            this.quantity = quantity;
            this.unitOfMeasure = unitOfMeasure;
            this.profit = profit;
        }
    }
}
