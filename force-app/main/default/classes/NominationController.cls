public class NominationController {

	@AuraEnabled
	public static List<Nomination__c> getNominationTypesByOpportunityId(String enquiryId) {
		List<Nomination__c> nominationList =[SELECT Id, Name, Port__c, Port__r.Name, Account__c, Account__r.Chop_Type__c, Account__r.Inactive_Suspended__c,
                                             		Account__r.Name, Account__r.Default_Contact__c, Account__r.Default_Contact__r.Name, Account__r.Default_Contact__r.Salutation,
													RecordTypeId, RecordType.Name, Sent__c, Received__c, Remarks__c, Additional_File__c, Buyer_Confirmation__c,
                                             		STEM__r.Buyer_Broker__c, STEM__r.Buyer_Broker__r.Company_Code__c, STEM__r.Name, STEM__r.Invoice_Status__c,
													RefCode__c, Supplier_RefCode__c, Enquiry__c, File__c, Expected_Delivery_Date__c, STEM__c, Buyer_Supplier_Trader__c,
													PDF__c, Last_Saved_Inputs__c, Last_Saved_Remarks__c, Supplier_RefCode_Index__c, STEM__r.Buyer_Broker__r.Hidden_Broker__c,
                                             		STEM__r.Buyer_Broker__r.Hidden_Broker_Company__c, Account__r.Email_Confirmation__c, Account__r.Email_Nomination__c,
                                             		Account__r.Confirmation_Format__c, Account__r.Nomination_Format__c, BT_ST_Email_Address__c, Payment_Term__c, Account__r.Attn_Override__c, Account__r.Attn__c,
                                             		BT_ST_CC_Email_Address__c, BT_ST_Visible__c, Sanctions_Compliance_File__c, Replaced__c, Contact__c, Contact__r.Name, Contact__r.Salutation, Contact__r.Email,
													Buyer_Confirmation__r.File__c, Buyer_Confirmation__r.RefCode__c, Sent_Nomination__c, Sent_Email_Trustee__c, Additional_Subject__c
                                             	FROM Nomination__c WHERE Enquiry__c = :enquiryId AND Deprecated__c = false
												ORDER BY Expected_Delivery_Date__c ASC, RecordType.Name ASC, CreatedDate];
		return nominationList;
	}

	@AuraEnabled(cacheable=true)
	public static List<ContentVersion> getContentDocumentVersions(List<String> contentDocumentIds) {
		return [SELECT Id, ContentDocumentId, VersionNumber, Sent__c FROM ContentVersion WHERE ContentDocumentId IN :contentDocumentIds ORDER By VersionNumber];
	}
    /*
    @AuraEnabled
    public static void generateDocument(List<Nomination__c> nominations){
        Map<String, String> nominationIdAndRecordTypeToSTEMId = new Map<String, String>();
		for(Nomination__c nomination: nominations){
            nominationIdAndRecordTypeToStemId.put(nomination.Id + ',' + nomination.RecordTypeId, nomination.STEM__c);
        }
		VFPDFGenerator.generatePDFInNewContext(nominationIdAndRecordTypeToSTEMId);
    }
    */
    @AuraEnabled
    public static void generateDocument(String nominationId, String fileUrl, String fileName){
        Nomination__c nomination = [SELECT Id, RecordTypeId, STEM__c, File__c, Replaced__c, Sent__c FROM Nomination__c WHERE Id =: nominationId LIMIT 1];
        PageReference vfPage = null;
        String fileTitle;
        if (nomination.RecordTypeId == FCBStatic.NOMINATION_BUYER_RT_IT){
            vfPage = Page.ConfirmationToBuyer;
            fileTitle = 'ConfirmationToBuyer.pdf';
        } else if(nomination.RecordTypeId == FCBStatic.NOMINATION_SUPPLIER_RT_IT){
            vfPage = Page.NominationToSupplier;
            fileTitle = 'NominationToSupplier.pdf';
        }
    
        vfPage.getParameters().put('stemId', nomination.STEM__c);
        vfPage.getParameters().put('nominationId', nomination.Id);
    
        Blob body;
        if (!Test.isRunningTest()) {
            body = vfPage.getContentAsPDF(); 
        } else {
            body = Blob.valueOf('TestString');
        }
    
        saveGeneratedDocument(body, nomination, fileName);
    }
    
    @AuraEnabled
    public static void generateDocumentFromBlob(String body, String nominationId, String fileUrl, String fileName){
        Nomination__c nomination = [
            SELECT Id, File__c, Replaced__c, Sent__c
            FROM Nomination__c
            WHERE Id = :nominationId
            LIMIT 1
        ];
        saveGeneratedDocument(EncodingUtil.base64Decode(body), nomination, fileName);
    }

    private static void saveGeneratedDocument(Blob body, Nomination__c nomination, String fileName) {
        ContentVersion contentVersion = new ContentVersion(
            PathOnClient = '/' + fileName + '.pdf',
            Title = fileName + '.pdf',
            VersionData = body,
            Sent__c = false
        );

        Id contentDocumentId = getContentDocumentId(nomination.File__c);
        Boolean currentUserOwnsDocument = false;
        if (contentDocumentId != null) {
            ContentDocument existingDocument = [
                SELECT OwnerId
                FROM ContentDocument
                WHERE Id = :contentDocumentId
                LIMIT 1
            ];
            currentUserOwnsDocument = existingDocument.OwnerId == UserInfo.getUserId();
        }

        if (contentDocumentId == null || !currentUserOwnsDocument) {
            contentVersion.FirstPublishLocationId = nomination.Id;
            insert contentVersion;

            contentVersion = [
                SELECT Id, ContentDocumentId
                FROM ContentVersion
                WHERE Id = :contentVersion.Id
                LIMIT 1
            ];
            contentDocumentId = contentVersion.ContentDocumentId;
            nomination.File__c = URL.getSalesforceBaseUrl().toExternalForm() + '/' + contentDocumentId;
            if (nomination.Sent__c != '🔴') {
                nomination.Replaced__c = true;
            }
            update nomination;
        } else {
            contentVersion.ContentDocumentId = contentDocumentId;
            insert contentVersion;

            if (nomination.Sent__c != '🔴') {
                nomination.Replaced__c = true;
                update nomination;
            }
        }
    }

    private static Id getContentDocumentId(String fileUrl) {
        if (String.isBlank(fileUrl)) {
            return null;
        }

        List<String> parsedUrl = fileUrl.split('/');
        String candidateId = parsedUrl.get(parsedUrl.size() - 1);
        return candidateId != null && candidateId.startsWith('069')
            ? (Id) candidateId
            : null;
    }

    @AuraEnabled
    public static List<STEM__c> getStemItems(List<String> stemIds){
        return [SELECT Id, Invoice_Status__c,
                (SELECT Id, Original_Supplier__c, Original_Supplier__r.Name, Cancelled__c, Payment_Term__c FROM STEM_Line_Items__r WHERE Cancelled__c = false),
                (SELECT Id, Supplier__c, Supplier__r.Name, Cancelled__c, Product2Id__c, Product2Id__r.Name, Payment_Term__c FROM STEM_Extra_Costs__r WHERE Cancelled__c = false)
               FROM STEM__c WHERE Id IN: stemIds];
    }
    
    @AuraEnabled
    public static STEM__c getStemBuyerInfo(String stemId){
        return [SELECT Id, Account__r.Name, Contact__c, Contact__r.Name, Account__r.Payment_Terms__c, Account__r.Attn_Override__c, Account__r.Attn__c,
									Contact__r.Salutation, Vessel__r.Name, Vessel__r.IMO__c, Payment_Term__c,
                    				Port__r.Name, Port__r.Country__c, Port__r.Port_Area__c, Location_Details__c, Account__r.Chop_Type__c,
                    				Agent__c, ETA_ETB__c, Buyer_Broker__c, Buyer_Broker__r.Hidden_Broker__c, Buyer_Broker__r.Hidden_Broker_Company__c,
                                    ETA_Start_Date__c, ETA_Start_Time__c, ETA_End_Date__c, ETA_End_Time__c,
                                    ETB_Start_Date__c, ETB_Start_Time__c, ETB_End_Date__c, ETB_End_Time__c,
                                    ETD_Start_Date__c, ETD_Start_Time__c, ETD_End_Date__c, ETD_End_Time__c,
                                    ETCD_Start_Date__c, ETCD_Start_Time__c, ETCD_End_Date__c, ETCD_End_Time__c,
                					Expected_Delivery_Date__c, Buyer_Broker__r.Name, Buyer_Broker__r.Confirmation_Format__c,
                					Buyer_Broker__r.Attn_Override__c, Buyer_Broker__r.Attn__c, Buyer_Broker__r.Default_Contact__c, Buyer_Broker__r.Default_Contact__r.Name, 
                					Buyer_Broker__r.Default_Contact__r.Salutation, Partial_CIA__c, Partial_Lumpsum_Sell_At__c,
                					(SELECT Id, Product__r.Name, Quantity__c, Is_Quantity_Range__c, Quantity_Max__c,
                                        Unit_of_Measure__c, Unit_Sell_At__c, Hide_Buyers_Brokers_Commission__c,
                                        Original_Supplier__c, Original_Supplier__r.Name, Original_Supplier__r.BDN_Company__c, Supplier_Nomination__c, BDN_Company__c,
                                        Payment_Term__c, Offer_Line_Item__c,
                                        Buyers_Brokers_Commission_Per_Unit__c
									FROM STEM_Line_Items__r WHERE Cancelled__c = false ORDER BY Offer_Line_item__r.Opportunity_Line_Item__r.RefCode__c NULLS LAST, Offer_Line_item__r.CreatedDate NULLS LAST, CreatedDate),
                					(SELECT Id, STEM__r.Port__r.Name, Product2Id__r.Name, Quantity__c, Is_Quantity_Range__c, Quantity_Range_Max__c,
                                            STEM_Line_Item__r.Unit_of_Measure__c, Unit_Price__c, Minimum_Sell_At__c, Lumpsum_Price__c, RecordType.Name, STEM_Line_Item__c,
                                            Supplier__r.Name, Transportation_Included__c, Nundination_Type__c, Fixed__c, Unit_of_Measure__c, Line_Total__c
                                        FROM STEM_Extra_Costs__r WHERE Cancelled__c = false
                                     	ORDER BY Offer_Line_item__r.Opportunity_Line_Item__r.RefCode__c NULLS LAST, Offer_Line_item__r.CreatedDate NULLS LAST, CreatedDate)
							FROM STEM__c WHERE Id = :stemId LIMIT 1];
    }
    
    @AuraEnabled
    public static STEM__c getStemSupplierInfo(String stemId, String supplierId, String paymentTerm){
        return [SELECT Id, Account__r.Name, Contact__c, Contact__r.Name, Account__r.Payment_Terms__c,
									Contact__r.Salutation, Vessel__r.Name, Vessel__r.IMO__c, Payment_Term__c,
                    				Port__r.Name, Port__r.Country__c, Port__r.Port_Area__c, Account__r.Chop_Type__c,
                    				Agent__c, ETA_ETB__c, Location_Details__c,
                                    ETA_Start_Date__c, ETA_Start_Time__c, ETA_End_Date__c, ETA_End_Time__c,
                                    ETB_Start_Date__c, ETB_Start_Time__c, ETB_End_Date__c, ETB_End_Time__c,
                                    ETD_Start_Date__c, ETD_Start_Time__c, ETD_End_Date__c, ETD_End_Time__c,
                                    ETCD_Start_Date__c, ETCD_Start_Time__c, ETCD_End_Date__c, ETCD_End_Time__c,
                					Expected_Delivery_Date__c,
                					(SELECT Id, Product__r.Name, Quantity__c, Is_Quantity_Range__c, Quantity_Max__c,
                                        Unit_of_Measure__c, Unit_Buy_At__c, Hide_Buyers_Brokers_Commission__c,
                                        Original_Supplier__c, Original_Supplier__r.Name, Original_Supplier__r.BDN_Company__c, Supplier_Nomination__c, BDN_Company__c,
                                     	Original_Supplier__r.Attn_Override__c, Original_Supplier__r.Attn__c,
                                        Payment_Term__c, Offer_Line_Item__c, Supplier_Broker__c, Supplier_Broker__r.Hidden_Broker__c, Supplier_Broker__r.Hidden_Broker_Company__c,
                                        Buyers_Brokers_Commission_Per_Unit__c, Supplier_Broker__r.Name, Supplier_Broker__r.Nomination_Format__c, Intended_Payment_Date__c,
                                     	Supplier_Broker__r.Attn_Override__c, Supplier_Broker__r.Attn__c, Supplier_Broker__r.Default_Contact__c, Supplier_Broker__r.Default_Contact__r.Name,
                                     	Supplier_Broker__r.Default_Contact__r.Salutation, Partial_CIA__c, Partial_Lumpsum_Buy_At__c
									FROM STEM_Line_Items__r WHERE Original_Supplier__c =: supplierId AND Payment_Term__c =: paymentTerm AND Cancelled__c = false
                                    ORDER BY Offer_Line_item__r.Opportunity_Line_Item__r.RefCode__c NULLS LAST, Offer_Line_item__r.CreatedDate NULLS LAST, CreatedDate),
                					(SELECT Id, STEM__r.Port__r.Name, Product2Id__r.Name, Quantity__c, Is_Quantity_Range__c, Quantity_Range_Max__c, Payment_Term__c,
                                            STEM_Line_Item__r.Unit_of_Measure__c, Unit_Cost__c, Minimum_Buy_At__c, Lumpsum_Cost__c, RecordType.Name, STEM_Line_Item__c,
                                            Supplier__r.Name, Transportation_Included__c, Nundination_Type__c, Fixed__c, Unit_of_Measure__c, Line_Total_Buy__c,
                                     		STEM__r.ETA_ETB__c,
                                            STEM__r.ETA_Start_Date__c, STEM__r.ETA_Start_Time__c, STEM__r.ETA_End_Date__c, STEM__r.ETA_End_Time__c,
                                            STEM__r.ETB_Start_Date__c, STEM__r.ETB_Start_Time__c, STEM__r.ETB_End_Date__c, STEM__r.ETB_End_Time__c,
                                            STEM__r.ETD_Start_Date__c, STEM__r.ETD_Start_Time__c, STEM__r.ETD_End_Date__c, STEM__r.ETD_End_Time__c,
                                            STEM__r.ETCD_Start_Date__c, STEM__r.ETCD_Start_Time__c, STEM__r.ETCD_End_Date__c, STEM__r.ETCD_End_Time__c, Intended_Payment_Date__c
                                        FROM STEM_Extra_Costs__r WHERE Supplier__c =: supplierId AND Payment_Term__c =: paymentTerm AND Cancelled__c = false AND Line_Total_Buy__c != null AND Line_Total_Buy__c != 0
                                     ORDER BY Offer_Line_item__r.Opportunity_Line_Item__r.RefCode__c NULLS LAST, Offer_Line_item__r.CreatedDate NULLS LAST, CreatedDate)
							FROM STEM__c WHERE Id = :stemId LIMIT 1];
    }
    
    @AuraEnabled
    public static Payment_Term__c getPaymentTerm(String paymentTerm){
        return [SELECT Id, Name, Description__c FROM Payment_Term__c WHERE Name =: paymentTerm LIMIT 1];
    }
    
    @AuraEnabled
    public static List<Payment_Term__c> getSupplierPaymentTerms(List<String> paymentTerms){
        return [SELECT Id, Name, Description__c FROM Payment_Term__c WHERE Name IN: paymentTerms];
    }
    
    @AuraEnabled
    public static List<String> getConfirmationSpecialTerms(List<String> lineItemIds, String remarks, String enquiryId){
    
        List<Special_Terms_Link__c> specialtTermsLinks = [
            SELECT Enquiry_Special_Term__c
            FROM Special_Terms_Link__c
            WHERE STEM_Line_Item__c IN :lineItemIds 
               OR STEM_Extra_Cost__c IN :lineItemIds
        ];
        
        List<String> espIdsForQuery = new List<String>();
        for (Special_Terms_Link__c st : specialtTermsLinks) {
            espIdsForQuery.add(st.Enquiry_Special_Term__c);
        }
    
        List<Enquiry_Special_Term__c> enquirySpecialTermList = [
            SELECT 
                Special_Term__r.Name,
                Special_Term__r.Special_Remark_in_Confirmation__c,
            	Special_Term__r.Add_to_Confirmation__c
            FROM Enquiry_Special_Term__c 
            WHERE (Id IN :espIdsForQuery OR Enquiry__c = :enquiryId)
        ];
    
        List<String> specialTerms = new List<String>();
    
        for (Enquiry_Special_Term__c est : enquirySpecialTermList) {
    
            String name = est.Special_Term__r.Name;
            String remark = est.Special_Term__r.Special_Remark_in_Confirmation__c;
            Boolean addToConfirmation = est.Special_Term__r.Add_to_Confirmation__c;
    
            if (name != null && ((remark == null || remark.trim() == '') && addToConfirmation)) {
                specialTerms.add(name);
            }
    
            if (remark != null && remark.trim() != '') {
                List<String> remarkLines = remark.split('\\r?\\n');
            
                for (String line : remarkLines) {
                    if (line != null) {
                        specialTerms.add(line);
                    }
                }
            }
        }
    
        if (remarks != null && remarks != '') {
            specialTerms.add(remarks);
        }
    
        return specialTerms;
    }
    
    @AuraEnabled
    public static List<String> getNominationSpecialTerms(List<String> lineItemIds, String remarks, String enquiryId){
        List<Special_Terms_Link__c> specialtTermsLinks = [
            SELECT Enquiry_Special_Term__c
            FROM Special_Terms_Link__c
            WHERE STEM_Line_Item__c IN :lineItemIds 
               OR STEM_Extra_Cost__c IN :lineItemIds
        ];
        
        List<String> espIdsForQuery = new List<String>();
        for (Special_Terms_Link__c st : specialtTermsLinks) {
            espIdsForQuery.add(st.Enquiry_Special_Term__c);
        }
    
        List<Enquiry_Special_Term__c> enquirySpecialTermList = [
            SELECT 
                Special_Term__r.Name,
                Special_Term__r.Special_Remark_in_Nomination__c,
            	Special_Term__r.Add_to_Nomination__c
            FROM Enquiry_Special_Term__c 
            WHERE (Id IN :espIdsForQuery OR Enquiry__c = :enquiryId)
        ];
    
        List<String> specialTerms = new List<String>();
    
        for (Enquiry_Special_Term__c est : enquirySpecialTermList) {
    
            String name = est.Special_Term__r.Name;
            String remark = est.Special_Term__r.Special_Remark_in_Nomination__c;
            Boolean addToNomination = est.Special_Term__r.Add_to_Nomination__c;
    
            if (name != null && ((remark == null || remark.trim() == '') && addToNomination)) {
                specialTerms.add(name);
            }
            
            if (remark != null && remark.trim() != '') {
                List<String> remarkLines = remark.split('\\r?\\n');
            
                for (String line : remarkLines) {
                    if (line != null) {
                        specialTerms.add(line);
                    }
                }
            }
        }
    
        if (remarks != null && remarks != '') {
            specialTerms.add(remarks);
        }
    
        return specialTerms;
    }
    
    @AuraEnabled
    public static void updateSanctionsCompliance(String recordId, String documentId){
        Nomination__c nomination = [SELECT Id, Sanctions_Compliance_File__c FROM Nomination__c WHERE Id =: recordId];
        nomination.Sanctions_Compliance_File__c = URL.getSalesforceBaseUrl().toExternalForm() + '/' + documentId;
        update nomination;
    }
}
