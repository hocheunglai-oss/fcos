import { LightningElement, api, wire, track } from "lwc";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import { getRecord } from "lightning/uiRecordApi";
import getStemLineItemsByStemId from "@salesforce/apex/StemDetailController.getStemLineItemsByStemId";
import getStemExtraCostsByStemId from "@salesforce/apex/StemDetailController.getStemExtraCostsByStemId"
import getProductInfo from "@salesforce/apex/StemProcessingController.getProductInfo"
import getInvoices from "@salesforce/apex/StemProcessingController.getInvoices"
import getLastInvoiceForm from "@salesforce/apex/StemProcessingController.getLastInvoiceForm"
import updateAllStemExtraCosts from "@salesforce/apex/StemProcessingController.updateAllStemExtraCosts"
import getPaymentTermOptions from '@salesforce/apex/SupplierBidManagerController.getPaymentTermOptions';
import getEarliestSupplierDeliveryDate from '@salesforce/apex/StemProcessingController.getEarliestSupplierDeliveryDate';
import getStemBuyerBrokers from '@salesforce/apex/StemProcessingController.getStemBuyerBrokers';
import getTraderText from '@salesforce/apex/StemProcessingController.getTraderText';
//import putDeletedInvoiceToChangesCSV from '@salesforce/apex/MyobDataExportController.putDeletedInvoiceToChangesCSV';
import { NavigationMixin } from 'lightning/navigation';
import { updateRecord , deleteRecord } from "lightning/uiRecordApi";
import { refreshApex } from "@salesforce/apex";
import { registerListener } from "c/pubsub";
import { CurrentPageReference } from "lightning/navigation";
import { getPicklistValues } from 'lightning/uiObjectInfoApi';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import STEM_OBJECT from '@salesforce/schema/STEM__c';
import DISPUTE_STATUS_FIELD from '@salesforce/schema/STEM__c.Dispute_Status__c';

const FIELDS = ['STEM__c.Port__r.Id', 'STEM__c.Port__r.Country__c', 'STEM__c.Payment_Delay__c', 'STEM__c.Invoice_Due_Date__c', 'STEM__c.Payment_Term__c', 'STEM__c.Delivery_Date__c', 'STEM__c.Due_Date_Override__c',
                'STEM__c.Agent__c', 'STEM__c.ETA_End_Date__c', 'STEM__c.ETA_End_Time__c', 'STEM__c.ETA_Start_Date__c', 'STEM__c.ETA_Start_Time__c',
                'STEM__c.ETA_ETB__c', 'STEM__c.ETB_End_Date__c', 'STEM__c.ETB_End_Time__c', 'STEM__c.ETB_Start_Date__c', 'STEM__c.ETB_Start_Time__c', 'STEM__c.ETCD_End_Date__c',
                'STEM__c.ETCD_End_Time__c', 'STEM__c.ETCD_Start_Date__c', 'STEM__c.ETCD_Start_Time__c', 'STEM__c.ETD_End_Date__c', 'STEM__c.ETD_End_Time__c',
                'STEM__c.ETD_Start_Date__c', 'STEM__c.ETD_Start_Time__c', 'STEM__c.Expected_Delivery_Date__c', 'STEM__c.Dispute_Status__c', 'STEM__c.Account__c', 'STEM__c.Account__r.Name',
                'STEM__c.Account__r.Inactive_Suspended__c', 'STEM__c.Factoring_Invoice__c', 'STEM__c.Invoice_Status__c', 'STEM__c.Receivable_Balance__c', 'STEM__c.Enquiry__c', 
                'STEM__c.Buyer_Broker__c', 'STEM__c.Buyer_Broker__r.Name', 'STEM__c.Mailing_Requirement__c', 'STEM__c.Acknowledge_Receipt__c', 'STEM__c.FCBS_Reference__c',
                'STEM__c.Partial_CIA__c', 'STEM__c.Partial_Lumpsum_Sell_At__c', 'STEM__c.Message__c', 'STEM__c.Hold_Payment__c']


const FCBS_NAME = 'FRATELLI COSULICH BUNKERS (S) PTE LTD';
const KOREA_PORT = 'KOREA';


const COLS = [
  {
    label: 'Product Input',
    fieldName: 'productName',
    type: 'text',
  },
  {
    label: 'Input',
    fieldName: 'input',
    type: 'text',
  },
  {
    label: 'Issued',
    fieldName: 'issued',
    type: 'boolean'
  }
]

const INVOICE_COLS = [
    {
    label: 'Invoice Name',
    fieldName: 'File__c',
    typeAttributes: {
      label: {fieldName: "Name"},
      tooltip: {fieldName: "Name"},
      target: "_blank"
    },
    type: 'url',
    sortable: true
  },
  {
    label: 'Invoice Date',
    fieldName: 'Invoice_Date',
    type: 'text'
  },
  {
    label: 'Delivery Date',
    fieldName: 'Delivery_Date',
    type: 'text'
  },
  {
    label: 'Invoice Due Date',
    fieldName: 'Invoice_Due_Date',
    type: 'text'
  },
  {
    label: 'Deprecated',
    fieldName: 'Deprecated__c',
    type: 'boolean',
    editable: true
  },
  {
    label: 'Sent',
    fieldName: 'Sent__c',
    type: 'boolean',
  },
  {
    label: 'Amount',
    fieldName: 'Amount__c',
    type: 'currency'
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
]

const PROFORMA_INVOICE_LABEL = 'Create Proforma Invoice'
const INVOICE_LABEL = 'Create Invoice'

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
    || detail?.message
    || error?.message
    || 'An unexpected error occurred.';
}

export default class FcbStemProcessing extends NavigationMixin(LightningElement) {
  @api recordId;
  @api stemId;  
  @track recordTypeId;
  showQuantityBDN = true;
  notShowQuantityBDN = false;
  showSaveButton = false;
  isCanceled = false;
  showSaveAllButton = false;
  isSavingBdnDetails = false;
  showSaveAllCommissionButton = false;
  isSaveAllCancelled = false;
  isSaveAllCommissionsCancelled = false;
  isLoading = false;
  openEmail = false;
  productDisabled = true;
  proformaDisabled = true;
  createInvoiceDisabled = true;
  sendInvoiceDisabled = true;
  dueDateOverride = false;
  dueDateDisabled = true;
  dueDateOverrideDisabled = false;
  showEditStem = false;
  showDisputeAccounts = false;
  actionExecuted = true;

  @track invoiceColumns = INVOICE_COLS;
  @track productColumns = COLS;

  @track stemLineItems;
  @track wiredStemLineItems;
  @track extraCosts;
  @track productInfo = [];
  wiredProductInfo = [];
  @track invoices = [];
  wiredInvoices = [];
  @track lastInvoiceForm;
  wiredLastInvoiceForm;
  disabledLastInvoiceForm = true;
  selectedProducts = [];
  selectedInvoices = [];

  @track stem;
  @track wiredStemInfo;
  paymentTermOptions;
  wiredPaymentTermOptions;
  buyerPaymentTermRecordType = 'Buyer';
  paymentTermValue = '';
  @track traderText;

  @track dateRange;
  @track deliveryDateValue;
  @track invoiceDueDateValue;
  @track pumpingCompletionDateValue;
  expectedDeliveryDateValue;
  invoiceButtonLabel;
  createInvoiceDisabledMessage = "Pick at least one product";
  @track tabBackground = '';
  @track invoiceBackground = '';
  disputeStatusValue;
  disputeStatusOptions;
  showDisputes;
  @track isAcknowledgeReceiptVisible = false;
  @track acknowledgeReceiptLabel = 'Acknowledge Receipt';
  @track isPumpingCompletionDate;
  @track deliveryDateLabel = 'Delivery Date';
  isProductLineItemExisting;
  @track deliveryDateRequired = false;
  @track deliveryDateDisabled = false;
  @track isDisabledPartialCIA = true;
  @track partialLumpsumSellAt;

  holdPaymentValue = 'No';

  get holdPaymentOptions() {
      return [
          { label: 'Yes', value: 'Yes' },
          { label: 'No', value: 'No' }
      ];
  }

  @track fcbsReferenceVisible = false;
  @track fcbsReference;

  originatedClass

  @track stemBuyerBrokers;
  wiredStemBuyerBrokers;
  @track newStemBuyerBrokers;
  @track isBuyerBrokerChanged = false;
  stemBuyerBrokersToDelete = [];

  @track showMessage = false;

  @wire(CurrentPageReference) pageRef;

  @wire(getObjectInfo, { objectApiName: STEM_OBJECT })
  wiredObjectInfo({error, data}) {
    if (data) {
      const rtis = data.recordTypeInfos;
      this.recordTypeId = Object.keys(rtis).find(rti => rtis[rti].name === 'Originated');
    } else if (error) {
      console.error(error);
    }
  }

  @wire(getPicklistValues, { recordTypeId: "$recordTypeId", fieldApiName: DISPUTE_STATUS_FIELD })
  wireDisputeStatus(value){
    const {data, error} = value;
    if (data) {
      this.disputeStatusOptions = data.values;
    } else if (error) {
      this.error = error;
      console.error(error)
    }
  }

  @wire(getPaymentTermOptions, {recordTypeName: '$buyerPaymentTermRecordType'})
  wiredPaymentTerms(value) {
    this.wiredPaymentTermOptions = value;
    const {data, error} = value;
    if (data) {
      this.error = undefined;
      let paymentTermPicklist = [];
      data.forEach((paymentTerm) => {
        paymentTermPicklist.push({
          label: paymentTerm.Name,
          value: paymentTerm.Name,
        });
      });
      this.paymentTermOptions = paymentTermPicklist;
    } else if (error) {
      this.error = error;
      console.error(error)
    }
  }

  @wire(getTraderText, { stemId: "$recordId" })
  wiredTraderText(value) { 
    console.log(value);
    
    const { data, error } = value;  
    if (data !== undefined) {
      this.traderText = data ? data.replace(/\\n/g, '\n') : '';
    } else {
      console.error(error);
    }
  }

  @wire(getRecord, { recordId: "$recordId", fields: FIELDS })
  wiredStem(value) {
    this.wiredStemInfo = value;
    const {data,error} = value
    if (data) {
      this.setStemInfo(data);
      this.setDateRange(); 
    } else if (error) {
      console.error(error);
    }
  }

  setStemInfo(data){
    this.stem = data.fields;
    this.isAcknowledgeReceiptVisible = this.stem.Mailing_Requirement__c.value
      ? this.stem.Mailing_Requirement__c.value?.includes('-1')
      : false; 
    this.acknowledgeReceiptLabel = this.stem.Mailing_Requirement__c.value
      ? this.stem.Mailing_Requirement__c.value?.includes('-1a')
        ? 'Acknowledge Receipt by Email'
        : this.stem.Mailing_Requirement__c.value?.includes('-1b')
          ? 'Acknowledge Receipt by WeChat'
          : 'Acknowledge Receipt'
      : 'Acknowledge Receipt'; 
    this.isPumpingCompletionDate = this.stem.Mailing_Requirement__c.value
      ? this.stem.Mailing_Requirement__c.value?.includes('-6')
      : false;
    this.deliveryDateLabel = this.isPumpingCompletionDate ? 'Pumping Completion Date' : 'Delivery Date';
    this.paymentTermValue = this.stem.Payment_Term__c.value;
    this.expectedDeliveryDateValue = this.stem.Expected_Delivery_Date__c.value;
    this.invoiceDueDateValue = this.stem.Invoice_Due_Date__c.value;
    this.disputeStatusValue = this.stem.Dispute_Status__c.value;
    this.showDisputes = this.disputeStatusValue != 'No Dispute' ? true : false;
    this.tabBackground = this.stem.Dispute_Status__c.value === 'No Dispute' ? '' : 'redBackground';
    this.invoiceBackground = this.stem.Message__c.value != null 
      ? 'purpleBackground' 
      : this.tabBackground
    this.showMessage = Boolean(this.stem.Message__c.value);
    this.dueDateOverride = this.stem.Due_Date_Override__c.value;
    this.dueDateDisabled = !this.stem.Due_Date_Override__c.value;
    this.dueDateOverrideDisabled = this.stem.Due_Date_Override__c.value && this.stem.Payment_Term__c.value === "CIA";
    this.partialLumpsumSellAt = this.stem.Partial_Lumpsum_Sell_At__c.value;
    this.isDisabledPartialCIA = !this.stem.Partial_CIA__c.value
    this.invoiceButtonLabel =
      this.stem.Payment_Term__c.value === "CIA" &&
      !this.stem.Delivery_Date__c.value
        ? PROFORMA_INVOICE_LABEL
        : INVOICE_LABEL;
    this.holdPaymentValue = Boolean(this.stem.Hold_Payment__c.value) ? 'Yes' : 'No';
    this.originatedClass = this.stem.Account__r.value.fields.Inactive_Suspended__c.value === false ? '' : 'slds-theme_warning';
    if(this.stem.Payment_Term__c.value === 'CIA' && Boolean(this.invoiceDueDateValue) === false){
      let invoiceDueDate = new Date(this.stem.Expected_Delivery_Date__c.value);
      invoiceDueDate.setDate(
        invoiceDueDate.getDate() - 1
      );
      this.invoiceDueDateValue = this._convertDate(invoiceDueDate);
    }
    if (this.stem.Delivery_Date__c.value) {
      this.deliveryDateValue = this.stem.Delivery_Date__c.value;
    } else if(this.stem.Mailing_Requirement__c.value?.includes('-6')){
      this.deliveryDateValue = null;
    }
    this.fcbsReferenceVisible = this.stem.Account__r.value.fields.Name.value === FCBS_NAME && this.stem.Port__r.value.fields.Country__c.value === KOREA_PORT;
    this.fcbsReference = this.stem.FCBS_Reference__c.value;
  }

  setDateRange() {
    let startDateRange, endDateRange;
    let dateFields = [
      this.stem.ETA_Start_Date__c.value,
      this.stem.ETB_Start_Date__c.value,
      this.stem.ETCD_Start_Date__c.value,
      this.stem.ETD_Start_Date__c.value,
      this.stem.ETA_End_Date__c.value,
      this.stem.ETB_End_Date__c.value,
      this.stem.ETCD_End_Date__c.value,
      this.stem.ETD_End_Date__c.value,
    ];
    if (this.stem.ETA_ETB__c.value !== "PROMPT") {
      startDateRange = this.getMinDate(dateFields);
      endDateRange = this.getMaxDate(dateFields);
      this.dateRange =
        endDateRange && startDateRange  && startDateRange !== endDateRange
          ? startDateRange + "-" + endDateRange
          : startDateRange
          ? startDateRange
          : "";
    } else if (this.stem.ETA_ETB__c.value === "PROMPT") {
      startDateRange = new Date(this.expectedDeliveryDateValue).toLocaleDateString('en-GB');
      endDateRange = this.getMaxDate(dateFields);
      this.dateRange =
        endDateRange && startDateRange  && startDateRange !== endDateRange
          ? startDateRange + "-" + endDateRange
          : startDateRange
          ? startDateRange
          : "";
    }
  }

  getMinDate(dates) {
    dates = dates.filter(Boolean);
    if (dates.length === 0) return null;
    let startDate = new Date(
      Math.min(
        ...dates.map((date) => {
          return new Date(date);
        })
      )
    );
    return startDate.toLocaleDateString('en-GB')
  }

  getMaxDate(dates) {
    dates = dates.filter(Boolean);
    if (dates.length === 0) return null;
    let endDate = new Date(
      Math.max(
        ...dates.map((date) => {
          return new Date(date);
        })
      )
    );
    return endDate.toLocaleDateString('en-GB')
  }

  @wire(getProductInfo, { stemId: "$recordId" })
  wiredProductInfo(value) { 
    this.wiredProductInfo = value;
    const { data, error } = value;  
    if (data) {
      this.productInfo = data;
      if(Array.isArray(this.productInfo)){
        let selectedSTEMLineItems = this.productInfo.filter(product => product.objectName === 'STEM_Line_Item__c');
        if (Array.isArray(selectedSTEMLineItems) && selectedSTEMLineItems.length > 0) {
          this.isProductLineItemExisting = true;
          if(this.stem && this.stem.Delivery_Date__c && this.stem.Delivery_Date__c.value){
            this.deliveryDateValue = this.stem.Delivery_Date__c.value;
          } else if (selectedSTEMLineItems.filter(product => product.bdnDeliveryDate).length > 0 &&
            !(this.stem && this.stem.Delivery_Date__c && this.stem.Delivery_Date__c.value)) {
            this.deliveryDateValue = null;
          } else{
            getEarliestSupplierDeliveryDate({stemId: this.recordId}).then((supplierInvoices) => {
              if(Array.isArray(supplierInvoices) && !(this.stem && this.stem.Delivery_Date__c && this.stem.Delivery_Date__c.value)){
                this.deliveryDateValue = supplierInvoices.map(supplierInvoice => supplierInvoice.Supplier_Delivery_Date__c)[0];
                if (this.dueDateDisabled && Boolean(this.invoiceDueDateValue) === false) {
                  if(this.stem.Payment_Term__c.value === 'CIA'){
                    let invoiceDueDate = new Date(this.stem.Expected_Delivery_Date__c.value);
                    invoiceDueDate.setDate(
                      invoiceDueDate.getDate() - 1
                    );
                    this.invoiceDueDateValue = invoiceDueDate;
                  } else{
                    let invoiceDueDate = new Date(this.deliveryDateValue);
                    invoiceDueDate.setDate(
                      invoiceDueDate.getDate() + Number(this.stem.Payment_Term__c.value.replace( /^\D+/g, '')) - 1
                    );
                    this.invoiceDueDateValue = invoiceDueDate;
                  }
                }
              }
            })
          }
        } else{
          if (this.productInfo.every(product => product.issued) &&
            !(this.stem && this.stem.Delivery_Date__c && this.stem.Delivery_Date__c.value)) {
            this.deliveryDateValue = null;
          }
          this.isProductLineItemExisting = false;
          this.deliveryDateDisabled = true;
          this.deliveryDateRequired = false;
          this.dueDateOverride = true;
          this.dueDateDisabled = false;
        }
      }
      this.error = undefined;
    } else if (error) {
      console.error(error)
      this.error = error;
    }
  }

  @wire(getInvoices, { stemId: "$recordId" })
  wiredInvoice(value) {
    this.wiredInvoices = value;
    const { data, error } = value;
    if (data) {
      let invoicesList = []
      data.forEach(invoice => {
        invoicesList.push({
          ...invoice,
          Invoice_Date: invoice.Invoice_Date__c ? new Date(invoice.Invoice_Date__c).toLocaleDateString('en-GB') : '',
          Delivery_Date: invoice.Delivery_Date__c ? new Date(invoice.Delivery_Date__c).toLocaleDateString('en-GB') : '',
          Invoice_Due_Date: invoice.Invoice_Due_Date__c ? new Date(invoice.Invoice_Due_Date__c).toLocaleDateString('en-GB') : '',
        })
      })
      this.invoices = invoicesList;
      this.error = undefined;
    } else if (error) {
      console.error(error)
      this.error = error;
    }
  }

  @wire(getLastInvoiceForm, { stemId: "$recordId" })
  wireLastInvoiceForm(value) {
    this.wiredLastInvoiceForm = value;
    const { data, error } = value;
    if (data) {
      this.lastInvoiceForm = data;
      this.disabledLastInvoiceForm = !data;
      this.error = undefined;
    } else if (error) {
      console.error(error)
      this.error = error;
    }
  }

  @wire(getStemBuyerBrokers, { stemId: "$recordId" })
  wireStemBuyerBrokers(value) {
    this.wiredStemBuyerBrokers = value;
    const { data, error } = value;
    if (data) {
      this.stemBuyerBrokers = data;
      this.newStemBuyerBrokers = data.length > 0 ? [] : [{id: this.makeId(7)}];
      this.isBuyerBrokerChanged = false;
      this.error = undefined;
    } else if (error) {
      console.error(error)
      this.error = error;
    }
  }

  connectedCallback() {
    refreshApex(this.wiredInvoices);
    registerListener("refreshStemLineItemList", this.handleRefreshStemItems, this);
    registerListener("refreshStemExtraCostsList", this.handleRefreshStemItems, this);
    registerListener("refreshSupplierInvoicesList",this.handleRefreshSupplierInvoices,this);
    registerListener("refreshInvoices",this.handleRefreshInvoices,this);
  }

  handleRefreshStemItems(ref) {
    if (ref) {
      refreshApex(this.wiredStemLineItems).then(() => {
        refreshApex(this.wiredStemInfo);
        refreshApex(this.wiredProductInfo).then(() => {
          if(this.template.querySelector('.product-info')){
            this.selectedProducts = [];
            this.handleInvoiceFormChange();
          }
          refreshApex(this.wiredInvoices);
          if(this.template.querySelector("c-fcb-stem-payment")){
            this.template.querySelector("c-fcb-stem-payment").refreshGridData();
          }
          let components = [
            ...this.template.querySelectorAll("c-fcb-supplier-invoice-payment"),
          ].map((component) => {
            component.refreshGridData();
          });
          if(this.template.querySelector("c-fcb-stem-extra-cost-tab")){
            this.template.querySelector("c-fcb-stem-extra-cost-tab").refreshData()
          }
          if(this.template.querySelector("c-fcb-supplier-invoices")){
            this.template.querySelector("c-fcb-supplier-invoices").refreshData()
          }
          if(this.template.querySelector("c-fcb-commission-invoice-form")){
            this.template.querySelector("c-fcb-commission-invoice-form").refreshData()
          }
          if(this.template.querySelector("c-fcb-stem-line-item-table")){
            this.template.querySelector("c-fcb-stem-line-item-table").handleRefreshStemLineItems(true)
          }
          if(this.template.querySelector("c-fcb-stem-unofficial-compensations")){
            this.template.querySelector("c-fcb-stem-unofficial-compensations").getUnofficialCompensation(true)
          }
          components = [
            ...this.template.querySelectorAll("c-fcb-commision-invoices"),
          ].map((component) => component.resetFields());
          components = [
            ...this.template.querySelectorAll("c-fcb-stem-line-item"),
          ].map((component) => {
            component.refreshTable();
          });
        });
      }); 
    }  
  }

  handleRefreshProductInfo(){
    this.handleRefreshStemItems(true);
  }

  handleRefreshInvoices(ref) {
    if (ref) {
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Success",
          message: "Product Info is updated",
          variant: "success",
        })
      );
      if(this.template.querySelector("c-fcb-stem-payment")){
        this.template.querySelector("c-fcb-stem-payment").refreshGridData();
      }
      this.handleRefreshStemItems(true);
      this.template.querySelector(".product-info").selectedRows = [];
      this.selectedProducts = [];
      this.createInvoiceDisabled = true;
      this.createInvoiceDisabledMessage = "Pick at least one product";
      refreshApex(this.wiredInvoices);
      refreshApex(this.wiredLastInvoiceForm);
      this.actionExecuted = true;
    }
  }

  handleRefreshSupplierInvoices(ref) {
    if (ref) {      
      this.template.querySelector("c-fcb-supplier-invoices")?.refreshData();
      refreshApex(this.wiredStemInfo).then(() => {
        let components = [
          ...this.template.querySelectorAll("c-fcb-supplier-invoice-payment"),
        ].map((component) => {
          component.refreshGridData();
        });
      });
    }
  }

  handleSubmit(event) {
    try {
      event.preventDefault();
      const fields = event.detail.fields;
      fields.Expected_Delivery_Date__c = this.expectedDeliveryDateValue;
      fields.Payment_Term__c = this.paymentTermValue;
      fields.Dispute_Status__c = this.disputeStatusValue;
      fields.Hold_Payment__c = this.holdPaymentValue === 'Yes';
      this.template.querySelector(".main-form").submit(fields);
      console.log('save');
      
    } catch (error) {
      console.error(error)
    }

  }

  handleSuccess(event) {
    try {
      let evt = new ShowToastEvent({
        title: "Record updated",
        variant: "success",
      });
      if(this.template.querySelector("c-fcb-stem-payment")){
        this.template.querySelector("c-fcb-stem-payment").refreshGridData();
      }
      if(this.template.querySelector("c-fcb-commission-invoice-form")){
        this.template.querySelector("c-fcb-commission-invoice-form").refreshData()
      }
      refreshApex(this.wiredStemLineItems).then(() => {
        let components = [
          ...this.template.querySelectorAll("c-fcb-commision-invoices"),
        ].map((component) => component.resetFields());
      })
      console.log(this.disputeStatusValue);
      
      this.dispatchEvent(evt);
      this.showSaveButton = false;
      refreshApex(this.wiredStemInfo).then(() => {
        this.handleInvoiceFormChange();
      })
    } catch (error) {
      console.error(error)
    }

  }

  handleError(event){
    console.error('Save error:', JSON.stringify(event.detail));
  }

  handleReset(event) {
    try {
      this.isCanceled = true;
      const inputFields = this.template.querySelectorAll(
        "lightning-input-field"
      );
      if (inputFields) {
        inputFields.forEach((field) => {
          if (field.name === "main-form-field") field.reset();
        });
      }
      this.setStemInfo(this.wiredStemInfo.data)
      this.handleChange(event);
    } catch (error) {
      console.error(error);
    }
  }

  handleChange(event) {
    if(event.target.fieldName === 'Partial_CIA__c'){
      this.isDisabledPartialCIA = !event.detail.value;
    } 
    if(!event.detail.value){
      this.partialLumpsumSellAt = null;
    }
    this.showSaveButton = this.isCanceled ? false : true;
    this.isCanceled = false;
  }

  addNewBuyerBroker(event){
    this.isBuyerBrokerChanged = true;
    this.newStemBuyerBrokers = [...this.newStemBuyerBrokers, {id: this.makeId(7)}]
  }

  makeId(length) {
    let result = "";
    let characters =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  }

  removeBuyerBroker(event){
    this.isBuyerBrokerChanged = true;
    this.stemBuyerBrokers = this.stemBuyerBrokers.filter(stemBuyerBroker => stemBuyerBroker.Id !== event.target.dataset.id);
    this.stemBuyerBrokersToDelete.push(event.target.dataset.id);
  }

  removeNewBuyerBroker(event){
    this.newStemBuyerBrokers = this.newStemBuyerBrokers.filter(stemBuyerBroker => stemBuyerBroker.id !== event.target.dataset.id);
  }

  handleBuyerBrokerChange(event){
    this.isBuyerBrokerChanged = true;
  }

  async saveBuyerBrokers(event) {
    try {
      let btns = this.template.querySelectorAll(".hidden-btn");
      if (btns) {
        btns.forEach(btn => {
          btn.click();
        });
      }
      Promise.all(this.stemBuyerBrokersToDelete.map(recordId => deleteRecord(recordId)));
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Success",
          message: "Brokers have been edited",
          variant: "success",
        })
      );
      this.isBuyerBrokerChanged = false;
    } catch (error) {
      console.error(error)
    }
  }

  cancelSavebBuyerBrokers(){
    this.isBuyerBrokerChanged = false;
    this.newStemBuyerBrokers = [];
    refreshApex(this.wiredStemBuyerBrokers);
  }

  handleSubmitBuyerBroker(event) {
    event.preventDefault();
    const fields = event.detail.fields;
    fields.STEM__c = this.recordId;
    event.target.submit(fields);
  }

  handleSuccessBuyerBroker(){
    refreshApex(this.wiredStemBuyerBrokers);
  }

  handleHoldPaymentChange(event) {
    this.holdPaymentValue = event.detail.value;
  }
  
  handleDisputeStatusChange(event){
    this.disputeStatusValue = event.detail.value;
  }

  handlePaymentTermChange(event){
    this.paymentTermValue = event.detail.value;
  }

  handleChangeExpectedDeliveryDate(event){
    this.expectedDeliveryDateValue = event.detail.value;
  }

  handleChangeDeliveryDate(event){
    this.deliveryDateValue = event.detail.value;
    if (this.dueDateDisabled) {
      if(this.stem.Payment_Term__c.value === 'CIA'){
        let invoiceDueDate = new Date(this.stem.Expected_Delivery_Date__c.value);
        invoiceDueDate.setDate(
          invoiceDueDate.getDate() - 1
        );
        this.invoiceDueDateValue = this._convertDate(invoiceDueDate);
      } else{
        let invoiceDueDate = new Date(this.deliveryDateValue);
        invoiceDueDate.setDate(
          invoiceDueDate.getDate() + Number(this.stem.Payment_Term__c.value.replace( /^\D+/g, '')) - 1
        );
        this.invoiceDueDateValue = this._convertDate(invoiceDueDate);
      }
    }
    this.handleInvoiceFormChange();
  }

  handleChangeInvoiceDueDate(event){
    this.invoiceDueDateValue = event.detail.value;
    this.handleInvoiceFormChange();
  }

  handleChangeFcbsReference(event){
    this.fcbsReference = event.detail.value;
  }

  @wire(getStemLineItemsByStemId, { stemId: "$recordId" })
  wireStemLineItem(value) {    
    this.wiredStemLineItems = value;
    const { data, error } = value;
    if (data) {
      let stemLineItemList = [];
      data.forEach((row) => {
        stemLineItemList.push({...row});
      });
      console.log(stemLineItemList);
      
      this.stemLineItems = stemLineItemList;
      this.error = undefined;
    } else if (error) {
      this.error = error;
    }
  }

  @wire(getStemExtraCostsByStemId, { stemId: "$recordId" })
  wireStemExtraCost(value) {
    const { data, error } = value;
    if (data) {
      this.extraCosts = data;
      this.error = undefined;
    } else if (error) {
      this.error = error;
    }
  }

  handleSave(event) {
    let recordsToUpdate = [];
    event.detail.draftValues.forEach((changedRecord) => {
      const fields = {};
      fields.Id = changedRecord.Id;
      fields.Deprecated__c = changedRecord.Deprecated__c;
      recordsToUpdate.push({ fields });
    });
    Promise.all(recordsToUpdate.map((record) => updateRecord(record)))
      .then((record) => {
        this.handleRefreshProductInfo();
        this.dispatchEvent(
          new ShowToastEvent({
            title: "Success",
            message: "Invoices updated",
            variant: "success",
          })
        );
        this.template.querySelector(".invoice-info").draftValues = [];
      })
      .catch((error) => {
        this.dispatchEvent(
          new ShowToastEvent({
            title: "Error Updating Invoices",
            message: error.body.output.errors[0].message,
            variant: "error",
          })
        );
        this.template.querySelector(".invoice-info").draftValues = [];
      });
  }

  /**
   *
   * @param {*} event
   */

  async handleSubmitAllProductLineItems() {
    this.isSavingBdnDetails = true;
    try {
      const recordForms = this.template.querySelectorAll("c-fcb-stem-line-item");
      for (const form of recordForms) {
        await form.submitForm();
      }

      this.showSaveAllButton = false;
      await refreshApex(this.wiredStemLineItems);
      this.dispatchEvent(
        new ShowToastEvent({
          title: "BDN details saved",
          message: "All changed BDN lines were saved successfully.",
          variant: "success",
        })
      );
    } catch (error) {
      this.showSaveAllButton = true;
      this.dispatchEvent(
        new ShowToastEvent({
          title: "BDN details were not fully saved",
          message: getErrorMessage(error),
          variant: "error",
          mode: "sticky",
        })
      );
    } finally {
      this.isSavingBdnDetails = false;
    }
  }

  handleSubmitAllCommisions(event) {
    try {
      let recordForms = this.template.querySelectorAll("c-fcb-commision-invoices");
      recordForms.forEach((form) => {
        form.submitForm();
      });
      this.showSaveAllCommissionButton = false;
      refreshApex(this.wiredStemLineItems);
    } catch (error) {
      console.error(error);
    }
  }

  handleStemLineItemChange(event) {
    this.showSaveAllButton = this.isSaveAllCancelled ? false : true;
    this.isSaveAllCancelled = false;
  }

  handleStemLineItemReset(event) {
    this.isSaveAllCancelled = true;
    let components = [
      ...this.template.querySelectorAll("c-fcb-stem-line-item"),
    ].map((component) => {
      component.resetFields();
    });
    this.handleStemLineItemChange(event);
  }

  handleCommissionChange(event){
      this.showSaveAllCommissionButton = this.isSaveAllCommissionsCancelled ? false : true;
      this.isSaveAllCommissionsCancelled = false; 
  }

  handleCommissionReset(event){
      this.isSaveAllCommissionsCancelled = true;
    let components = [
      ...this.template.querySelectorAll("c-fcb-commision-invoices"),
    ].map((component) => component.resetFields());
    this.handleCommissionChange(event);
  }

  /**
   *
   * @param {*} event
   */
  generateInvoice(event) {
    try {
      let buttonName = event.target.dataset.name;
      this.actionExecuted = false;
      let fields = {};
      let isValid = this.validateFields();
      if (isValid) {
        fields["Id"] = this.recordId;
        fields["Delivery_Date__c"] = this.productInfo.every(product => product.issued && product.objectName === 'STEM_Extra_Cost__c') 
          ? null
          : this.deliveryDateValue;
        fields["Invoice_Due_Date__c"] = this.invoiceDueDateValue;
        fields["Due_Date_Override__c"] = !this.dueDateDisabled;
        fields["FCBS_Reference__c"] = this.fcbsReferenceVisible ? this.fcbsReference : null;
        let recordInput = {fields}
        updateRecord(recordInput).then(() => {
          updateAllStemExtraCosts({ stemExtraCosts: this.extraCosts });
          let createProforma = this.template.querySelector('[data-name="createInvoiceButton"]').label === "Create Proforma Invoice" ? true : false;
          let invoiceFormModal = this.template.querySelector(
            "c-fcb-invoice-form"
          );
          if(buttonName === 'lastInvoiceForm'){
            invoiceFormModal.openModal(this.recordId, this.selectedProducts, createProforma, this.isProductLineItemExisting, this.lastInvoiceForm);
          } else{
            this.selectedProducts = this.template.querySelector(".product-info").getSelectedRows();
            invoiceFormModal.openModal(this.recordId, this.selectedProducts, createProforma, this.isProductLineItemExisting, null);
          }
          this.actionExecuted = true;
        })
      } else{
        this.actionExecuted = true;
      }
    } catch (error) {
      console.error(error)
    }
  }

  sendInvoice(event) {
    this.openEmail = true;
    this.selectedInvoices = this.template.querySelector(".invoice-info").getSelectedRows();
    setTimeout(() => {
      let sendEmailModal = this.template.querySelector(
        "c-fcb-email-invoice-modal"
      );
      sendEmailModal.openModal(this.recordId, this.selectedInvoices);
    }, 10);
  }

  validateFields(fields) {
    if ((!this.deliveryDateValue && this.deliveryDateRequired) 
      || (!this.invoiceDueDateValue && this.template.querySelector(".due-date-input").required)
      || (this.fcbsReferenceVisible && Boolean(this.fcbsReference) === false)) {
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Error Creating Invoice",
          message: "Please fill necessary dates",
          variant: "error",
        })
      );
      return false;
    }
    if(Array.isArray(this.selectedProducts)){
      if(this.selectedProducts.filter(product => product.issued).length > 0){
        this.dispatchEvent(
          new ShowToastEvent({
            title: "Error Creating Invoice",
            message: "One of products was already invoiced",
            variant: "error",
          })
        );
        return false;
      }
    }
    if(Array.isArray(this.selectedProducts)){
      let selectedSTEMLineItems = this.selectedProducts.filter(product => product.objectName === 'STEM_Line_Item__c');
      if(Array.isArray(selectedSTEMLineItems) && selectedSTEMLineItems.length > 0){
        let bdnDeliveryDate = selectedSTEMLineItems[0].bdnDeliveryDate;
        if(this.stem.Mailing_Requirement__c.value?.includes("-5") && !selectedSTEMLineItems.every(product => product.bdnDeliveryDate === bdnDeliveryDate)){
          this.dispatchEvent(
            new ShowToastEvent({
              title: "Error Creating Invoice",
              message: "Please select product with the same BDN Delivery Date",
              variant: "error",
            })
          );
          return false;
        }
      }
    }
    return true;
  }

  handleProductChange(event) {
    try {
      this.selectedProducts = event.detail.selectedRows;
      this.handleInvoiceFormChange();
    } catch (error) {
      console.error(error)
    }

  }

  handleInvoiceFormChange() {
    if(this.template.querySelector(".delivery-date-input")){ 
      this.deliveryDateRequired = this.isProductLineItemExisting ? true : false;
      let isQuantityRange = false;
      let quantityDeliveredMissing = false;
      for (const stemLineItem of this.stemLineItems) {
        if (stemLineItem.Is_Quantity_Range__c) isQuantityRange = true;
        if (!stemLineItem.Quantity_Delivered_Per_BDN__c) quantityDeliveredMissing = true;
      }
      console.log(this.stem.Partial_CIA__c.value);
      
      if ((this.stem.Payment_Term__c.value === "CIA" || this.stem.Partial_CIA__c.value) && !this.template.querySelector(".delivery-date-input").value) {
        this.deliveryDateRequired = false;
        this.invoiceButtonLabel = PROFORMA_INVOICE_LABEL;
        this.dueDateOverride = true;
        this.dueDateDisabled = false;
        this.dueDateOverrideDisabled = true;
      } else {
        this.invoiceButtonLabel = INVOICE_LABEL;
        this.dueDateOverrideDisabled = false;
      }
      if (this.selectedProducts.length == 0) {
        this.createInvoiceDisabled = true;
        this.createInvoiceDisabledMessage = "Pick at least one product";
      } else if (Boolean(this.template.querySelector(".delivery-date-input").value) && quantityDeliveredMissing) {
        this.createInvoiceDisabled = true;
        this.createInvoiceDisabledMessage =
          "At least one BDN Quantity Delivered is missing.";
      } else if (isQuantityRange && quantityDeliveredMissing) {
        this.createInvoiceDisabled = true;
        this.createInvoiceDisabledMessage =
          "Proforma Invoice cannot be created because product quantities are still in range.";
      }  else {
        this.createInvoiceDisabled = false;
      }
    }
  }

  handleInvoiceChange(event) {
    this.sendInvoiceDisabled =
      event.detail.selectedRows.length > 0 ? false : true;
  }

  handleInvoiceTableRefresh() {
    this.isLoading = true;
    this.sendInvoiceDisabled = true;
    this.template.querySelector('.invoice-info').selectedRows = [];
    refreshApex(this.wiredInvoices);
  }

  provideDueDate(event) {
    this.dueDateOverride = event.target.checked;
    this.dueDateDisabled = !event.target.checked;
    this.invoiceDueDateValue = null;
    this.handleInvoiceFormChange();
  }

  handleRowAction(event) {
    const action = event.detail.action;
    const row = event.detail.row;
    switch (action.name) {
      case "viewRow":
        this.openInvoice(row);
        break;
      case "delete":
        this.removeInvoice(row.Id);
        break;
      default:
        break;
    }
  }

  openInvoice(Invoice__c) {
    this[NavigationMixin.Navigate]({
      type: "standard__recordPage",
      attributes: {
        recordId: Invoice__c.Id,
        objectApiName: "Invoice__c",
        actionName: "view",
      },
    });
  }

  removeInvoice(InvoiceId) {
    deleteRecord(InvoiceId)
      .then(() => { 
        //putDeletedInvoiceToChangesCSV({ recordId: InvoiceId });
        if (this.invoices.length == 1) {
          let fields = {
            Id: this.recordId,
            Delivery_Date__c: null
          };
          let recordInput = { fields };
          return updateRecord(recordInput);
        }
      })
      .then(() => {
        this.dispatchEvent(
          new ShowToastEvent({
            title: "Success",
            message: "Record deleted",
            variant: "success",
          })
        );
        this.handleInvoiceTableRefresh();
        const paymentComponent = this.template.querySelector("c-fcb-stem-payment");
        if (paymentComponent) {
          paymentComponent.refreshGridData();
        }
        refreshApex(this.wiredStemInfo);
        refreshApex(this.wiredProductInfo);
      })
      .catch((error) => {
        this.dispatchEvent(
          new ShowToastEvent({
            title: "Error deleting record",
            message: error.body?.message || error.body || error.message || "Unknown error",
            variant: "error",
          })
        );
      });
  }

  openStemModal(event) {
    this.showEditStem = true;
  }

  openDisputeAccounts(event){
    this.showDisputeAccounts = true;
  }

  handleModalCloseEvent(event) {
    if (event.detail.modal === "showstemmodal") {
      this.showEditStem = false;
    } else if(event.detail.modal === "showdisputeaccounts"){
      this.showDisputeAccounts = false;
      if(this.template.querySelector("c-fcb-disputes")){
        this.template.querySelector("c-fcb-disputes").refreshData()
      }

    }
  }

  _convertDate(date) {
    let day = date.getDate();
    day = day < 10 ? "0" + day : day;
    let month = date.getMonth() + 1;
    month = month < 10 ? "0" + month : month;
    let year = date.getFullYear();
    return year + "-" + month + "-" + day;
  }
}
