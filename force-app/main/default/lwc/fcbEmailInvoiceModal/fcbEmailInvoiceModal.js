import { api, track, LightningElement } from 'lwc';
import sendEmail from '@salesforce/apex/EmailInvoiceController.sendEmail';
import getEmailData from '@salesforce/apex/EmailInvoiceController.getEmailData';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

const FCOS_VARIABLE_CHARGES_URL = 'https://fcos.fcuno.com/payment-collections?tab=variable-charges&stemId=';
const FCOS_MASTER_CONTRACTS_URL = 'https://fcos.fcuno.com/master-contracts';

export default class FcbEmailInvoiceModal extends LightningElement {
    @api recordId;
    @api currentStem;
    @api selectedItems;

    isModalOpen = false;
    isSendButtonDisabled = false;
    actionExecuted = true;
    isSending = false;
    operationError = '';
    fcosTaskUrl = '';
    fcosTaskLabel = '';
    @track invoiceURLs = [];

    @track emailTemplate = this.emptyEmailTemplate();

    emptyEmailTemplate() {
        return {
            toAddress: '',
            toCCAddress: '',
            toBCCAddress: '',
            senderDisplayName: '',
            subject: '',
            textBody: '',
            stemLineItems: null,
            stemExtraCosts: null
        };
    }

    get isSendDisabled() {
        return this.isSendButtonDisabled || this.isSending || !this.actionExecuted || !this.emailTemplate;
    }

    get hasOperationError() {
        return Boolean(this.operationError);
    }

    checkRequiredFields() {
        const allValid = [...this.template.querySelectorAll('lightning-input')].reduce((validSoFar, inputCmp) => {
            inputCmp.reportValidity();
            return validSoFar && inputCmp.checkValidity();
        }, true);
        this.isSendButtonDisabled = !allValid;
        return allValid;
    }

    handleInputChange(event) {
        this.operationError = '';
        this.fcosTaskUrl = '';
        this.fcosTaskLabel = '';
        switch (event.target.name) {
            case 'toAddress':
                this.emailTemplate.toAddress = event.target.value;
                break;
            case 'toCCAddress':
                this.emailTemplate.toCCAddress = event.target.value;
                break;
            case 'toBCCAddress':
                this.emailTemplate.toBCCAddress = event.target.value;
                break;
            case 'subject':
                this.emailTemplate.subject = event.target.value;
                break;
            case 'textBody':
                this.emailTemplate.textBody = event.target.value;
                break;
            default:
        }
        this.checkRequiredFields();
    }

    @api
    async openModal(recordId, selectedItems) {
        this.recordId = recordId;
        this.selectedItems = selectedItems;
        this.operationError = '';
        this.fcosTaskUrl = '';
        this.isModalOpen = true;
        this.actionExecuted = false;

        try {
            const result = await getEmailData({ stemId: this.recordId, invoices: this.selectedItems });
            this.emailTemplate = {
                toAddress: result.toAddress,
                toCCAddress: result.toCCAddress,
                toBCCAddress: result.toBCCAddress,
                senderDisplayName: 'FCB Support',
                subject: result.subject,
                textBody: result.textBody,
                stemLineItems: result.stemLineItems,
                stemExtraCosts: result.stemExtraCosts
            };
            const attachmentSelector = this.template.querySelector('c-fcb-email-stem-line-item');
            if (!attachmentSelector) throw new Error('Invoice attachments could not be loaded. Close the email window and try again.');
            await attachmentSelector.getDocuments(this.emailTemplate.stemLineItems, this.emailTemplate.stemExtraCosts);
        } catch (error) {
            this.showOperationError(error, 'The invoice email could not be prepared. Close the email window and try again.');
        } finally {
            this.actionExecuted = true;
        }
    }

    closeModal() {
        this.dispatchEvent(new CustomEvent('refreshinvoicetable'));
        this.isModalOpen = false;
        this.actionExecuted = true;
        this.isSending = false;
        this.operationError = '';
        this.fcosTaskUrl = '';
        this.fcosTaskLabel = '';
        this.emailTemplate = this.emptyEmailTemplate();
    }

    async sendEmail() {
        if (this.isSending || !this.actionExecuted) return;

        if (!this.checkRequiredFields()) {
            this.operationError = 'Enter at least one valid recipient email address before sending.';
            this.fcosTaskUrl = '';
            this.fcosTaskLabel = '';
            return;
        }

        this.isSending = true;
        this.actionExecuted = false;
        this.operationError = '';
        this.fcosTaskUrl = '';
        this.fcosTaskLabel = '';

        try {
            const attachmentSelector = this.template.querySelector('c-fcb-email-stem-line-item');
            if (!attachmentSelector) throw new Error('Invoice attachments are unavailable. Close the email window and try again.');
            const documentIds = attachmentSelector.getSelectedDocuments();
            await sendEmail({
                emailData: {
                    toAddress: this.emailTemplate.toAddress,
                    toCCAddress: this.emailTemplate.toCCAddress,
                    toBCCAddress: this.emailTemplate.toBCCAddress,
                    senderDisplayName: 'FCB Support',
                    subject: this.emailTemplate.subject,
                    textBody: this.emailTemplate.textBody,
                    stemId: this.recordId,
                    stemLineItems: this.emailTemplate.stemLineItems,
                    stemExtraCosts: this.emailTemplate.stemExtraCosts
                },
                invoices: this.selectedItems,
                documentIds
            });
            this.closeModal();
            this.dispatchEvent(new ShowToastEvent({
                title: 'Success',
                message: 'Email has been sent',
                variant: 'success'
            }));
        } catch (error) {
            this.showOperationError(error, 'The invoice email could not be sent. Review the details and try again.');
        } finally {
            this.isSending = false;
            this.actionExecuted = true;
        }
    }

    showOperationError(error, fallbackMessage) {
        const message = error?.body?.message || error?.message || fallbackMessage;
        const isMasterContractError = /master\s+contract/i.test(message);
        this.operationError = message;
        this.fcosTaskUrl = isMasterContractError
            ? FCOS_MASTER_CONTRACTS_URL
            : /fcos/i.test(message) && this.recordId
                ? `${FCOS_VARIABLE_CHARGES_URL}${encodeURIComponent(this.recordId)}`
                : '';
        this.fcosTaskLabel = isMasterContractError ? 'Open FCOS task' : 'Open FCOS variable-charge task';
        this.dispatchEvent(new ShowToastEvent({
            title: 'Invoice email not sent',
            message,
            variant: 'error',
            mode: 'sticky'
        }));
    }
}
