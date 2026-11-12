import { api, LightningElement, wire } from 'lwc';
import { getRecord } from 'lightning/uiRecordApi';
import { getObjectInfo, getPicklistValues } from 'lightning/uiObjectInfoApi';
import { CloseActionScreenEvent } from 'lightning/actions';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import PAYMENT_OBJECT from '@salesforce/schema/Payment__c';
import BANK_FIELD from '@salesforce/schema/Payment__c.Bank__c';
import previewAllocation from '@salesforce/apex/FcosTradePaymentService.previewAllocation';
import recordPayment from '@salesforce/apex/FcosTradePaymentService.recordPayment';
import recordUsdReissuePayment from '@salesforce/apex/FcosTradePaymentService.recordUsdReissuePayment';

const BANK_CURRENCY_OPTIONS = [
    { label: 'USD bank account', value: 'USD' },
    { label: 'HKD bank account', value: 'HKD' },
];

function errorMessage(error) {
    return error?.body?.message || error?.message || 'The payment review could not be loaded. Refresh and try again.';
}

function money(value, currency) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return new Intl.NumberFormat('en-HK', {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(Number(value));
}

export default class FcosTradePaymentEditor extends LightningElement {
    @api recordId;

    recordLoaded = false;
    recordError;
    paymentInfo;
    bankPicklist;
    review;
    nativeAmount = '';
    paymentDate = '';
    bankName = '';
    bankCurrencyCode = '';
    bankNativeAmount = '';
    bankEvidence = '';
    error;
    isLoading = false;
    isSaving = false;
    requestVersion = 0;
    pendingOperation;

    // The record wire proves the action is opened on an accessible record. All
    // financial values remain server-authoritative through previewAllocation.
    @wire(getRecord, { recordId: '$recordId', layoutTypes: ['Full'], modes: ['View'] })
    wiredRecord({ data, error }) {
        if (data) {
            this.recordLoaded = true;
            this.recordError = undefined;
            this.refreshAllocation();
        } else if (error) {
            this.recordLoaded = false;
            this.recordError = errorMessage(error);
        }
    }

    @wire(getObjectInfo, { objectApiName: PAYMENT_OBJECT })
    wiredPaymentInfo(result) {
        this.paymentInfo = result;
    }

    get paymentRecordTypeId() {
        return this.paymentInfo?.data?.defaultRecordTypeId;
    }

    @wire(getPicklistValues, { recordTypeId: '$paymentRecordTypeId', fieldApiName: BANK_FIELD })
    wiredBankPicklist(result) {
        this.bankPicklist = result;
    }

    get bankOptions() {
        return this.bankPicklist?.data?.values || [];
    }

    get bankCurrencyOptions() {
        return BANK_CURRENCY_OPTIONS;
    }

    get isCreditReview() {
        return Number(this.review?.invoiceNativeTotal) < 0;
    }

    get remainingLabel() {
        return this.isCreditReview ? 'Refundable cash remaining' : 'Native outstanding';
    }

    get showReview() {
        return Boolean(this.review);
    }

    get isHkdReview() {
        return this.review?.currencyCode === 'HKD';
    }

    get isUsdReview() {
        return this.review?.currencyCode === 'USD';
    }

    get nativeAllocationLabel() {
        return this.review?.currencyCode ? `${this.review.currencyCode} allocation` : 'Native allocation';
    }

    get bankAmountHelpText() {
        if (!this.isUsdReview) return 'Enter the actual amount on the bank statement.';
        return 'For a USD bank account, this must equal the USD allocation magnitude. For an HKD bank account, retain the actual statement amount.';
    }

    get reviewRate() {
        return this.review?.usdHkdRate == null ? 'Select a payment date to review the company rate.'
            : `${this.review.usdHkdRate} HKD per USD`;
    }

    get rateStatus() {
        if (!this.review?.rateId) return 'No payment-date rate has been reviewed.';
        return `Rate ${this.review.rateId} effective ${this.review.effectiveAt}`;
    }

    get invoiceNativeTotal() {
        return money(this.review?.invoiceNativeTotal, this.review?.currencyCode || 'HKD');
    }

    get remainingNative() {
        return money(this.review?.remainingNative, this.review?.currencyCode || 'HKD');
    }

    get invoiceUsdTotal() {
        return money(this.review?.invoiceUsdTotal, 'USD');
    }

    get remainingCarryingUsd() {
        return money(this.review?.remainingCarryingUsd, 'USD');
    }

    get cashUsd() {
        return money(this.review?.cashUsd, 'USD');
    }

    get carryingUsd() {
        return money(this.review?.carryingUsd, 'USD');
    }

    get settlementFxUsd() {
        return money(this.review?.settlementFxUsd, 'USD');
    }

    get controlsDisabled() {
        return this.isLoading || this.isSaving || Boolean(this.pendingOperation);
    }

    get canRecord() {
        return !this.isSaving && !this.isLoading && Boolean(this.pendingOperation || (this.paymentDate && (this.isUsdReview || (this.isHkdReview && this.review?.rateId))));
    }

    get recordDisabled() {
        return !this.canRecord;
    }

    connectedCallback() {
        // recordId is assigned by the record action after construction; the
        // record wire above starts the first server review when it is available.
    }

    async refreshAllocation() {
        if (this.pendingOperation) return;
        if (!this.recordId || !this.recordLoaded) return;
        const version = ++this.requestVersion;
        this.isLoading = true;
        this.error = undefined;
        try {
            const review = await previewAllocation({
                invoiceId: this.recordId,
                nativeAmount: this.nativeAmount === '' ? null : this.nativeAmount,
                paymentDate: this.paymentDate || null,
            });
            if (version === this.requestVersion) this.review = review;
        } catch (error) {
            if (version === this.requestVersion) this.error = errorMessage(error);
        } finally {
            if (version === this.requestVersion) this.isLoading = false;
        }
    }

    handleNativeAmountChange(event) {
        this.nativeAmount = event.target.value;
        this.invalidateRateReview();
        this.refreshAllocation();
    }

    handlePaymentDateChange(event) {
        this.paymentDate = event.target.value;
        this.invalidateRateReview();
        this.refreshAllocation();
    }

    invalidateRateReview() {
        if (!this.review) return;
        this.review = {
            ...this.review,
            rateId: null,
            usdHkdRate: null,
            effectiveAt: null,
            cashUsd: null,
            carryingUsd: null,
            settlementFxUsd: null,
        };
    }

    handleBankNameChange(event) {
        this.bankName = event.detail.value;
    }

    handleBankCurrencyChange(event) {
        this.bankCurrencyCode = event.detail.value;
    }

    handleBankNativeAmountChange(event) {
        this.bankNativeAmount = event.target.value;
    }

    handleBankEvidenceChange(event) {
        this.bankEvidence = event.target.value;
    }

    validateInputs() {
        return [...this.template.querySelectorAll('lightning-input, lightning-combobox, lightning-textarea')]
            .every((input) => {
                input.reportValidity();
                return input.checkValidity();
            });
    }

    handleNewRequest() {
        if (this.isSaving) return;
        this.pendingOperation = undefined;
        this.nativeAmount = '';
        this.bankNativeAmount = '';
        this.bankEvidence = '';
        this.invalidateRateReview();
        this.refreshAllocation();
    }

    async handleRecord() {
        if (this.isSaving || (!this.pendingOperation && (!this.validateInputs() || !this.canRecord))) return;
        this.isSaving = true;
        this.error = undefined;
        try {
            if (!this.pendingOperation) {
                const request = {
                    operationId: crypto.randomUUID(),
                    invoiceId: this.recordId,
                    nativeAmount: this.nativeAmount,
                    paymentDate: this.paymentDate,
                    bankName: this.bankName,
                    bankCurrencyCode: this.bankCurrencyCode,
                    bankNativeAmount: this.bankNativeAmount,
                    bankEvidence: this.bankEvidence,
                };
                this.pendingOperation = this.isHkdReview
                    ? { ...request, reviewedRateId: this.review.rateId }
                    : request;
            }
            const paymentId = this.pendingOperation.reviewedRateId
                ? await recordPayment({ ...this.pendingOperation })
                : await recordUsdReissuePayment({ ...this.pendingOperation });
            this.dispatchEvent(new ShowToastEvent({
                title: 'Native payment recorded',
                message: this.pendingOperation.reviewedRateId
                    ? `Payment ${paymentId} was recorded with the reviewed HKD rate.`
                    : `Payment ${paymentId} was recorded as the exact USD allocation.`,
                variant: 'success',
            }));
            this.dispatchEvent(new CustomEvent('paymentrecorded', {
                detail: { paymentId, invoiceId: this.recordId, review: this.review },
                bubbles: true,
                composed: true,
            }));
            this.dispatchEvent(new CloseActionScreenEvent());
        } catch (error) {
            this.error = errorMessage(error);
            this.error += ' Retry this same request to retrieve its payment safely. Check Salesforce before starting a different payment.';
        } finally {
            this.isSaving = false;
        }
    }
}
