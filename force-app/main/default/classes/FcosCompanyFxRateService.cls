/** Dedicated, fail-closed connection to the company's immutable USD/HKD authority. */
public with sharing class FcosCompanyFxRateService {
    public class FxException extends Exception {}
    public class Snapshot {
        @AuraEnabled public String rateId;
        @AuraEnabled public String revision;
        @AuraEnabled public Decimal usdHkdRate;
        @AuraEnabled public Datetime effectiveAt;
    }
    @TestVisible private static Fcos_Trading_FX_Setting__c settingsOverride;
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
    private static Snapshot fetch(String purpose, Date paymentDate, String reviewedRateId) {
        Fcos_Trading_FX_Setting__c config = settings();
        if (!enabled() || String.isBlank(config.Endpoint__c) || !config.Endpoint__c.startsWith('https://')
            || !config.Endpoint__c.endsWith('/api/salesforce/company-fx') || String.isBlank(config.Signing_Secret__c)) {
            throw new FxException('Company FX is not configured. HKD entry remains disabled.');
        }
        Map<String, Object> payload = new Map<String, Object>{ 'purpose' => purpose };
        if (paymentDate != null) payload.put('paymentDate', String.valueOf(paymentDate));
        if (purpose == 'confirmation') {
            if (String.isBlank(reviewedRateId)) throw new FxException('Review the company rate before confirming.');
            payload.put('reviewedRateId', reviewedRateId);
        }
        String body = JSON.serialize(payload);
        String timestamp = Datetime.now().formatGmt('yyyy-MM-dd\'T\'HH:mm:ss.SSS\'Z\'');
        String eventId = EncodingUtil.convertToHex(Crypto.generateAesKey(128));
        String signature = EncodingUtil.convertToHex(Crypto.generateMac('HmacSHA256',
            Blob.valueOf(timestamp + '.' + eventId + '.' + body), Blob.valueOf(config.Signing_Secret__c)));
        HttpRequest request = new HttpRequest();
        request.setEndpoint(config.Endpoint__c);
        request.setMethod('POST');
        request.setTimeout(15000);
        request.setHeader('Content-Type', 'application/json');
        request.setHeader('x-salesforce-org-id', UserInfo.getOrganizationId());
        request.setHeader('x-salesforce-event-id', eventId);
        request.setHeader('x-salesforce-timestamp', timestamp);
        request.setHeader('x-salesforce-signature', 'sha256=' + signature);
        request.setBody(body);
        HttpResponse response;
        try { response = new Http().send(request); }
        catch (Exception error) { throw new FxException('Company FX is unavailable. No HKD confirmation or payment was recorded.'); }
        if (response.getStatusCode() == 409) throw new FxException('The company rate changed. Review the refreshed rate before confirming.');
        if (response.getStatusCode() != 200) throw new FxException('No approved company rate is available for this request.');
        try {
            Map<String, Object> envelope = (Map<String, Object>) JSON.deserializeUntyped(response.getBody());
            if (envelope.get('ok') != true || envelope.get('purpose') != purpose || envelope.get('requestId') != eventId) {
                throw new FxException('Invalid company rate response.');
            }
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
