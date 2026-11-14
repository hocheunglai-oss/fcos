@IsTest
private class FcosCompanyFxRateServiceTest {
    private static HttpRequest capturedRequest;

    private class CompanyFxMock implements HttpCalloutMock {
        private Integer statusCode;
        private String responseMode;
        CompanyFxMock(Integer statusCode, String responseMode) {
            this.statusCode = statusCode;
            this.responseMode = responseMode;
        }
        public HttpResponse respond(HttpRequest request) {
            capturedRequest = request;
            HttpResponse response = new HttpResponse();
            response.setStatusCode(statusCode);
            if (statusCode == 200 && responseMode == 'valid') {
                Map<String, Object> requestBody = (Map<String, Object>) JSON.deserializeUntyped(request.getBody());
                response.setBody(JSON.serialize(new Map<String, Object>{
                    'ok' => true,
                    'purpose' => requestBody.get('purpose'),
                    'requestId' => request.getHeader('x-salesforce-event-id'),
                    'rate' => new Map<String, Object>{
                        'rateId' => 'immutable-rate-1',
                        'revision' => 9,
                        'usdHkdRate' => '7.800000',
                        'effectiveAt' => '2026-09-01T00:00:00.000Z'
                    }
                }));
            } else if (statusCode == 200 && responseMode == 'invalid-rate') {
                response.setBody('{"ok":true,"purpose":"preview","requestId":"' + request.getHeader('x-salesforce-event-id') + '","rate":{"rateId":"","usdHkdRate":"0","effectiveAt":null}}');
            } else {
                response.setBody('{"ok":false}');
            }
            return response;
        }
    }

    private static void configure(Boolean enabled) {
        FcosCompanyFxRateService.settingsOverride = new Fcos_Trading_FX_Setting__c(
            Enabled__c = enabled
        );
        capturedRequest = null;
    }

    private static void assertDedicatedSignedRequest(String expectedPurpose, Date expectedPaymentDate) {
        System.assertNotEquals(null, capturedRequest, 'The enabled service must make its dedicated company-FX callout.');
        System.assertEquals('POST', capturedRequest.getMethod());
        System.assertEquals('https://fcos.fcuno.com/api/salesforce/company-fx', capturedRequest.getEndpoint());
        System.assertEquals('application/json', capturedRequest.getHeader('Content-Type'));
        System.assertEquals(UserInfo.getOrganizationId(), capturedRequest.getHeader('x-salesforce-org-id'));
        String eventId = capturedRequest.getHeader('x-salesforce-event-id');
        String timestamp = capturedRequest.getHeader('x-salesforce-timestamp');
        System.assert(eventId != null && Pattern.matches('[0-9A-Fa-f]{32}', eventId), 'A dedicated request event ID is required.');
        Datetime signedAt = (Datetime) JSON.deserialize(JSON.serialize(timestamp), Datetime.class);
        System.assert(Math.abs(Datetime.now().getTime() - signedAt.getTime()) <= 300000, 'The request timestamp must be current.');
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(capturedRequest.getBody());
        System.assertEquals(expectedPurpose, body.get('purpose'));
        if (expectedPaymentDate == null) System.assertEquals(false, body.containsKey('paymentDate'));
        else System.assertEquals(String.valueOf(expectedPaymentDate), body.get('paymentDate'));
        System.assertEquals('rsa-sha256=Zml4dHVyZQ==', capturedRequest.getHeader('x-salesforce-signature'));
    }

    @IsTest
    static void currentUsesDedicatedSignatureHeadersAndTimestamp() {
        configure(true);

        Test.setMock(HttpCalloutMock.class, new CompanyFxMock(200, 'valid'));

        Test.startTest();
        FcosCompanyFxRateService.Snapshot result = FcosCompanyFxRateService.current();
        Test.stopTest();

        assertDedicatedSignedRequest('preview', null);
        System.assertEquals('immutable-rate-1', result.rateId);
        System.assertEquals('9', result.revision);
        System.assertEquals(Decimal.valueOf('7.8'), result.usdHkdRate);
    }

    @IsTest
    static void disabledConfigurationFailsClosedBeforeAnyCallout() {
        configure(false);
        try {
            FcosCompanyFxRateService.current();
            System.assert(false, 'Disabled FX configuration must reject HKD use.');
        } catch (FcosCompanyFxRateService.FxException error) {
            System.assert(error.getMessage().contains('not configured'));
        }
        System.assertEquals(null, capturedRequest);
    }

    @IsTest
    static void invalidAndUnavailableRatesFailClosed() {
        configure(true);

        Test.setMock(HttpCalloutMock.class, new CompanyFxMock(200, 'invalid-rate'));
        try {
            FcosCompanyFxRateService.current();
            System.assert(false, 'Invalid rate payloads must be rejected.');
        } catch (FcosCompanyFxRateService.FxException error) {
            System.assert(error.getMessage().contains('could not be verified'));
        }

        Test.setMock(HttpCalloutMock.class, new CompanyFxMock(503, 'unavailable'));
        try {
            FcosCompanyFxRateService.current();
            System.assert(false, 'Unavailable rates must reject HKD use.');
        } catch (FcosCompanyFxRateService.FxException error) {
            System.assert(error.getMessage().contains('No approved company rate'));
        }
    }

    @IsTest
    static void confirmationRejectsChangedRate() {
        configure(true);

        Test.setMock(HttpCalloutMock.class, new CompanyFxMock(409, 'changed'));
        try {
            FcosCompanyFxRateService.confirm('rate-reviewed');
            System.assert(false, 'A changed reviewed rate must be rejected.');
        } catch (FcosCompanyFxRateService.FxException error) {
            System.assert(error.getMessage().contains('rate changed'));
        }
        assertDedicatedSignedRequest('confirmation', null);
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(capturedRequest.getBody());
        System.assertEquals('rate-reviewed', body.get('reviewedRateId'));
    }

    @IsTest
    static void paymentDatesNeverFallBackToCurrentRate() {
        configure(true);
        try {
            FcosCompanyFxRateService.forPaymentDate(null);
            System.assert(false, 'A payment date must be explicit.');
        } catch (FcosCompanyFxRateService.FxException error) {
            System.assert(error.getMessage().contains('payment date is required'));
        }
        System.assertEquals(null, capturedRequest);

        Date paymentDate = Date.newInstance(2026, 9, 10);

        Test.setMock(HttpCalloutMock.class, new CompanyFxMock(200, 'valid'));
        FcosCompanyFxRateService.Snapshot result = FcosCompanyFxRateService.forPaymentDate(paymentDate);
        assertDedicatedSignedRequest('payment', paymentDate);
        System.assertEquals('immutable-rate-1', result.rateId);
    }
}
