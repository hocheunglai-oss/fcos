import { api, LightningElement } from 'lwc';
import { CloseActionScreenEvent } from 'lightning/actions';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import entryContext from '@salesforce/apex/FcosTradeCashService.entryContext';
import previewCash from '@salesforce/apex/FcosTradeCashService.previewCash';
import recordCash from '@salesforce/apex/FcosTradeCashService.recordCash';
import cashPosition from '@salesforce/apex/FcosTradeCashService.cashPosition';
import previewAllocation from '@salesforce/apex/FcosTradeCashService.previewAllocation';
import allocate from '@salesforce/apex/FcosTradeCashService.allocate';
import previewReversal from '@salesforce/apex/FcosTradeCashService.previewReversal';
import reverseAllocation from '@salesforce/apex/FcosTradeCashService.reverseAllocation';

const MODE_OPTIONS = [
    { label: 'Record actual cash', value: 'payment' },
    { label: 'Refund unallocated cash', value: 'refund' },
    { label: 'Apply cash to a final invoice', value: 'allocation' },
];
const BANK_CURRENCY_OPTIONS = [
    { label: 'USD bank account', value: 'USD' },
    { label: 'HKD bank account', value: 'HKD' },
];

function message(error) {
    return error?.body?.message || error?.message || 'The native cash review could not be completed.';
}

function money(value, currency = 'USD') {
    if (value == null || value === '' || !Number.isFinite(Number(value))) return '—';
    return new Intl.NumberFormat('en-HK', {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(Number(value));
}

function eventCurrency(row) {
    return row?.Currency__c || 'USD';
}

function eventNative(row) {
    return eventCurrency(row) === 'HKD' ? row?.Cash_HKD_Amount__c : row?.Cash_USD_Amount__c;
}

function allocationNative(row) {
    return row?.Currency__c === 'HKD' ? row?.Allocated_HKD__c : row?.Allocated_Cash_USD__c;
}

function inputValue(event) {
    return event.detail?.value ?? event.target?.value ?? '';
}

export default class FcosTradeCashEditor extends LightningElement {
    _recordId;
    context;
    mode = 'payment';
    selectedSideId = '';
    selectedCashId = '';
    selectedInvoiceId = '';
    selectedAllocationId = '';
    nativeAmount = '';
    paymentDate = '';
    bankName = '';
    bankCurrencyCode = '';
    bankNativeAmount = '';
    bankEvidence = '';
    reference = '';
    position;
    cashReview;
    allocationReview;
    reversalFingerprint;
    reviewedCashRequestJson;
    pendingCashOperationId;
    pendingAllocationOperationId;
    pendingReversalOperationId;
    error;
    isLoading = false;
    isSaving = false;
    contextSequence = 0;
    positionSequence = 0;

    @api
    set recordId(value) {
        if (value === this._recordId) return;
        this._recordId = value;
        if (value) this.loadContext();
    }

    get recordId() {
        return this._recordId;
    }

    get modeOptions() {
        return MODE_OPTIONS;
    }

    get bankCurrencyOptions() {
        return BANK_CURRENCY_OPTIONS;
    }

    get bankOptions() {
        return this.context?.banks || [];
    }

    get sideOptions() {
        return (this.context?.sides || []).map((side) => ({
            label: side.needsConfirmation ? `${side.label} — confirm currency first` : side.label,
            value: side.value,
            disabled: Boolean(side.needsConfirmation),
        }));
    }

    get cashOptions() {
        return (this.context?.events || [])
            .filter((row) => row.Kind__c === 'Payment')
            .map((row) => ({
                value: row.Id,
                label: `${row.Reference__c || row.Name || 'Cash'} — ${row.Direction__c} ${money(eventNative(row), eventCurrency(row))} on ${row.Payment_Date__c}`,
            }));
    }

    get invoiceOptions() {
        const selected = this.selectedCashEvent;
        return (this.context?.invoices || [])
            .filter((row) => !selected || (row.Supplier__c ? 'Buy' : 'Sell') === selected.Direction__c
                && row.Document_Currency__c === selected.Currency__c)
            .map((row) => ({ value: row.Id,
                label: `${row.Supplier__c ? 'Supplier' : 'Buyer'}: ${row.Name} — ${row.Document_Currency__c}` }));
    }

    get selectedSide() {
        return (this.context?.sides || []).find((side) => side.value === this.selectedSideId);
    }

    get selectedCashEvent() {
        return (this.context?.events || []).find((row) => row.Id === this.selectedCashId);
    }

    get selectedAllocation() {
        return (this.position?.allocations || []).find((row) => row.Id === this.selectedAllocationId);
    }

    get showPayment() {
        return this.mode === 'payment';
    }

    get showRefund() {
        return this.mode === 'refund';
    }

    get showAllocation() {
        return this.mode === 'allocation';
    }

    get showCashForm() {
        return this.showPayment || this.showRefund;
    }

    get showPosition() {
        return Boolean(this.position && this.selectedCashEvent);
    }

    get showCashReview() {
        return Boolean(this.cashReview);
    }

    get showAllocationReview() {
        return Boolean(this.allocationReview);
    }

    get showReversalReview() {
        return Boolean(this.reversalFingerprint && this.selectedAllocation);
    }

    get controlsDisabled() {
        return this.isLoading || this.isSaving;
    }

    get cashCommitDisabled() {
        return this.controlsDisabled || !this.cashReview || !this.reviewedCashRequestJson;
    }

    get allocationCommitDisabled() {
        return this.controlsDisabled || !this.allocationReview;
    }

    get reversalCommitDisabled() {
        return this.controlsDisabled || !this.reversalFingerprint;
    }

    get cashNativeLabel() {
        const currency = this.cashReview?.currencyCode || this.selectedSide?.currencyCode || this.selectedCashEvent?.Currency__c;
        return currency ? `${currency} cash amount` : 'Native cash amount';
    }

    get allocationNativeLabel() {
        const currency = this.selectedCashEvent?.Currency__c;
        return currency ? `${currency} amount to apply` : 'Native amount to apply';
    }

    get cashReviewNative() {
        return money(this.cashReview?.nativeAmount, this.cashReview?.currencyCode);
    }

    get cashReviewUsd() {
        return money(this.cashReview?.cashUsd, 'USD');
    }

    get cashReviewOriginalUsd() {
        return money(this.cashReview?.originalCarryingUsd, 'USD');
    }

    get cashReviewSettlementFx() {
        return money(this.cashReview?.settlementFxUsd, 'USD');
    }

    get cashReviewRate() {
        if (!this.cashReview) return '—';
        return this.cashReview.currencyCode === 'USD'
            ? 'USD organisation base currency'
            : `${this.cashReview.rate} HKD per USD · ${this.cashReview.rateId} · effective ${this.cashReview.effectiveAt}`;
    }

    get selectedEventNative() {
        return money(eventNative(this.selectedCashEvent), eventCurrency(this.selectedCashEvent));
    }

    get selectedEventUsd() {
        return money(this.selectedCashEvent?.Cash_USD_Amount__c, 'USD');
    }

    get selectedEventRate() {
        if (!this.selectedCashEvent) return '—';
        return this.selectedCashEvent.Currency__c === 'USD'
            ? 'USD organisation base currency'
            : `${this.selectedCashEvent.FX_Rate__c} HKD per USD · ${this.selectedCashEvent.FX_Revision__c} · effective ${this.selectedCashEvent.FX_Effective_At__c}`;
    }

    get positionNative() {
        return money(this.position?.nativeRemaining, eventCurrency(this.selectedCashEvent));
    }

    get positionUsd() {
        return money(this.position?.cashUsdRemaining, 'USD');
    }

    get positionBank() {
        return money(this.position?.bankRemaining, this.selectedCashEvent?.Bank_Currency__c || eventCurrency(this.selectedCashEvent));
    }

    get allocationCashUsd() {
        return money(this.allocationReview?.cashUsd, 'USD');
    }

    get allocationCarryingUsd() {
        return money(this.allocationReview?.carryingUsd, 'USD');
    }

    get allocationSettlementFx() {
        return money(this.allocationReview?.settlementFxUsd, 'USD');
    }

    get allocationBankAmount() {
        return money(this.allocationReview?.bankAmount,
            this.selectedCashEvent?.Bank_Currency__c || this.allocationReview?.currencyCode);
    }

    get allocationNativeReviewed() {
        return money(this.allocationReview?.nativeAmount, this.allocationReview?.currencyCode);
    }

    get allocationAvailableCash() {
        return money(this.allocationReview?.availableCashNative, this.allocationReview?.currencyCode);
    }

    get allocationInvoiceRemaining() {
        return money(this.allocationReview?.invoiceRemainingNative, this.allocationReview?.currencyCode);
    }

    get allocationRows() {
        const rows = this.position?.allocations || [];
        const reversed = new Set(rows.filter((row) => row.Kind__c === 'Reversal').map((row) => row.Reverses_Allocation__c));
        return rows.map((row) => ({
            id: row.Id,
            name: row.Name || row.Id,
            kind: row.Kind__c,
            amount: money(allocationNative(row), row.Currency__c),
            cashUsd: money(row.Allocated_Cash_USD__c, 'USD'),
            carryingUsd: money(row.Invoice_Carrying_USD__c, 'USD'),
            settlementFx: money(row.Settlement_FX_USD__c, 'USD'),
            date: row.Allocation_Date__c,
            invoice: row.Buyer_Invoice__r?.Name || row.Supplier_Invoice__r?.Name || row.Buyer_Invoice__c || row.Supplier_Invoice__c,
            canReverse: row.Kind__c === 'Applied' && !reversed.has(row.Id),
        }));
    }

    get refundRows() {
        return (this.position?.refunds || []).map((row) => ({
            id: row.Id,
            amount: money(eventNative(row), row.Currency__c),
            cashUsd: money(row.Cash_USD_Amount__c, 'USD'),
            settlementFx: money(row.Settlement_FX_USD__c, 'USD'),
            date: row.Payment_Date__c,
            bank: row.Bank__c,
            bankAmount: money(row.Bank_Native_Amount__c, row.Bank_Currency__c),
        }));
    }

    get hasAllocationRows() {
        return this.allocationRows.length > 0;
    }

    get hasRefundRows() {
        return this.refundRows.length > 0;
    }

    get reversalAmount() {
        return money(allocationNative(this.selectedAllocation), this.selectedAllocation?.Currency__c);
    }

    async loadContext() {
        const sequence = ++this.contextSequence;
        this.isLoading = true;
        this.error = undefined;
        try {
            const result = await entryContext({ recordId: this.recordId });
            if (sequence !== this.contextSequence) return;
            this.context = result;
            if (!this.paymentDate) this.paymentDate = result.hongKongDate;
            if (!this.selectedSideId && result.sides?.length === 1 && !result.sides[0].needsConfirmation) {
                this.selectedSideId = result.sides[0].value;
            }
        } catch (error) {
            if (sequence === this.contextSequence) this.error = message(error);
        } finally {
            if (sequence === this.contextSequence) this.isLoading = false;
        }
    }

    async loadPosition() {
        if (!this.selectedCashId) {
            this.position = undefined;
            return;
        }
        const sequence = ++this.positionSequence;
        this.isLoading = true;
        this.error = undefined;
        try {
            const result = await cashPosition({ cashEventId: this.selectedCashId });
            if (sequence === this.positionSequence) this.position = result;
        } catch (error) {
            if (sequence === this.positionSequence) {
                this.position = undefined;
                this.error = message(error);
            }
        } finally {
            if (sequence === this.positionSequence) this.isLoading = false;
        }
    }

    resetReviews() {
        this.cashReview = undefined;
        this.allocationReview = undefined;
        this.reversalFingerprint = undefined;
        this.selectedAllocationId = '';
        this.reviewedCashRequestJson = undefined;
        this.pendingCashOperationId = undefined;
        this.pendingAllocationOperationId = undefined;
        this.pendingReversalOperationId = undefined;
        this.error = undefined;
    }

    invalidateCashReview() {
        this.cashReview = undefined;
        this.reviewedCashRequestJson = undefined;
        this.pendingCashOperationId = undefined;
        this.error = undefined;
    }

    invalidateAllocationReview() {
        this.allocationReview = undefined;
        this.pendingAllocationOperationId = undefined;
        this.reversalFingerprint = undefined;
        this.pendingReversalOperationId = undefined;
        this.selectedAllocationId = '';
        this.error = undefined;
    }

    handleModeChange(event) {
        this.mode = event.detail.value;
        this.selectedCashId = '';
        this.selectedInvoiceId = '';
        this.position = undefined;
        this.nativeAmount = '';
        this.resetReviews();
    }

    handleSideChange(event) {
        this.selectedSideId = event.detail.value;
        this.invalidateCashReview();
    }

    handleCashChange(event) {
        this.selectedCashId = event.detail.value;
        this.selectedInvoiceId = '';
        this.nativeAmount = '';
        this.resetReviews();
        this.loadPosition();
    }

    handleInvoiceChange(event) {
        this.selectedInvoiceId = event.detail.value;
        this.invalidateAllocationReview();
    }

    handleNativeChange(event) {
        this.nativeAmount = inputValue(event);
        if (this.showCashForm) this.invalidateCashReview();
        else this.invalidateAllocationReview();
    }

    handlePaymentDateChange(event) {
        this.paymentDate = inputValue(event);
        this.invalidateCashReview();
    }

    handleBankChange(event) {
        this.bankName = event.detail.value;
        this.invalidateCashReview();
    }

    handleBankCurrencyChange(event) {
        this.bankCurrencyCode = event.detail.value;
        this.invalidateCashReview();
    }

    handleBankAmountChange(event) {
        this.bankNativeAmount = inputValue(event);
        this.invalidateCashReview();
    }

    handleBankEvidenceChange(event) {
        this.bankEvidence = inputValue(event);
        this.invalidateCashReview();
    }

    handleReferenceChange(event) {
        this.reference = inputValue(event);
        this.invalidateCashReview();
    }

    validate(selector) {
        return [...this.template.querySelectorAll(selector)].every((control) => {
            control.reportValidity();
            return control.checkValidity();
        });
    }

    cashRequest() {
        const refund = this.showRefund;
        return {
            tradeRecordId: refund ? null : this.selectedSide?.tradeRecordId,
            direction: refund ? this.selectedCashEvent?.Direction__c : this.selectedSide?.direction,
            proformaId: null,
            originalCashId: refund ? this.selectedCashId : null,
            kind: refund ? 'Refund' : 'Payment',
            nativeAmount: this.nativeAmount,
            paymentDate: this.paymentDate,
            reviewedRateId: null,
            bankName: this.bankName,
            bankCurrencyCode: this.bankCurrencyCode,
            bankNativeAmount: this.bankNativeAmount,
            bankEvidence: this.bankEvidence,
            reference: this.reference || null,
        };
    }

    async handlePreviewCash() {
        if (this.controlsDisabled || !this.validate('.cash-input')) return;
        if (this.showPayment && !this.selectedSide) {
            this.error = 'Select a confirmed trading side.';
            return;
        }
        if (this.showRefund && !this.selectedCashEvent) {
            this.error = 'Select the original cash event to refund.';
            return;
        }
        const requestJson = JSON.stringify(this.cashRequest());
        this.isLoading = true;
        this.error = undefined;
        try {
            this.cashReview = await previewCash({ requestJson });
            this.reviewedCashRequestJson = requestJson;
            this.pendingCashOperationId = undefined;
        } catch (error) {
            this.cashReview = undefined;
            this.reviewedCashRequestJson = undefined;
            this.error = message(error);
        } finally {
            this.isLoading = false;
        }
    }

    async handleRecordCash() {
        if (this.cashCommitDisabled) return;
        this.isSaving = true;
        this.error = undefined;
        if (!this.pendingCashOperationId) this.pendingCashOperationId = crypto.randomUUID();
        try {
            const originalCashId = this.showRefund ? this.selectedCashId : null;
            const eventId = await recordCash({ requestJson: this.reviewedCashRequestJson,
                reviewedFingerprint: this.cashReview.fingerprint, operationId: this.pendingCashOperationId });
            this.toast(this.showRefund ? 'Cash refund recorded' : 'Actual cash recorded', `Cash event ${eventId} was recorded.`);
            await this.afterCashMutation(originalCashId);
        } catch (error) {
            this.error = `${message(error)} Retry this unchanged reviewed request to recover the same operation safely.`;
        } finally {
            this.isSaving = false;
        }
    }

    async handlePreviewAllocation() {
        if (this.controlsDisabled || !this.validate('.allocation-input') || !this.selectedCashEvent) return;
        this.isLoading = true;
        this.error = undefined;
        try {
            this.allocationReview = await previewAllocation({ cashEventId: this.selectedCashId,
                invoiceId: this.selectedInvoiceId, nativeAmount: this.nativeAmount });
            this.pendingAllocationOperationId = undefined;
        } catch (error) {
            this.allocationReview = undefined;
            this.error = message(error);
        } finally {
            this.isLoading = false;
        }
    }

    async handleAllocate() {
        if (this.allocationCommitDisabled) return;
        this.isSaving = true;
        this.error = undefined;
        if (!this.pendingAllocationOperationId) this.pendingAllocationOperationId = crypto.randomUUID();
        try {
            const allocationId = await allocate({ cashEventId: this.selectedCashId, invoiceId: this.selectedInvoiceId,
                nativeAmount: this.nativeAmount, reviewedFingerprint: this.allocationReview.fingerprint,
                operationId: this.pendingAllocationOperationId });
            this.toast('Cash applied', `Allocation ${allocationId} was recorded against the final invoice.`);
            this.allocationReview = undefined;
            this.pendingAllocationOperationId = undefined;
            this.nativeAmount = '';
            await this.loadContext();
            await this.loadPosition();
        } catch (error) {
            this.error = `${message(error)} Retry this unchanged reviewed allocation to recover the same operation safely.`;
        } finally {
            this.isSaving = false;
        }
    }

    async handlePreviewReversal(event) {
        if (this.controlsDisabled) return;
        this.selectedAllocationId = event.currentTarget.dataset.id;
        this.reversalFingerprint = undefined;
        this.pendingReversalOperationId = undefined;
        this.isLoading = true;
        this.error = undefined;
        try {
            this.reversalFingerprint = await previewReversal({ allocationId: this.selectedAllocationId });
        } catch (error) {
            this.selectedAllocationId = '';
            this.error = message(error);
        } finally {
            this.isLoading = false;
        }
    }

    async handleReverseAllocation() {
        if (this.reversalCommitDisabled) return;
        this.isSaving = true;
        this.error = undefined;
        if (!this.pendingReversalOperationId) this.pendingReversalOperationId = crypto.randomUUID();
        try {
            const reversalId = await reverseAllocation({ allocationId: this.selectedAllocationId,
                reviewedFingerprint: this.reversalFingerprint, operationId: this.pendingReversalOperationId });
            this.toast('Application reversed', `Reversal ${reversalId} restored the cash to the on-account balance.`);
            this.reversalFingerprint = undefined;
            this.pendingReversalOperationId = undefined;
            this.selectedAllocationId = '';
            await this.loadContext();
            await this.loadPosition();
        } catch (error) {
            this.error = `${message(error)} Retry this unchanged reviewed reversal to recover the same operation safely.`;
        } finally {
            this.isSaving = false;
        }
    }

    async afterCashMutation(originalCashId) {
        this.pendingCashOperationId = undefined;
        this.cashReview = undefined;
        this.reviewedCashRequestJson = undefined;
        this.nativeAmount = '';
        this.bankNativeAmount = '';
        this.bankEvidence = '';
        this.reference = '';
        await this.loadContext();
        if (originalCashId) {
            this.selectedCashId = originalCashId;
            await this.loadPosition();
        }
    }

    toast(title, toastMessage) {
        this.dispatchEvent(new ShowToastEvent({ title, message: toastMessage, variant: 'success' }));
    }

    handleClose() {
        if (!this.isSaving) this.dispatchEvent(new CloseActionScreenEvent());
    }
}
