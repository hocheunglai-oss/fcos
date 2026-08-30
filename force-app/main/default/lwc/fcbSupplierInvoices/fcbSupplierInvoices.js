import { api, LightningElement, track, wire } from "lwc";
import {ShowToastEvent} from "lightning/platformShowToastEvent";
import { CurrentPageReference } from 'lightning/navigation';
import getSupplierInvoiceTemplates from "@salesforce/apex/StemProcessingController.getSupplierInvoiceTemplates";
import getSupplierInvoicesOptions from "@salesforce/apex/StemProcessingController.getSupplierInvoicesOptions";
import getSupplierRefcodeIndex from "@salesforce/apex/MyobDataExportController.getSupplierRefcodeIndex";
import { NavigationMixin } from "lightning/navigation";
import { fireEvent } from 'c/pubsub';
import { refreshApex } from "@salesforce/apex";
import { updateRecord , createRecord} from "lightning/uiRecordApi";
import getSupplierVariableChargeReadiness from "@salesforce/apex/VariableChargeInvoiceReadinessService.getSupplierReadiness";
import getSupplierMasterContractReadiness from "@salesforce/apex/MasterContractInvoiceReadinessService.getSupplierReadiness";


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
    type: 'boolean',
  }
]

const FCBS_NAME = 'FRATELLI COSULICH BUNKERS (S) PTE LTD';
const KOREA_PORT = 'KOREA';

export default class FcbSupplierInvoices extends  NavigationMixin (
    LightningElement
){
  @api recordId;
  @api stem;
  @track error;
  @track productSuppliers;
  @track wiredProductSuppliers;
  @track supplierInvoices;
  @track supplierValue;
  @track optionValue;
  paymentTermValue;
  @track bankDetailsValue = '';
  isSaved = true;
  options;
  bankDetailOptions;
  totalSumForSupplierText = '';
  invoiceDateValue;
  @track deliveryDateValue;
  @track invoiceAmountValue;
  calculatedAmount;
  @track supplierVariableChargeReadiness;

  @track productColumns = COLS;
  @track productInfo;
  @track selectedProducts;

  wiredSupplierInvoices;
  supplierInvoices;

  @track invoiceNumber;

  @track fcbsReferenceVisible = false;
  @track fcbsReference;

  @wire(CurrentPageReference) pageRef;

  @track partialCIA = false;
  @track partialAmount;

  connectedCallback(){
    this.invoiceDateValue = this._convertDate(new Date());
  }

  get supplierInvoiceCreateDisabled() {
    return !this.isSaved || (this.supplierVariableChargeReadiness && this.supplierVariableChargeReadiness.ready !== true);
  }

  async loadSupplierVariableChargeReadiness() {
    if (!this.recordId || !this.supplierValue) {
      this.supplierVariableChargeReadiness = null;
      return null;
    }
    try {
      const params = { stemId: this.recordId, supplierId: this.supplierValue };
      const [masterContract, variableCharges] = await Promise.all([
        getSupplierMasterContractReadiness(params),
        getSupplierVariableChargeReadiness(params),
      ]);
      if (masterContract && masterContract.ready !== true) {
        this.supplierVariableChargeReadiness = {
          ...masterContract,
          linkLabel: 'Open Master Contracts in FCOS',
        };
      } else {
        this.supplierVariableChargeReadiness = {
          ...variableCharges,
          linkLabel: 'Open FCOS task',
        };
      }
      return this.supplierVariableChargeReadiness;
    } catch (error) {
      this.supplierVariableChargeReadiness = {
        ready: false,
        requiresVariableChargeReview: true,
        reason: 'Supplier Invoice readiness could not be checked. Refresh, then open the FCOS task if the problem continues.',
        fcosUrl: `https://fcos.fcuno.com/master-contracts`,
        linkLabel: 'Open FCOS',
      };
      return this.supplierVariableChargeReadiness;
    }
  }

  @api
  refreshData(){
    this.handleReset();    
    refreshApex(this.wiredProductSuppliers);
    refreshApex(this.wiredSupplierInvoices);
  }


  @wire(getSupplierInvoicesOptions, { stemId: "$recordId" })
  getSupplierInvoices(result) {
    this.wiredSupplierInvoices = result;    
    if (result.data) {      
      this.supplierInvoices = result.data;
    } else {
      this.supplierInvoices = [];
    }
  };

  @wire(getSupplierInvoiceTemplates, { stemId: "$recordId" })
  wiredSupplierInvoiceTemplate(value) {
    const {data,error} = value;
    this.wiredProductSuppliers = value;
    if (data) {
      this.productSuppliers = data;
      this.error = undefined;
      let suppliersPicklist = [];
      this.productSuppliers.forEach(stemLineItem => {
        if (stemLineItem.supplierId) {
          suppliersPicklist.push({ label: stemLineItem.supplierName + ': ' + stemLineItem.paymentTerm,
             value: stemLineItem.supplierId + '_' + stemLineItem.paymentTerm,
             supplierId: stemLineItem.supplierId,
             paymentTerm: stemLineItem.paymentTerm})
        }
      })
      let filteredSuppliersPicklist = suppliersPicklist.filter((element , index, self)  =>
                                                         self.map(x => x.value)
                                                             .indexOf(element.value) === index);                                          
      this.options = filteredSuppliersPicklist;
      this.supplierValue = null;
    } else if (error) {
      console.error(error);
      
      this.error = error;
      this.productSuppliers = undefined;
    }
  }

  

  async handleSubmit(event) {
    try {
      this.isSaved = false;
      const readiness = await this.loadSupplierVariableChargeReadiness();
      if (readiness && readiness.ready !== true) {
        this.dispatchEvent(new ShowToastEvent({
          title: 'Supplier Invoice verification required',
          message: readiness.reason,
          variant: 'error',
        }));
        this.isSaved = true;
        return;
      }
      if(this.productInfo.filter(product => this.selectedProducts.includes(product.id) && product.issued).length > 0){
        const evt = new ShowToastEvent({
          title: "Error",
          message: "Issued product has been selected",
          variant: "error"
        });
        this.dispatchEvent(evt);
        this.isSaved = true;
        return;
      }
      if (this.productInfo.some(product =>
          this.selectedProducts.includes(product.id) &&
          product.objectType === 'STEM Line Item' &&
          !product.quantityDeliveredPerBDN
      )) {
          const evt = new ShowToastEvent({
              title: "Error",
              message: "Selected products doesn't have Quantity Delivered per BDN set",
              variant: "error"
          });
          this.dispatchEvent(evt);
          this.isSaved = true;
          return;
      }
      if(!this.validateInputsAndGetValidationResult()){
        const evt = new ShowToastEvent({
          title: "Error",
          message: "Please fill all required fields",
          variant: "error"
        });
        this.dispatchEvent(evt);
        this.isSaved = true;
        return;
      }
      if(this.selectedProducts.length === 0){
        const evt = new ShowToastEvent({
          title: "Error",
          message: "Please select items",
          variant: "error"
        });
        this.dispatchEvent(evt);
        this.isSaved = true;
        return;
      }
      let products = this.productInfo.filter(product => this.selectedProducts.includes(product.id))
      const fields = {};
      fields.Name = this.invoiceNumber;
      fields.Invoice_Amount__c = this.invoiceAmountValue;
      fields.Bank_Details__c = this.bankDetailsValue ? this.bankDetailsValue : '';
      fields.FCBS_Reference__c = this.fcbsReferenceVisible ? this.fcbsReference : '';
      fields.Supplier__c = this.supplierValue;
      fields.Supplier_Delivery_Date__c = this.deliveryDateValue;
      fields.Invoice_Date__c = this.invoiceDateValue;
      fields.Payment_Term__c = this.paymentTermValue;
      fields.Partial_CIA__c = this.partialCIA;
      fields.Partial_Amount__c = this.partialCIA ? this.partialAmount : null;
      fields.Partial_Invoice_Due_Date__c = this.partialCIA ? this.deliveryDateValue : null;
      fields.Exported__c = products.some(product => product.exported);
      fields.Is_CSV_Info_Changed__c = fields.Exported__c
        && (products.length !== this.productInfo.length || this.invoiceAmountValue !== this.calculatedAmount 
          || products.some(product => product.isChanged)
        );
      fields.Refcode_Index__c = products.find(product => Boolean(product.refcodeIndex))?.refcodeIndex;
      if(Boolean(fields.Refcode_Index__c) === false){
        fields.Refcode_Index__c = await getSupplierRefcodeIndex({stemId: this.recordId, supplierId: this.supplierValue});
      }

      const daysToAdd = ['CIA', 'Deposit'].includes(this.paymentTermValue)
          ? 0
          : parseInt(this.paymentTermValue) || 0;

      const expectedDueDate = new Date(this.deliveryDateValue);
      expectedDueDate.setDate(expectedDueDate.getDate() + daysToAdd);

      const expectedDateStr = expectedDueDate.toISOString().split('T')[0];
      const supplierInvoice = this.supplierInvoices.find(supplierInvoice => supplierInvoice.Supplier__c === this.supplierValue 
        && supplierInvoice.STEM__c === this.recordId && supplierInvoice.Supplier_Delivery_Date__c === this.deliveryDateValue
        && supplierInvoice.Invoice_Due_Date__c === expectedDateStr);
   
      if (supplierInvoice) {
        fields["Id"] = supplierInvoice.Id;
        fields["Invoice_Amount__c"] = supplierInvoice.Invoice_Amount__c + this.invoiceAmountValue;
        const recordToUpdate = { fields };
        updateRecord(recordToUpdate).then((result) => {
          this.handleSuccess(result);
        })
      } else {
        fields.STEM__c = this.recordId;
        const recordInput = { apiName: 'Supplier_Invoice__c', fields };
        createRecord(recordInput).then((result) => {
          this.handleSuccess(result);
        }).catch(error => {
          console.error('Full error: ', JSON.stringify(error, null, 2));
          
        })
      } 
    } catch (error) {
      console.error(error)
    }
  }



  handleSuccess(result) {
    try {
    let fileUploadBinder = this.template.querySelector('c-fcb-file-upload-binder');
    fileUploadBinder.relatedTo = result.id;
    fileUploadBinder.bindWithParent().then(() => {
      let recordsToUpdate = [];
      this.productInfo.forEach((product) => {
        const fields = {};
        fields.Id = product.id;
        if(this.selectedProducts.includes(product.id)){
          fields.Supplier_Input__c = '🟢';
          fields.Supplier_Issued__c = true;
          fields.Supplier_Invoice__c = result.id;
        }
        recordsToUpdate.push({ fields });
      });
      Promise.all(recordsToUpdate.map((record) => updateRecord(record)))
        .then((record) => {
          this.handleReset();
          refreshApex(this.wiredProductSuppliers);
          refreshApex(this.wiredSupplierInvoices);
          this.isSaved = true;
          const evt = new ShowToastEvent({
            title: "Supplier Invoice Saved",
            variant: "success"
          });
          this.dispatchEvent(evt);
          fireEvent(this.pageRef, 'refreshSupplierInvoicesList', true);
        }) 
    });   
    } catch (error) {
      console.error(error)
    }     
  }

  validateInputsAndGetValidationResult() {
    let fields = [...this.template.querySelectorAll('lightning-input-field'), ...this.template.querySelectorAll('lightning-input'),
      ...this.template.querySelectorAll('lightning-combobox')];
    let isValid = true;
    fields.forEach(field => {
      if (field.required && !field.value) {
        field.reportValidity();
        isValid = false;
      } else {
        field.reportValidity();
      }
    });
    return isValid;
  }

  handleChangeInvoiceNumber(event){
    this.invoiceNumber = event.detail.value;
  }

  handleChangeDeliveryDate(event){
    this.deliveryDateValue = event.detail.value;
  }

  handleChangeInvoiceDate(event){
    this.invoiceDateValue = event.detail.value;
  }

  handleChangeFcbsReference(event){
    this.fcbsReference = event.detail.value;
  }

  async handleChange(event){
    try {
      const [supplierId, paymentTerm] = event.detail.value.split('_');
      this.optionValue = event.detail.value;
      this.supplierValue = supplierId;
      this.paymentTermValue = paymentTerm
      let products = this.productSuppliers.filter(element => element.supplierId === this.supplierValue && element.paymentTerm === this.paymentTermValue);   
      this.productInfo = products;
      this.selectedProducts = []; 
      this.setBankDetailOptions(products);
      this.setFcsbReference(products);
      this.recaclulateInoviceAmountValue();
      await this.loadSupplierVariableChargeReadiness();
    } catch (error) {
      console.error(error)
    } 
  }

  setBankDetailOptions(products) {
    let bankD = products[0].bankDetails;
    let bankDetails = bankD ? bankD.split("\r\n") : [];
    let bankDetailsPicklist = [];
    bankDetailsPicklist.push({ label: "Not Provided", value: "Not Provided" })
    bankDetails.forEach(element => {
      bankDetailsPicklist.push({ label: element, value: element })
    })
    this.bankDetailOptions = bankDetailsPicklist;
  }

  setFcsbReference(products){
    this.fcbsReferenceVisible = products[0].supplierName === FCBS_NAME && this.stem.Port__r.value.fields.Country__c.value === KOREA_PORT;
  }

  recaclulateInoviceAmountValue(event){
    let products = this.productInfo.filter(product => this.selectedProducts.includes(product.id));
    let stemLineItemSum = 0, productExtraChargesSum = 0, stemExtraChargesSum = 0;
    this.partialAmount = 0;
    this.partialCIA = false;
    products.forEach(product => {
      if(product.objectType === "STEM Line Item"){
        stemLineItemSum += product.totalCost;
        if(product.partialCIA){
          this.partialCIA = true;
          this.partialAmount = product.partialAmount;
        }
      }
      else if (product.objectType === "Product Charge") {
        productExtraChargesSum += product.totalCost;
      } else {
        stemExtraChargesSum += product.totalCost;
      }
    })
    this.invoiceAmountValue = Number(stemLineItemSum.toFixed(2)) + Number(productExtraChargesSum.toFixed(2)) + Number(stemExtraChargesSum.toFixed(2));
    this.partialAmount = Number(this.partialAmount.toFixed(2));
    this.calculatedAmount = this.invoiceAmountValue
    this.totalSumForSupplierText =
      this._numberWithCommas(stemLineItemSum) +
      "$ + " +
      this._numberWithCommas(productExtraChargesSum) +
      "$ + " +
      this._numberWithCommas(stemExtraChargesSum) +
      "$";
    let stemLineItems = products.filter(product => product.objectType === "STEM Line Item");
    if(Array.isArray(stemLineItems) && stemLineItems.length > 0 && !Boolean(this.deliveryDateValue)){      
      let defaultDeliveryDate = stemLineItems[0].bdnDeliveryDate;
      this.deliveryDateValue = stemLineItems.every(stemLineItem => stemLineItem.bdnDeliveryDate === defaultDeliveryDate) ? defaultDeliveryDate : this.deliveryDateValue      
    } 
  }

  handleProductChange(event) {
    try { 
      this.selectedProducts = event.detail.selectedRows.map(row => row.id);
      this.recaclulateInoviceAmountValue();
    } catch (error) {
      console.error(error)
    }

  }

  handleBankDetailChange(event){
    this.bankDetailsValue = event.target.value;
  }
  
  handleChangeInvoiceAmount(event){
    this.invoiceAmountValue = event.target.value;
  }

  handleError(event) {
    this.isSaved = true;
    const evt = new ShowToastEvent({
      title: "Error",
      message: event.detail.detail,
      variant: "error"
    });
    this.dispatchEvent(evt);
  }

  handleReset() {
    this.productInfo = null;
    this.invoiceNumber = null;
    this.selectedProducts = [];
    this.supplierValue = null;
    this.paymentTermValue = null;
    this.bankDetailsValue = null;
    this.deliveryDateValue = null;
    this.invoiceAmountValue = null;
    this.optionValue = null;
    this.fcbsReference = null;
    this.fcbsReferenceVisible = false;
    this.supplierVariableChargeReadiness = null;
    this.partialCIA = false;
    this.partialAmount = null;
    const inputFields = this.template.querySelectorAll(
        'lightning-input-field'
    );
    if (inputFields) {
      inputFields.forEach(field => {
        if (field.fieldName !== "STEM__c"){
          field.reset();
        }
      });
    }  
  }

  _convertDate(date) {
    let day = date.getDate();
    day = day < 10 ? '0' + day : day;
    let month = date.getMonth() + 1;
    month = month < 10 ? '0' + month : month;
    let year = date.getFullYear();
    return year + '-' + month + '-' + day;
  }

  _numberWithCommas(num) {
    return num.toFixed(2).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
}
