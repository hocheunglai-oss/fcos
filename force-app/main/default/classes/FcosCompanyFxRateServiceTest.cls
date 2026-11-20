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
            if (statusCode == 200 && (responseMode == 'valid' || responseMode.startsWith('fixture'))) {
                Map<String, Object> requestBody = (Map<String, Object>) JSON.deserializeUntyped(request.getBody());
                Map<String, Object> envelope = new Map<String, Object>{
                    'ok' => true,
                    'purpose' => requestBody.get('purpose'),
                    'requestId' => request.getHeader('x-salesforce-event-id'),
                    'rate' => new Map<String, Object>{
                        'rateId' => 'immutable-rate-1',
                        'revision' => 9,
                        'usdHkdRate' => '7.800000',
                        'effectiveAt' => '2026-09-01T00:00:00.000Z'
                    }
                };
                if (responseMode.startsWith('fixture')) {
                    Map<String, Object> scope = (Map<String, Object>)requestBody.get('scope');
                    if (responseMode == 'fixture-wrong-record') scope.put('recordId', '0QL000000000002GAA');
                    envelope.put('scope', scope);
                    envelope.put('environment', 'devee');
                }
                response.setBody(JSON.serialize(envelope));
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

    private static FcosTradeCurrencyService.Context fixtureContext() {
        FcosTradeCurrencyService.Context context = new FcosTradeCurrencyService.Context();
        context.scopeId = '0Q0000000000001';
        context.row = new QuoteLineItem(Id='0QL000000000001');
        context.direction = 'Sell';
        context.portName = 'Hong Kong';
        return context;
    }

    private static FcosCompanyFxRateService.EditorFixtureEnrollment enrollmentFor(FcosTradeCurrencyService.Context context) {
        FcosCompanyFxRateService.EditorFixtureEnrollment enrollment = new FcosCompanyFxRateService.EditorFixtureEnrollment();
        enrollment.fixtureId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        enrollment.actorId = UserInfo.getUserId();
        enrollment.scopeId = context.scopeId;
        enrollment.direction = context.direction;
        enrollment.recordIds = new Set<Id>{context.row.Id};
        enrollment.startsAt = System.now().addMinutes(-1);
        enrollment.expiresAt = System.now().addMinutes(1);
        return enrollment;
    }

    @IsTest
    static void fixtureEnrollmentBindsTheTypedRecordDirectionAndWindow() {
        FcosTradeCurrencyService.Context context = fixtureContext();
        FcosCompanyFxRateService.EditorFixtureEnrollment enrollment = enrollmentFor(context);
        Map<String, String> scope = FcosCompanyFxRateService.fixtureScope(enrollment, context, UserInfo.getUserId(), System.now());
        System.assertEquals(String.valueOf(context.row.Id), scope.get('recordId'));
        System.assertEquals('Sell', scope.get('direction'));
        try {
            FcosCompanyFxRateService.fixtureScope(enrollment, context, UserInfo.getUserId(), enrollment.expiresAt);
            System.assert(false, 'An expired enrollment must not authorize even a preview.');
        } catch (FcosCompanyFxRateService.FxException error) {
            System.assert(error.getMessage().contains('outside its fixture enrollment'));
        }
        context.direction = 'sell';
        try {
            FcosCompanyFxRateService.fixtureScope(enrollment, context, UserInfo.getUserId(), System.now());
            System.assert(false, 'A mismatched direction must not authorize a fixture request.');
        } catch (FcosCompanyFxRateService.FxException error) {
            System.assert(error.getMessage().contains('outside its fixture enrollment'));
        }
    }

    @IsTest
    static void fixtureCalloutUsesDedicatedTransportAndRejectsDifferentResponseScope() {
        configure(false);
        FcosTradeCurrencyService.Context context = fixtureContext();
        if ((Id)UserInfo.getOrganizationId() != FcosCompanyFxRateService.DEVEE) {
            try {
                FcosCompanyFxRateService.editorFixtureRate(enrollmentFor(context), context, 'preview', null);
                System.assert(false, 'The fixture path must be disabled outside DEVEE.');
            } catch (FcosCompanyFxRateService.FxException error) {
                System.assert(error.getMessage().contains('only in DEVEE'));
            }
            System.assertEquals(0, Limits.getCallouts());
            return;
        }
        Id profileId = [SELECT Id FROM Profile WHERE Name='FCB Trader' AND PermissionsModifyAllData=false LIMIT 1].Id;
        User actor = new User(Alias='fxroute', LastName='FX Route Rehearsal', Email='fxroute@example.com',
            Username='fxroute.'+UserInfo.getOrganizationId()+'.'+System.now().getTime()+'@example.com',
            EmailEncodingKey='UTF-8', LanguageLocaleKey='en_US', LocaleSidKey='en_US',
            TimeZoneSidKey='Asia/Hong_Kong', ProfileId=profileId);
        insert actor;
        insert new PermissionSetAssignment(AssigneeId=actor.Id,
            PermissionSetId=[SELECT Id FROM PermissionSet WHERE Name='Fcos_Trading_FX_Access' LIMIT 1].Id);
        System.runAs(actor) {
            FcosCompanyFxRateService.EditorFixtureEnrollment enrollment = enrollmentFor(context);
            Test.setMock(HttpCalloutMock.class, new CompanyFxMock(200, 'fixture-valid'));
            Test.startTest();
            System.assertEquals('immutable-rate-1', FcosCompanyFxRateService.editorFixtureRate(enrollment, context, 'preview', null).rateId);
            System.assertEquals('callout:FCOS_DEVEE_Editor_Fixture/api/fixtures/salesforce/company-fx', capturedRequest.getEndpoint());
            System.assertEquals(String.valueOf(FcosCompanyFxRateService.DEVEE), capturedRequest.getHeader('x-salesforce-org-id'));
            Test.setMock(HttpCalloutMock.class, new CompanyFxMock(200, 'fixture-wrong-record'));
            try {
                FcosCompanyFxRateService.editorFixtureRate(enrollment, context, 'preview', null);
                System.assert(false, 'A response for an unenrolled record must be refused.');
            } catch (FcosCompanyFxRateService.FxException error) {
                System.assert(error.getMessage().contains('could not be verified'));
            }
            Integer callouts = Limits.getCallouts();
            try {
                FcosCompanyFxRateService.editorFixtureRate(enrollment, context, 'payment', null);
                System.assert(false, 'The fixture path cannot serve payment rates.');
            } catch (FcosCompanyFxRateService.FxException error) {
                System.assert(error.getMessage().contains('scoped preview or confirmation'));
            }
            System.assertEquals(callouts, Limits.getCallouts());
            Test.stopTest();
        }
    }

    @IsTest
    static void signedEnrollmentBindsFullScopeAndPurpose() {
        Blob key = EncodingUtil.base64Decode('MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3uehgDQuKJ+ng00naEYa14fm8C/r26KW89Im5SAB+QTdSVL/ZArQsTu90D4KcPykxa4uAUYrvv59bOi0RyKjlFraWKNTgP3tipdBbWlYcll44sTz9GQv4gCY+14E5GPsdd0auxJJ/rIEfY88xeqC51k0MtZXNaZpsiyN8b4AaqTS7IK7n01aFQ5lq4SCKqIrwRfTJluYRxJuHrkPN4PStTh/4yrvUPa4Js4H4sB52BTVUy+1xHWgI+KgYQsT/gDKGbCM+dzGwJrYbkdMM1YXZkyN5CCEmH5UYZoJwDEpvaenEpyTP4sf0vuMBrkOJl1LEAY/spBjGerGM3eQrtTX7wIDAQAB');
        String grant = 'C9aUG0Rzhb24CybX7NGz0v8eR2lM/bVHl2Usz8RyaeNbziAAAep86SAayZ7yyA1Ouye7SlBUUhzZDphucWIerIJ2WD10X8LMa3Pf30IqWyIgg7sEQuZSlQTG2NYMdRnNyii1Sc2KX9Pn+JveSWhyTmWChvNerHQo/kVY4CLrOJWeFSEmGd9rmlujjfMFIaLmkTxNczjFqZoYwWVCgbRmnnX7qziLx6Fk5haNeLab88qF9IheoQKy8c9qvmxYhrcb8UScz/92nKinbbML8XE2KyYOYS7WM1NZd9zrYPt3XkxS6cF0mXerlvsEhvi7jlGOMfc8EZPTl+1tysAYyg8wZA==';
        String ordinary = 'nGlufor9sSb8fmrEpNod7stJ5NXu2/NRv2VOWuFJrElFY7XaDp/iQgfov8wPToJzGWvkfAVOMB+LEti+GKLz9JEzsmGUZ5Hzuduqpn0h5Sns3knCEB0Q6rmE/2nUPIPDGYabZpShjvzYXuCNLqqHSJTlaS/xDFRxxC0EqX9KKWSkA+FmmX0j2TsX0p5DfJEgvEKHxu2cIWyzSdGbpgAXF5TW/IYyStTMyAKcqPvFQW0q4zQgdprXVgm4B4yjXJC8df77caZTq1qlukAOzFu9pjGZ8/9YPYAtMqf5ZYHfgUnmoZagfO8nM5ZV6Hq7r5ti4gBH8r6pKbCJfHo3XVj2rA==';
        String payload = 'eyJmaXh0dXJlSWQiOiJhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhIiwiYWN0b3JJZCI6IjAwNTAwMDAwMDAwMDAwMUFBQSIsInJvb3RJZCI6IjBRMDAwMDAwMDAwMDAwMUNBQSIsImRpcmVjdGlvbiI6IlNlbGwiLCJyZWNvcmRJZHMiOlsiMFFMMDAwMDAwMDAwMDAxR0FBIiwiMFFMMDAwMDAwMDAwMDAyR0FBIl0sInN0YXJ0c0F0Ijo2MDgwMDAwMDAwMDAsImV4cGlyZXNBdCI6NjA4MDAwNjAwMDAwfQ==';
        String altered = 'eyJmaXh0dXJlSWQiOiJhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhIiwiYWN0b3JJZCI6IjAwNTAwMDAwMDAwMDAwMUFBQSIsInJvb3RJZCI6IjBRMDAwMDAwMDAwMDAwMUNBQSIsImRpcmVjdGlvbiI6IkJ1eSIsInJlY29yZElkcyI6WyIwUUwwMDAwMDAwMDAwMDFHQUEiLCIwUUwwMDAwMDAwMDAwMDJHQUEiXSwic3RhcnRzQXQiOjYwODAwMDAwMDAwMCwiZXhwaXJlc0F0Ijo2MDgwMDA2MDAwMDB9';
        FcosTradeCurrencyService.Context context = fixtureContext();
        Id actor = '005000000000001AAA';
        Datetime active = Datetime.newInstance(608000300000L);
        Map<String, String> scope = new Map<String, String>{'fixtureId' => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'};
        FcosCompanyFxRateService.EditorFixtureEnrollment enrollment = FcosCompanyFxRateService.verifyEnrollment(
            payload, grant, key, scope, context, actor, active);
        System.assertEquals(new Set<Id>{(Id)'0QL000000000001GAA', (Id)'0QL000000000002GAA'}, enrollment.recordIds);
        System.assertEquals(context.scopeId, enrollment.scopeId);
        for (String rejected : new List<String>{'altered', 'wrong-purpose', 'other-actor', 'expired'}) {
            try {
                FcosCompanyFxRateService.verifyEnrollment(rejected=='altered' ? altered : payload,
                    rejected=='wrong-purpose' ? ordinary : grant, key, scope, context,
                    rejected=='other-actor' ? (Id)'005000000000002AAA' : actor,
                    rejected=='expired' ? Datetime.newInstance(608000600000L) : active);
                System.assert(false, rejected + ' enrollment was accepted.');
            } catch (FcosCompanyFxRateService.FxException error) {
                System.assert(error.getMessage().contains('could not be verified'), rejected);
            }
        }
    }

    @IsTest
    static void signedTeardownClaimsBindPurposeActorAndExpiry() {
        if ((Id)UserInfo.getOrganizationId() != FcosCompanyFxRateService.DEVEE) return;
        Blob key = EncodingUtil.base64Decode('MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAozNlD1SHUgfM4Z3pE0OLe4CffeYeENxydbRQQPVm8tb5S3zFssRHpmVhUD0LALOkGSzf9SMJ1Hh0F9kRzrzfjuRdcNhtLVj8KLa5ae7oO00NClqizpsKZN+8Bw/g5dolL2U5c1FlnuxkyN3ctr64hyiiekO4inZPCjPL4PX7p6Dy56D0viowc0i3jsAJKHhG0aM15MwfJwK0duxBdMR1+QdqHFwJasSD3dX/p1NA07UDY83fx63FAW3yqdFigQTxwMVeZJkKd3/cDhrS8pQFVmgHPDX44+50qe/JYEzRroMtjS7kzhjd6m+VmiDmBRVz+Kr6J7WHV3W7dtDPp6k1hwIDAQAB');
        String payload = 'eyJzY2hlbWFWZXJzaW9uIjoxLCJwdXJwb3NlIjoiZGV2ZWUtZWRpdG9yLWZpeHR1cmUtdGVhcmRvd24iLCJvcmdJZCI6IjAwRDFtMDAwMDAwOGtpb0VBQSIsImZpeHR1cmVJZCI6ImFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWEiLCJhY3RvcklkIjoiMDA1MDAwMDAwMDAwMDAxQUFBIiwib3BlcmF0aW9uSWQiOiJmaXh0dXJlLWNyZWF0ZS10ZXN0LTEiLCJzb3VyY2VUcmVlSGFzaCI6ImJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmIiLCJjcmVhdGlvbkRpZ2VzdCI6ImNjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2MiLCJzYXZlRGlnZXN0IjoiZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZCIsIm9ic2VydmF0aW9uRGlnZXN0IjoiZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZSIsInNjb3BlSWQiOiIwUTAwMDAwMDAwMDAwMDFDQUEiLCJyZWNvcmRJZCI6IjBRTDAwMDAwMDAwMDAwMUdBQSIsImRpcmVjdGlvbiI6IlNlbGwiLCJyZWNvcmRJZHMiOlsiMFFMMDAwMDAwMDAwMDAxR0FBIl0sInNpZGVJZCI6ImExNTAwMDAwMDAwMDAwMUFBQSIsImZpbmdlcnByaW50IjoiZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZiIsImlzc3VlZEF0TXMiOjYwODAwMDAwMDAwMCwiZXhwaXJlc0F0TXMiOjYwODAwMDA2MDAwMH0=';
        String signature = 'TktLGWAK5Uv2OpimUHXHFFhTjjZtoFpIY7KeEEgEStdjBxHBAwsY8W1BUmY/xxHcfC9v+ih+E5FF0niDpyORq+LeWIMRp5ongrU9MHF8D0DbL2BA83CxPkh9QW3JnpGfJ6BXLr4hHr36wYoE0wMfd7y8/vtJxWBY2N4f0vYyYI628oR0dW6BCKB5W4TInACFOqgW3U2gWkqOxGFT56lNJ3IwG4Z8ZvjQ2CLSEU9jJjU7k7Sq1n0ALTzUZ6UYlamkengPxFgIn+Q5b/PCeURdv8MwwyqG26J/lGeO5SeO0jFmDMdLNYGJDtyk3M59QkRhzv9bUkhB6j6NoYZBGvpddg==';
        String enrollmentSignature = 'gYmfcESiwcXTv6R5sQ4dRbgGUXr+rgePPNpgfW0T6oVZeUrryRPc7PTNVWk6+Zv3xQxYAjAL4TmgUaBwBJ6Uk5Y8Gl2mXtQwwocdNOZ2VJ3tsiNr1A8nbgPhjLYmviLeeaFk1UYg1Wyn9UxpoJhIN0VWq1qNgYNO7hkF/X16vZ72ZZkKO88ycyfs7LG4mv4qKj/evtJ5cPRAQOQ1JzRN7W/qq1dxekIv97N8P9p8y9a/tuHrECMMQa6G8sge3r8HCoQBEQAQZ29lMP4lH9q95fUYVekKMy7a8oqjJq1GTuLzLTHF4xtIi0m1CNSmtOcGf0wp5E73J8NrGVoHKjyeTw==';
        String altered = 'eyJzY2hlbWFWZXJzaW9uIjoxLCJwdXJwb3NlIjoiZGV2ZWUtZWRpdG9yLWZpeHR1cmUtdGVhcmRvd24iLCJvcmdJZCI6IjAwRDFtMDAwMDAwOGtpb0VBQSIsImZpeHR1cmVJZCI6ImFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWEiLCJhY3RvcklkIjoiMDA1MDAwMDAwMDAwMDAxQUFBIiwib3BlcmF0aW9uSWQiOiJmaXh0dXJlLWNyZWF0ZS10ZXN0LTEiLCJzb3VyY2VUcmVlSGFzaCI6ImJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmIiLCJjcmVhdGlvbkRpZ2VzdCI6ImNjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2MiLCJzYXZlRGlnZXN0IjoiZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZCIsIm9ic2VydmF0aW9uRGlnZXN0IjoiZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZSIsInNjb3BlSWQiOiIwUTAwMDAwMDAwMDAwMDFDQUEiLCJyZWNvcmRJZCI6IjBRTDAwMDAwMDAwMDAwMUdBQSIsImRpcmVjdGlvbiI6IkJ1eSIsInJlY29yZElkcyI6WyIwUUwwMDAwMDAwMDAwMDFHQUEiXSwic2lkZUlkIjoiYTE1MDAwMDAwMDAwMDAxQUFBIiwiZmluZ2VycHJpbnQiOiJmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmIiwiaXNzdWVkQXRNcyI6NjA4MDAwMDAwMDAwLCJleHBpcmVzQXRNcyI6NjA4MDAwMDYwMDAwfQ==';
        Id actor = '005000000000001AAA';
        Datetime now = Datetime.newInstance(608000030000L);
        FcosCompanyFxRateService.EditorFixtureTeardownClaim decoded = FcosCompanyFxRateService.verifyTeardownClaim(
            payload, signature, key, actor, now);
        System.assertEquals(actor, decoded.actorId);
        System.assertEquals('fixture-create-test-1', decoded.operationId);
        System.assertEquals(new List<Id>{(Id)'0QL000000000001GAA'}, decoded.recordIds);
        for (String rejected : new List<String>{'altered','other-purpose','other-actor','expired'}) {
            try {
                FcosCompanyFxRateService.verifyTeardownClaim(rejected=='altered' ? altered : payload,
                    rejected=='other-purpose' ? enrollmentSignature : signature, key,
                    rejected=='other-actor' ? (Id)'005000000000002AAA' : actor,
                    rejected=='expired' ? Datetime.newInstance(608000060000L) : now);
                System.assert(false, rejected + ' teardown claim was accepted.');
            } catch (FcosCompanyFxRateService.FxException error) {
                System.assert(error.getMessage().contains('could not be verified'), rejected);
            }
        }
    }
}
