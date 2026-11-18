public with sharing class FcosTradeCurrencyController {
    @AuraEnabled
    public static FcosTradeCurrencyService.Review preview(Id recordId, String direction) {
        FcosTradeCurrencyService.Review existing = FcosTradeCurrencyService.review(recordId,direction,null);
        if (!existing.enabled || !existing.hongKong || existing.confirmedAt != null) return existing;
        Boolean agentDefault = FcosTradeCurrencyService.isInitialAgentHkdDefault(recordId,direction);
        try {
            FcosTradeCurrencyService.Review reviewed = FcosTradeCurrencyService.review(recordId,direction,FcosCompanyFxRateService.current());
            return agentDefault ? proposeCurrency(reviewed,'HKD') : reviewed;
        } catch(FcosCompanyFxRateService.FxException error) {
            // USD may continue without an FX authority; a marked HKD proposal may not.
            if (!agentDefault && existing.currencyCode == 'USD') return existing;
            throw error;
        }
    }
    private static FcosTradeCurrencyService.Review proposeCurrency(FcosTradeCurrencyService.Review review, String currencyCode) {
        if (currencyCode != 'HKD' || review.rate == null || review.rate <= 0) {
            throw new AuraHandledException('An authoritative Hong Kong company rate is required.');
        }
        Decimal economicUsd = review.currencyCode == 'HKD' ? review.nativeUnitPrice / review.rate : review.nativeUnitPrice;
        review.nativeUnitPrice = (economicUsd * review.rate).setScale(8,RoundingMode.HALF_UP);
        review.usdUnitPrice = economicUsd;
        review.currencyCode = currencyCode;
        return review;
    }
    @AuraEnabled
    public static FcosTradeCurrencyService.Review previewCurrency(Id recordId, String direction, String currencyCode) {
        if (currencyCode != 'USD' && currencyCode != 'HKD') throw new AuraHandledException('Choose USD or HKD.');
        return previewSelectedCurrency(preview(recordId,direction), currencyCode);
    }
    private static FcosTradeCurrencyService.Review previewSelectedCurrency(FcosTradeCurrencyService.Review result, String currencyCode) {
        if (result.confirmedAt != null && result.currencyCode != currencyCode) throw new AuraHandledException('Changing confirmed currency requires an amendment.');
        if (currencyCode == 'HKD' && (!result.hongKong || result.rate == null || result.rate <= 0)) throw new AuraHandledException('An authoritative Hong Kong company rate is required.');
        if (currencyCode == 'HKD') return proposeCurrency(result,currencyCode);
        Decimal economicUsd = result.currencyCode == 'HKD' ? result.nativeUnitPrice/result.rate : result.nativeUnitPrice;
        result.nativeUnitPrice = economicUsd.setScale(8,RoundingMode.HALF_UP);
        result.usdUnitPrice = economicUsd;
        result.currencyCode = currencyCode;
        return result;
    }
    @AuraEnabled
    public static FcosTradeCurrencyService.Review saveDraft(Id recordId, String direction, String currencyCode, Decimal nativeUnitPrice, String reviewedFingerprint, String reviewedRateId, Boolean confirmSide) {
        FcosTradeCurrencyService.Review existing = FcosTradeCurrencyService.review(recordId,direction,null);
        FcosCompanyFxRateService.Snapshot rate;
        if (existing.confirmedAt == null && (currencyCode == 'HKD' || existing.currencyCode == 'HKD')) {
            rate = FcosCompanyFxRateService.confirm(reviewedRateId);
        }
        return FcosTradeCurrencyService.save(recordId,direction,currencyCode,nativeUnitPrice,reviewedFingerprint,rate,confirmSide == true);
    }
    @AuraEnabled
    public static FcosTradeCurrencyService.Review amendCurrency(Id recordId,String direction,String currencyCode,Decimal nativeUnitPrice,String reviewedFingerprint,String reviewedRateId,String reason) {
        FcosCompanyFxRateService.Snapshot rate=FcosCompanyFxRateService.confirm(reviewedRateId);
        return FcosTradeCurrencyService.amend(recordId,direction,currencyCode,nativeUnitPrice,reviewedFingerprint,rate,reason);
    }
    @AuraEnabled
    public static FcosCompanyFxRateService.Snapshot previewAmendmentRate() {
        if (!FeatureManagement.checkPermission('Fcos_Trading_FX_Amend')) throw new AuraHandledException('FX amendment permission is required.');
        return FcosCompanyFxRateService.current();
    }

    @AuraEnabled
    public static FcosTradeCurrencyService.Review previewFixture(String fixtureId, Id recordId, String direction, String currencyCode) {
        if (currencyCode != null && currencyCode != 'USD' && currencyCode != 'HKD') throw new AuraHandledException('Choose USD or HKD.');
        FcosTradeCurrencyService.Review reviewed = FcosTradeCurrencyService.previewEditorFixture(fixtureId, recordId, direction);
        return currencyCode == null ? reviewed : previewSelectedCurrency(reviewed, currencyCode);
    }

    @AuraEnabled
    public static FcosTradeCurrencyService.Review saveFixture(String fixtureId, Id recordId, String direction,
        String currencyCode, Decimal nativeUnitPrice, String reviewedFingerprint, String reviewedRateId, Boolean confirmSide) {
        return FcosTradeCurrencyService.saveEditorFixture(fixtureId, recordId, direction, currencyCode,
            nativeUnitPrice, reviewedFingerprint, reviewedRateId, confirmSide == true);
    }

    @AuraEnabled
    public static void teardownFixture(String payload, String signature) {
        FcosTradeCurrencyService.teardownEditorFixture(payload, signature);
    }
}
