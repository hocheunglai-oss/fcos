import { LightningElement, api , wire , track } from 'lwc';
import { getObjectInfo } from "lightning/uiObjectInfoApi";
import LightningConfirm from 'lightning/confirm';
import getAccount from "@salesforce/apex/AccountController.getAccount"
import resetAcknowledgeReceipt from "@salesforce/apex/AccountController.resetAcknowledgeReceipt"
import ACCOUNT_OBJECT from "@salesforce/schema/Account";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import { updateRecord } from 'lightning/uiRecordApi';
import { getPicklistValues } from 'lightning/uiObjectInfoApi';
import EMAIL_INVOICE_FIELD from '@salesforce/schema/Account.Email_Invoice__c';
import INVOICE_FORMAT_FIELD from '@salesforce/schema/Account.Invoice_Format__c';
import EMAIL_NOMINATION_FIELD from '@salesforce/schema/Account.Email_Nomination__c';
import NOMINATION_FORMAT_FIELD from '@salesforce/schema/Account.Nomination_Format__c';
import EMAIL_CONFIRMATION_FIELD from '@salesforce/schema/Account.Email_Confirmation__c';
import CONFIRMATION_FORMAT_FIELD from '@salesforce/schema/Account.Confirmation_Format__c';
 
export default class FcbAccountRecordType extends LightningElement {
  @api recordId
  @api objectApiName;
  @track recordTypeId;
  savedRecordTypeId;
  @track isAgent;
  savedIsAgent;
  @track isVariable;
  savedIsVariable;
  @track agencyFeeUsd;
  savedAgencyFeeUsd;
  @track isBroker;
  @track isBrokerRecordType;
  savedIsBroker;
  @track isShowedSavedButton;
  @track actionExecuting = false;
  @track recordTypeIds;
  @track hiddenBroker;
  savedHiddenBroker;
  @track hiddenBrokerCompany;
  savedHiddenBrokerCompany;
  @track emailInvoiceOptions = [];
  @track invoiceFormatOptions = [];
  @track emailNominationOptions = [];
  @track nominationFormatOptions = [];
  @track emailConfirmationOptions = [];
  @track confirmationFormatOptions = [];
  @track selectedEmailInvoice;
  savedEmailInvoice;
  @track selectedInvoiceFormat;
  savedInvoiceFormat;
  @track selectedEmailNomination;
  savedEmailNomination;
  @track selectedNominationFormat;
  savedNominationFormat;
  @track selectedEmailConfirmation;
  savedEmailConfirmation;
  @track selectedConfirmationFormat;
  savedConfirmationFormat;

  @track disabledRadioButtons = false;

  @track invoicingRequirement;
  savedInvoicingRequirement;

  connectedCallback() {
    this.refreshAccountFields();
  }

  @wire(getObjectInfo, { objectApiName: ACCOUNT_OBJECT })
  wiredObject(result) {
    if (result.data) {
      let recordtypeinfo = result.data.recordTypeInfos;
      let uiCombobox = [];
      for (let eachRecordtype in recordtypeinfo) {
        if (recordtypeinfo.hasOwnProperty(eachRecordtype) && recordtypeinfo[eachRecordtype].name !== 'Master')
          uiCombobox.push({ label: recordtypeinfo[eachRecordtype].name, value: recordtypeinfo[eachRecordtype].recordTypeId })
      }
      this.recordTypeIds = uiCombobox;
    } else if (result.error) {
      this.error = result.error;
    }
  }

  @wire(getPicklistValues, { recordTypeId: '$recordTypeId', fieldApiName: EMAIL_INVOICE_FIELD })
  wiredEmailInvoicePicklist({ data, error }) {
    if (data) {
      this.emailInvoiceOptions = data.values;
    } else if (error) {
      console.error('Error fetching Email_Invoice__c picklist values:', error);
    }
  }

  @wire(getPicklistValues, { recordTypeId: '$recordTypeId', fieldApiName: INVOICE_FORMAT_FIELD })
  wiredInvoiceFormatPicklist({ data, error }) {
    if (data) {
      this.invoiceFormatOptions = data.values;
    } else if (error) {
      console.error('Error fetching Invoice_Format__c picklist values:', error);
    }
  }

  
  @wire(getPicklistValues, { recordTypeId: '$recordTypeId', fieldApiName: EMAIL_NOMINATION_FIELD })
  wiredEmailNominationPicklist({ data, error }) {
    if (data) {
      this.emailNominationOptions = data.values;
    } else if (error) {
      console.error('Error fetching Email_Nomination__c picklist values:', error);
    }
  }

  @wire(getPicklistValues, { recordTypeId: '$recordTypeId', fieldApiName: NOMINATION_FORMAT_FIELD })
  wiredNominationFormatPicklist({ data, error }) {
    if (data) {
      this.nominationFormatOptions = data.values;
    } else if (error) {
      console.error('Error fetching Nomination_Format__c picklist values:', error);
    }
  }

  
  @wire(getPicklistValues, { recordTypeId: '$recordTypeId', fieldApiName: EMAIL_CONFIRMATION_FIELD })
  wiredEmailConfirmationPicklist({ data, error }) {
    if (data) {
      this.emailConfirmationOptions = data.values;
    } else if (error) {
      console.error('Error fetching Email_Confirmation__c picklist values:', error);
    }
  }

  @wire(getPicklistValues, { recordTypeId: '$recordTypeId', fieldApiName: CONFIRMATION_FORMAT_FIELD })
  wiredConfirmationFormatPicklist({ data, error }) {
    if (data) {
      this.confirmationFormatOptions = data.values;
    } else if (error) {
      console.error('Error fetching Confirmation_Format__c picklist values:', error);
    }
  }

  refreshAccountFields() {
    getAccount({ accountId: this.recordId }).then(result => {
      this.savedRecordTypeId = result.RecordTypeId;
      this.recordTypeId = result.RecordTypeId;
      this.isAgent = result.Is_Agent__c;
      this.savedIsAgent = result.Is_Agent__c;
      this.isVariable = result.Is_Variable__c;
      this.savedIsVariable = result.Is_Variable__c;
      this.agencyFeeUsd = result.Agency_Fee_USD__c;
      this.savedAgencyFeeUsd = result.Agency_Fee_USD__c;
      this.isBroker = result.Is_Broker__c;
      this.savedIsBroker = result.Is_Broker__c;
      this.isBrokerRecordType = this.recordTypeId === this.recordTypeIds.find(recordType => recordType.label === 'Broker').value;
      this.hiddenBroker = result.Hidden_Broker__c;
      this.savedHiddenBroker = result.Hidden_Broker__c;
      this.hiddenBrokerCompany = result.Hidden_Broker_Company__c;
      this.savedHiddenBrokerCompany = result.Hidden_Broker_Company__c;
      this.disabledRadioButtons = result.Hidden_Broker__c || result.Hidden_Broker_Company__c;
      this.selectedEmailInvoice = result.Email_Invoice__c;
      this.savedEmailInvoice = result.Email_Invoice__c;
      this.selectedInvoiceFormat = result.Invoice_Format__c;
      this.savedInvoiceFormat = result.Invoice_Format__c;
      
      this.selectedEmailNomination = result.Email_Nomination__c;
      this.savedEmailNomination = result.Email_Nomination__c;
      this.selectedNominationFormat = result.Nomination_Format__c;
      this.savedNominationFormat = result.Nomination_Format__c;

      this.selectedEmailConfirmation = result.Email_Confirmation__c;
      this.savedEmailConfirmation = result.Email_Confirmation__c;
      this.selectedConfirmationFormat = result.Confirmation_Format__c;
      this.savedConfirmationFormat = result.Confirmation_Format__c;

      this.invoicingRequirement = result.Mailing_Requirement__c;
      this.savedInvoicingRequirement = result.Mailing_Requirement__c;
    })
  }

  async saveRecord(event) {
    try {
      let result;
      let uncheckAcknowledgeReceipt = false;
      if(!this.invoicingRequirement?.includes('-1') && this.savedInvoicingRequirement?.includes('-1')){
        uncheckAcknowledgeReceipt = await LightningConfirm.open({
          message: 'Click “OK“ if you want to uncheck all related STEMs “Acknowledge Receipt” fields',
          label: "Please Confirm",
          theme: "warning",
        });
      }

      let message = this.savedIsAgent !== this.isAgent
        ? (this.isAgent
          ? 'Mark this Account as Is Agent? Its final supplier charges will require Variable Charges verification.'
          : 'Remove Is Agent from this Account? Existing manual requirements and invoiced history remain governed.')
        : this.savedIsVariable !== this.isVariable
        ? (this.isVariable
          ? 'Mark this Account as Is Variable? Its final supplier charges will require Variable Charges review. Hong Kong deliveries will also use the Hong Kong charge rules.'
          : 'Remove Is Variable from this Account? Existing manual requirements and invoiced history remain governed.')
        : this.savedIsBroker && !this.isBroker
        ? "Are you sure this account is no longer a broker?"
        : this.isBroker || this.recordTypeId === this.recordTypeIds.find(recordType => recordType.label === 'Broker').value
          ? "Are you sure you would like to change this account to buyer/supplier/broker?"
          : "Are you sure you would like to change this account to buyer/supplier"
      if ((this.recordTypeId !== this.savedRecordTypeId) || (this.isAgent !== this.savedIsAgent) || (this.isVariable !== this.savedIsVariable) || (this.isBroker !== this.savedIsBroker)) {
        result = await LightningConfirm.open({
          message: message,
          label: "Please Confirm",
          theme: "warning",
        });
        if (result) {
          this.actionExecuting = true;
          const fields = {};
          fields["Id"] = this.recordId;
          fields["RecordTypeId"] = this.recordTypeId;
          fields["Is_Agent__c"] = this.isAgent;
          fields["Is_Variable__c"] = this.isVariable;
          fields["Agency_Fee_USD__c"] = this.agencyFeeUsd === '' ? null : this.agencyFeeUsd;
          fields["Is_Broker__c"] = this.isBroker;
          fields["Hidden_Broker__c"] = this.hiddenBroker;
          fields["Hidden_Broker_Company__c"] = this.hiddenBrokerCompany;
          fields["Email_Invoice__c"] = this.selectedEmailInvoice;
          fields["Invoice_Format__c"] = this.selectedInvoiceFormat;
          fields["Nomination_Format__c"] = this.selectedNominationFormat;
          fields["Email_Nomination__c"] = this.selectedEmailNomination;
          fields["Email_Confirmation__c"] = this.selectedEmailConfirmation;
          fields["Confirmation_Format__c"] = this.selectedConfirmationFormat;
          fields["Mailing_Requirement__c"]= this.invoicingRequirement;
          const recordInput = { fields };
          updateRecord(recordInput)
            .then(() => {
              this.isShowedSavedButton = false;
              this.actionExecuting = false;
              this.savedRecordTypeId = this.recordTypeId;
              this.savedIsAgent = this.isAgent;
              this.savedIsVariable = this.isVariable;
              this.savedAgencyFeeUsd = this.agencyFeeUsd;
              this.savedIsBroker = this.isBroker;
              this.dispatchEvent(
                new ShowToastEvent({
                  title: "Success",
                  message: "Record Type saved",
                  variant: "success",
                }),
              );
              if(uncheckAcknowledgeReceipt){
                resetAcknowledgeReceipt({accountId: this.recordId});
              }
              this.refreshAccountFields();
            })
            .catch(error => {
              this.dispatchEvent(
                new ShowToastEvent({
                  title: "Error",
                  message: error.body.output.errors[0].message,
                  variant: "error",
                }),
              );
            })
        } else {
          this.recordTypeId = this.savedRecordTypeId;
          this.isAgent = this.savedIsAgent;
          this.isVariable = this.savedIsVariable;
          this.isBroker = this.savedIsBroker;
          this.isBrokerRecordType = this.recordTypeId === this.recordTypeIds.find(recordType => recordType.label === 'Broker').value;
          this.template.querySelector('lightning-combobox').value - this.savedRecordTypeId
          this.showSaveButton();
        }
      } else {
        const fields = {};
        fields["Id"] = this.recordId;
        fields["Is_Agent__c"] = this.isAgent;
        fields["Is_Variable__c"] = this.isVariable;
        fields["Agency_Fee_USD__c"] = this.agencyFeeUsd === '' ? null : this.agencyFeeUsd;
        fields["Hidden_Broker__c"] = this.hiddenBroker;
        fields["Hidden_Broker_Company__c"] = this.hiddenBrokerCompany;
        fields["Email_Invoice__c"] = this.selectedEmailInvoice;
        fields["Invoice_Format__c"] = this.selectedInvoiceFormat;
        fields["Nomination_Format__c"] = this.selectedNominationFormat;
        fields["Email_Nomination__c"] = this.selectedEmailNomination;
        fields["Email_Confirmation__c"] = this.selectedEmailConfirmation;
        fields["Confirmation_Format__c"] = this.selectedConfirmationFormat;
        fields["Mailing_Requirement__c"]= this.invoicingRequirement;
        const recordInput = { fields };
        updateRecord(recordInput)
          .then(() => {
            this.isShowedSavedButton = false;
            this.actionExecuting = false;
            this.savedRecordTypeId = this.recordTypeId;
            this.savedIsAgent = this.isAgent;
            this.savedIsVariable = this.isVariable;
            this.savedAgencyFeeUsd = this.agencyFeeUsd;
            this.savedIsBroker = this.isBroker;
            this.dispatchEvent(
              new ShowToastEvent({
                title: "Success",
                message: "Record Type saved",
                variant: "success",
              }),
            );
            if(uncheckAcknowledgeReceipt){
              resetAcknowledgeReceipt({accountId: this.recordId});
            }
            this.refreshAccountFields();
          })
          .catch(error => {
            this.dispatchEvent(
              new ShowToastEvent({
                title: "Error",
                message: error.body.output.errors[0].message,
                variant: "error",
              }),
            );
          })
      }
    } catch (error) {
      console.error(error)
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Error",
          message: error.body.output.errors[0].message,
          variant: "error",
        }),
      );
      
    }
  }

  handleChangeInvoicingRequirement(event){
    this.invoicingRequirement = event.detail.value;
    this.showSaveButton();
  }

  handleAgencyFeeChange(event) {
    this.agencyFeeUsd = event.detail.value;
    this.showSaveButton();
  }

  handleChangeRecordType(event) {
    if (event.target.name === 'recordType') {
      this.recordTypeId = event.detail.value;
      this.isBrokerRecordType = this.recordTypeId === this.recordTypeIds.find(recordType => recordType.label === 'Broker').value;
    } else if (event.target.name === 'isAgent') {
      this.isAgent = event.detail.checked;
    } else if (event.target.name === 'isVariable') {
      this.isVariable = event.detail.checked;
    } else if (event.target.name === 'isBroker') {
      this.isBroker = event.detail.checked;
    } else if(event.target.name === 'hiddenBroker'){
      this.hiddenBroker = event.detail.checked;
      this.hiddenBrokerCompany = false;
      this.disabledRadioButtons = event.detail.checked;
      this.emptyRadioButtons();
    } else if(event.target.name === 'hiddenBrokerCompany'){
      this.hiddenBrokerCompany = event.detail.checked;
      this.hiddenBroker = false;
      this.disabledRadioButtons = event.detail.checked;
      this.emptyRadioButtons();
    }
    this.showSaveButton();
  }

  emptyRadioButtons(){
    this.selectedEmailInvoice = null;
    this.selectedEmailConfirmation = null;
    this.selectedEmailNomination = null;
    this.selectedInvoiceFormat = null;
    this.selectedConfirmationFormat = null;
    this.selectedNominationFormat = null;
  }

  handleEmailInvoiceChange(event) {
    this.selectedEmailInvoice = event.detail.value;
    this.showSaveButton();
  }

  handleInvoiceFormatChange(event) {
      this.selectedInvoiceFormat = event.detail.value;
      this.showSaveButton();
  }

  handleEmailNominationChange(event) {
    this.selectedEmailNomination = event.detail.value;
    this.showSaveButton();
  }

  handleNominationFormatChange(event) {
      this.selectedNominationFormat = event.detail.value;
      this.showSaveButton();
  }

  handleEmailConfirmationChange(event) {
    this.selectedEmailConfirmation = event.detail.value;
    this.showSaveButton();
  }

  handleConfirmationFormatChange(event) {
      this.selectedConfirmationFormat = event.detail.value;
      this.showSaveButton();
  }

  showSaveButton() {
    this.isShowedSavedButton = this.recordTypeId !== this.savedRecordTypeId 
    || this.isAgent !== this.savedIsAgent
    || this.isVariable !== this.savedIsVariable
    || String(this.agencyFeeUsd ?? '') !== String(this.savedAgencyFeeUsd ?? '')
    || this.isBroker !== this.savedIsBroker 
    || this.hiddenBroker !== this.savedHiddenBroker
    || this.hiddenBrokerCompany !== this.savedHiddenBrokerCompany
    || this.selectedEmailInvoice !== this.savedEmailInvoice
    || this.selectedInvoiceFormat !== this.savedInvoiceFormat
    || this.selectedEmailNomination !== this.savedEmailNomination
    || this.selectedNominationFormat !== this.savedNominationFormat
    || this.selectedEmailConfirmation !== this.savedEmailConfirmation
    || this.selectedConfirmationFormat !== this.savedConfirmationFormat
    || this.invoicingRequirement !== this.savedInvoicingRequirement;
  }
}
