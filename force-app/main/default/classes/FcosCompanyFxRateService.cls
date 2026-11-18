/** Dedicated, fail-closed connection to the company's immutable USD/HKD authority. */
public with sharing class FcosCompanyFxRateService {
    public class FxException extends Exception {}
    public class Snapshot {
        @AuraEnabled public String rateId;
        @AuraEnabled public String revision;
        @AuraEnabled public Decimal usdHkdRate;
        @AuraEnabled public Datetime effectiveAt;
    }
    private static final String ENDPOINT = 'https://fcos.fcuno.com/api/salesforce/company-fx';
    private static final String SIGNING_CERTIFICATE = 'FCOS_Company_FX_Signing';
    @TestVisible private static final Id DEVEE = '00D1m0000008kioEAA';
    private static final String DEVEE_FIXTURE_ENDPOINT = 'callout:FCOS_DEVEE_Editor_Fixture/api/fixtures/salesforce/company-fx';
    private static final String DEVEE_ENROLLMENT_PREFIX = 'fcos-devee-editor-enrollment-v1\n';
    private static final String DEVEE_TEARDOWN_PREFIX = 'fcos-devee-editor-fixture-teardown-v1\n';
    private static final String DEVEE_ENROLLMENT_SPKI = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA+Fp7GrdwZ5n+I9wBCkHZ41o5pyKaX1Y63nxDzWKZo0inNlzcyKCrhKXsksLZbpTsJwu+4zzi+s/yyBXz3QjsEVN1rSYaykeTAvuCCAKfEZnzhnfJ0SjPYucQetlKQfbaeDXY17/VEq9e5KG6sKRB4iinPM4t2I1fbYZWt5jLLb1ns8Iqdr8og/tsN2g1VdXbuguAcx0c71Tx0yhWaYBeb9TZsLEf8XgpN31dvIZ269Q248YP5nvvjdjhKGEWx/EViPi5u8nXwaP7GJICX0JKLnrfnNNz0k3hAYM6Sd8MlvppvV9KYsqgqBLRBgWUGA3HysH5QWisAMrJAI8pUgIGiwIDAQAB';
    @TestVisible private static Fcos_Trading_FX_Setting__c settingsOverride;

    // Constructed by the server-side sandbox fixture enrollment reader. Never
    // accept this enrollment as an Aura or REST action input.
    public class EditorFixtureEnrollment {
        public String fixtureId;
        public Id actorId;
        public Id scopeId;
        public String direction;
        public Set<Id> recordIds;
        public Datetime startsAt;
        public Datetime expiresAt;
    }
    private class SignedEnrollmentPayload {
        public String fixtureId;
        public Id actorId;
        public Id rootId;
        public String direction;
        public List<Id> recordIds;
        public Long startsAt;
        public Long expiresAt;
    }
    public class EditorFixtureTeardownClaim {
        public Integer schemaVersion;
        public String purpose;
        public Id orgId;
        public String fixtureId;
        public Id actorId;
        public String operationId;
        public String sourceTreeHash;
        public String creationDigest;
        public String saveDigest;
        public String observationDigest;
        public Id scopeId;
        public Id recordId;
        public String direction;
        public List<Id> recordIds;
        public Id sideId;
        public String fingerprint;
        public Long issuedAtMs;
        public Long expiresAtMs;
    }

    public static EditorFixtureTeardownClaim readEditorFixtureTeardownClaim(String payload, String signature) {
        requireDeveeEditorActor();
        return verifyTeardownClaim(payload, signature, EncodingUtil.base64Decode(DEVEE_ENROLLMENT_SPKI),
            UserInfo.getUserId(), System.now());
    }

    @TestVisible
    private static EditorFixtureTeardownClaim verifyTeardownClaim(
        String encodedPayload, String encodedSignature, Blob publicKey, Id actor, Datetime now
    ) {
        try {
            String payload = verifiedFixturePayload(encodedPayload, encodedSignature, publicKey, DEVEE_TEARDOWN_PREFIX);
            EditorFixtureTeardownClaim claim = (EditorFixtureTeardownClaim)JSON.deserializeStrict(payload, EditorFixtureTeardownClaim.class);
            assertTeardownClaimIdentity(claim, actor, now);
            return claim;
        } catch (Exception error) {
            throw new FxException('The editor fixture teardown claim could not be verified.');
        }
    }

    private static void assertTeardownClaimIdentity(EditorFixtureTeardownClaim claim, Id actor, Datetime now) {
        if (claim == null || claim.orgId != DEVEE || actor == null || claim.actorId != actor || claim.schemaVersion != 1
            || !'devee-editor-fixture-teardown'.equals(claim.purpose) || String.isBlank(claim.operationId)
            || !Pattern.matches('[a-z0-9-]{8,100}', claim.operationId)
            || claim.issuedAtMs == null || claim.expiresAtMs == null || now == null || now.getTime() < claim.issuedAtMs
            || now.getTime() >= claim.expiresAtMs || claim.expiresAtMs - claim.issuedAtMs > 120000
            || claim.sideId == null || claim.sideId.getSObjectType() != Trade_Currency_Side__c.SObjectType
            || claim.scopeId == null || claim.recordId == null || claim.recordIds == null
            || !claim.recordIds.contains(claim.recordId) || claim.recordIds.contains(null)
            || new Set<Id>(claim.recordIds).size() != claim.recordIds.size()) {
            throw new FxException('The editor fixture teardown claim is outside its scope.');
        }
        for (String digest : new List<String>{claim.fixtureId, claim.sourceTreeHash, claim.creationDigest,
            claim.saveDigest, claim.observationDigest, claim.fingerprint}) {
            if (String.isBlank(digest) || !Pattern.matches('[a-f0-9]{64}', digest)) {
                throw new FxException('The editor fixture teardown claim is outside its scope.');
            }
        }
    }

    public static void assertEditorFixtureTeardownClaim(EditorFixtureTeardownClaim claim,
        EditorFixtureEnrollment enrollment, FcosTradeCurrencyService.Context context, Id sideId, String fingerprint) {
        assertEditorFixtureContext(enrollment, context);
        assertTeardownClaimIdentity(claim, UserInfo.getUserId(), System.now());
        if (!enrollment.fixtureId.equals(claim.fixtureId) || context.scopeId != claim.scopeId
            || context.row.Id != claim.recordId || !context.direction.equals(claim.direction)
            || !enrollment.recordIds.equals(new Set<Id>(claim.recordIds)) || sideId != claim.sideId
            || !claim.fingerprint.equals(fingerprint)) {
            throw new FxException('The editor fixture teardown claim does not match the locked scope.');
        }
    }
    public static Boolean enabled() {
        Fcos_Trading_FX_Setting__c settings = settings();
        return settings != null && settings.Enabled__c == true;
    }
    private static Fcos_Trading_FX_Setting__c settings() {
        return settingsOverride == null ? Fcos_Trading_FX_Setting__c.getOrgDefaults() : settingsOverride;
    }
    public static Snapshot current() { return fetch('preview', null, null); }
    public static Snapshot confirm(String reviewedRateId) { return fetch('confirmation', null, reviewedRateId); }
    public static Snapshot forPaymentDate(Date paymentDate) {
        if (paymentDate == null) throw new FxException('The Hong Kong payment date is required.');
        return fetch('payment', paymentDate, null);
    }

    public static Snapshot editorFixtureRate(EditorFixtureEnrollment enrollment, FcosTradeCurrencyService.Context context,
        String purpose, String reviewedRateId) {
        requireDeveeEditorActor();
        Map<String, Object> payload = new Map<String, Object>{
            'purpose' => purpose, 'scope' => fixtureScope(enrollment, context, UserInfo.getUserId(), System.now())
        };
        if ('confirmation'.equals(purpose) && !String.isBlank(reviewedRateId)) {
            payload.put('reviewedRateId', reviewedRateId);
        } else if (!'preview'.equals(purpose) || reviewedRateId != null) {
            throw new FxException('The editor fixture accepts scoped preview or confirmation only.');
        }
        Snapshot result = sendRateRequest(DEVEE_FIXTURE_ENDPOINT, String.valueOf(DEVEE), payload, reviewedRateId);
        fixtureScope(enrollment, context, UserInfo.getUserId(), System.now());
        return result;
    }

    public static void requireDeveeEditorActor() {
        Id orgId = (Id)UserInfo.getOrganizationId();
        if (orgId != DEVEE || ![SELECT IsSandbox FROM Organization WHERE Id=:orgId].IsSandbox) {
            throw new FxException('The editor fixture is available only in DEVEE.');
        }
        if (!FeatureManagement.checkPermission('Fcos_Trading_FX_Entry')) {
            throw new FxException('The editor fixture requires FX Entry access.');
        }
    }

    public static void assertEditorFixtureContext(EditorFixtureEnrollment enrollment, FcosTradeCurrencyService.Context context) {
        requireDeveeEditorActor();
        fixtureScope(enrollment, context, UserInfo.getUserId(), System.now());
    }

    // Called internally only for a record already resolved through the editor's
    // sharing-aware context. The runner supplies the fixture identifier only.
    public static EditorFixtureEnrollment lookupEditorFixture(String fixtureId, FcosTradeCurrencyService.Context context) {
        requireDeveeEditorActor();
        if (context == null || context.row == null) throw new FxException('The editor record is outside its fixture enrollment.');
        Id actor = UserInfo.getUserId();
        Datetime now = System.now();
        EditorFixtureEnrollment lookup = new EditorFixtureEnrollment();
        lookup.fixtureId = fixtureId;
        lookup.actorId = actor;
        lookup.scopeId = context.scopeId;
        lookup.direction = context.direction;
        lookup.recordIds = new Set<Id>{context.row.Id};
        lookup.startsAt = now;
        lookup.expiresAt = now.addSeconds(15);
        Map<String, String> scope = fixtureScope(lookup, context, actor, now);
        HttpRequest request = signedRequest(DEVEE_FIXTURE_ENDPOINT, String.valueOf(DEVEE),
            new Map<String, Object>{'purpose' => 'enrollment', 'scope' => scope});
        HttpResponse response = sendSignedRequest(request);
        try {
            Map<String, Object> envelope = (Map<String, Object>)JSON.deserializeUntyped(response.getBody());
            assertResponseIdentity(envelope, 'enrollment', request.getHeader('x-salesforce-event-id'), scope);
            Map<String, Object> grant = (Map<String, Object>)envelope.get('enrollment');
            if (grant == null || grant.size() != 2) throw new FxException('Invalid editor fixture enrollment.');
            return verifyEnrollment((String)grant.get('payload'), (String)grant.get('signature'),
                EncodingUtil.base64Decode(DEVEE_ENROLLMENT_SPKI), scope, context, actor, System.now());
        } catch (Exception error) {
            throw new FxException('The editor fixture enrollment could not be verified.');
        }
    }

    @TestVisible
    private static EditorFixtureEnrollment verifyEnrollment(String encodedPayload, String encodedSignature, Blob publicKey,
        Map<String, String> expectedScope, FcosTradeCurrencyService.Context context, Id actor, Datetime now) {
        try {
            String payload = verifiedFixturePayload(encodedPayload, encodedSignature, publicKey, DEVEE_ENROLLMENT_PREFIX);
            SignedEnrollmentPayload claims = (SignedEnrollmentPayload)JSON.deserializeStrict(payload, SignedEnrollmentPayload.class);
            if (claims == null || claims.recordIds == null || claims.recordIds.isEmpty() || claims.recordIds.contains(null)
                || claims.startsAt == null || claims.expiresAt == null || claims.expiresAt <= claims.startsAt
                || claims.expiresAt - claims.startsAt > 900000) throw new FxException('Invalid editor fixture enrollment.');
            EditorFixtureEnrollment enrollment = new EditorFixtureEnrollment();
            enrollment.fixtureId = claims.fixtureId;
            enrollment.actorId = claims.actorId;
            enrollment.scopeId = claims.rootId;
            enrollment.direction = claims.direction;
            enrollment.recordIds = new Set<Id>(claims.recordIds);
            enrollment.startsAt = Datetime.newInstance(claims.startsAt);
            enrollment.expiresAt = Datetime.newInstance(claims.expiresAt);
            if (enrollment.recordIds.size() != claims.recordIds.size()
                || !expectedScope.get('fixtureId').equals(enrollment.fixtureId)) throw new FxException('Invalid editor fixture enrollment.');
            fixtureScope(enrollment, context, actor, now);
            assertEnrollmentRecordTypes(enrollment);
            return enrollment;
        } catch (Exception error) { throw new FxException('The editor fixture enrollment could not be verified.'); }
    }

    private static String verifiedFixturePayload(String encodedPayload, String encodedSignature, Blob publicKey, String prefix) {
        if (String.isBlank(encodedPayload) || String.isBlank(encodedSignature) || encodedPayload.length() > 4096
            || encodedSignature.length() != 344) throw new FxException('Invalid editor fixture payload.');
        Blob payloadBytes = EncodingUtil.base64Decode(encodedPayload);
        Blob signature = EncodingUtil.base64Decode(encodedSignature);
        String payload = payloadBytes.toString();
        if (!encodedPayload.equals(EncodingUtil.base64Encode(payloadBytes))
            || !encodedSignature.equals(EncodingUtil.base64Encode(signature))
            || !Crypto.verify('RSA-SHA256', Blob.valueOf(prefix + payload), signature, publicKey)) {
            throw new FxException('Invalid editor fixture signature.');
        }
        return payload;
    }

    private static void assertEnrollmentRecordTypes(EditorFixtureEnrollment enrollment) {
        Boolean bid = enrollment.scopeId.getSObjectType() == Supplier_Bid__c.SObjectType;
        for (Id recordId : enrollment.recordIds) {
            Schema.SObjectType objectType = recordId.getSObjectType();
            if (bid ? recordId != enrollment.scopeId && objectType != Supplier_Bid_Extra_Cost__c.SObjectType
                : objectType != QuoteLineItem.SObjectType) throw new FxException('Invalid editor fixture enrollment.');
        }
        if (bid && !enrollment.recordIds.contains(enrollment.scopeId)) throw new FxException('Invalid editor fixture enrollment.');
    }

    @TestVisible
    private static Map<String, String> fixtureScope(EditorFixtureEnrollment enrollment, FcosTradeCurrencyService.Context context,
        Id actor, Datetime now) {
        if (enrollment == null || context == null || context.row == null || context.row.Id == null
            || actor == null || enrollment.actorId != actor || enrollment.scopeId == null || enrollment.scopeId != context.scopeId
            || enrollment.direction == null || !enrollment.direction.equals(context.direction)
            || enrollment.recordIds == null || !enrollment.recordIds.contains(context.row.Id)
            || context.formulaPrice != false || !FcosTradeCurrencyService.hongKong(context.portName, context.portCountry)
            || String.isBlank(enrollment.fixtureId) || !Pattern.matches('[a-f0-9]{64}', enrollment.fixtureId)
            || now == null || enrollment.startsAt == null || enrollment.expiresAt == null
            || now < enrollment.startsAt || now >= enrollment.expiresAt
            || enrollment.expiresAt.getTime() - enrollment.startsAt.getTime() > 900000) {
            throw new FxException('The editor record is outside its fixture enrollment.');
        }
        Id recordId = context.row.Id;
        Schema.SObjectType recordType = recordId.getSObjectType();
        Schema.SObjectType rootType = context.scopeId.getSObjectType();
        Boolean offerSide = rootType == Quote.SObjectType && recordType == QuoteLineItem.SObjectType
            && ('Sell'.equals(context.direction) || 'Buy'.equals(context.direction));
        Boolean bidSide = rootType == Supplier_Bid__c.SObjectType && 'Buy'.equals(context.direction)
            && ((recordType == Supplier_Bid__c.SObjectType && recordId == context.scopeId)
                || recordType == Supplier_Bid_Extra_Cost__c.SObjectType);
        if (!offerSide && !bidSide) throw new FxException('The editor record is outside its fixture enrollment.');
        return new Map<String, String>{ 'fixtureId' => enrollment.fixtureId, 'actorId' => String.valueOf(actor),
            'scopeId' => String.valueOf(context.scopeId), 'recordId' => String.valueOf(recordId), 'direction' => context.direction };
    }
    private static Snapshot fetch(String purpose, Date paymentDate, String reviewedRateId) {
        if (!enabled()) {
            throw new FxException('Company FX is not configured. HKD entry remains disabled.');
        }
        Map<String, Object> payload = new Map<String, Object>{ 'purpose' => purpose };
        if (paymentDate != null) payload.put('paymentDate', String.valueOf(paymentDate));
        if (purpose == 'confirmation') {
            if (String.isBlank(reviewedRateId)) throw new FxException('Review the company rate before confirming.');
            payload.put('reviewedRateId', reviewedRateId);
        }
        return sendRateRequest(ENDPOINT, UserInfo.getOrganizationId(), payload, reviewedRateId);
    }

    private static Snapshot sendRateRequest(String endpoint, String senderOrg, Map<String, Object> payload, String reviewedRateId) {
        HttpRequest request = signedRequest(endpoint, senderOrg, payload);
        return readRateResponse(sendSignedRequest(request).getBody(), (String)payload.get('purpose'),
            request.getHeader('x-salesforce-event-id'), reviewedRateId, (Map<String, String>)payload.get('scope'));
    }

    private static HttpRequest signedRequest(String endpoint, String senderOrg, Map<String, Object> payload) {
        String body = JSON.serialize(payload);
        String timestamp = Datetime.now().formatGmt('yyyy-MM-dd\'T\'HH:mm:ss.SSS\'Z\'');
        String eventId = EncodingUtil.convertToHex(Crypto.generateAesKey(128));
        Blob signedBytes = Blob.valueOf(timestamp + '.' + eventId + '.' + body);
        String signature;
        try {
            signature = Test.isRunningTest() ? 'Zml4dHVyZQ==' : EncodingUtil.base64Encode(
                Crypto.signWithCertificate('RSA-SHA256', signedBytes, SIGNING_CERTIFICATE));
        } catch (Exception error) {
            throw new FxException('Company FX is not configured. HKD entry remains disabled.');
        }
        HttpRequest request = new HttpRequest();
        request.setEndpoint(endpoint);
        request.setMethod('POST');
        request.setTimeout(15000);
        request.setHeader('Content-Type', 'application/json');
        request.setHeader('x-salesforce-org-id', senderOrg);
        request.setHeader('x-salesforce-event-id', eventId);
        request.setHeader('x-salesforce-timestamp', timestamp);
        request.setHeader('x-salesforce-signature', 'rsa-sha256=' + signature);
        request.setBody(body);
        return request;
    }

    private static HttpResponse sendSignedRequest(HttpRequest request) {
        HttpResponse response;
        try { response = new Http().send(request); }
        catch (Exception error) { throw new FxException('Company FX is unavailable. No HKD confirmation or payment was recorded.'); }
        if (response.getStatusCode() == 409) throw new FxException('The company rate changed. Review the refreshed rate before confirming.');
        if (response.getStatusCode() != 200) throw new FxException('No approved company rate is available for this request.');
        return response;
    }

    private static void assertResponseIdentity(Map<String, Object> envelope, String purpose, String eventId, Map<String, String> scope) {
        if (envelope.get('ok') != true || envelope.get('purpose') != purpose || envelope.get('requestId') != eventId) {
            throw new FxException('Invalid company rate response.');
        }
        if (scope == null) return;
        Map<String, Object> actualScope = (Map<String, Object>)envelope.get('scope');
        if (!'devee'.equals((String)envelope.get('environment')) || actualScope == null || actualScope.size() != scope.size()) {
            throw new FxException('Invalid editor fixture response.');
        }
        for (String key : scope.keySet()) {
            if (!scope.get(key).equals((String)actualScope.get(key))) throw new FxException('Invalid editor fixture response.');
        }
    }

    @TestVisible
    private static Snapshot readRateResponse(String body, String purpose, String eventId, String reviewedRateId, Map<String, String> fixtureScope) {
        try {
            Map<String, Object> envelope = (Map<String, Object>) JSON.deserializeUntyped(body);
            assertResponseIdentity(envelope, purpose, eventId, fixtureScope);
            Map<String, Object> rate = (Map<String, Object>) envelope.get('rate');
            Snapshot result = new Snapshot();
            result.rateId = (String) rate.get('rateId');
            result.revision = rate.get('revision') == null ? null : String.valueOf(rate.get('revision'));
            result.usdHkdRate = Decimal.valueOf(String.valueOf(rate.get('usdHkdRate')));
            result.effectiveAt = (Datetime) JSON.deserialize(JSON.serialize(rate.get('effectiveAt')), Datetime.class);
            if (String.isBlank(result.rateId) || result.effectiveAt == null || result.usdHkdRate <= 0 || result.usdHkdRate > 100
                || (purpose == 'confirmation' && result.rateId != reviewedRateId)) throw new FxException('Invalid company rate snapshot.');
            return result;
        } catch (Exception error) { throw new FxException('The company rate response could not be verified.'); }
    }
}
