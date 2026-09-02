public without sharing class HongKongBasicCallingBundleService {
    public static final String BASIC_CALLING_COST = 'BASIC CALLING COST';
    public static final String AGENCY_FEE = 'AGENCY FEE';
    public static final String PORT_CLEARANCE_EXTENSION = 'PORT CLEARANCE EXTENSION';
    public static final String LEGACY_PORT_CLEARANCE_FEE = 'PORT CLEARANCE FEE';
    public static final String LIGHT_DUES = 'LIGHT DUES';
    public static final String ANCHORAGE_DUES = 'ANCHORAGE DUES';
    public static final Decimal PORT_CLEARANCE_RATE_HKD = 58;
    public static final String PORT_CLEARANCE_VERSION = 'HK-PC-2026-01';

    private static final List<String> SUPPORT_NAMES = new List<String>{
        AGENCY_FEE, PORT_CLEARANCE_EXTENSION, LIGHT_DUES, ANCHORAGE_DUES
    };
    private static final Set<String> ALL_PRODUCT_NAMES = new Set<String>{
        BASIC_CALLING_COST, AGENCY_FEE, PORT_CLEARANCE_EXTENSION, LEGACY_PORT_CLEARANCE_FEE, LIGHT_DUES, ANCHORAGE_DUES
    };
    private static final Set<String> REQUIRED_PRODUCT_NAMES = new Set<String>{
        BASIC_CALLING_COST, AGENCY_FEE, PORT_CLEARANCE_EXTENSION, LIGHT_DUES, ANCHORAGE_DUES
    };
    private static Boolean synchronizing = false;

    private class SynchronizeStemsJob implements Queueable {
        private final Set<Id> stemIds;
        SynchronizeStemsJob(Set<Id> stemIds) {
            this.stemIds = stemIds == null ? new Set<Id>() : new Set<Id>(stemIds);
        }
        public void execute(QueueableContext context) {
            synchronizeStemIds(stemIds);
        }
    }

    public class BundleConfigurationException extends Exception {}

    public static void afterExtraCostChange(
        List<STEM_Extra_Cost__c> newRows,
        Map<Id, STEM_Extra_Cost__c> oldRows
    ) {
        if (synchronizing) return;
        Set<Id> stemIds = new Set<Id>();
        if (newRows != null) {
            for (STEM_Extra_Cost__c row : newRows) if (row.STEM__c != null) stemIds.add(row.STEM__c);
        }
        if (oldRows != null) {
            for (STEM_Extra_Cost__c row : oldRows.values()) if (row.STEM__c != null) stemIds.add(row.STEM__c);
        }
        // STEM Charge saves already run a large legacy handler chain. Reconcile
        // the bundle in a clean transaction so an unrelated charge save cannot
        // consume the remaining SOQL budget needed by invoice/reconfirm logic.
        if (!stemIds.isEmpty()) System.enqueueJob(new SynchronizeStemsJob(stemIds));
    }

    public static void afterStemChange(List<STEM__c> newRows, Map<Id, STEM__c> oldRows) {
        if (synchronizing || newRows == null || oldRows == null) return;
        Set<Id> stemIds = new Set<Id>();
        for (STEM__c row : newRows) {
            STEM__c before = oldRows.get(row.Id);
            if (before != null && row.Port__c != before.Port__c) stemIds.add(row.Id);
        }
        // STEM updates already run a large legacy handler chain. Defer the bundle
        // port reconciliation to its own transaction so an ordinary save cannot
        // cross Salesforce's 100-query governor limit.
        if (!stemIds.isEmpty()) System.enqueueJob(new SynchronizeStemsJob(stemIds));
    }

    public static void afterAccountChange(Map<Id, Account> newRows, Map<Id, Account> oldRows) {
        if (synchronizing || newRows == null || oldRows == null) return;
        Set<Id> supplierIds = new Set<Id>();
        for (Account row : newRows.values()) {
            Account before = oldRows.get(row.Id);
            if (before != null && (row.Agency_Fee_USD__c != before.Agency_Fee_USD__c
                || row.Agency_Fee_Currency__c != before.Agency_Fee_Currency__c)) supplierIds.add(row.Id);
        }
        fillMissingAgencyFees(supplierIds, newRows);
    }

    @TestVisible
    static void synchronizeStemIds(Set<Id> stemIds) {
        if (synchronizing || stemIds == null || stemIds.isEmpty()) return;
        synchronizing = true;
        try {
            Map<Id, STEM__c> stems = new Map<Id, STEM__c>([
                SELECT Id, Port__c, Vessel__c, Port__r.Name, Port__r.Country__c
                FROM STEM__c WHERE Id IN :stemIds
            ]);
            List<STEM_Extra_Cost__c> rows = [
                SELECT Id, STEM__c, Supplier__c, Product2Id__c, Product2Id__r.Name,
                    Product2Id__r.IsActive, Payment_Term__c, Cancelled__c,
                    Buyer_Invoice__c, Supplier_Invoice__c, Fixed__c, Quantity__c,
                    Quantity_Delivered_Per_BDN__c, Unit_of_Measure__c,
                    Unit_Cost__c, Unit_Price__c, Lumpsum_Cost__c, Lumpsum_Price__c,
                    Line_Total_Buy__c, Line_Total__c,
                    Supplier_Cost_Input_Currency__c, Supplier_Cost_Input_Value__c,
                    Supplier_Cost_USD_HKD_Rate__c, Supplier_Cost_FX_Settings_Revision__c,
                    Hong_Kong_Bundle_Key__c, Hong_Kong_Bundle_Managed__c,
                    Hong_Kong_Bundle_Sequence__c, Hong_Kong_Bundle_Source__c,
                    Port_Clearance_Rate_HKD__c, Port_Clearance_Calculation_Version__c
                FROM STEM_Extra_Cost__c WHERE STEM__c IN :stemIds
            ];
            Map<String, Product2> products = exactActiveProducts();
            Map<Id, Account> suppliers = loadSuppliers(rows);
            Id stemChargeRecordTypeId = Schema.SObjectType.STEM_Extra_Cost__c
                .getRecordTypeInfosByName().get('STEM Charge').getRecordTypeId();

            Map<Id, List<STEM_Extra_Cost__c>> rowsByStem = new Map<Id, List<STEM_Extra_Cost__c>>();
            for (STEM_Extra_Cost__c row : rows) {
                if (!rowsByStem.containsKey(row.STEM__c)) rowsByStem.put(row.STEM__c, new List<STEM_Extra_Cost__c>());
                rowsByStem.get(row.STEM__c).add(row);
            }

            List<STEM_Extra_Cost__c> inserts = new List<STEM_Extra_Cost__c>();
            Map<Id, STEM_Extra_Cost__c> updates = new Map<Id, STEM_Extra_Cost__c>();
            for (Id stemId : stems.keySet()) {
                synchronizeStem(
                    stems.get(stemId),
                    rowsByStem.containsKey(stemId) ? rowsByStem.get(stemId) : new List<STEM_Extra_Cost__c>(),
                    products,
                    suppliers,
                    stemChargeRecordTypeId,
                    inserts,
                    updates
                );
            }
            // Basic Calling Cost has already run the normal STEM Charge handlers
            // for this supplier/payment-term pair. The generated support rows are
            // fully initialized here so replaying every legacy handler four more
            // times cannot exhaust the transaction query limit or create duplicate
            // nominations and cashflows.
            Boolean previousSkip = ContextManager.skipTriggers;
            ContextManager.skipTriggers = true;
            try {
                if (!updates.isEmpty()) {
                    List<STEM_Extra_Cost__c> safeUpdates = new List<STEM_Extra_Cost__c>();
                    for (STEM_Extra_Cost__c row : updates.values()) safeUpdates.add(sparseUpdate(row));
                    update safeUpdates;
                }
                if (!inserts.isEmpty()) insert inserts;
            } finally {
                ContextManager.skipTriggers = previousSkip;
            }
        } finally {
            synchronizing = false;
        }
    }

    private static void synchronizeStem(
        STEM__c stem,
        List<STEM_Extra_Cost__c> rows,
        Map<String, Product2> products,
        Map<Id, Account> suppliers,
        Id stemChargeRecordTypeId,
        List<STEM_Extra_Cost__c> inserts,
        Map<Id, STEM_Extra_Cost__c> updates
    ) {
        Map<Id, List<STEM_Extra_Cost__c>> basicsBySupplier = new Map<Id, List<STEM_Extra_Cost__c>>();
        for (STEM_Extra_Cost__c row : rows) {
            if (row.Cancelled__c == true || row.Supplier__c == null || row.Product2Id__r == null
                || row.Product2Id__r.IsActive != true || normalize(row.Product2Id__r.Name) != BASIC_CALLING_COST) continue;
            if (!basicsBySupplier.containsKey(row.Supplier__c)) basicsBySupplier.put(row.Supplier__c, new List<STEM_Extra_Cost__c>());
            basicsBySupplier.get(row.Supplier__c).add(row);
        }
        Boolean qualifyingPort = isHongKong(stem);
        Set<String> requiredKeys = new Set<String>();
        if (qualifyingPort && !basicsBySupplier.isEmpty()) requireCompleteProducts(products);

        for (Id supplierId : basicsBySupplier.keySet()) {
            List<STEM_Extra_Cost__c> basics = basicsBySupplier.get(supplierId);
            if (basics.size() != 1) {
                throw new BundleConfigurationException('Exactly one active Basic Calling Cost is required per Hong Kong STEM and supplier.');
            }
            STEM_Extra_Cost__c basic = basics[0];
            for (Integer index = 0; index < SUPPORT_NAMES.size(); index++) {
                String productName = SUPPORT_NAMES[index];
                String key = bundleKey(stem.Id, supplierId, productName);
                requiredKeys.add(key);
                List<STEM_Extra_Cost__c> matchingManual = matchingRows(rows, supplierId, productName, false);
                List<STEM_Extra_Cost__c> matchingManaged = matchingRows(rows, supplierId, productName, true);
                if (matchingManual.size() > 1) {
                    throw new BundleConfigurationException('Multiple active manual ' + title(productName) + ' rows exist for the same STEM and supplier.');
                }
                if (!matchingManual.isEmpty()) {
                    cancelUnissuedManaged(matchingManaged, updates);
                    continue;
                }
                STEM_Extra_Cost__c managed = findManagedByKey(rows, key);
                if (managed == null) {
                    inserts.add(newManagedRow(
                        stem, supplierId, basic, products.get(productName), productName,
                        index + 1, key, suppliers.get(supplierId), stemChargeRecordTypeId
                    ));
                } else if (isUnissued(managed)) {
                    synchronizeManagedRow(managed, basic, productName, index + 1, suppliers.get(supplierId));
                    updates.put(managed.Id, managed);
                }
            }
        }

        for (STEM_Extra_Cost__c row : rows) {
            if (row.Hong_Kong_Bundle_Managed__c != true || row.Id == null) continue;
            if (!qualifyingPort || !requiredKeys.contains(row.Hong_Kong_Bundle_Key__c)) {
                if (isUnissued(row) && row.Cancelled__c != true) {
                    row.Cancelled__c = true;
                    updates.put(row.Id, row);
                }
            }
        }
    }

    private static STEM_Extra_Cost__c newManagedRow(
        STEM__c stem,
        Id supplierId,
        STEM_Extra_Cost__c basic,
        Product2 product,
        String productName,
        Integer sequence,
        String key,
        Account supplier,
        Id recordTypeId
    ) {
        STEM_Extra_Cost__c row = new STEM_Extra_Cost__c(
            STEM__c = stem.Id,
            Port__c = stem.Port__c,
            Vessel__c = stem.Vessel__c,
            Supplier__c = supplierId,
            Product2Id__c = product.Id,
            RecordTypeId = recordTypeId,
            Payment_Term__c = basic.Payment_Term__c,
            Cancelled__c = false,
            Quantity__c = 1,
            Quantity_Delivered_Per_BDN__c = 1,
            Unit_of_Measure__c = '1.',
            Hong_Kong_Bundle_Key__c = key,
            Hong_Kong_Bundle_Managed__c = true,
            Hong_Kong_Bundle_Sequence__c = sequence,
            Hong_Kong_Bundle_Source__c = basic.Id,
            Description__c = title(productName)
        );
        String supplierCurrency = supplierCostCurrency(supplier);
        if (supplierCurrency != null) row.Supplier_Cost_Input_Currency__c = supplierCurrency;
        if (productName == PORT_CLEARANCE_EXTENSION) {
            row.Fixed__c = false;
            row.Supplier_Cost_Input_Currency__c = supplierCurrency == null ? 'HKD' : supplierCurrency;
            row.Supplier_Cost_Input_Value__c = row.Supplier_Cost_Input_Currency__c == 'HKD' ? PORT_CLEARANCE_RATE_HKD : null;
            row.Unit_Price__c = 0;
            row.Line_Total_Buy__c = 0;
            row.Line_Total__c = 0;
            row.Port_Clearance_Rate_HKD__c = PORT_CLEARANCE_RATE_HKD;
            row.Port_Clearance_Calculation_Version__c = PORT_CLEARANCE_VERSION;
        } else {
            row.Fixed__c = true;
            if (productName == AGENCY_FEE) {
                String feeCurrency = agencyFeeCurrency(supplier);
                Decimal fee = supplier == null ? null : supplier.Agency_Fee_USD__c;
                row.Lumpsum_Cost__c = feeCurrency == 'USD' ? fee : null;
                row.Lumpsum_Price__c = 0;
                row.Line_Total_Buy__c = row.Lumpsum_Cost__c == null ? 0 : row.Lumpsum_Cost__c;
                row.Line_Total__c = 0;
                if (fee != null) {
                    row.Supplier_Cost_Input_Currency__c = feeCurrency;
                    row.Supplier_Cost_Input_Value__c = fee;
                }
            } else if (productName == LIGHT_DUES) {
                row.Lumpsum_Price__c = 0;
                row.Line_Total_Buy__c = 0;
                row.Line_Total__c = 0;
            } else if (productName == ANCHORAGE_DUES) {
                row.Line_Total_Buy__c = 0;
                row.Line_Total__c = 0;
            }
        }
        return row;
    }

    private static void synchronizeManagedRow(
        STEM_Extra_Cost__c row,
        STEM_Extra_Cost__c basic,
        String productName,
        Integer sequence,
        Account supplier
    ) {
        row.Cancelled__c = false;
        row.Payment_Term__c = basic.Payment_Term__c;
        row.Hong_Kong_Bundle_Source__c = basic.Id;
        row.Hong_Kong_Bundle_Sequence__c = sequence;
        String supplierCurrency = supplierCostCurrency(supplier);
        if (supplierCurrency != null) row.Supplier_Cost_Input_Currency__c = supplierCurrency;
        if (productName == PORT_CLEARANCE_EXTENSION) {
            row.Fixed__c = false;
            row.Port_Clearance_Rate_HKD__c = PORT_CLEARANCE_RATE_HKD;
            row.Port_Clearance_Calculation_Version__c = PORT_CLEARANCE_VERSION;
            if (row.Quantity__c == null || row.Quantity__c < 1 || row.Quantity__c != row.Quantity__c.setScale(0)) row.Quantity__c = 1;
            row.Unit_of_Measure__c = '1.';
            row.Supplier_Cost_Input_Currency__c = supplierCurrency == null ? 'HKD' : supplierCurrency;
            row.Supplier_Cost_Input_Value__c = row.Supplier_Cost_Input_Currency__c == 'HKD' ? PORT_CLEARANCE_RATE_HKD : null;
            if (row.Unit_Price__c == null) row.Unit_Price__c = 0;
        } else if (productName == AGENCY_FEE && supplier != null && supplier.Agency_Fee_USD__c != null) {
            String feeCurrency = agencyFeeCurrency(supplier);
            row.Supplier_Cost_Input_Currency__c = feeCurrency;
            row.Supplier_Cost_Input_Value__c = supplier.Agency_Fee_USD__c;
            if (row.Lumpsum_Price__c == null) row.Lumpsum_Price__c = 0;
            if (feeCurrency == 'USD' && row.Lumpsum_Cost__c == null) {
                row.Lumpsum_Cost__c = supplier.Agency_Fee_USD__c;
                row.Line_Total_Buy__c = supplier.Agency_Fee_USD__c;
            }
            row.Line_Total__c = row.Lumpsum_Price__c;
        }
    }

    private static void fillMissingAgencyFees(Set<Id> supplierIds, Map<Id, Account> accounts) {
        if (supplierIds == null || supplierIds.isEmpty()) return;
        synchronizing = true;
        try {
            List<STEM_Extra_Cost__c> updates = new List<STEM_Extra_Cost__c>();
            for (STEM_Extra_Cost__c row : [
                SELECT Id, Supplier__c, Lumpsum_Cost__c, Lumpsum_Price__c,
                    Buyer_Invoice__c, Supplier_Invoice__c, Cancelled__c,
                    Supplier_Cost_Input_Currency__c, Supplier_Cost_Input_Value__c
                FROM STEM_Extra_Cost__c
                WHERE Supplier__c IN :supplierIds AND Hong_Kong_Bundle_Managed__c = true
                    AND Product2Id__r.Name = :AGENCY_FEE
            ]) {
                Account supplier = accounts.get(row.Supplier__c);
                Decimal fee = supplier?.Agency_Fee_USD__c;
                if (fee == null || !isUnissued(row) || row.Cancelled__c == true) continue;
                String feeCurrency = agencyFeeCurrency(supplier);
                Boolean evidenceChanged = row.Supplier_Cost_Input_Currency__c != feeCurrency
                    || row.Supplier_Cost_Input_Value__c != fee;
                if (!evidenceChanged && (feeCurrency == 'HKD' || row.Lumpsum_Cost__c != null)) continue;
                if (row.Lumpsum_Price__c == null) row.Lumpsum_Price__c = 0;
                row.Supplier_Cost_Input_Currency__c = feeCurrency;
                row.Supplier_Cost_Input_Value__c = fee;
                if (feeCurrency == 'USD') {
                    row.Lumpsum_Cost__c = fee;
                    row.Line_Total_Buy__c = fee;
                } else if (evidenceChanged) {
                    row.Lumpsum_Cost__c = null;
                    row.Line_Total_Buy__c = 0;
                    row.Supplier_Cost_USD_HKD_Rate__c = null;
                    row.Supplier_Cost_FX_Settings_Revision__c = null;
                }
                row.Line_Total__c = row.Lumpsum_Price__c;
                updates.add(row);
            }
            if (!updates.isEmpty()) {
                Boolean previousSkip = ContextManager.skipTriggers;
                ContextManager.skipTriggers = true;
                try {
                    update updates;
                } finally {
                    ContextManager.skipTriggers = previousSkip;
                }
            }
        } finally {
            synchronizing = false;
        }
    }

    private static STEM_Extra_Cost__c sparseUpdate(STEM_Extra_Cost__c row) {
        return new STEM_Extra_Cost__c(
            Id = row.Id,
            Payment_Term__c = row.Payment_Term__c,
            Cancelled__c = row.Cancelled__c,
            Fixed__c = row.Fixed__c,
            Quantity__c = row.Quantity__c,
            Quantity_Delivered_Per_BDN__c = row.Quantity_Delivered_Per_BDN__c,
            Unit_of_Measure__c = row.Unit_of_Measure__c,
            Unit_Cost__c = row.Unit_Cost__c,
            Unit_Price__c = row.Unit_Price__c,
            Lumpsum_Cost__c = row.Lumpsum_Cost__c,
            Lumpsum_Price__c = row.Lumpsum_Price__c,
            Line_Total_Buy__c = row.Line_Total_Buy__c,
            Line_Total__c = row.Line_Total__c,
            Supplier_Cost_Input_Currency__c = row.Supplier_Cost_Input_Currency__c,
            Supplier_Cost_Input_Value__c = row.Supplier_Cost_Input_Value__c,
            Hong_Kong_Bundle_Sequence__c = row.Hong_Kong_Bundle_Sequence__c,
            Hong_Kong_Bundle_Source__c = row.Hong_Kong_Bundle_Source__c,
            Port_Clearance_Rate_HKD__c = row.Port_Clearance_Rate_HKD__c,
            Port_Clearance_Calculation_Version__c = row.Port_Clearance_Calculation_Version__c
        );
    }

    private static Map<String, Product2> exactActiveProducts() {
        Map<String, Product2> result = new Map<String, Product2>();
        for (Product2 product : [SELECT Id, Name, IsActive FROM Product2 WHERE IsActive = true AND Name IN :ALL_PRODUCT_NAMES]) {
            String name = canonicalProductName(product.Name);
            if (result.containsKey(name)) {
                // Keep unrelated Extra Cost saves working. A qualifying Hong Kong
                // bundle fails closed later when this null catalog entry is used.
                result.put(name, null);
                continue;
            }
            result.put(name, product);
        }
        return result;
    }

    private static void requireCompleteProducts(Map<String, Product2> products) {
        for (String name : REQUIRED_PRODUCT_NAMES) {
            if (!products.containsKey(name) || products.get(name) == null) {
                throw new BundleConfigurationException('No unique active Product is named exactly ' + title(name) + '.');
            }
        }
    }

    private static Map<Id, Account> loadSuppliers(List<STEM_Extra_Cost__c> rows) {
        Set<Id> ids = new Set<Id>();
        for (STEM_Extra_Cost__c row : rows) if (row.Supplier__c != null) ids.add(row.Supplier__c);
        return ids.isEmpty() ? new Map<Id, Account>() : new Map<Id, Account>([
            SELECT Id, Is_Agent__c, Agency_Fee_USD__c, Agency_Fee_Currency__c FROM Account WHERE Id IN :ids
        ]);
    }

    private static String agencyFeeCurrency(Account supplier) {
        return supplier != null && supplier.Agency_Fee_Currency__c == 'HKD' ? 'HKD' : 'USD';
    }

    private static String supplierCostCurrency(Account supplier) {
        if (supplier?.Is_Agent__c != true) return null;
        return supplier.Agency_Fee_Currency__c == 'HKD' || supplier.Agency_Fee_Currency__c == 'USD'
            ? supplier.Agency_Fee_Currency__c
            : null;
    }

    private static List<STEM_Extra_Cost__c> matchingRows(
        List<STEM_Extra_Cost__c> rows,
        Id supplierId,
        String productName,
        Boolean managed
    ) {
        List<STEM_Extra_Cost__c> result = new List<STEM_Extra_Cost__c>();
        for (STEM_Extra_Cost__c row : rows) {
            if (row.Supplier__c == supplierId && row.Cancelled__c != true
                && row.Hong_Kong_Bundle_Managed__c == managed
                && row.Product2Id__r != null && canonicalProductName(row.Product2Id__r.Name) == productName) result.add(row);
        }
        return result;
    }

    private static STEM_Extra_Cost__c findManagedByKey(List<STEM_Extra_Cost__c> rows, String key) {
        STEM_Extra_Cost__c match;
        for (STEM_Extra_Cost__c row : rows) {
            if (row.Hong_Kong_Bundle_Key__c != key) continue;
            if (match != null) throw new BundleConfigurationException('Multiple managed Hong Kong bundle rows share one key.');
            match = row;
        }
        return match;
    }

    private static void cancelUnissuedManaged(List<STEM_Extra_Cost__c> rows, Map<Id, STEM_Extra_Cost__c> updates) {
        for (STEM_Extra_Cost__c row : rows) {
            if (isUnissued(row) && row.Cancelled__c != true) {
                row.Cancelled__c = true;
                updates.put(row.Id, row);
            }
        }
    }

    private static Boolean isUnissued(STEM_Extra_Cost__c row) {
        return row.Buyer_Invoice__c == null && row.Supplier_Invoice__c == null;
    }

    private static Boolean isHongKong(STEM__c stem) {
        return normalize(stem?.Port__r?.Name) == 'HONG KONG'
            || normalize(stem?.Port__r?.Country__c) == 'HONG KONG'
            || normalize(stem?.Port__r?.Country__c) == 'HK';
    }

    private static String bundleKey(Id stemId, Id supplierId, String productName) {
        String stableName = productName == PORT_CLEARANCE_EXTENSION ? LEGACY_PORT_CLEARANCE_FEE : productName;
        return 'HKBC|' + stemId + '|' + supplierId + '|' + stableName.replace(' ', '_');
    }

    private static String canonicalProductName(String value) {
        String productName = normalize(value);
        return productName == LEGACY_PORT_CLEARANCE_FEE ? PORT_CLEARANCE_EXTENSION : productName;
    }

    private static String normalize(String value) {
        return String.isBlank(value) ? '' : value.trim().replaceAll('\\s+', ' ').toUpperCase();
    }

    private static String title(String value) {
        if (String.isBlank(value)) return value;
        List<String> words = new List<String>();
        for (String part : value.toLowerCase().split(' ')) {
            words.add(part.substring(0, 1).toUpperCase() + part.substring(1));
        }
        return String.join(words, ' ');
    }
}
