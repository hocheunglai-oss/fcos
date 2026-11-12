import { api, LightningElement } from 'lwc';
import { CloseActionScreenEvent } from 'lightning/actions';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import describeContext from '@salesforce/apex/FcosTradeProformaService.describeContext';
import candidates from '@salesforce/apex/FcosTradeProformaService.candidates';
import previewProforma from '@salesforce/apex/FcosTradeProformaService.previewProforma';
import recordProforma from '@salesforce/apex/FcosTradeProformaService.recordProforma';
import previewFinal from '@salesforce/apex/FcosTradeProformaService.previewFinal';
import recordFinal from '@salesforce/apex/FcosTradeProformaService.recordFinal';
import generateDocument from '@salesforce/apex/FcosTradeProformaService.generateDocument';

const message = (error) => error?.body?.message || error?.message || 'The reviewed document action failed.';
const uuid = () => crypto.randomUUID();

export default class FcosTradeProformaEditor extends LightningElement {
    _recordId;
    context;
    direction = 'Sell';
    supplierId;
    lineOptions = [];
    selectedLineIds = [];
    reference = '';
    documentDate = '';
    deliveryDate = '';
    dueDate = '';
    depositNative;
    depositDueDate = '';
    review;
    documentId;
    pdfUrl;
    error;
    busy = false;

    @api
    get recordId() { return this._recordId; }
    set recordId(value) { this._recordId = value; if (value) this.initialize(); }

    get isCreate() { return this.context?.mode === 'CREATE'; }
    get isFinal() { return this.context?.mode === 'FINALIZE'; }
    get isBuy() { return this.direction === 'Buy'; }
    get directionOptions() { return [{ label: 'Buyer proforma', value: 'Sell' }, { label: 'Supplier proforma', value: 'Buy' }]; }
    get hasLines() { return this.lineOptions.length > 0; }
    get canReview() {
        return Boolean(!this.busy && this.reference.trim() && this.documentDate && this.deliveryDate && this.dueDate &&
            (this.isFinal || (this.selectedLineIds.length && this.depositNative && this.depositDueDate)));
    }
    get canRecord() { return !this.busy && this.review?.fingerprint && !this.documentId; }
    get canGenerate() { return !this.busy && this.documentId && !this.pdfUrl; }
    get reviewDisabled() { return !this.canReview; }
    get recordDisabled() { return !this.canRecord; }
    get generateDisabled() { return !this.canGenerate; }
    get reviewTitle() { return this.isFinal ? 'Reviewed final document' : 'Reviewed proforma request'; }
    get grossText() { return this.review ? `${this.review.currencyCode} ${this.review.nativeTotal}` : ''; }
    get depositText() { return this.review ? `${this.review.currencyCode} ${this.review.depositNative} (USD ${this.review.depositUSD})` : ''; }
    get lineCount() { return this.review?.lines?.length || 0; }

    async initialize() {
        this.busy = true; this.error = undefined;
        try {
            this.context = await describeContext({ recordId: this._recordId });
            this.direction = this.context.direction || 'Sell'; this.supplierId = this.context.supplierId;
            this.reference = this.isFinal ? `${this.context.reference}-FINAL` : '';
            this.documentDate = this.context.documentDate || ''; this.deliveryDate = this.context.deliveryDate || '';
            this.dueDate = this.context.dueDate || ''; this.depositNative = this.context.depositNative;
            this.depositDueDate = this.context.depositDueDate || '';
            if (this.isCreate && !this.isBuy) await this.loadCandidates();
        } catch (error) { this.error = message(error); }
        finally { this.busy = false; }
    }
    async loadCandidates() {
        if (!this.context?.stemId || (this.isBuy && !this.supplierId)) { this.lineOptions = []; this.selectedLineIds = []; return; }
        this.busy = true; this.error = undefined;
        try {
            const lines = await candidates({ stemId: this.context.stemId, direction: this.direction, supplierId: this.supplierId });
            this.lineOptions = (lines || []).map((line) => ({ label: `${line.name} — ${line.nativeAmount}`, value: line.id }));
            this.selectedLineIds = this.lineOptions.map((line) => line.value);
        } catch (error) { this.error = message(error); this.lineOptions = []; this.selectedLineIds = []; }
        finally { this.busy = false; }
    }
    handleDirection(event) { this.direction = event.detail.value; this.supplierId = undefined; this.review = undefined; this.loadCandidates(); }
    handleSupplier(event) { this.supplierId = event.detail.recordId; this.review = undefined; this.loadCandidates(); }
    handleLines(event) { this.selectedLineIds = event.detail.value; this.review = undefined; }
    handleInput(event) { this[event.target.name] = event.target.value; this.review = undefined; }

    async handleReview() {
        if (!this.canReview) return;
        this.busy = true; this.error = undefined;
        try {
            this.review = this.isFinal
                ? await previewFinal({ proformaId: this._recordId, reference: this.reference.trim(), invoiceDate: this.documentDate, deliveryDate: this.deliveryDate, dueDate: this.dueDate })
                : await previewProforma({ stemId: this.context.stemId, direction: this.direction, supplierId: this.supplierId,
                    lineIds: this.selectedLineIds, reference: this.reference.trim(), documentDate: this.documentDate,
                    deliveryDate: this.deliveryDate, dueDate: this.dueDate, depositNative: this.depositNative, depositDueDate: this.depositDueDate });
        } catch (error) { this.error = message(error); }
        finally { this.busy = false; }
    }
    async handleRecord() {
        if (!this.canRecord) return;
        this.busy = true; this.error = undefined;
        try {
            const operationId = uuid();
            this.documentId = this.isFinal
                ? await recordFinal({ proformaId: this._recordId, reference: this.reference.trim(), invoiceDate: this.documentDate,
                    deliveryDate: this.deliveryDate, dueDate: this.dueDate, reviewedFingerprint: this.review.fingerprint, operationId })
                : await recordProforma({ stemId: this.context.stemId, direction: this.direction, supplierId: this.supplierId,
                    lineIds: this.selectedLineIds, reference: this.reference.trim(), documentDate: this.documentDate,
                    deliveryDate: this.deliveryDate, dueDate: this.dueDate, depositNative: this.depositNative,
                    depositDueDate: this.depositDueDate, reviewedFingerprint: this.review.fingerprint, operationId });
            this.dispatchEvent(new ShowToastEvent({ title: this.isFinal ? 'Final document recorded' : 'Proforma recorded',
                message: 'The immutable document was recorded. Generate its PDF as a separate idempotent step.', variant: 'success' }));
        } catch (error) { this.error = message(error); }
        finally { this.busy = false; }
    }
    async handleGenerate() {
        this.busy = true; this.error = undefined;
        try { this.pdfUrl = await generateDocument({ documentId: this.documentId }); }
        catch (error) { this.error = message(error); }
        finally { this.busy = false; }
    }
    handleDone() { this.dispatchEvent(new CloseActionScreenEvent()); }
}
