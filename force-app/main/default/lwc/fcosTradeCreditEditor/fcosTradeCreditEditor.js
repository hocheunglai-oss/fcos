import { api, LightningElement, wire } from 'lwc';
import { getRecord } from 'lightning/uiRecordApi';
import { CloseActionScreenEvent } from 'lightning/actions';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import preview from '@salesforce/apex/FcosTradeCreditService.preview';
import recordCredit from '@salesforce/apex/FcosTradeCreditService.recordCredit';
import generateCreditPdf from '@salesforce/apex/FcosTradeCreditService.generateCreditPdf';
import releaseForReissue from '@salesforce/apex/FcosTradeReissueService.release';

function errorMessage(error) {
    return error?.body?.message || error?.message || 'The native credit review could not be completed. Refresh and try again.';
}

export default class FcosTradeCreditEditor extends LightningElement {
    @api recordId;

    recordLoaded = false;
    recordError;
    review;
    creditDate = '';
    reason = '';
    creditId;
    pdfUrl;
    error;
    isLoading = false;
    isRecording = false;
    isGeneratingPdf = false;
    isReleasing = false;
    releaseResult;
    requestVersion = 0;

    // getRecord establishes an accessible record-action context. Financial
    // amounts and the original rate are supplied only by the Apex review.
    @wire(getRecord, { recordId: '$recordId', layoutTypes: ['Full'], modes: ['View'] })
    wiredRecord({ data, error }) {
        if (data) {
            this.recordLoaded = true;
            this.recordError = undefined;
            this.refreshReview();
        } else if (error) {
            this.recordLoaded = false;
            this.recordError = errorMessage(error);
        }
    }

    get showReview() {
        return Boolean(this.review);
    }

    get isHkd() {
        return this.review?.currencyCode === 'HKD';
    }

    get isRecorded() {
        return Boolean(this.creditId);
    }

    get controlsDisabled() {
        return this.isLoading || this.isRecording || this.isGeneratingPdf || this.isReleasing || this.isRecorded;
    }

    get recordDisabled() {
        return !this.review?.fingerprint || !this.creditDate || !this.reason.trim() || this.controlsDisabled;
    }

    get pdfDisabled() {
        return !this.creditId || this.isGeneratingPdf || this.isReleasing || Boolean(this.pdfUrl);
    }

    get pdfButtonLabel() {
        return this.isGeneratingPdf ? 'Generating credit PDF' : 'Generate credit PDF';
    }

    get releaseDisabled() {
        return !this.pdfUrl || this.isGeneratingPdf || this.isReleasing || Boolean(this.releaseResult);
    }

    get releaseButtonLabel() {
        return this.isReleasing ? 'Releasing credited lines' : 'Release credited lines for reissue';
    }

    get lines() {
        return (this.review?.lines || []).map((line, index) => ({ ...line, key: `${index}-${line.name}` }));
    }

    async refreshReview() {
        if (!this.recordId || !this.recordLoaded || this.creditId) return;
        const version = ++this.requestVersion;
        this.isLoading = true;
        this.error = undefined;
        try {
            const review = await preview({ originalInvoiceId: this.recordId });
            if (version === this.requestVersion) this.review = review;
        } catch (error) {
            if (version === this.requestVersion) this.error = errorMessage(error);
        } finally {
            if (version === this.requestVersion) this.isLoading = false;
        }
    }

    handleCreditDateChange(event) {
        this.creditDate = event.target.value;
    }

    handleReasonChange(event) {
        this.reason = event.target.value;
    }

    validateRecordInputs() {
        return [...this.template.querySelectorAll('[data-id="record-input"]')].every((input) => {
            input.reportValidity();
            return input.checkValidity();
        });
    }

    async handleRecordCredit() {
        if (!this.validateRecordInputs() || this.recordDisabled) return;
        this.isRecording = true;
        this.error = undefined;
        try {
            const creditId = await recordCredit({
                originalInvoiceId: this.recordId,
                reviewedFingerprint: this.review.fingerprint,
                creditDate: this.creditDate,
                reason: this.reason.trim(),
            });
            this.creditId = creditId;
            this.dispatchEvent(new ShowToastEvent({
                title: 'Native credit recorded',
                message: `Credit ${creditId} was recorded as the full original-currency reversal.`,
                variant: 'success',
            }));
            this.dispatchEvent(new CustomEvent('creditrecorded', {
                detail: { creditId, originalInvoiceId: this.recordId, review: this.review },
                bubbles: true,
                composed: true,
            }));
        } catch (error) {
            this.error = errorMessage(error);
            await this.refreshReview();
        } finally {
            this.isRecording = false;
        }
    }

    async handleGeneratePdf() {
        if (this.pdfDisabled) return;
        this.isGeneratingPdf = true;
        this.error = undefined;
        try {
            const fileURL = await generateCreditPdf({ creditId: this.creditId });
            if (!fileURL) throw new Error('The credit PDF was not returned.');
            this.pdfUrl = fileURL;
            this.dispatchEvent(new ShowToastEvent({
                title: 'Credit PDF generated',
                message: 'The credit was not recreated while generating its PDF.',
                variant: 'success',
            }));
        } catch (error) {
            // creditId is retained, so retrying only calls generateCreditPdf.
            this.error = errorMessage(error);
        } finally {
            this.isGeneratingPdf = false;
        }
    }

    async handleReleaseForReissue() {
        if (this.releaseDisabled) return;
        this.isReleasing = true;
        this.error = undefined;
        try {
            const releaseResult = await releaseForReissue({ creditId: this.creditId });
            this.releaseResult = releaseResult;
            this.dispatchEvent(new ShowToastEvent({
                title: 'Credited lines released',
                message: `${releaseResult.releasedLineCount} ${releaseResult.direction} side line(s) are available for a separately reviewed reissue.`,
                variant: 'success',
            }));
            this.dispatchEvent(new CustomEvent('reissuereleased', {
                detail: { ...releaseResult, originalInvoiceId: this.recordId },
                bubbles: true,
                composed: true,
            }));
        } catch (error) {
            this.error = errorMessage(error);
        } finally {
            this.isReleasing = false;
        }
    }

    handleDone() {
        this.dispatchEvent(new CloseActionScreenEvent());
    }
}
