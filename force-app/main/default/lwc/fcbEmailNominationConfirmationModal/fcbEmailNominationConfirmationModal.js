import {api, wire, track, LightningElement} from 'lwc';
import sendEmail from '@salesforce/apex/EmailNominationConfirmationController.sendEmail';
import getEmailData from '@salesforce/apex/EmailNominationConfirmationController.getEmailData';
import getSpecialTermsFiles from '@salesforce/apex/EmailNominationConfirmationController.getSpecialTermsFiles';
import getAdditionalAttachments from '@salesforce/apex/EmailNominationConfirmationController.getAdditionalAttachments';
import changeSentStatus from '@salesforce/apex/EmailNominationConfirmationController.changeSentStatus';
import {ShowToastEvent} from "lightning/platformShowToastEvent";
import {updateRecord} from "lightning/uiRecordApi";
import {refreshApex} from "@salesforce/apex";
import {NavigationMixin} from 'lightning/navigation';
import { fireEvent } from 'c/pubsub';
import { CurrentPageReference } from 'lightning/navigation';
import sanctionsFile from '@salesforce/resourceUrl/SanctionsCompliance';

const COLS = [
    {
        label: "Name",
        fieldName: "name",
        type: "text"
    },
    {
        label: "Document File",
        fieldName: "docUrl",
        type: "url",
        typeAttributes: {
            label: { fieldName: "docTitle" },
            tooltip: { fieldName: "docTitle" },
            target: "_blank"
        },
    }
]

export default class FcbEmailNominationConfirmationModal extends NavigationMixin(LightningElement) {
    @api recordId;
    isModalOpen = false;
    emailTemplate;
    nomination = {};
    isSendButtonDisabled = false;
    @track actionExecuted = true;
    filesLoaded = false;
    specialTerms;
    filePurpose = 'Attachment for nomination email';
    @track additionalFiles;
    @track columns = COLS;
    result;

    @track isBuyerConfirmation = false;

    @wire(CurrentPageReference) pageRef;


    constructor() {
        super();
        this.emailTemplate = {
                toAddress: '',
                toCCAddress: '',
                toBCCAddress: '',
                senderDisplayName: '',
                subject: '',
                textBody: '',
                specialTerms: '',
            }
    }

    checkRequiredFields() {
        let allValid = [...this.template.querySelectorAll('lightning-input')].reduce((validSoFar, inputCmp) => {
            inputCmp.reportValidity();
            return validSoFar && inputCmp.checkValidity();
        }, true);
        this.isSendButtonDisabled = !allValid;
    }

    handleInputChange(event) {
        this.checkRequiredFields();
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
    }

    @api
    openModal(recordData) {
        this.nomination = recordData;
        this.recordId = this.nomination.Id;
        this.isBuyerConfirmation = this.nomination.RecordType.Name === 'Buyer Confirmation';
        let localNomination = JSON.parse(JSON.stringify(recordData));
        localNomination.PDFUrl = '/' + localNomination.PDFUrl;
        this.nomination = localNomination;
        this.getData();
    }

    getData(){
        try {
            getEmailData({ nomination: this.nomination }).then(result => {
                this.result = result;
                this.emailTemplate = {
                    toAddress: result.toAddress,
                    toCCAddress: result.toCCAddress,
                    toBCCAddress: result.toBCCAddress,
                    senderDisplayName: this.nomination.Buyer_Supplier_Trader__c,
                    subject: result.subject,
                    textBody: result.textBody,
                };
                this.refreshAllFiles();
            });
        } catch (error) {
            console.error(error)
        }
    }

    refreshAllFiles() {
        let files = [{
            name: this.nomination.RecordType.Name,
            docUrl: this.nomination.PDFUrl,
            docTitle: this.nomination.RefCode__c
        }]
        getAdditionalAttachments({ recordId: this.recordId, filePurpose: this.filePurpose }).then(additionalAttachments => {
            additionalAttachments.forEach(additionalAttachment => {
                files.push({
                    name: additionalAttachment.ContentDocument.Title,
                    docUrl: '/' + additionalAttachment.ContentDocumentId,
                    docTitle: additionalAttachment.ContentDocument.Title
                })
            });
            if (this.result.specialTerms) {
                getSpecialTermsFiles({ specialTermIds: Object.keys(this.result.specialTerms) }).then((specialTermFiles) => {
                    if (specialTermFiles) {
                        specialTermFiles.forEach(specialTermFile => {
                            files.push({
                                name: specialTermFile.ContentDocument.Title,
                                docUrl: '/' + specialTermFile.ContentDocumentId,
                                docTitle: specialTermFile.ContentDocument.Title
                            })
                        });
                    }
                    this.isModalOpen = true;
                    this.additionalFiles = files;
                    this.actionExecuted = true;
                    this.filesLoaded = true;
                })
            } else {
                this.isModalOpen = true;
                this.additionalFiles = files;
                this.actionExecuted = true;
                this.filesLoaded = true;
            }
        })
    }

    renderedCallback(){
        if (this.filesLoaded && this.isModalOpen) {
            this.selectAllFiles();
            this.filesLoaded = false;
        }
    }

    selectAllFiles(){
        let allDocUrls = this.additionalFiles.map(file => file.docUrl)
        this.template.querySelector('lightning-datatable').selectedRows = allDocUrls;
    }

    closeModal() {
        this.isModalOpen = false;
        this.actionExecuted = true;
        this.emailTemplate = {
            toAddress: '',
            toCCAddress: '',
            toBCCAddress:'',
            senderDisplayName: '',
            subject: '',
            textBody: '',
        }
    }

    navigateToFiles(event) {
        let documentId;
        if (!event.currentTarget.dataset.id){
            documentId = this.nomination.PDFUrl.replace('/', '');
        } else {
            documentId = event.currentTarget.dataset.id
        }
        this[NavigationMixin.Navigate]({
            type: 'standard__namedPage',
            attributes: {
                pageName: 'filePreview'
            },
            state: {
                recordIds: documentId,
                selectedRecordId: documentId
            }
        })
    }

    sendEmail() {
        try {
            this.checkRequiredFields();
            if (this.isSendButtonDisabled) return;
            this.actionExecuted = false;
            let emailData = {
                toAddress: this.emailTemplate.toAddress,
                toCCAddress: this.emailTemplate.toCCAddress,
                toBCCAddress: this.emailTemplate.toBCCAddress,
                senderDisplayName: this.emailTemplate.senderDisplayName,
                subject: this.emailTemplate.subject,
                textBody: this.emailTemplate.textBody,
                nomination: this.nomination,
            };
            this.sendEmailCall(emailData);
        } catch (error) {
            console.error(error)
        }
    }

    sendEmailCall(emailData) {
        let additionalFileIds = this.template.querySelector('lightning-datatable').getSelectedRows().map((document) => {
            return document.docUrl.substring(document.docUrl.lastIndexOf("/") + 1, document.docUrl.length);
        })
        sendEmail({emailData: emailData, nomination: this.nomination, additionalFiles: additionalFileIds}).then(() => {
            const nominationWithSentDateForUpdate = {
                fields: {
                    Id: this.nomination.Id,
                    Sent_Date__c: this.convertDate(new Date()),
                    Sent_Nomination__c: true
                }
            };
            updateRecord(nominationWithSentDateForUpdate).then(() => {
                changeSentStatus({nominationId: this.nomination.Id}).then(() => {
                    this.actionExecuted = true;
                    this.closeModal();
                    fireEvent(this.pageRef, "refreshNominations", true);
                    this.dispatchEvent(
                        new ShowToastEvent({
                            title: "Success",
                            message: "Email has been sent",
                            variant: "success"
                        })
                    );
                })
            }).catch(error => {
                this.actionExecuted = true;
                console.log('Error on update sent date', error);
            });
        }).catch(error => {
            this.actionExecuted = true;
            console.log('Error on send email', error);
        });
    }

    convertDate(date) {
        let day = date.getDate();
        day = day < 10 ? "0" + day : day;
        let month = date.getMonth() + 1;
        month = month < 10 ? "0" + month : month;
        let year = date.getFullYear();
        return year + "-" + month + "-" + day;
    }

    handleUploadFinished(event){
        this.actionExecuted = false;
        let recordsToUpdate = [];
        event.detail.files.forEach((file) => {
            const fields = {};
            fields.Id = file.documentId;
            fields.Title = file.name;
            recordsToUpdate.push({ fields });
        });
        Promise.all(recordsToUpdate.map((record) => updateRecord(record)))
            .then((record) => {
                this.refreshAllFiles();
            })
    }

    handleEnquirySpecialTermSubmit(event){
        event.preventDefault();
        const fields = event.detail.fields;
        fields.Enquiry__c = this.nomination.Enquiry__c;
        this.template.querySelector('lightning-record-edit-form').submit(fields);
    }

    handleEnquirySpecialTermSuccess(event){
        const inputFields = this.template.querySelectorAll(
            'lightning-input-field'
        );
        if (inputFields) {
            inputFields.forEach(field => {
                field.reset();
            });
        }
        this.refreshAllFiles();
    }
}