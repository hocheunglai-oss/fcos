import {LightningElement, api, wire, track} from "lwc";
import getSupplierInvoicesOptions from "@salesforce/apex/StemProcessingController.getSupplierInvoicesOptions";
import getConsultations from "@salesforce/apex/StemProcessingController.getConsultations";
import updateProductExtraCosts from "@salesforce/apex/StemProcessingController.updateProductExtraCosts";
import updateCompensations from "@salesforce/apex/StemProcessingController.updateCompensations";
import {ShowToastEvent} from "lightning/platformShowToastEvent";
import { CurrentPageReference } from 'lightning/navigation';
import { fireEvent } from 'c/pubsub';
import { refreshApex } from "@salesforce/apex";
import { NavigationMixin } from "lightning/navigation";
import { deleteRecord } from "lightning/uiRecordApi";

const CONSULTATION_COLS = [
  {
    label: "Consultant",
    fieldName: "consultantUrl",
    type: "url",
    typeAttributes: {
      label: { fieldName: "consultantName" },
      tooltip: { fieldName: "consultantName" },
      target: "_blank",
    },
    sortable: true,
  },
  {
    label: "Fee",
    fieldName: "Fee__c",
    type: "currency",
  },
    {
      type: "action",
      typeAttributes: {
        rowActions: [
          {
            label: "View",
            iconName: "utility:chevronup",
            name: "viewRow"
          },
          {
            label: "Remove",
            iconName: "utility:delete",
            name: "delete"
          }
        ]
      }
    }
];

const STEM_LINE_ITEM_COLS = [
  {
    label: "",
    fieldName: "fieldName",
    type: "text",
  },
  {
    label: "",
    fieldName: "value",
    type: "currency",
  }
]

function getErrorMessage(error) {
  const detail = error?.detail || error;
  const body = detail?.body || detail;
  const fieldErrors = body?.output?.fieldErrors;

  if (fieldErrors) {
    for (const errors of Object.values(fieldErrors)) {
      if (errors?.[0]?.message) {
        return errors[0].message;
      }
    }
  }

  return body?.output?.errors?.[0]?.message
    || body?.pageErrors?.[0]?.message
    || body?.message
    || body?.detail
    || detail?.message
    || error?.message
    || 'An unexpected error occurred.';
}

export default class FcbStemLineItem extends NavigationMixin(LightningElement) {
  @api recordId;
  @api stemLineItem;
  @track supplierInvoices;
  @track options = [];
  @track stemLineItemData = [];
  @track stemLineItemColumns = STEM_LINE_ITEM_COLS;
  consultations;
  wiredConsultations;
  consultationColumns = CONSULTATION_COLS;

  @track bdnDeliveryDateValue;
  isDirty = false;
  _pendingSave;
  _pendingSaveResolve;
  _pendingSaveReject;
  _saveTimeout;

  @wire(CurrentPageReference) pageRef;

  value = "";
  valueCF = false;
  showConsultationTable = false;

  get acceptedFormats() {
    return [".pdf", ".png"];
  }

  handleUploadFinished(event) {
    const uploadedFiles = event.detail.files;
  }

  @wire(getSupplierInvoicesOptions, { stemId: "$recordId" })
  wireSupplierInvoices(value) {
    const { data, error } = value;
    if (data) {
      this.supplierInvoices = data;
      this.error = undefined;
    } else if (error) {
      this.error = error;
    }
  }

  @wire(getConsultations, { stemLineItemId: "$stemLineItem.Id" })
  wireConsultations(value) {
    this.wiredConsultations = value;
    const { data, error } = value;
    if (data) {
      let consultationList = [];
      data.forEach((item) => {
        consultationList.push({
          ...item,
          consultantUrl: !item.Consultant__c ? "" : `/${item.Consultant__c}`,
          consultantName: !item.Consultant__c ? "" : item.Consultant__r.Name,
        });
      });
      this.consultations = consultationList;
      this.showConsultationTable = this.valueCF || this.consultations.length > 0;
      this.error = undefined;
    } else if (error) {
      this.error = error;
    }
  }

  connectedCallback() {
    this.refreshTable();
    this.bdnDeliveryDateValue = this.stemLineItem.BDN_Delivery_Date__c
  }

  @api
  refreshTable(){
    this.stemLineItemData = [];
    this.stemLineItemData.push({fieldName: 'Unit Buy At', value: this.stemLineItem.Unit_Buy_At__c});
    this.stemLineItemData.push({fieldName: 'Unit Sell At', value: this.stemLineItem.Unit_Sell_At__c});
    this.stemLineItemData.push({fieldName: 'Subtotal Buy At', value: this.stemLineItem.Subtotal_Buy_At__c});
    this.stemLineItemData.push({fieldName: 'Subtotal Sell At', value: this.stemLineItem.Subtotal_Sell_At__c});
    this.stemLineItemData.push({fieldName: 'Commission Cost', value: this.stemLineItem.Commission_Cost__c});
    this.stemLineItemData.push({fieldName: 'Subtotal Profit', value: this.stemLineItem.Subtotal_Profit__c});
  }

  @api
  submitForm() {
    if (!this.isDirty) {
      return Promise.resolve({ skipped: true });
    }

    if (this._pendingSave) {
      return this._pendingSave;
    }

    this._pendingSave = new Promise((resolve, reject) => {
      this._pendingSaveResolve = resolve;
      this._pendingSaveReject = reject;
    });
    const pendingSave = this._pendingSave;
    this._saveTimeout = setTimeout(() => {
      this._rejectPendingSave(new Error('Saving this BDN line timed out. Refresh the page before retrying.'));
    }, 30000);

    const btn = this.template.querySelector(".hidden");
    if (btn) {
      btn.click();
    } else {
      this._rejectPendingSave(new Error('The BDN save form is unavailable. Refresh the page before retrying.'));
    }

    return pendingSave;
  }

  @api
  resetFields() {
    const inputFields = this.template.querySelectorAll("lightning-input-field");
    if (inputFields) {
      inputFields.forEach((field) => {
        field.reset();
      });
    }
    this.bdnDeliveryDateValue = this.stemLineItem.BDN_Delivery_Date__c;
    this.isDirty = false;
  }

  handleChangeBdnDeliveryDate(event){
    this.bdnDeliveryDateValue = event.target.value;
    this.isDirty = true;
    const selectedEvent = new CustomEvent("changeinput");
    this.dispatchEvent(selectedEvent);
  }

  handleSubmit(event) {
    event.preventDefault();
    let fields = event.detail.fields;
    fields.BDN_Delivery_Date__c = this.bdnDeliveryDateValue;
    try {
      this.template.querySelector(".stem-line-item-form").submit(fields);
    } catch (error) {
      this._rejectPendingSave(error);
    }
  }

  /* Starting file upload/binding */
  async handleSuccess(event) {
    try {
      const fileUploadBinders = this.template.querySelectorAll("c-fcb-file-upload-binder");

      for (const fileUploadBinder of fileUploadBinders) {
        await fileUploadBinder.bindWithParent();
      }
      await updateProductExtraCosts({ stemLineItemId: event.detail.id });
      await updateCompensations({ stemLineItemId: event.detail.id });

      this.isDirty = false;
      fireEvent(this.pageRef, "refreshStemLineItemList", true);
      this._resolvePendingSave({ id: event.detail.id });
    } catch (error) {
      this._rejectPendingSave(
        new Error(`The BDN fields were saved, but related files or costs were not synchronized. ${getErrorMessage(error)}`)
      );
    }
  }

  /* Display some toast or report message about stem line items failed */
  handleError(event) {
    this._rejectPendingSave(new Error(getErrorMessage(event)));
  }

  handleChange(event) {
    this.isDirty = true;
    const selectedEvent = new CustomEvent("changeinput");
    this.dispatchEvent(selectedEvent);
  }

  _resolvePendingSave(result) {
    const resolve = this._pendingSaveResolve;
    this._clearPendingSave();
    if (resolve) {
      resolve(result);
    }
  }

  _rejectPendingSave(error) {
    const reject = this._pendingSaveReject;
    this._clearPendingSave();
    if (reject) {
      reject(error);
    }
  }

  _clearPendingSave() {
    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout);
    }
    this._saveTimeout = undefined;
    this._pendingSave = undefined;
    this._pendingSaveResolve = undefined;
    this._pendingSaveReject = undefined;
  }

  showConsultationForm(event) {
    this.valueCF = event.detail.checked;
    this.showConsultationTable = this.valueCF || this.consultations.length > 0;
  }

  handleConsultationSubmit(event) {
    event.preventDefault();
    const fields = event.detail.fields;
    fields.STEM_Line_Item__c = this.stemLineItem.Id;
    this.template.querySelector(".consultation-form").submit(fields);
  }

  handleConsultationSuccess(event) {
    const evt = new ShowToastEvent({
      title: "Consultation Saved",
      variant: "success",
    });
    this.dispatchEvent(evt);
    const inputFields = this.template.querySelectorAll(".consultation-field");
    inputFields.forEach((field) => {
      field.reset();
    });
    refreshApex(this.wiredConsultations);
    fireEvent(this.pageRef, "refreshStemLineItemList", true);
  }

  handleRowAction(event) {
    const action = event.detail.action;
    const row = event.detail.row;
    switch (action.name) {
      case "viewRow":
        this.openConsultation(row);
        break; 
      case "delete":
        this.removeConsultation(row.Id);
        break;
      default:
        break;
    }
  }

  openConsultation(consultation) {
    this[NavigationMixin.Navigate]({
      type: "standard__recordPage",
      attributes: {
        recordId: consultation.Id,
        objectApiName: "Consultation__c",
        actionName: "view",
      },
    });
  }

  removeConsultation(consultationId) {
    deleteRecord(consultationId)
      .then(() => {
        this.dispatchEvent(
          new ShowToastEvent({
            title: "Success",
            message: "Record deleted",
            variant: "success",
          })
        );
        refreshApex(this.wiredConsultations);
        fireEvent(this.pageRef, 'refreshStemLineItemList', true);
      })
      .catch((error) => {
        this.dispatchEvent(
          new ShowToastEvent({
            title: "Error deleting record",
            message: error.body.output.errors[0].message,
            variant: "error",
          })
        );
      });
  }
}
