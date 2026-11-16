import { api, LightningElement } from 'lwc';
import preview from '@salesforce/apex/FcosTradeCurrencyController.preview';
import previewCurrency from '@salesforce/apex/FcosTradeCurrencyController.previewCurrency';
import saveDraft from '@salesforce/apex/FcosTradeCurrencyController.saveDraft';
import previewAmendmentRate from '@salesforce/apex/FcosTradeCurrencyController.previewAmendmentRate';
import amendCurrency from '@salesforce/apex/FcosTradeCurrencyController.amendCurrency';
import canAmendCurrency from '@salesforce/customPermission/Fcos_Trading_FX_Amend';

const CURRENCY_OPTIONS = [
    { label: 'USD', value: 'USD' },
    { label: 'HKD', value: 'HKD' },
];

const AMENDMENT_PRICE_SCALE = 8;
// Lightning Locker can hide the global BigInt constructor. Keep exact arithmetic using literals.
const DECIMAL_DIGITS = [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n];

function decimalInteger(digits) {
    let integer = 0n;
    for (const digit of digits) {
        integer = integer * 10n + DECIMAL_DIGITS[digit];
    }
    return integer;
}

function powerOfTen(scale) {
    return 10n ** decimalInteger(String(scale));
}

function decimalParts(value) {
    const raw = String(value ?? '').trim();
    if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
    const [whole, fraction = ''] = raw.split('.');
    if (fraction.length > 16) return null;
    return {
        integer: decimalInteger(whole + fraction),
        scale: fraction.length,
    };
}

function formatScaled(integer, scale) {
    const text = integer.toString().padStart(scale + 1, '0');
    const whole = scale === 0 ? text : text.slice(0, -scale);
    const fraction = scale === 0 ? '' : text.slice(-scale).replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole;
}

function roundDivision(numerator, denominator) {
    return (numerator + denominator / 2n) / denominator;
}

function multiplyDecimal(left, right) {
    const a = decimalParts(left);
    const b = decimalParts(right);
    if (!a || !b) return '';
    const scale = a.scale + b.scale;
    let integer = a.integer * b.integer;
    if (scale > AMENDMENT_PRICE_SCALE) {
        integer = roundDivision(integer, powerOfTen(scale - AMENDMENT_PRICE_SCALE));
    } else if (scale < AMENDMENT_PRICE_SCALE) {
        integer *= powerOfTen(AMENDMENT_PRICE_SCALE - scale);
    }
    return formatScaled(integer, AMENDMENT_PRICE_SCALE);
}

function divideDecimal(left, right) {
    const a = decimalParts(left);
    const b = decimalParts(right);
    if (!a || !b || b.integer === 0n) return '';
    const numerator = a.integer * powerOfTen(b.scale + AMENDMENT_PRICE_SCALE);
    const denominator = b.integer * powerOfTen(a.scale);
    return formatScaled(roundDivision(numerator, denominator), AMENDMENT_PRICE_SCALE);
}

function errorMessage(error) {
    return error?.body?.message || error?.message || 'The trading currency review could not be completed. Refresh and try again.';
}

export default class FcosTradeCurrencyEditor extends LightningElement {
    _recordId;
    _direction;
    review;
    currency;
    nativeUnitPrice;
    error;
    isLoading = false;
    isSaving = false;
    requestVersion = 0;
    lastReviewKey;
    amendmentRate;
    amendmentOriginalReview;
    amendmentCurrency;
    amendmentNativeUnitPrice;
    amendmentReason = '';
    isAmending = false;

    @api
    get recordId() {
        return this._recordId;
    }
    set recordId(value) {
        if (this._recordId !== value) {
            this.requestVersion += 1;
            this.lastReviewKey = undefined;
            this.applyReview(undefined);
            this.cancelAmendment();
        }
        this._recordId = value;
        this.refreshReview();
    }

    @api
    get direction() {
        return this._direction;
    }
    set direction(value) {
        if (this._direction !== value) {
            this.requestVersion += 1;
            this.lastReviewKey = undefined;
            this.applyReview(undefined);
            this.cancelAmendment();
        }
        this._direction = value;
        this.refreshReview();
    }

    connectedCallback() {
        this.refreshReview();
    }

    get currencyOptions() {
        return CURRENCY_OPTIONS;
    }

    get showEditor() {
        return this.review?.enabled === true && this.review?.hongKong === true;
    }

    get isConfirmed() {
        return Boolean(this.review?.confirmedAt);
    }

    get requiresConfirmation() {
        return this.review?.needsConfirmation === true;
    }

    get controlsDisabled() {
        return this.isLoading || this.isSaving;
    }

    get currencyDisabled() {
        return this.controlsDisabled || this.isConfirmed;
    }

    get canAmend() {
        return Boolean(canAmendCurrency) && this.isConfirmed;
    }

    get amendmentVisible() {
        return this.isAmending;
    }

    get amendmentControlsDisabled() {
        return this.controlsDisabled || !this.amendmentRate;
    }

    get amendmentRateLabel() {
        return this.amendmentRate?.usdHkdRate == null
            ? 'Loading current amendment rate'
            : `${this.amendmentRate.usdHkdRate} HKD per USD`;
    }

    get amendmentNativePriceLabel() {
        return `${this.amendmentCurrency || 'USD'} amended unit price`;
    }

    get sideLabel() {
        return this.direction === 'Buy' ? 'Supplier / payable side' : 'Buyer / receivable side';
    }

    get nativePriceLabel() {
        return `${this.currency || 'USD'} unit price`;
    }

    get rateLabel() {
        return this.review?.rate == null ? 'Rate unavailable' : `${this.review.rate} HKD per USD`;
    }

    get rateStatus() {
        if (this.isConfirmed) return `Locked on ${this.review.confirmedAt}`;
        return this.review?.rateId ? `Review rate ${this.review.rateId}` : 'USD side';
    }

    applyReview(reviewResult) {
        this.review = reviewResult;
        this.currency = reviewResult?.currencyCode || 'USD';
        this.nativeUnitPrice = reviewResult?.nativeUnitPrice == null ? '' : String(reviewResult.nativeUnitPrice);
    }

    async refreshReview({ keepError = false } = {}) {
        if (!this.recordId || !this.direction) return;
        const version = ++this.requestVersion;
        this.isLoading = true;
        if (!keepError) this.error = undefined;
        try {
            const reviewResult = await preview({ recordId: this.recordId, direction: this.direction });
            if (version === this.requestVersion) {
                this.applyReview(reviewResult);
                this.emitCurrencyReview(reviewResult);
            }
        } catch (error) {
            if (version === this.requestVersion) this.error = errorMessage(error);
        } finally {
            if (version === this.requestVersion) this.isLoading = false;
        }
    }

    async handleCurrencyChange(event) {
        const currency = event.detail.value;
        const version = ++this.requestVersion;
        this.isLoading = true;
        this.error = undefined;
        try {
            const reviewResult = await previewCurrency({ recordId: this.recordId, direction: this.direction, currencyCode: currency });
            if (version === this.requestVersion) this.applyReview(reviewResult);
        } catch (error) {
            if (version === this.requestVersion) {
                this.error = errorMessage(error);
                await this.refreshReview({ keepError: true });
            }
        } finally {
            if (version === this.requestVersion) this.isLoading = false;
        }
    }

    handleNativePriceChange(event) {
        this.nativeUnitPrice = event.target.value;
    }

    emitCurrencyReview(reviewResult) {
        const key = `${this.recordId}:${this.direction}:${reviewResult?.fingerprint || ''}`;
        if (this.lastReviewKey === key) return;
        this.lastReviewKey = key;
        this.dispatchEvent(new CustomEvent('currencyreview', {
            detail: { recordId: this.recordId, direction: this.direction, review: reviewResult },
            bubbles: true,
            composed: true,
        }));
    }

    async save(confirmSide) {
        const input = this.template.querySelector('[data-id="native-price"]');
        if (!input?.checkValidity()) {
            input?.reportValidity();
            return;
        }
        const { recordId, direction } = this;
        if (!recordId || !direction || this.controlsDisabled) return;
        this.isSaving = true;
        this.error = undefined;
        try {
            const reviewResult = await saveDraft({
                recordId,
                direction,
                currencyCode: this.currency,
                nativeUnitPrice: this.nativeUnitPrice,
                reviewedFingerprint: this.review?.fingerprint,
                reviewedRateId: this.review?.rateId,
                confirmSide,
            });
            if (this.recordId !== recordId || this.direction !== direction) return;
            this.applyReview(reviewResult);
            this.dispatchEvent(new CustomEvent('currencychange', {
                detail: { recordId, direction, review: reviewResult },
                bubbles: true,
                composed: true,
            }));
        } catch (error) {
            if (this.recordId !== recordId || this.direction !== direction) return;
            this.error = errorMessage(error);
            await this.refreshReview({ keepError: true });
        } finally {
            this.isSaving = false;
        }
    }

    handleSaveDraft() {
        return this.save(false);
    }

    handleConfirm() {
        return this.save(true);
    }

    originalUsdUnitPrice() {
        if (this.amendmentOriginalReview?.currencyCode === 'HKD') {
            return divideDecimal(this.amendmentOriginalReview.nativeUnitPrice, this.amendmentOriginalReview.rate);
        }
        return String(this.amendmentOriginalReview?.nativeUnitPrice ?? '');
    }

    async handleStartAmendment() {
        const { recordId, direction, review } = this;
        if (!recordId || !direction || !review || this.controlsDisabled) return;
        this.error = undefined;
        this.isSaving = true;
        try {
            const rate = await previewAmendmentRate();
            if (this.recordId !== recordId || this.direction !== direction) return;
            this.amendmentOriginalReview = { ...review };
            this.amendmentRate = rate;
            this.amendmentCurrency = review.currencyCode;
            this.amendmentNativeUnitPrice = String(review.nativeUnitPrice ?? '');
            this.amendmentReason = '';
            this.isAmending = true;
        } catch (error) {
            if (this.recordId === recordId && this.direction === direction) this.error = errorMessage(error);
        } finally {
            this.isSaving = false;
        }
    }

    handleAmendmentCurrencyChange(event) {
        const currency = event.detail.value;
        const usdUnitPrice = this.originalUsdUnitPrice();
        this.amendmentCurrency = currency;
        this.amendmentNativeUnitPrice = currency === 'HKD'
            ? multiplyDecimal(usdUnitPrice, this.amendmentRate?.usdHkdRate)
            : usdUnitPrice;
    }

    handleAmendmentNativePriceChange(event) {
        this.amendmentNativeUnitPrice = event.target.value;
    }

    handleAmendmentReasonChange(event) {
        this.amendmentReason = event.target.value;
    }

    cancelAmendment() {
        this.isAmending = false;
        this.amendmentRate = undefined;
        this.amendmentOriginalReview = undefined;
        this.amendmentReason = '';
    }

    async handleSaveAmendment() {
        const priceInput = this.template.querySelector('[data-id="amendment-native-price"]');
        if (!priceInput?.checkValidity()) {
            priceInput?.reportValidity();
            return;
        }
        if (!this.amendmentReason?.trim() || this.amendmentReason.trim().length < 5) {
            this.error = 'Enter a specific amendment reason of at least five characters.';
            return;
        }
        const { recordId, direction } = this;
        if (!recordId || !direction || this.controlsDisabled) return;
        this.isSaving = true;
        this.error = undefined;
        try {
            const reviewResult = await amendCurrency({
                recordId,
                direction,
                currencyCode: this.amendmentCurrency,
                nativeUnitPrice: this.amendmentNativeUnitPrice,
                reviewedFingerprint: this.amendmentOriginalReview?.fingerprint,
                reviewedRateId: this.amendmentRate?.rateId,
                reason: this.amendmentReason.trim(),
            });
            if (this.recordId !== recordId || this.direction !== direction) return;
            this.applyReview(reviewResult);
            this.cancelAmendment();
            this.dispatchEvent(new CustomEvent('currencychange', {
                detail: { recordId, direction, review: reviewResult },
                bubbles: true,
                composed: true,
            }));
        } catch (error) {
            if (this.recordId !== recordId || this.direction !== direction) return;
            this.error = errorMessage(error);
            await this.refreshReview({ keepError: true });
        } finally {
            this.isSaving = false;
        }
    }
}
