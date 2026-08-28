import { LightningElement , api, track , wire} from 'lwc';
import {ShowToastEvent} from "lightning/platformShowToastEvent";
import { CurrentPageReference } from 'lightning/navigation';
import { fireEvent } from 'c/pubsub';
import { refreshApex } from "@salesforce/apex";
import getCommissionInvoiceTemplates from "@salesforce/apex/StemProcessingController.getCommissionInvoiceTemplates";
import getBrokerRefcodeIndex from "@salesforce/apex/MyobDataExportController.getBrokerRefcodeIndex";

 
export default class FcbCommissionInvoiceForm extends LightningElement {
    @api recordId;
    @api stemLineItems;
    @track error;
    @track stemLineItemBrokers;
    @track wiredStemLineItemBrokers;
    @track brokerId = '';
    @track bankDetailsValue = '';
    isSaved = true;
    options;
    bankDetailOptions;
    invoiceDateValue;
    @track deliveryDateValue;
    @track invoiceAmountValue;
    calculatedAmountValue;
    @track totalSumForBrokerText;
    @track disableCommissionInputs = false;

    @wire(CurrentPageReference) pageRef;
    value = '';

    connectedCallback(){
        this.invoiceDateValue = this._convertDate(new Date());
    }

    @api
    refreshData(){
      this.isSaved = false;
      refreshApex(this.wiredStemLineItemBrokers);
    }
  
    @wire(getCommissionInvoiceTemplates, { stemId: "$recordId" })
    wiredCommissionInvoiceTemplate(value) {
      try {
        const {data,error} = value;
        this.wiredStemLineItemBrokers = value;
        if (data) {
          this.stemLineItemBrokers = [];
          this.error = undefined;
          let brokersPicklist = [];
          data.forEach(stemLineItem => {
            if (stemLineItem.Supplier_Broker__c && !stemLineItem.Supplier_Broker__r.Hidden_Commission__c) {
              brokersPicklist.push({ label: stemLineItem.Supplier_Broker__r.Name, value: stemLineItem.Supplier_Broker__c });
              this.stemLineItemBrokers.push({
                brokerId: stemLineItem.Supplier_Broker__c,
                commission: stemLineItem.Suppliers_Brokers_Commission_Lumpsum__c,
                refcodeIndex: stemLineItem.Supplier_Broker_Refcode_Index__c,
                bankDetails: stemLineItem.Supplier_Broker__r.Bank_Details__c,
                productName: stemLineItem.Product__r.Name,
                exported: stemLineItem.Is_Supplier_Purchase_Comm_Exported__c,
                isCsvInfoChanged: stemLineItem.Is_Supplier_Purchase_Comm_Info_Changed__c,
                exportingDisabled: false
              })
            }
            if (stemLineItem.STEM__r.Buyer_Broker__c && !stemLineItem.STEM__r.Buyer_Broker__r.Hidden_Commission__c) {
              brokersPicklist.push({ label: stemLineItem.STEM__r.Buyer_Broker__r.Name, value: stemLineItem.STEM__r.Buyer_Broker__c })
              this.stemLineItemBrokers.push({
                brokerId: stemLineItem.STEM__r.Buyer_Broker__c,
                commission: stemLineItem.Buyers_Brokers_Commission_Lumpsum__c,
                refcodeIndex: stemLineItem.Buyer_Broker_Refcode_Index__c,
                bankDetails: stemLineItem.STEM__r.Buyer_Broker__r.Bank_Details__c,
                productName: stemLineItem.Product__r.Name,
                exported: stemLineItem.Is_Buyer_Purchase_Comm_Exported__c,
                isCsvInfoChanged: stemLineItem.Is_Buyer_Purchase_Comm_Info_Changed__c,
                exportingDisabled: false
              })
            }
            if(stemLineItem.STEM_Line_Item_Buyer_Brokers__r){
              stemLineItem.STEM_Line_Item_Buyer_Brokers__r.forEach(broker => {
                if(!broker.STEM_Buyer_Broker__r.Buyer_Broker__r.Hidden_Commission__c){
                  brokersPicklist.push({ label: broker.STEM_Buyer_Broker__r.Buyer_Broker__r.Name, value: broker.STEM_Buyer_Broker__r.Buyer_Broker__c })
                  this.stemLineItemBrokers.push({
                    brokerId: broker.STEM_Buyer_Broker__r.Buyer_Broker__c,
                    commission: broker.Commission_Lumpsum__c,
                    refcodeIndex: broker.STEM_Buyer_Broker__r.Refcode_Index__c,
                    bankDetails: broker.STEM_Buyer_Broker__r.Buyer_Broker__r.Bank_Details__c,
                    productName: stemLineItem.Product__r.Name,
                    exported: broker.STEM_Buyer_Broker__r.Exported__c,
                    isCsvInfoChanged: broker.STEM_Buyer_Broker__r.Is_CSV_Info_Changed__c,
                    exportingDisabled: true
                  })
                }  
              })
            }
          })
          let filteredBrokersPicklist = brokersPicklist.filter((element , index, self)  =>
                                                             self.map(x => x.value)
                                                                 .indexOf(element.value) === index);
          this.options = filteredBrokersPicklist;
          this.disableCommissionInputs = Boolean(this.options.length === 0);  
          this.brokerId = null;
          this.isSaved = true;
        } else if (error) {
          this.error = error;
          this.stemLineItemBrokers = undefined;
          this.isSaved = true;
        }  
      } catch (error) {
        console.error(error)
      }
      
    }

    async handleSubmit(event) {
      try {
        this.isSaved = false;
        event.preventDefault();
        let fields = event.detail.fields;
        if (this.brokerId){
          fields.Invoice_Amount__c = this.invoiceAmountValue;
          fields.Calculated_Amount__c = this.calculatedAmountValue;
          fields.Bank_Details__c = this.bankDetailsValue ? this.bankDetailsValue : '';
          fields.Broker__c = this.brokerId;
          fields.Invoice_Date__c = this.invoiceDateValue;
          if(this.stemLineItemBrokers.some(stemLineItem => (stemLineItem.brokerId === this.brokerId && stemLineItem.exportingDisabled))){
            fields.Exporting_Disabled__c = true;
          } else{
            fields.Exported__c = this.stemLineItemBrokers.some(stemLineItem =>
              (stemLineItem.brokerId === this.brokerId && stemLineItem.exported)
            );
            fields.Is_CSV_Info_Changed__c = fields.Exported__c 
              && (this.invoiceAmountValue !== this.calculatedAmountValue || this.stemLineItemBrokers.some(stemLineItem =>
              (stemLineItem.brokerId === this.brokerId && stemLineItem.isCsvInfoChanged)
            ));
            fields.Refcode_Index__c = this.stemLineItemBrokers.find(stemLineItem => stemLineItem.brokerId === this.brokerId).refcodeIndex;
            if (Boolean(fields.Refcode_Index__c) === false) {
              fields.Refcode_Index__c = await getBrokerRefcodeIndex({ stemId: this.recordId, brokerId: this.brokerId });
            }
          }
          
          this.template.querySelector('.commision-invoice-form').submit(fields);
        }
      } catch (error) {
        console.error(error)
      }
    }
  
    validateInputsAndGetValidationResult() {
      let fields = [...this.template.querySelectorAll('.commission-invoice-field'),];
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
  
    handleChangeInvoiceDate(event){
      this.invoiceDateValue = event.detail.value;
    }
  
    handleChange(event){
      try {
        this.brokerId = event.target.value;
        let stemLineItems = this.stemLineItemBrokers.filter(
          element => element.brokerId === event.target.value
        );
        let bankD = stemLineItems[0].bankDetails;
        let bankDetails = bankD ? bankD.split("\r\n") : [];
        let bankDetailsPicklist = []
        bankDetailsPicklist.push({label : "Not Provided", value : "Not Provided"})
        bankDetails.forEach(element => {
          bankDetailsPicklist.push({label : element, value :element})
        })
        this.bankDetailOptions = bankDetailsPicklist;
        let stemLineItemSum = 0;
        this.totalSumForBrokerText = null;
        stemLineItems.forEach(stemLineItem => {
          if(stemLineItem.brokerId === event.target.value && stemLineItem.commission){
            stemLineItemSum += stemLineItem.commission;
            if(this.totalSumForBrokerText){
              this.totalSumForBrokerText += " + " + this._numberWithCommas(stemLineItem.commission) + '$ (' + stemLineItem.productName + ')';
            } else{
              this.totalSumForBrokerText = this._numberWithCommas(stemLineItem.commission) + '$ (' + stemLineItem.productName + ')';
            }
          } 
        })
        this.calculatedAmountValue = stemLineItemSum;
        this.invoiceAmountValue = stemLineItemSum;  
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
  
    handleSuccess(event) {
      try {
      this.brokerId = null;
      this.bankDetailsValue = null;
      this.deliveryDateValue = null;
      this.invoiceAmountValue = null;
      this.totalSumForBrokerText = '';
      let fileUploadBinder = this.template.querySelector('c-fcb-file-upload-binder');
      fileUploadBinder.relatedTo = event.detail.id;
      fileUploadBinder.bindWithParent().then(() => {
        this.handleReset();
        this.isSaved = true;
        const evt = new ShowToastEvent({
          title: "Commisssion Invoice Saved",
          variant: "success"
        });
        this.dispatchEvent(evt);
        fireEvent(this.pageRef, 'refreshSupplierInvoicesList', true);
      });   
      } catch (error) {
        console.error(error)
      }     
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
