public class ContractsFillingProcessingController {
	@AuraEnabled
    public static List<Nomination__c> getContracts(String accountFilter, String stemFilter, Date startDate, Date endDate, Integer pageSize, Integer offsetSize){
        accountFilter = accountFilter != null ? '%' + accountFilter + '%' : '%%';
        stemFilter = stemFilter != null ? '%' + stemFilter + '%' : '%%';
        Set<Id> confirmationIds = new Set<Id>();
        Map<Id, Nomination__c> nominations = new Map<Id, Nomination__c>(
            							  [SELECT Id, Buyer_Confirmation__c
                                           FROM Nomination__c 
                                           WHERE RecordTypeId =: FCBStatic.SUPPLIER_NOMINATION_RT_ID AND Deprecated__c = false 
                						   AND STEM__r.Name LIKE: stemFilter AND Account__r.Name LIKE: accountFilter AND STEM__c != null 
                                           AND ((STEM__r.Delivery_Date__c = null AND STEM__r.Expected_Delivery_Date__c >: startDate AND STEM__r.Expected_Delivery_Date__c <: endDate) 
                                                OR (STEM__r.Delivery_Date__c >: startDate AND STEM__r.Delivery_Date__c <: endDate))
                                           ORDER BY CreatedDate DESC
                                           LIMIT :pageSize
        								   OFFSET :offsetSize
                                          ]
        );
        for(Nomination__c nomination: nominations.values()){
            confirmationIds.add(nomination.Buyer_Confirmation__c);
        }
        return [SELECT Id, Name, PDF__c, Sent__c, Received__c, Account__c, Account__r.Name, STEM__c, STEM__r.Name, STEM__r.Port__c, STEM__r.Port__r.Name, STEM__r.Vessel__c, STEM__r.Vessel__r.Name,
                STEM__r.Vessel__r.IMO__c, STEM__r.Expected_Delivery_Date__c, STEM__r.Delivery_Date__c, RecordTypeId, RecordType.Name, Supplier_RefCode__c, RefCode__c, File__c,
                (SELECT Id, ContentDocument.Id, ContentDocument.Title FROM ContentDocumentLinks ORDER BY ContentDocument.LastModifiedDate DESC),
                (SELECT Id, PDF__c, Sent__c, Received__c, Name, Account__c, Account__r.Name, STEM__c, STEM__r.Name, STEM__r.Port__c, STEM__r.Port__r.Name, STEM__r.Vessel__c, STEM__r.Vessel__r.Name,
                 STEM__r.Expected_Delivery_Date__c, STEM__r.Delivery_Date__c, RecordTypeId, RecordType.Name, Supplier_RefCode__c, RefCode__c, File__c,
                 (SELECT Id, ContentDocument.Id, ContentDocument.Title FROM ContentDocumentLinks WHERE ContentDocument.Title LIKE '%CON S%'  ORDER BY ContentDocument.LastModifiedDate DESC)
                 	FROM SupplierNominations__r WHERE Account__r.Name LIKE: accountFilter AND Deprecated__c = false)
                FROM Nomination__c
                WHERE RecordTypeId =: FCBStatic.BUYER_NOMINATION_RT_ID AND Deprecated__c = false 
                AND ((STEM__r.Name LIKE: stemFilter AND Account__r.Name LIKE: accountFilter AND STEM__c != null
                AND ((STEM__r.Delivery_Date__c = null AND STEM__r.Expected_Delivery_Date__c >: startDate AND STEM__r.Expected_Delivery_Date__c <: endDate) OR (STEM__r.Delivery_Date__c >: startDate AND STEM__r.Delivery_Date__c <: endDate)))
                    OR Id IN: confirmationIds)
               ORDER BY CreatedDate DESC LIMIT :pageSize OFFSET :offsetSize];
    }
    
    @AuraEnabled
    public static void runVesselUpload(String vesselsJson) {
        String token = getUploadToken();
        
        HttpRequest req = new HttpRequest();
        req.setEndpoint('https://fcbhk.org/api/movement');
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('Authorization', 'Bearer ' + token);
        req.setBody(vesselsJson);

        try {
            Http http = new Http();
            HttpResponse res = http.send(req);

            if (res.getStatusCode() == 401) {
                throw new CalloutException('Unauthorized - check API key');
            }
            if (res.getStatusCode() == 429) {
                throw new CalloutException('Already running - please wait');
            }
            if (res.getStatusCode() == 500) {
                throw new CalloutException('Server error: ' + res.getBody());
            }

        } catch (CalloutException e) {
            if (e.getMessage() != 'Read timed out') {
                throw new AuraHandledException(e.getMessage());
            }
        }
    }
    
    @AuraEnabled
    public static void runCompanyUpload(String vesselsJson) {
        String token = getUploadToken();
        
        HttpRequest req = new HttpRequest();
        req.setEndpoint('https://fcbhk.org/api/company');
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('Authorization', 'Bearer ' + token);
        req.setBody(vesselsJson);

        try {
            Http http = new Http();
            HttpResponse res = http.send(req);

            if (res.getStatusCode() == 401) {
                throw new CalloutException('Unauthorized - check API key');
            }
            if (res.getStatusCode() == 429) {
                throw new CalloutException('Already running - please wait');
            }
            if (res.getStatusCode() == 500) {
                throw new CalloutException('Server error: ' + res.getBody());
            }

        } catch (CalloutException e) {
            if (e.getMessage() != 'Read timed out') {
                throw new AuraHandledException(e.getMessage());
            }
        }
    }

    private static String getUploadToken() {
        Upload_Vessel_Report__mdt config = Upload_Vessel_Report__mdt.getInstance('Bearer_Token');
        if (config == null || String.isBlank(config.Token__c)) {
            throw new AuraHandledException('Upload configuration is unavailable.');
        }
        return config.Token__c;
    }
}
