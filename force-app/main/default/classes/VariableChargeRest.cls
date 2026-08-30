@RestResource(urlMapping='/fcos/variable-charges/*')
global without sharing class VariableChargeRest {
    global class RequestBody {
        public String stemId;
        public String supplierId;
        public String verifierEmail;
        public String expectedFingerprint;
        public String expectedCostFingerprint;
        public String expectedBuyerFingerprint;
        public String expectedStageLastModifiedAt;
        public String expectedStemLastModifiedAt;
        public String gmOverrideReason;
        public List<String> sides;
    }

    global class ResponseBody {
        public String stemId;
        public String supplierId;
        public String stageId;
        public String supplierStatus;
        public String buyerChargeStatus;
        public Boolean buyerConfirmed;
        public Integer revision;
        public Integer buyerChargeRevision;
        public String fingerprint;
        public String costFingerprint;
        public String buyerFingerprint;
        public String lastModifiedAt;
    }

    @HttpPost
    global static ResponseBody post() {
        RequestBody body = (RequestBody)JSON.deserialize(RestContext.request.requestBody.toString(), RequestBody.class);
        List<String> parts = pathParts();
        if (body == null) body = new RequestBody();
        if (String.isBlank(body.stemId) && !parts.isEmpty()) body.stemId = parts[0];
        if (String.isBlank(body.supplierId) && parts.size() >= 3 && parts[1] == 'supplier') body.supplierId = parts[2];
        if (String.isBlank(body.stemId)) throw requestError('A STEM is required.');
        Id stemId = Id.valueOf(body.stemId);
        String action = parts.size() >= 2 ? parts[1].toLowerCase() : '';
        if (action == 'supplier' && parts.size() == 4 && parts[3].toLowerCase() == 'verify') {
            body.sides = new List<String>{'cost'};
            return confirmSupplierSides(stemId, body);
        }
        if (action == 'supplier' && parts.size() == 4 && parts[3].toLowerCase() == 'confirm') return confirmSupplierSides(stemId, body);
        if (action == 'supplier' && parts.size() == 5 && parts[4].toLowerCase() == 'confirm') {
            body.sides = new List<String>{normalizedSide(parts[3])};
            return confirmSupplierSides(stemId, body);
        }
        if (action == 'buyer' && parts.size() == 3 && parts[2].toLowerCase() == 'confirm') {
            throw requestError('The Variable Charges workflow changed. Refresh FCOS and confirm each supplier buyer-charge side.');
        }
        throw requestError('Unsupported Variable Charges action.');
    }

    @HttpGet
    global static ResponseBody get() {
        List<String> parts = pathParts();
        if (parts.size() < 4 || parts[1].toLowerCase() != 'supplier') throw requestError('Unsupported Variable Charges readiness request.');
        Id stemId = Id.valueOf(parts[0]);
        Id supplierId = Id.valueOf(parts[2]);
        if (!VariableChargeInvoiceReadinessService.exactSupplierIds(stemId).contains(supplierId)) throw requestError('The selected Account is not an exact active supplier on this STEM.');
        String side = parts.size() == 4 && parts[3].toLowerCase() == 'fingerprint'
            ? 'cost'
            : parts.size() == 5 && parts[4].toLowerCase() == 'fingerprint' ? normalizedSide(parts[3]) : null;
        if (side == null) throw requestError('Unsupported Variable Charges readiness request.');
        ResponseBody response = baseResponse(stemId, supplierId);
        if (side == 'cost') {
            response.costFingerprint = VariableChargeInvoiceReadinessService.supplierFingerprint(stemId, supplierId);
            response.fingerprint = response.costFingerprint;
        } else {
            response.buyerFingerprint = VariableChargeInvoiceReadinessService.buyerChargeFingerprint(stemId, supplierId);
            response.fingerprint = response.buyerFingerprint;
        }
        STEM__c stem = [SELECT LastModifiedDate FROM STEM__c WHERE Id = :stemId LIMIT 1];
        response.lastModifiedAt = iso(stem.LastModifiedDate);
        return response;
    }

    private static ResponseBody confirmSupplierSides(Id stemId, RequestBody body) {
        if (String.isBlank(body.supplierId) || String.isBlank(body.verifierEmail)) throw requestError('An exact supplier and verifier email are required.');
        Set<String> sides = new Set<String>();
        for (String requested : body.sides == null ? new List<String>() : body.sides) sides.add(normalizedSide(requested));
        sides.remove(null);
        if (sides.isEmpty()) throw requestError('Select at least one Variable Charges side to confirm.');
        Id supplierId = Id.valueOf(body.supplierId);
        STEM__c stem = [SELECT Id, LastModifiedDate FROM STEM__c WHERE Id = :stemId LIMIT 1 FOR UPDATE];
        assertTimestamp(stem.LastModifiedDate, body.expectedStemLastModifiedAt, 'The STEM changed after it was opened.');
        if (!VariableChargeInvoiceReadinessService.exactSupplierIds(stemId).contains(supplierId)) throw requestError('The selected Account is not an exact active supplier on this STEM.');
        if (!VariableChargeInvoiceReadinessService.requiredSupplierIds(stemId).contains(supplierId)) throw requestError('This supplier is not currently required in Variable Charges.');
        assertTaskActionable(stemId);
        if (String.isNotBlank(body.gmOverrideReason) && body.gmOverrideReason.trim().length() < 5) throw requestError('A General Manager override reason of at least 5 characters is required.');

        String key = String.valueOf(stemId) + ':' + String.valueOf(supplierId);
        List<STEM_Variable_Charge_Supplier__c> existing = [
            SELECT Id, External_Key__c, STEM__c, Supplier__c, Manual_Review_Required__c,
                Supplier_Status__c, Verified_At__c, Verified_By_Email__c,
                Reviewed_Source_Fingerprint__c, Revision__c, Buyer_Charge_Status__c,
                Buyer_Charge_Reviewed_Source_Fingerprint__c, Buyer_Charge_Confirmed_At__c,
                Buyer_Charge_Confirmed_By_Email__c, Buyer_Charge_Revision__c, LastModifiedDate
            FROM STEM_Variable_Charge_Supplier__c WHERE External_Key__c = :key LIMIT 1 FOR UPDATE
        ];
        STEM_Variable_Charge_Supplier__c stage;
        if (existing.isEmpty()) {
            if (String.isNotBlank(body.expectedStageLastModifiedAt)) throw requestError('The supplier stage changed after it was opened.');
            stage = new STEM_Variable_Charge_Supplier__c(STEM__c = stemId, Supplier__c = supplierId, External_Key__c = key, Manual_Review_Required__c = false);
        } else {
            stage = existing[0];
            assertTimestamp(stage.LastModifiedDate, body.expectedStageLastModifiedAt, 'The supplier stage changed after it was opened.');
        }
        String costFingerprint;
        String buyerFingerprint;
        if (sides.contains('cost')) {
            costFingerprint = VariableChargeInvoiceReadinessService.supplierFingerprint(stemId, supplierId);
            String expectedCost = String.isNotBlank(body.expectedCostFingerprint) ? body.expectedCostFingerprint : body.expectedFingerprint;
            if (String.isBlank(expectedCost) || expectedCost.toLowerCase() != costFingerprint) throw requestError('Supplier cost data changed after review. Refresh and review the cost side again.');
            stage.Supplier_Status__c = 'Verified';
            stage.Verified_At__c = System.now();
            stage.Verified_By_Email__c = body.verifierEmail.trim().toLowerCase();
            stage.Reviewed_Source_Fingerprint__c = costFingerprint;
        }
        if (sides.contains('buyer_charge')) {
            buyerFingerprint = VariableChargeInvoiceReadinessService.buyerChargeFingerprint(stemId, supplierId);
            if (String.isBlank(body.expectedBuyerFingerprint) || body.expectedBuyerFingerprint.toLowerCase() != buyerFingerprint) throw requestError('Buyer-charge data changed after review. Refresh and review the buyer-charge side again.');
            stage.Buyer_Charge_Status__c = 'Verified';
            stage.Buyer_Charge_Confirmed_At__c = System.now();
            stage.Buyer_Charge_Confirmed_By_Email__c = body.verifierEmail.trim().toLowerCase();
            stage.Buyer_Charge_Reviewed_Source_Fingerprint__c = buyerFingerprint;
        }
        upsert stage External_Key__c;
        if (sides.contains('buyer_charge') && allBuyerSidesReady(stemId)) {
            stem.Variable_Charges_Confirmed__c = true;
            update stem;
        }
        stage = [SELECT Id, Supplier_Status__c, Revision__c, Buyer_Charge_Status__c,
            Buyer_Charge_Revision__c, LastModifiedDate
            FROM STEM_Variable_Charge_Supplier__c WHERE External_Key__c = :key LIMIT 1];
        ResponseBody response = baseResponse(stemId, supplierId);
        response.stageId = stage.Id;
        response.supplierStatus = stage.Supplier_Status__c;
        response.buyerChargeStatus = stage.Buyer_Charge_Status__c;
        response.revision = stage.Revision__c == null ? 0 : stage.Revision__c.intValue();
        response.buyerChargeRevision = stage.Buyer_Charge_Revision__c == null ? 0 : stage.Buyer_Charge_Revision__c.intValue();
        response.costFingerprint = costFingerprint;
        response.buyerFingerprint = buyerFingerprint;
        response.fingerprint = sides.size() == 1 ? (sides.contains('cost') ? costFingerprint : buyerFingerprint) : null;
        response.buyerConfirmed = [SELECT Variable_Charges_Confirmed__c FROM STEM__c WHERE Id = :stemId].Variable_Charges_Confirmed__c;
        response.lastModifiedAt = iso(stage.LastModifiedDate);
        return response;
    }

    private static Boolean allBuyerSidesReady(Id stemId) {
        for (Id requiredSupplierId : VariableChargeInvoiceReadinessService.requiredSupplierIds(stemId)) {
            if (VariableChargeInvoiceReadinessService.evaluateBuyerSupplier(stemId, requiredSupplierId).ready != true) return false;
        }
        return true;
    }

    private static void assertSupplierTrader(Id stemId, Id supplierId, String verifierEmail) {
        List<Nomination__c> nominations = [
            SELECT Id, Buyer_Supplier_Trader__c, BT_ST_Email_Address__c
            FROM Nomination__c
            WHERE STEM__c = :stemId AND Account__c = :supplierId AND Deprecated__c = false
                AND RecordTypeId = :FCBStatic.SUPPLIER_NOMINATION_RT_ID
        ];
        if (nominations.isEmpty()) throw requestError('No active Supplier Nomination is assigned. A reasoned GM/Admin override is required.');
        Set<String> resolved = new Set<String>();
        Set<String> unresolvedNames = new Set<String>();
        for (Nomination__c nomination : nominations) {
            String email = normalizeEmail(nomination.BT_ST_Email_Address__c);
            if (String.isNotBlank(email)) resolved.add(email);
            else if (String.isNotBlank(nomination.Buyer_Supplier_Trader__c)) unresolvedNames.add(nomination.Buyer_Supplier_Trader__c.trim());
        }
        if (!unresolvedNames.isEmpty()) {
            Map<String, Set<String>> emailsByName = new Map<String, Set<String>>();
            for (User user : [SELECT Name, Email FROM User WHERE IsActive = true AND Name IN :unresolvedNames]) {
                if (!emailsByName.containsKey(user.Name)) emailsByName.put(user.Name, new Set<String>());
                if (String.isNotBlank(user.Email)) emailsByName.get(user.Name).add(normalizeEmail(user.Email));
            }
            for (String name : unresolvedNames) {
                if (!emailsByName.containsKey(name) || emailsByName.get(name).size() != 1) throw requestError('The Supplier Trader does not resolve uniquely. A reasoned GM/Admin override is required.');
                resolved.addAll(emailsByName.get(name));
            }
        }
        if (resolved.size() != 1 || !resolved.contains(normalizeEmail(verifierEmail))) throw requestError('Only the resolved Supplier Trader may verify this supplier.');
    }

    private static void assertTaskActionable(Id stemId) {
        VariableChargeInvoiceReadinessService.Readiness readiness =
            VariableChargeInvoiceReadinessService.evaluateTaskActionability(stemId);
        if (readiness.ready != true) throw requestError(readiness.reason);
    }

    private static ResponseBody baseResponse(Id stemId, Id supplierId) {
        ResponseBody response = new ResponseBody();
        response.stemId = String.valueOf(stemId);
        response.supplierId = supplierId == null ? null : String.valueOf(supplierId);
        return response;
    }

    private static List<String> pathParts() {
        String suffix = RestContext.request.requestURI.substringAfter('/fcos/variable-charges/');
        List<String> result = new List<String>();
        for (String part : suffix.split('/')) if (String.isNotBlank(part)) result.add(part);
        return result;
    }

    private static void assertTimestamp(Datetime actual, String expected, String message) {
        if (String.isBlank(expected) || iso(actual) != expected) throw requestError(message);
    }

    private static String normalizeEmail(String value) {
        return String.isBlank(value) ? '' : value.trim().toLowerCase();
    }

    private static String normalizedSide(String value) {
        String side = String.isBlank(value) ? '' : value.trim().toLowerCase().replace('-', '_');
        if (side == 'cost' || side == 'buyer_charge') return side;
        throw requestError('Only cost and buyer-charge sides are supported.');
    }

    private static String iso(Datetime value) {
        return value == null ? null : value.formatGmt('yyyy-MM-dd\'T\'HH:mm:ss.SSS\'Z\'');
    }

    private static AuraHandledException requestError(String message) {
        RestContext.response.statusCode = 409;
        AuraHandledException error = new AuraHandledException(message);
        error.setMessage(message);
        return error;
    }
}
