public without sharing class FcosXeroContactSyncService {
    private static final Date MIN_DELIVERY_DATE = Date.newInstance(2025, 1, 1);
    private static final Integer MAX_RECORDS_PER_EVENT = 200;
    private static final String ALLOWED_ENDPOINT = 'https://fcos.fcuno.com/api/salesforce/contact-sync';

    @TestVisible private static Boolean enabledOverride;
    @TestVisible private static String endpointOverride;
    @TestVisible private static String signingSecretOverride;
    @TestVisible private static String timestampOverride;
    @TestVisible private static String eventIdOverride;

    public class SourceRecord {
        public String objectApiName;
        public String recordId;
        public String fieldName;
        public String accountId;
        public String operation;
    }

    private class Config {
        Boolean enabled = false;
        String endpoint;
        String signingSecret;

        Boolean isReady() {
            return enabled == true
                && !String.isBlank(endpoint)
                && endpoint == ALLOWED_ENDPOINT
                && !String.isBlank(signingSecret)
                && !signingSecret.startsWith('__');
        }
    }

    public static void enqueueForOpportunities(List<Opportunity> rows, Map<Id, Opportunity> oldMap) {
        if (ContextManager.skipTriggers || ContextManager.avoidEnquiryFiring) return;
        if (!currentConfig().isReady()) return;
        List<SourceRecord> records = new List<SourceRecord>();
        Set<String> seen = new Set<String>();
        for (Opportunity row : rows) {
            if (!qualifiesDate(row.CloseDate)) continue;
            collectChangedLookup(records, seen, row, oldMap == null ? null : oldMap.get(row.Id), 'Opportunity', 'AccountId');
        }
        enqueue(records);
    }

    public static void enqueueForQuotes(List<Quote> rows, Map<Id, Quote> oldMap) {
        if (ContextManager.skipTriggers || ContextManager.avoidQuoteFiring) return;
        if (!currentConfig().isReady()) return;
        Map<Id, Boolean> eligibleEnquiries = eligibleOpportunityIds(opportunityIds(rows, 'OpportunityId'));
        List<SourceRecord> records = new List<SourceRecord>();
        Set<String> seen = new Set<String>();
        for (Quote row : rows) {
            if (!eligibleEnquiries.containsKey((Id) row.get('OpportunityId'))) continue;
            SObject oldRow = oldMap == null ? null : oldMap.get(row.Id);
            collectChangedLookup(records, seen, row, oldRow, 'Quote', 'AccountId');
            collectChangedLookup(records, seen, row, oldRow, 'Quote', 'Quote_Buyer__c');
            collectChangedLookup(records, seen, row, oldRow, 'Quote', 'Broker__c');
        }
        enqueue(records);
    }

    public static void enqueueForBrokerEnquiries(List<Broker_Enquiry__c> rows, Map<Id, Broker_Enquiry__c> oldMap) {
        if (ContextManager.skipTriggers || ContextManager.avoidEnquiryBrokerFiring) return;
        if (!currentConfig().isReady()) return;
        Map<Id, Boolean> eligibleEnquiries = eligibleOpportunityIds(parentIds(brokerEnquiriesAsSObjects(rows), 'Enquiry__c'));
        List<SourceRecord> records = new List<SourceRecord>();
        Set<String> seen = new Set<String>();
        for (Broker_Enquiry__c row : rows) {
            if (!eligibleEnquiries.containsKey((Id) row.get('Enquiry__c'))) continue;
            SObject oldRow = oldMap == null ? null : oldMap.get(row.Id);
            collectChangedLookup(records, seen, row, oldRow, 'Broker_Enquiry__c', 'Buyer__c');
            collectChangedLookup(records, seen, row, oldRow, 'Broker_Enquiry__c', 'Broker__c');
        }
        enqueue(records);
    }

    public static void enqueueForSupplierBids(List<Supplier_Bid__c> rows, Map<Id, Supplier_Bid__c> oldMap) {
        if (ContextManager.skipTriggers || ContextManager.avoidSupplierBidRecursion) return;
        if (!currentConfig().isReady()) return;
        Map<Id, Boolean> eligibleEnquiries = eligibleOpportunityIds(parentIds(supplierBidsAsSObjects(rows), 'Enquiry__c'));
        List<SourceRecord> records = new List<SourceRecord>();
        Set<String> seen = new Set<String>();
        for (Supplier_Bid__c row : rows) {
            if (!eligibleEnquiries.containsKey((Id) row.get('Enquiry__c'))) continue;
            SObject oldRow = oldMap == null ? null : oldMap.get(row.Id);
            collectChangedLookup(records, seen, row, oldRow, 'Supplier_Bid__c', 'Supplier__c');
            collectChangedLookup(records, seen, row, oldRow, 'Supplier_Bid__c', 'Suppliers_Broker__c');
        }
        enqueue(records);
    }

    public static void enqueueForStems(List<STEM__c> rows, Map<Id, STEM__c> oldMap) {
        if (ContextManager.skipTriggers || ContextManager.avoidStemRecursion) return;
        if (!currentConfig().isReady()) return;
        List<SourceRecord> records = new List<SourceRecord>();
        Set<String> seen = new Set<String>();
        for (STEM__c row : rows) {
            if (!qualifiesStem(row)) continue;
            SObject oldRow = oldMap == null ? null : oldMap.get(row.Id);
            collectChangedLookup(records, seen, row, oldRow, 'STEM__c', 'Account__c');
            collectChangedLookup(records, seen, row, oldRow, 'STEM__c', 'Buyer_Broker__c');
        }
        enqueue(records);
    }

    public static void enqueueForStemLineItems(List<STEM_Line_Item__c> rows, Map<Id, STEM_Line_Item__c> oldMap) {
        if (ContextManager.skipTriggers || ContextManager.avoidSTEMLineItemFiring) return;
        if (!currentConfig().isReady()) return;
        Map<Id, Boolean> eligibleStems = eligibleStemIds(parentIds(stemLineItemsAsSObjects(rows), 'STEM__c'));
        List<SourceRecord> records = new List<SourceRecord>();
        Set<String> seen = new Set<String>();
        for (STEM_Line_Item__c row : rows) {
            if (!eligibleStems.containsKey((Id) row.get('STEM__c'))) continue;
            SObject oldRow = oldMap == null ? null : oldMap.get(row.Id);
            collectChangedLookup(records, seen, row, oldRow, 'STEM_Line_Item__c', 'Original_Supplier__c');
            collectChangedLookup(records, seen, row, oldRow, 'STEM_Line_Item__c', 'Substitute_Supplier__c');
            collectChangedLookup(records, seen, row, oldRow, 'STEM_Line_Item__c', 'Buyers_Broker__c');
            collectChangedLookup(records, seen, row, oldRow, 'STEM_Line_Item__c', 'Supplier_Broker__c');
        }
        enqueue(records);
    }

    public static void enqueueForStemExtraCosts(List<STEM_Extra_Cost__c> rows, Map<Id, STEM_Extra_Cost__c> oldMap) {
        if (ContextManager.skipTriggers || ContextManager.avoidSTEMExtraCostFiring) return;
        if (!currentConfig().isReady()) return;
        Map<Id, Boolean> eligibleStems = eligibleStemIds(parentIds(stemExtraCostsAsSObjects(rows), 'STEM__c'));
        List<SourceRecord> records = new List<SourceRecord>();
        Set<String> seen = new Set<String>();
        for (STEM_Extra_Cost__c row : rows) {
            if (!eligibleStems.containsKey((Id) row.get('STEM__c'))) continue;
            collectChangedLookup(records, seen, row, oldMap == null ? null : oldMap.get(row.Id), 'STEM_Extra_Cost__c', 'Supplier__c');
        }
        enqueue(records);
    }

    public static void enqueueForVariableChargeSuppliers(List<STEM_Variable_Charge_Supplier__c> rows, Map<Id, STEM_Variable_Charge_Supplier__c> oldMap) {
        if (ContextManager.skipTriggers) return;
        if (!currentConfig().isReady()) return;
        Map<Id, Boolean> eligibleStems = eligibleStemIds(parentIds(variableChargeSuppliersAsSObjects(rows), 'STEM__c'));
        List<SourceRecord> records = new List<SourceRecord>();
        Set<String> seen = new Set<String>();
        for (STEM_Variable_Charge_Supplier__c row : rows) {
            if (!eligibleStems.containsKey((Id) row.get('STEM__c'))) continue;
            collectChangedLookup(records, seen, row, oldMap == null ? null : oldMap.get(row.Id), 'STEM_Variable_Charge_Supplier__c', 'Supplier__c');
        }
        enqueue(records);
    }

    public static void enqueueForStemBuyerBrokers(List<STEM_Buyer_Broker__c> rows, Map<Id, STEM_Buyer_Broker__c> oldMap) {
        if (ContextManager.skipTriggers) return;
        if (!currentConfig().isReady()) return;
        Map<Id, Boolean> eligibleStems = eligibleStemIds(parentIds(stemBuyerBrokersAsSObjects(rows), 'STEM__c'));
        List<SourceRecord> records = new List<SourceRecord>();
        Set<String> seen = new Set<String>();
        for (STEM_Buyer_Broker__c row : rows) {
            if (!eligibleStems.containsKey((Id) row.get('STEM__c'))) continue;
            collectChangedLookup(records, seen, row, oldMap == null ? null : oldMap.get(row.Id), 'STEM_Buyer_Broker__c', 'Buyer_Broker__c');
        }
        enqueue(records);
    }

    private static void collectChangedLookup(List<SourceRecord> records, Set<String> seen, SObject row, SObject oldRow, String objectApiName, String fieldName) {
        Object value = safeGet(row, fieldName);
        if (value == null) return;
        String accountId = String.valueOf(value);
        if (String.isBlank(accountId)) return;
        String oldAccountId = oldRow == null ? null : String.valueOf(safeGet(oldRow, fieldName));
        if (oldRow != null && accountId == oldAccountId) return;

        SourceRecord record = new SourceRecord();
        record.objectApiName = objectApiName;
        record.recordId = String.valueOf(row.get('Id'));
        record.fieldName = fieldName;
        record.accountId = accountId;
        record.operation = oldRow == null ? 'insert' : 'update';
        String key = record.objectApiName + ':' + record.recordId + ':' + record.fieldName + ':' + record.accountId;
        if (seen.contains(key)) return;
        seen.add(key);
        records.add(record);
    }

    private static Object safeGet(SObject row, String fieldName) {
        try {
            return row == null ? null : row.get(fieldName);
        } catch (Exception ignored) {
            return null;
        }
    }

    private static Set<Id> parentIds(List<SObject> rows, String fieldName) {
        Set<Id> ids = new Set<Id>();
        for (SObject row : rows) {
            Object value = safeGet(row, fieldName);
            if (value != null) ids.add((Id) value);
        }
        return ids;
    }

    private static List<SObject> brokerEnquiriesAsSObjects(List<Broker_Enquiry__c> rows) {
        List<SObject> result = new List<SObject>();
        if (rows != null) for (Broker_Enquiry__c row : rows) result.add(row);
        return result;
    }

    private static List<SObject> supplierBidsAsSObjects(List<Supplier_Bid__c> rows) {
        List<SObject> result = new List<SObject>();
        if (rows != null) for (Supplier_Bid__c row : rows) result.add(row);
        return result;
    }

    private static List<SObject> stemLineItemsAsSObjects(List<STEM_Line_Item__c> rows) {
        List<SObject> result = new List<SObject>();
        if (rows != null) for (STEM_Line_Item__c row : rows) result.add(row);
        return result;
    }

    private static List<SObject> stemExtraCostsAsSObjects(List<STEM_Extra_Cost__c> rows) {
        List<SObject> result = new List<SObject>();
        if (rows != null) for (STEM_Extra_Cost__c row : rows) result.add(row);
        return result;
    }

    private static List<SObject> variableChargeSuppliersAsSObjects(List<STEM_Variable_Charge_Supplier__c> rows) {
        List<SObject> result = new List<SObject>();
        if (rows != null) for (STEM_Variable_Charge_Supplier__c row : rows) result.add(row);
        return result;
    }

    private static List<SObject> stemBuyerBrokersAsSObjects(List<STEM_Buyer_Broker__c> rows) {
        List<SObject> result = new List<SObject>();
        if (rows != null) for (STEM_Buyer_Broker__c row : rows) result.add(row);
        return result;
    }

    private static Set<Id> opportunityIds(List<Quote> rows, String fieldName) {
        Set<Id> ids = new Set<Id>();
        for (Quote row : rows) {
            Object value = safeGet(row, fieldName);
            if (value != null) ids.add((Id) value);
        }
        return ids;
    }

    private static Map<Id, Boolean> eligibleOpportunityIds(Set<Id> opportunityIds) {
        Map<Id, Boolean> result = new Map<Id, Boolean>();
        if (opportunityIds.isEmpty()) return result;
        for (Opportunity row : [SELECT Id, CloseDate FROM Opportunity WHERE Id IN :opportunityIds]) {
            if (qualifiesDate(row.CloseDate)) result.put(row.Id, true);
        }
        return result;
    }

    private static Map<Id, Boolean> eligibleStemIds(Set<Id> stemIds) {
        Map<Id, Boolean> result = new Map<Id, Boolean>();
        if (stemIds.isEmpty()) return result;
        for (STEM__c row : [SELECT Id, Delivery_Date__c, Expected_Delivery_Date__c FROM STEM__c WHERE Id IN :stemIds]) {
            if (qualifiesStem(row)) result.put(row.Id, true);
        }
        return result;
    }

    private static Boolean qualifiesStem(STEM__c row) {
        return qualifiesDate((Date) safeGet(row, 'Delivery_Date__c'))
            || qualifiesDate((Date) safeGet(row, 'Expected_Delivery_Date__c'));
    }

    private static Boolean qualifiesDate(Date value) {
        return value != null && value >= MIN_DELIVERY_DATE;
    }

    private static void enqueue(List<SourceRecord> records) {
        if (records.isEmpty()) return;
        Config config = currentConfig();
        if (!config.isReady()) return;
        if (Limits.getQueueableJobs() >= Limits.getLimitQueueableJobs()) return;
        if (records.size() > MAX_RECORDS_PER_EVENT) {
            records = firstRecords(records, MAX_RECORDS_PER_EVENT);
        }
        System.enqueueJob(new ContactSyncQueueable(config.endpoint, config.signingSecret, records));
    }

    private static List<SourceRecord> firstRecords(List<SourceRecord> records, Integer limitSize) {
        List<SourceRecord> result = new List<SourceRecord>();
        for (Integer index = 0; index < records.size() && index < limitSize; index++) {
            result.add(records[index]);
        }
        return result;
    }

    private static Config currentConfig() {
        Config config = new Config();
        Xero_Contact_Sync_Setting__c setting = Xero_Contact_Sync_Setting__c.getOrgDefaults();
        config.enabled = enabledOverride == null ? setting != null && setting.Enabled__c == true : enabledOverride;
        config.endpoint = endpointOverride == null && setting != null ? setting.Endpoint__c : endpointOverride;
        config.signingSecret = signingSecretOverride == null && setting != null ? setting.Signing_Secret__c : signingSecretOverride;
        return config;
    }

    private class ContactSyncQueueable implements Queueable, Database.AllowsCallouts {
        private String endpoint;
        private String signingSecret;
        private List<SourceRecord> records;

        ContactSyncQueueable(String endpoint, String signingSecret, List<SourceRecord> records) {
            this.endpoint = endpoint;
            this.signingSecret = signingSecret;
            this.records = new List<SourceRecord>();
            this.records.addAll(records);
        }

        public void execute(QueueableContext context) {
            try {
                sendWebhook(endpoint, signingSecret, records);
            } catch (Exception error) {
                System.debug(LoggingLevel.WARN, 'FCOS Xero contact sync webhook failed: ' + error.getMessage());
            }
        }
    }

    @TestVisible private static HttpResponse sendWebhook(String endpoint, String signingSecret, List<SourceRecord> records) {
        String eventId = String.isBlank(eventIdOverride)
            ? UserInfo.getOrganizationId() + '-' + String.valueOf(System.now().getTime()) + '-' + String.valueOf(Math.abs(Crypto.getRandomInteger()))
            : eventIdOverride;
        String timestamp = String.isBlank(timestampOverride)
            ? System.now().formatGmt('yyyy-MM-dd\'T\'HH:mm:ss.SSS\'Z\'')
            : timestampOverride;
        String body = JSON.serialize(new Map<String, Object>{
            'eventId' => eventId,
            'source' => 'salesforce-trigger',
            'records' => records
        });
        String signature = EncodingUtil.convertToHex(Crypto.generateMac(
            'HmacSHA256',
            Blob.valueOf(timestamp + '.' + eventId + '.' + body),
            Blob.valueOf(signingSecret)
        ));

        HttpRequest request = new HttpRequest();
        request.setEndpoint(endpoint);
        request.setMethod('POST');
        request.setTimeout(10000);
        request.setHeader('Content-Type', 'application/json');
        request.setHeader('Accept', 'application/json');
        request.setHeader('x-salesforce-org-id', UserInfo.getOrganizationId());
        request.setHeader('x-salesforce-contact-sync-event-id', eventId);
        request.setHeader('x-salesforce-contact-sync-timestamp', timestamp);
        request.setHeader('x-salesforce-contact-sync-signature', signature);
        request.setBody(body);
        HttpResponse response = new Http().send(request);
        if (response.getStatusCode() >= 500) {
            System.debug(LoggingLevel.WARN, 'FCOS Xero contact sync webhook returned ' + response.getStatus());
        }
        return response;
    }
}
