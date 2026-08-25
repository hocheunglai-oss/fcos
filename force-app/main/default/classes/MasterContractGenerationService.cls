public without sharing class MasterContractGenerationService {
    public class MasterContractException extends Exception {}

    public class ProductTerm {
        public String productKey;
        public String productName;
        public Id salesforceProductId;
        public String uom;
    }
    public class DeliveryProduct {
        public String productKey;
        public String contractLineKey;
        public Decimal quantityMin;
        public Decimal quantityMax;
    }
    public class ChargeRule {
        public String chargeKey;
        public Id salesforceProductId;
        public Id supplierAccountId;
        public String chargeName;
        public String appliesWhen;
        public Decimal fixedCost;
        public Decimal fixedSell;
    }
    public class VariableCharges {
        public String mode;
        public List<Id> supplierIds;
    }
    public class Delivery {
        public String deliveryKey;
        public Integer sequence;
        public String vesselName;
        public String vesselImo;
        public Id vesselId;
        public Id portId;
        public String portName;
        public Date preliminaryEta;
        public String supplyLocation;
        public String buyerPaymentTerm;
        public String supplierPaymentTerm;
        public List<Id> variableChargeSupplierIds;
        public List<DeliveryProduct> products;
    }
    public class CreateRequest {
        public String idempotencyKey;
        public String requestHash;
        public String contractKey;
        public String contractTitle;
        public Id buyerAccountId;
        public Id supplierAccountId;
        public String ownerEmail;
        public String buyerPic;
        public List<ProductTerm> products;
        public List<ChargeRule> chargeRules;
        public VariableCharges variableCharges;
        public List<Delivery> deliveries;
    }
    public class PriceRequest {
        public String idempotencyKey;
        public String requestHash;
        public Id lineItemId;
        public String contractLineKey;
        public Decimal buyPrice;
        public Decimal sellPrice;
        public Date benchmarkDate;
        public String benchmarkCode;
        public Decimal benchmarkValue;
        public Date supplierPricingDate;
        public Date buyerPricingDate;
        public Decimal supplierBenchmarkValue;
        public Decimal buyerBenchmarkValue;
        public String pricingPosition;
        public Decimal buyUnrounded;
        public Decimal sellUnrounded;
        public String evidenceHash;
    }
    public class LinkEvidence {
        public String deliveryKey;
        public String entityType;
        public String externalKey;
        public Id salesforceId;
        public Datetime lastModifiedAt;
        public LinkEvidence(String deliveryKey, String entityType, String externalKey, Id salesforceId, Datetime lastModifiedAt) {
            this.deliveryKey = deliveryKey;
            this.entityType = entityType;
            this.externalKey = externalKey;
            this.salesforceId = salesforceId;
            this.lastModifiedAt = lastModifiedAt;
        }
    }
    public class CreateResponse {
        public Boolean committed;
        public Boolean duplicate;
        public String sourceFingerprint;
        public List<LinkEvidence> links = new List<LinkEvidence>();
    }
    public class StatusResponse {
        public Boolean available = true;
        public String contractKey;
        public List<Object> deliveries = new List<Object>();
        public List<LinkEvidence> links = new List<LinkEvidence>();
    }

    private static void require(Boolean condition, String message) {
        if (condition != true) throw new MasterContractException(message);
    }

    private static String normalized(String value) {
        return String.isBlank(value) ? null : value.trim();
    }

    private static Boolean applies(ChargeRule rule, String location) {
        if (rule == null) return false;
        if (rule.appliesWhen == 'every_delivery') return true;
        if (rule.appliesWhen == 'berth') return location == 'Berth';
        if (rule.appliesWhen == 'anchorage') return location == 'Anchorage';
        return false;
    }

    private static Map<String, ProductTerm> productTerms(List<ProductTerm> rows) {
        Map<String, ProductTerm> result = new Map<String, ProductTerm>();
        for (ProductTerm row : rows == null ? new List<ProductTerm>() : rows) {
            require(row != null && !String.isBlank(row.productKey) && row.salesforceProductId != null, 'Every product term requires an exact active Salesforce Product.');
            require(!result.containsKey(row.productKey), 'Master Contract product keys must be unique.');
            result.put(row.productKey, row);
        }
        require(!result.isEmpty(), 'At least one Master Contract product is required.');
        return result;
    }

    private static Set<Id> selectedVariableSuppliers(CreateRequest request, Delivery delivery) {
        Set<Id> ids = new Set<Id>();
        if (request.variableCharges != null && request.variableCharges.mode == 'contract') {
            if (request.variableCharges.supplierIds != null) ids.addAll(request.variableCharges.supplierIds);
        } else if (request.variableCharges != null && request.variableCharges.mode == 'per_delivery') {
            if (delivery.variableChargeSupplierIds != null) ids.addAll(delivery.variableChargeSupplierIds);
        } else {
            throw new MasterContractException('Variable Charges mode must be contract or per_delivery.');
        }
        ids.remove(null);
        return ids;
    }

    private static CreateResponse duplicateResponse(CreateRequest request, Set<String> deliveryKeys) {
        List<Opportunity> enquiries = [
            SELECT Id, Master_Contract_Delivery_Key__c, LastModifiedDate
            FROM Opportunity WHERE Master_Contract_Delivery_Key__c IN :deliveryKeys
        ];
        List<STEM__c> stems = [
            SELECT Id, Master_Contract_Delivery_Key__c, LastModifiedDate
            FROM STEM__c WHERE Master_Contract_Delivery_Key__c IN :deliveryKeys
        ];
        if (enquiries.isEmpty() && stems.isEmpty()) return null;
        require(enquiries.size() == deliveryKeys.size() && stems.size() == deliveryKeys.size(), 'A partial Master Contract delivery already exists. Reconcile it before retrying.');
        CreateResponse response = new CreateResponse();
        response.committed = true;
        response.duplicate = true;
        response.sourceFingerprint = request.requestHash;
        for (Opportunity row : enquiries) response.links.add(new LinkEvidence(row.Master_Contract_Delivery_Key__c, 'opportunity', row.Master_Contract_Delivery_Key__c, row.Id, row.LastModifiedDate));
        for (STEM__c row : stems) response.links.add(new LinkEvidence(row.Master_Contract_Delivery_Key__c, 'stem', row.Master_Contract_Delivery_Key__c, row.Id, row.LastModifiedDate));
        addChildLinks(response, deliveryKeys);
        validateCreationEvidence(request, response);
        return response;
    }

    private static void validateCreationEvidence(CreateRequest request, CreateResponse response) {
        Set<String> exact = new Set<String>();
        Map<String, Set<String>> typesByDelivery = new Map<String, Set<String>>();
        for (LinkEvidence link : response.links) {
            exact.add(link.deliveryKey + ':' + link.entityType + ':' + link.externalKey);
            if (!typesByDelivery.containsKey(link.deliveryKey)) typesByDelivery.put(link.deliveryKey, new Set<String>());
            typesByDelivery.get(link.deliveryKey).add(link.entityType);
        }
        for (Delivery delivery : request.deliveries) {
            require(exact.contains(delivery.deliveryKey + ':opportunity:' + delivery.deliveryKey), delivery.deliveryKey + ': Enquiry evidence is missing.');
            require(exact.contains(delivery.deliveryKey + ':stem:' + delivery.deliveryKey), delivery.deliveryKey + ': STEM evidence is missing.');
            require(typesByDelivery.get(delivery.deliveryKey)?.contains('buyer_confirmation') == true, delivery.deliveryKey + ': Buyer Confirmation evidence is missing.');
            require(typesByDelivery.get(delivery.deliveryKey)?.contains('nomination') == true, delivery.deliveryKey + ': Supplier Nomination evidence is missing.');
            for (DeliveryProduct allocation : delivery.products) {
                require(exact.contains(delivery.deliveryKey + ':line_item:' + allocation.contractLineKey), delivery.deliveryKey + ': product-line evidence is incomplete.');
            }
            for (ChargeRule rule : request.chargeRules == null ? new List<ChargeRule>() : request.chargeRules) {
                if (applies(rule, delivery.supplyLocation)) {
                    String key = delivery.deliveryKey + ':' + rule.chargeKey;
                    require(exact.contains(delivery.deliveryKey + ':charge:' + key), delivery.deliveryKey + ': fixed-charge evidence is incomplete.');
                }
            }
        }
    }

    public static CreateResponse create(CreateRequest request) {
        require(request != null, 'A complete Master Contract creation request is required.');
        require(!String.isBlank(request.idempotencyKey) && request.idempotencyKey.length() >= 16, 'A stable idempotency key is required.');
        require(!String.isBlank(request.requestHash) && Pattern.matches('[a-f0-9]{64}', request.requestHash), 'A valid source fingerprint is required.');
        require(!String.isBlank(request.contractKey) && request.contractKey.length() <= 80, 'A valid Master Contract key is required.');
        require(request.buyerAccountId != null && request.supplierAccountId != null, 'Exact Buyer and Supplier Accounts are required.');
        require(request.deliveries != null && !request.deliveries.isEmpty(), 'Select at least one Master Contract delivery.');
        require(!String.isBlank(request.ownerEmail), 'The assigned contract owner must resolve to an active Salesforce User.');

        Map<String, ProductTerm> terms = productTerms(request.products);
        Map<String, Delivery> deliveryByKey = new Map<String, Delivery>();
        Set<String> deliveryKeys = new Set<String>();
        Set<Id> accountIds = new Set<Id>{ request.buyerAccountId, request.supplierAccountId };
        Set<Id> productIds = new Set<Id>();
        Set<Id> vesselIds = new Set<Id>();
        Set<Id> portIds = new Set<Id>();
        for (ProductTerm term : terms.values()) productIds.add(term.salesforceProductId);
        for (ChargeRule rule : request.chargeRules == null ? new List<ChargeRule>() : request.chargeRules) {
            require(rule != null && !String.isBlank(rule.chargeKey) && rule.salesforceProductId != null && rule.supplierAccountId != null, 'Every charge rule requires a unique key, exact Product, and exact Supplier.');
            productIds.add(rule.salesforceProductId);
            accountIds.add(rule.supplierAccountId);
        }
        for (Delivery delivery : request.deliveries) {
            require(delivery != null && !String.isBlank(delivery.deliveryKey) && delivery.deliveryKey.length() <= 120, 'Every delivery requires a unique external key.');
            require(!deliveryByKey.containsKey(delivery.deliveryKey), 'Delivery keys must be unique within a batch.');
            require(delivery.vesselId != null && delivery.portId != null && delivery.preliminaryEta != null, 'Every delivery requires an exact Vessel, Port, and preliminary ETA.');
            require(!String.isBlank(delivery.buyerPaymentTerm) && !String.isBlank(delivery.supplierPaymentTerm), 'Every delivery requires Buyer and Supplier payment terms.');
            require(new Set<String>{'Berth', 'Anchorage', 'TBD'}.contains(delivery.supplyLocation), 'Supply location must be Berth, Anchorage, or TBD.');
            require(delivery.products != null && !delivery.products.isEmpty(), 'Every delivery requires at least one product allocation.');
            for (DeliveryProduct product : delivery.products) {
                require(product != null && terms.containsKey(product.productKey) && !String.isBlank(product.contractLineKey), 'Every allocation must reference an approved product term and unique line key.');
                require(product.quantityMin != null && product.quantityMax != null && product.quantityMin >= 0 && product.quantityMax >= product.quantityMin, 'Every allocation requires a valid quantity range.');
            }
            deliveryByKey.put(delivery.deliveryKey, delivery);
            deliveryKeys.add(delivery.deliveryKey);
            vesselIds.add(delivery.vesselId);
            portIds.add(delivery.portId);
            accountIds.addAll(selectedVariableSuppliers(request, delivery));
        }

        CreateResponse duplicate = duplicateResponse(request, deliveryKeys);
        if (duplicate != null) return duplicate;

        List<User> owners = [SELECT Id, Email FROM User WHERE IsActive = true AND Email = :request.ownerEmail LIMIT 2];
        require(owners.size() == 1, 'The assigned contract owner does not uniquely match an active Salesforce User by email.');
        Map<Id, Account> accounts = new Map<Id, Account>([
            SELECT Id, Name, Inactive_Suspended__c, Buyer_Payment_Term__c, Supplier_Payment_Term__c,
                Is_Agent__c, RecordType.Name
            FROM Account WHERE Id IN :accountIds
        ]);
        require(accounts.size() == accountIds.size(), 'One or more exact Account identities are unavailable.');
        for (Id accountId : accountIds) require(accounts.get(accountId).Inactive_Suspended__c != true, 'Inactive Accounts cannot be used in a Master Contract.');
        require(new Set<String>{ 'Buyer', 'Buyer & Supplier' }.contains(accounts.get(request.buyerAccountId).RecordType.Name), 'The exact Account must have the Buyer or Buyer & Supplier Record Type.');
        require(new Set<String>{ 'Supplier', 'Buyer & Supplier' }.contains(accounts.get(request.supplierAccountId).RecordType.Name), 'The exact Account must have the Supplier or Buyer & Supplier Record Type.');
        Map<Id, Product2> products = new Map<Id, Product2>([SELECT Id, Name, IsActive FROM Product2 WHERE Id IN :productIds]);
        require(products.size() == productIds.size(), 'One or more exact Products are unavailable.');
        for (Product2 product : products.values()) require(product.IsActive, 'Inactive Products cannot be used in a Master Contract.');
        Map<Id, Vessel__c> vessels = new Map<Id, Vessel__c>([SELECT Id, Name, IMO__c, Inactive__c FROM Vessel__c WHERE Id IN :vesselIds]);
        require(vessels.size() == vesselIds.size(), 'One or more exact Vessels are unavailable.');
        for (Vessel__c vessel : vessels.values()) require(vessel.Inactive__c != true, 'Inactive Vessels cannot be used in a Master Contract.');
        Map<Id, Port__c> ports = new Map<Id, Port__c>([SELECT Id, Name FROM Port__c WHERE Id IN :portIds]);
        require(ports.size() == portIds.size(), 'One or more exact Ports are unavailable.');

        Savepoint checkpoint = Database.setSavepoint();
        try {
            List<Opportunity> enquiries = new List<Opportunity>();
            for (Delivery delivery : request.deliveries) {
                enquiries.add(new Opportunity(
                    Name = delivery.vesselName + ' - Master Contract',
                    AccountId = request.buyerAccountId,
                    Vessel__c = delivery.vesselId,
                    OwnerId = owners[0].Id,
                    StageName = 'Closed Won',
                    CloseDate = Date.today(),
                    Time__c = Time.newInstance(0, 0, 0, 0),
                    Unit_of_Measure__c = 'MT',
                    Estimated_Value__c = 0,
                    Direct_Offer__c = true,
                    Master_Contract_Source__c = true,
                    Master_Contract_Key__c = request.contractKey,
                    Master_Contract_Delivery_Key__c = delivery.deliveryKey
                ));
            }
            insert enquiries;

            List<STEM__c> stems = new List<STEM__c>();
            Map<String, Opportunity> enquiryByKey = new Map<String, Opportunity>();
            for (Opportunity enquiry : enquiries) enquiryByKey.put(enquiry.Master_Contract_Delivery_Key__c, enquiry);
            Map<Id, STEM__c> workflowStemByEnquiryId = new Map<Id, STEM__c>();
            Set<Id> enquiryIds = new Map<Id, Opportunity>(enquiries).keySet();
            for (STEM__c workflowStem : [
                SELECT Id, Enquiry__c, Account__c, Vessel__c, Port__c, RecordTypeId,
                    Expected_Delivery_Date__c, ETA_ETB__c, ETA_Start_Date__c, Payment_Term__c,
                    Master_Contract_Source__c, Master_Contract_Key__c, Master_Contract_Delivery_Key__c
                FROM STEM__c
                WHERE Enquiry__c IN :enquiryIds
                FOR UPDATE
            ]) {
                require(
                    !workflowStemByEnquiryId.containsKey(workflowStem.Enquiry__c),
                    'Salesforce created more than one STEM for the same Master Contract Enquiry.'
                );
                workflowStemByEnquiryId.put(workflowStem.Enquiry__c, workflowStem);
            }
            Id originatedId = Schema.SObjectType.STEM__c.getRecordTypeInfosByName().get('Originated').getRecordTypeId();
            List<STEM__c> workflowStemsToUpdate = new List<STEM__c>();
            for (Delivery delivery : request.deliveries) {
                Opportunity enquiry = enquiryByKey.get(delivery.deliveryKey);
                STEM__c stem = workflowStemByEnquiryId.get(enquiry.Id);
                if (stem == null) {
                    stems.add(new STEM__c(
                        Enquiry__c = enquiry.Id,
                        Account__c = request.buyerAccountId,
                        Vessel__c = delivery.vesselId,
                        Port__c = delivery.portId,
                        RecordTypeId = originatedId,
                        Expected_Delivery_Date__c = delivery.preliminaryEta,
                        ETA_ETB__c = 'ETA',
                        ETA_Start_Date__c = delivery.preliminaryEta,
                        Payment_Term__c = delivery.buyerPaymentTerm,
                        Invoice_Date__c = Date.today(),
                        Master_Contract_Source__c = true,
                        Master_Contract_Key__c = request.contractKey,
                        Master_Contract_Delivery_Key__c = delivery.deliveryKey
                    ));
                    continue;
                }
                require(
                    stem.Account__c == request.buyerAccountId && stem.Vessel__c == delivery.vesselId,
                    'The workflow-created STEM identity does not match the exact Master Contract delivery.'
                );
                stem.Port__c = delivery.portId;
                stem.RecordTypeId = originatedId;
                stem.Expected_Delivery_Date__c = delivery.preliminaryEta;
                stem.ETA_ETB__c = 'ETA';
                stem.ETA_Start_Date__c = delivery.preliminaryEta;
                stem.Payment_Term__c = delivery.buyerPaymentTerm;
                stem.Master_Contract_Source__c = true;
                stem.Master_Contract_Key__c = request.contractKey;
                stem.Master_Contract_Delivery_Key__c = delivery.deliveryKey;
                workflowStemsToUpdate.add(stem);
            }
            if (!workflowStemsToUpdate.isEmpty()) update workflowStemsToUpdate;
            if (!stems.isEmpty()) {
                for (Database.SaveResult result : Database.insert(stems, false)) {
                    if (result.isSuccess()) continue;
                    Database.Error error = result.getErrors()[0];
                    throw new MasterContractException(
                        'Salesforce could not create the exact delivery STEM (' + error.getStatusCode() +
                        (error.getFields().isEmpty() ? '' : ' on ' + String.join(error.getFields(), ', ')) + '): ' +
                        error.getMessage()
                    );
                }
            }
            stems = [SELECT Id, RefCode__c, Master_Contract_Delivery_Key__c, LastModifiedDate FROM STEM__c WHERE Master_Contract_Delivery_Key__c IN :deliveryKeys];
            Map<String, STEM__c> stemByKey = new Map<String, STEM__c>();
            for (STEM__c stem : stems) stemByKey.put(stem.Master_Contract_Delivery_Key__c, stem);

            Id buyerConfirmationId = Schema.SObjectType.Nomination__c.getRecordTypeInfosByName().get('Buyer Confirmation').getRecordTypeId();
            List<Nomination__c> confirmations = new List<Nomination__c>();
            for (Delivery delivery : request.deliveries) {
                STEM__c stem = stemByKey.get(delivery.deliveryKey);
                String confirmationName = 'Confirmation to ' + accounts.get(request.buyerAccountId).Name;
                confirmations.add(new Nomination__c(
                    Name = confirmationName.left(Math.min(confirmationName.length(), 80)),
                    Port__c = delivery.portId,
                    Expected_Delivery_Date__c = delivery.preliminaryEta,
                    RecordTypeId = buyerConfirmationId,
                    Enquiry__c = enquiryByKey.get(delivery.deliveryKey).Id,
                    Account__c = request.buyerAccountId,
                    STEM__c = stem.Id,
                    RefCode__c = stem.RefCode__c,
                    Payment_Term__c = delivery.buyerPaymentTerm
                ));
            }
            insert confirmations;

            List<STEM_Line_Item__c> lineItems = new List<STEM_Line_Item__c>();
            for (Delivery delivery : request.deliveries) {
                for (DeliveryProduct allocation : delivery.products) {
                    ProductTerm term = terms.get(allocation.productKey);
                    lineItems.add(new STEM_Line_Item__c(
                        STEM__c = stemByKey.get(delivery.deliveryKey).Id,
                        Product__c = term.salesforceProductId,
                        Original_Supplier__c = request.supplierAccountId,
                        Quantity__c = allocation.quantityMin,
                        Quantity_Max__c = allocation.quantityMax,
                        Is_Quantity_Range__c = allocation.quantityMax != allocation.quantityMin,
                        Unit_of_Measure__c = String.isBlank(term.uom) ? 'MT' : term.uom,
                        Unit_Buy_At__c = 0,
                        Unit_Sell_At__c = 0,
                        Expected_Delivery_Date__c = delivery.preliminaryEta,
                        Payment_Term__c = delivery.supplierPaymentTerm,
                        Master_Contract_Source__c = true,
                        Master_Contract_Line_Key__c = allocation.contractLineKey,
                        DON_Price_Status__c = 'Unresolved'
                    ));
                }
            }
            insert lineItems;

            Id stemChargeId = Schema.SObjectType.STEM_Extra_Cost__c.getRecordTypeInfosByName().get('STEM Charge').getRecordTypeId();
            List<STEM_Extra_Cost__c> charges = new List<STEM_Extra_Cost__c>();
            for (Delivery delivery : request.deliveries) {
                for (ChargeRule rule : request.chargeRules == null ? new List<ChargeRule>() : request.chargeRules) {
                    if (!applies(rule, delivery.supplyLocation)) continue;
                    charges.add(new STEM_Extra_Cost__c(
                        STEM__c = stemByKey.get(delivery.deliveryKey).Id,
                        RecordTypeId = stemChargeId,
                        Supplier__c = rule.supplierAccountId,
                        Product2Id__c = rule.salesforceProductId,
                        Description__c = String.isBlank(rule.chargeName) ? rule.chargeKey : rule.chargeName,
                        Payment_Term__c = delivery.supplierPaymentTerm,
                        Unit_of_Measure__c = '1.',
                        Quantity__c = 1,
                        Quantity_Delivered_Per_BDN__c = 1,
                        Fixed__c = true,
                        Lumpsum_Cost__c = rule.fixedCost,
                        Lumpsum_Price__c = rule.fixedSell,
                        Master_Contract_Source__c = true,
                        Master_Contract_Charge_Key__c = delivery.deliveryKey + ':' + rule.chargeKey
                    ));
                }
            }
            if (!charges.isEmpty()) insert charges;

            List<STEM_Variable_Charge_Supplier__c> stages = new List<STEM_Variable_Charge_Supplier__c>();
            for (Delivery delivery : request.deliveries) {
                Set<Id> manualIds = selectedVariableSuppliers(request, delivery);
                Set<Id> applicable = new Set<Id>{ request.supplierAccountId };
                for (ChargeRule rule : request.chargeRules == null ? new List<ChargeRule>() : request.chargeRules) if (applies(rule, delivery.supplyLocation)) applicable.add(rule.supplierAccountId);
                for (Id supplierId : applicable) {
                    if (manualIds.contains(supplierId) || accounts.get(supplierId)?.Is_Agent__c == true) {
                        stages.add(new STEM_Variable_Charge_Supplier__c(
                            STEM__c = stemByKey.get(delivery.deliveryKey).Id,
                            Supplier__c = supplierId,
                            Manual_Review_Required__c = manualIds.contains(supplierId),
                            Supplier_Status__c = 'Pending'
                        ));
                    }
                }
            }
            if (!stages.isEmpty()) insert stages;

            CreateResponse response = new CreateResponse();
            response.committed = true;
            response.duplicate = false;
            response.sourceFingerprint = request.requestHash;
            enquiries = [SELECT Id, Master_Contract_Delivery_Key__c, LastModifiedDate FROM Opportunity WHERE Master_Contract_Delivery_Key__c IN :deliveryKeys];
            for (Opportunity row : enquiries) response.links.add(new LinkEvidence(row.Master_Contract_Delivery_Key__c, 'opportunity', row.Master_Contract_Delivery_Key__c, row.Id, row.LastModifiedDate));
            for (STEM__c row : stems) response.links.add(new LinkEvidence(row.Master_Contract_Delivery_Key__c, 'stem', row.Master_Contract_Delivery_Key__c, row.Id, row.LastModifiedDate));
            addChildLinks(response, deliveryKeys);
            validateCreationEvidence(request, response);
            return response;
        } catch (Exception ex) {
            Database.rollback(checkpoint);
            if (ex instanceof MasterContractException) throw ex;
            throw new MasterContractException(
                'Master Contract batch creation failed at service line ' + ex.getLineNumber() + ': ' + ex.getMessage()
            );
        }
    }

    private static void addChildLinks(CreateResponse response, Set<String> deliveryKeys) {
        Map<Id, String> stemKeys = new Map<Id, String>();
        for (STEM__c stem : [SELECT Id, Master_Contract_Delivery_Key__c FROM STEM__c WHERE Master_Contract_Delivery_Key__c IN :deliveryKeys]) stemKeys.put(stem.Id, stem.Master_Contract_Delivery_Key__c);
        if (stemKeys.isEmpty()) return;
        for (STEM_Line_Item__c row : [SELECT Id, STEM__c, Master_Contract_Line_Key__c, LastModifiedDate FROM STEM_Line_Item__c WHERE STEM__c IN :stemKeys.keySet() AND Master_Contract_Source__c = true]) {
            response.links.add(new LinkEvidence(stemKeys.get(row.STEM__c), 'line_item', row.Master_Contract_Line_Key__c, row.Id, row.LastModifiedDate));
        }
        for (STEM_Extra_Cost__c row : [SELECT Id, STEM__c, Master_Contract_Charge_Key__c, LastModifiedDate FROM STEM_Extra_Cost__c WHERE STEM__c IN :stemKeys.keySet() AND Master_Contract_Source__c = true]) {
            response.links.add(new LinkEvidence(stemKeys.get(row.STEM__c), 'charge', row.Master_Contract_Charge_Key__c, row.Id, row.LastModifiedDate));
        }
        for (Nomination__c row : [SELECT Id, STEM__c, RecordType.Name, LastModifiedDate FROM Nomination__c WHERE STEM__c IN :stemKeys.keySet() AND Deprecated__c = false]) {
            String typeName = row.RecordType.Name == 'Buyer Confirmation' ? 'buyer_confirmation' : 'nomination';
            response.links.add(new LinkEvidence(stemKeys.get(row.STEM__c), typeName, stemKeys.get(row.STEM__c) + ':' + typeName + ':' + row.Id, row.Id, row.LastModifiedDate));
        }
    }

    public static Map<String, Object> applyPrice(PriceRequest request) {
        require(request != null && request.lineItemId != null && !String.isBlank(request.contractLineKey), 'An exact Master Contract product line is required.');
        require(!String.isBlank(request.requestHash) && Pattern.matches('[a-f0-9]{64}', request.requestHash), 'A valid source fingerprint is required.');
        Date supplierDate = request.supplierPricingDate == null ? request.benchmarkDate : request.supplierPricingDate;
        Date buyerDate = request.buyerPricingDate == null ? request.benchmarkDate : request.buyerPricingDate;
        Decimal supplierBenchmark = request.supplierBenchmarkValue == null ? request.benchmarkValue : request.supplierBenchmarkValue;
        Decimal buyerBenchmark = request.buyerBenchmarkValue == null ? request.benchmarkValue : request.buyerBenchmarkValue;
        String position = String.isBlank(request.pricingPosition) ? 'Matched' : request.pricingPosition;
        require(request.buyPrice != null && request.sellPrice != null && supplierDate != null && buyerDate != null && supplierBenchmark != null && buyerBenchmark != null, 'Reviewed buyer and supplier pricing evidence is required.');
        require(new Set<String>{ 'Long', 'Short', 'Matched' }.contains(position), 'Pricing position must be Long, Short, or Matched.');
        require(!String.isBlank(request.evidenceHash) && Pattern.matches('[a-f0-9]{64}', request.evidenceHash), 'Reviewed DON evidence is required.');
        STEM_Line_Item__c row = [
            SELECT Id, Master_Contract_Line_Key__c, Master_Contract_Source__c, DON_Price_Status__c,
                DON_Evidence_Hash__c, Unit_Buy_At__c, Unit_Sell_At__c
            FROM STEM_Line_Item__c WHERE Id = :request.lineItemId LIMIT 1 FOR UPDATE
        ];
        require(row.Master_Contract_Source__c && row.Master_Contract_Line_Key__c == request.contractLineKey, 'The exact Master Contract product line identity does not match.');
        if (row.DON_Price_Status__c == 'Applied') {
            require(row.DON_Evidence_Hash__c == request.evidenceHash && row.Unit_Buy_At__c == request.buyPrice && row.Unit_Sell_At__c == request.sellPrice, 'A different DON price is already applied and requires review.');
            return new Map<String, Object>{ 'applied' => true, 'duplicate' => true, 'lineItemId' => row.Id };
        }
        row.Unit_Buy_At__c = request.buyPrice.setScale(2);
        row.Unit_Sell_At__c = request.sellPrice.setScale(2);
        row.DON_Pricing_Date__c = supplierDate;
        row.DON_Benchmark_Code__c = request.benchmarkCode;
        row.DON_Benchmark_Value__c = supplierBenchmark;
        row.DON_Supplier_Pricing_Date__c = supplierDate;
        row.DON_Buyer_Pricing_Date__c = buyerDate;
        row.DON_Supplier_Benchmark_Value__c = supplierBenchmark;
        row.DON_Buyer_Benchmark_Value__c = buyerBenchmark;
        row.DON_Pricing_Position__c = position;
        row.DON_Buy_Unrounded__c = request.buyUnrounded;
        row.DON_Sell_Unrounded__c = request.sellUnrounded;
        row.DON_Evidence_Hash__c = request.evidenceHash;
        row.DON_Price_Status__c = 'Applied';
        update row;
        return new Map<String, Object>{ 'applied' => true, 'duplicate' => false, 'lineItemId' => row.Id };
    }

    public static StatusResponse status(String contractKey) {
        require(!String.isBlank(contractKey), 'A Master Contract key is required.');
        StatusResponse response = new StatusResponse();
        response.contractKey = contractKey;
        List<STEM__c> stems = [
            SELECT Id, Name, KeyStem__c, Master_Contract_Delivery_Key__c, Account__c, Vessel__c,
                Vessel__r.Name, Vessel__r.IMO__c, Port__c, Port__r.Name, Expected_Delivery_Date__c,
                Delivery_Date__c, Payment_Term__c, LastModifiedDate,
                (SELECT Id, Master_Contract_Line_Key__c, Product__c, Product__r.Name, Original_Supplier__c,
                    Quantity__c, Quantity_Max__c, Quantity_Delivered_Per_BDN__c, Unit_Buy_At__c,
                    Unit_Sell_At__c, Payment_Term__c, DON_Price_Status__c, DON_Pricing_Date__c,
                    DON_Supplier_Pricing_Date__c, DON_Buyer_Pricing_Date__c,
                    DON_Supplier_Benchmark_Value__c, DON_Buyer_Benchmark_Value__c,
                    DON_Pricing_Position__c, LastModifiedDate
                 FROM STEM_Line_Items__r WHERE Master_Contract_Source__c = true),
                (SELECT Id, Master_Contract_Charge_Key__c, Product2Id__c, Product2Id__r.Name, Supplier__c,
                    Lumpsum_Cost__c, Lumpsum_Price__c, Cancelled__c, LastModifiedDate
                 FROM STEM_Extra_Costs__r WHERE Master_Contract_Source__c = true)
            FROM STEM__c WHERE Master_Contract_Key__c = :contractKey ORDER BY Expected_Delivery_Date__c
        ];
        Set<Id> stemIds = new Map<Id, STEM__c>(stems).keySet();
        Map<Id, Integer> financialCounts = new Map<Id, Integer>();
        if (!stemIds.isEmpty()) {
            for (AggregateResult result : [
                SELECT STEM__c stemId, COUNT(Id) recordCount
                FROM Invoice__c WHERE STEM__c IN :stemIds GROUP BY STEM__c
            ]) {
                financialCounts.put((Id) result.get('stemId'), (Integer) result.get('recordCount'));
            }
            for (AggregateResult result : [
                SELECT STEM__c stemId, COUNT(Id) recordCount
                FROM Supplier_Invoice__c WHERE STEM__c IN :stemIds GROUP BY STEM__c
            ]) {
                Id stemId = (Id) result.get('stemId');
                financialCounts.put(stemId, (financialCounts.containsKey(stemId) ? financialCounts.get(stemId) : 0) + (Integer) result.get('recordCount'));
            }
        }
        Set<String> deliveryKeys = new Set<String>();
        for (STEM__c stem : stems) {
            deliveryKeys.add(stem.Master_Contract_Delivery_Key__c);
            Map<String, Object> row = new Map<String, Object>{
                'deliveryKey' => stem.Master_Contract_Delivery_Key__c,
                'stemId' => stem.Id, 'stemName' => stem.Name, 'keyStem' => stem.KeyStem__c,
                'accountId' => stem.Account__c, 'vesselId' => stem.Vessel__c,
                'vesselName' => stem.Vessel__r?.Name, 'vesselImo' => stem.Vessel__r?.IMO__c,
                'portId' => stem.Port__c, 'portName' => stem.Port__r?.Name,
                'expectedDeliveryDate' => stem.Expected_Delivery_Date__c,
                'deliveryDate' => stem.Delivery_Date__c, 'buyerPaymentTerm' => stem.Payment_Term__c,
                'financialRecordCount' => financialCounts.containsKey(stem.Id) ? financialCounts.get(stem.Id) : 0,
                'lastModifiedAt' => stem.LastModifiedDate,
                'products' => stem.STEM_Line_Items__r,
                'charges' => stem.STEM_Extra_Costs__r
            };
            response.deliveries.add(row);
            response.links.add(new LinkEvidence(stem.Master_Contract_Delivery_Key__c, 'stem', stem.Master_Contract_Delivery_Key__c, stem.Id, stem.LastModifiedDate));
        }
        if (!deliveryKeys.isEmpty()) {
            for (Opportunity row : [SELECT Id, Master_Contract_Delivery_Key__c, LastModifiedDate FROM Opportunity WHERE Master_Contract_Delivery_Key__c IN :deliveryKeys]) {
                response.links.add(new LinkEvidence(row.Master_Contract_Delivery_Key__c, 'opportunity', row.Master_Contract_Delivery_Key__c, row.Id, row.LastModifiedDate));
            }
            CreateResponse child = new CreateResponse();
            addChildLinks(child, deliveryKeys);
            response.links.addAll(child.links);
        }
        return response;
    }
}
