import { api, LightningElement, track, wire } from 'lwc';
import getKoreaDeskChoices from '@salesforce/apex/EnquiryProgressBarController.getKoreaDeskChoices';
import closeKoreaDeskWon from '@salesforce/apex/EnquiryProgressBarController.closeKoreaDeskWon';
import STAGE_FIELD from '@salesforce/schema/Opportunity.StageName';
import { getRecord } from 'lightning/uiRecordApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { updateRecord } from 'lightning/uiRecordApi';
import LightningConfirm from 'lightning/confirm';
import { refreshApex } from '@salesforce/apex';
import updateQuoteStatuses from "@salesforce/apex/EnquiryProgressBarController.updateQuoteStatuses"
import { publish, MessageContext } from 'lightning/messageService';
import REFRESH_ENQUIRY_PAGE from '@salesforce/messageChannel/RefreshOpportunityPage__c';

export default class FcbEnquiryProgressBar extends LightningElement {
  @api recordId;
  get showKoreaDeskChoices() { return this.value === 'Closed Won' && this.koreaDeskChoices.length > 0; }
  koreaDeskChoices = [];
  koreaDeskOptions = [{ label: 'Yes', value: 'Yes' }, { label: 'No', value: 'No' }];

  async loadKoreaDeskChoices() {
    const choicesJson = await getKoreaDeskChoices({ recordId: this.recordId, recordType: 'enquiry' });
    this.koreaDeskChoices = JSON.parse(choicesJson).map(choice => ({
      ...choice,
      isFixed: choice.kind === 'fixed',
      isRequired: choice.kind === 'required'
    }));
  }

  handleKoreaDeskChange(event) {
    const key = event.target.dataset.key;
    this.koreaDeskChoices = this.koreaDeskChoices.map(choice =>
      choice.key === key ? { ...choice, answer: event.detail.value } : choice
    );
  }

  validateKoreaDeskChoices() {
    return [...this.template.querySelectorAll('[data-korea-choice]')]
      .map(input => { input.reportValidity(); return input.checkValidity(); })
      .every(Boolean);
  }

  wiredRecord;
  @track stages = [];
  wiredStages;
  @track currentStage;
  changedStage;
  isClosedLost = false;
  changedToClosedLost = false;
  openModal = false;
  actionExecuting = false;
  value = "Closed Won";
  stages = [
    { label: "Requirements Gathering", value: "Requirements Gathering" },
    { label: "RFQ", value: "RFQ" },
    { label: "Quote Collection", value: "Quote Collection" },
    { label: "Offer Sent & Negotiation", value: "Offer Sent & Negotiation" },
    { label: "Closed Won", value: "Closed Won" },
    { label: "Closed Lost", value: "Closed Lost" },
  ];
  get options() {
    return [
      { label: "Closed Won", value: "Closed Won" },
      { label: "Closed Lost", value: "Closed Lost" },
    ];
  }

  @wire(MessageContext)
  messageContext;

  @wire(getRecord, { recordId: "$recordId", fields: STAGE_FIELD })
  getRecord(value) {
    this.wiredRecord = value;
    const { data, error } = value;
    if (data) {
      this.currentStage = data.fields.StageName.value;
      if (this.currentStage === "Closed Lost") {
        this.isClosedLost = true;
      } else {
        this.isClosedLost = false;
      }
      this.changeStageOptions();
    } else if (error) {
      console.error(error);
    }
  }

  handleClick(event) {
    this.changedStage = event.target.value;
  }

  handleChange(event) {
    this.value = event.detail.value;
  }

  closeModal(event) {
    this.openModal = false;
  }

  handleSave(event) {
    if (this.actionExecuting) return;
    if (this.value === 'Closed Won' && !this.validateKoreaDeskChoices()) return;
    this.actionExecuting = true;
    const fields = {};
    this.currentStage = this.value;
    fields["Id"] = this.recordId;
    fields[STAGE_FIELD.fieldApiName] = this.currentStage;
    const recordInput = { fields };
    if (this.currentStage === "Closed Won") {
      closeKoreaDeskWon({
        recordId: this.recordId,
        recordType: 'enquiry',
        choicesJson: JSON.stringify(this.koreaDeskChoices),
        message: null,
      }).then(() => {
        this.actionExecuting = false;
        this.openModal = false;
        refreshApex(this.wiredRecord);
        this.changeStageOptions();
        this.dispatchEvent(
          new ShowToastEvent({
            title: "Success",
            message: "Enquiry Stage updated",
            variant: "success",
          })
        );
        this.publishUpdateMessage();
        eval("$A.get('e.force:refreshView').fire();");
      })
      .catch(error => {
        this.actionExecuting = false;
        this.openModal = false;
        refreshApex(this.wiredRecord);
        this.publishUpdateMessage();
        eval("$A.get('e.force:refreshView').fire();");
        this.changeStageOptions();
        this.dispatchEvent(
          new ShowToastEvent({
            title: "Error",
            message: error?.body?.message || error?.body?.pageErrors?.[0]?.message || 'Please reopen the window and try again.',
            variant: "error",
          })
        );
      });
    } else {
      updateRecord(recordInput).then(() => {
        this.actionExecuting = false;
        this.openModal = false;
        refreshApex(this.wiredRecord);
        this.changeStageOptions();
        this.dispatchEvent(
          new ShowToastEvent({
            title: "Success",
            message: "Enquiry Stage updated",
            variant: "success",
          })
        );
        this.changedToClosedLost = true;
        this.publishUpdateMessage();
        eval("$A.get('e.force:refreshView').fire();");
      }).catch(error => {
        this.actionExecuting = false;
        this.dispatchEvent(new ShowToastEvent({ title: 'Unable to close enquiry', message: error?.body?.message || 'Please try again.', variant: 'error' }));
      });
    }
  }

  handleSuccess(event) {
    this.dispatchEvent(
      new ShowToastEvent({
        title: "Success",
        message: "Loss Reason has been saved",
        variant: "success",
      })
    );
    this.changedToClosedLost = false;
  }

  changeStageOptions() {
    if (this.currentStage.includes("Closed")) {
      this.stages = this.stages.filter(
        (stage) => !stage.value.includes("Closed")
      );
      this.stages.push({ label: this.currentStage, value: this.currentStage });
    } else {
      this.stages = this.stages.filter(
        (stage) => !stage.value.includes("Closed")
      );
      this.stages.push({ label: "Closed", value: "Closed" });
    }
  }

  async nextStage(event) {
    let result = true;
    if (this.changedStage === "Closed") {
      try {
        await this.loadKoreaDeskChoices();
        this.openModal = true;
      } catch (error) {
        this.dispatchEvent(new ShowToastEvent({ title: 'Unable to load Korea Desk', message: error?.body?.message || 'Please try again.', variant: 'error' }));
      }
      return;
    }
    if (
      this.currentStage === "Closed Won" &&
      this.changedStage !== "Closed Won"
    ) {
      result = await LightningConfirm.open({
        message:
          "Are you sure you would like to undo Closed Won? STEMs of this Enquiry will be deleted",
        label: "Please Confirm",
        theme: "warning",
      });
    }
    if (result) {
      this.currentStage = this.changedStage;
      const fields = {};
      fields["Id"] = this.recordId;
      fields[STAGE_FIELD.fieldApiName] = this.currentStage;
      const recordInput = { fields };
      updateRecord(recordInput).then(() => {
        if (this.currentStage === "Requirements Gathering") {
          updateQuoteStatuses({ enquiryId: this.recordId, status: "RFQ" });
        } else {
          updateQuoteStatuses({
            enquiryId: this.recordId,
            status: this.currentStage,
          });
        }
        refreshApex(this.wiredRecord);
        this.changeStageOptions();
        this.dispatchEvent(
          new ShowToastEvent({
            title: "Success",
            message: "Enquiry updated",
            variant: "success",
          })
        );
        this.publishUpdateMessage();
        eval("$A.get('e.force:refreshView').fire();");
      });
    }
  }

  async publishUpdateMessage(){
    const message = {
      updated: true
    };
    publish(this.messageContext, REFRESH_ENQUIRY_PAGE, message);
  }
}
