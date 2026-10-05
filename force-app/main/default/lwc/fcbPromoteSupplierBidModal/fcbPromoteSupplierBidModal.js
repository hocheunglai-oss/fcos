import { LightningElement, api, wire, track } from "lwc";
import { CurrentPageReference } from "lightning/navigation";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import { fireEvent } from "c/pubsub";
import updateExistingPaymentTerms from "@salesforce/apex/QuoteLineItemTableController.updateExistingPaymentTerms"
import getPaymentTermOptions from '@salesforce/apex/SupplierBidManagerController.getPaymentTermOptions';
import getBuyerPaymentTerm from '@salesforce/apex/QuoteLineItemTableController.getBuyerPaymentTerm';
import getBDNCompany from '@salesforce/apex/SupplierBidManagerController.getBDNCompany';
import {getFieldValue } from "lightning/uiRecordApi";
import { updateRecord, createRecord } from 'lightning/uiRecordApi';
import getQuoteBuyerBrokers from '@salesforce/apex/QuoteLineItemTableController.getQuoteBuyerBrokers';
import updateOfferLineItemBuyerPartialAmount from '@salesforce/apex/SupplierBidManagerController.updateOfferLineItemBuyerPartialAmount';
import getPartialBuyerInfo from '@salesforce/apex/SupplierBidManagerController.getPartialBuyerInfo';


export default class FcbPromoteSupplierBidModal extends LightningElement {
  @track _supplierBid;
  _unitPrice = 0.000;
  _supplierUnitPrice = 0.000;
  actionExecuting = true;
  // [6.6.21] FCBSF-317 Add Quote to change supplier bid function [jB] 
  @api quote
  // [4.27.21] added to copy schedule from selected Supplier' Bids PORT-STOP TO Offer [jB]
  @api enquiryLineItem;
  today = this._convertDate(new Date());
  paymentTermOptions;
  wiredPaymentTermOptions;
  buyerPaymentTermRecordType = 'Buyer';
  buyerPaymentTermValue;
  @track disabledBuyerBrokerCommssion;
  @track isDisabledPartialCIA = true;

  @track buyerBrokerCommissionLabel;

  @track quoteBuyerBrokers;

  @track partialBuyerCia;
  @track partialLumpsumSellAt;


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
          value: paymentTerm.Id,
        });
      });
      this.paymentTermOptions = paymentTermPicklist;
    } else if (error) {
      this.error = error;
      console.error(error)
    }
  }

  renderedCallback(){
    const inputFields = this.template.querySelectorAll(
      "lightning-input-field"
    );
    if (inputFields) {
      inputFields.forEach((field) => {
        if (this.supplierBid[field.fieldName.slice(0, -1) + 'r']?.Inactive_Suspended__c === true){       
          field.className = field.className.includes('slds-theme_warning') ? field.className : 'slds-form-element_stacked slds-form-element slds-theme_warning';
        }else if(this.quote.fields[field.fieldName.slice(0, -1) + 'r']?.value?.fields.Inactive_Suspended__c.value === true){
          field.className = field.className.includes('slds-theme_warning') ? field.className : 'slds-form-element_stacked slds-form-element slds-theme_warning';
        }
      });
    }
  }

  connectedCallback() {
    getBuyerPaymentTerm({quoteId: this.quote.id}).then((result) => {
      this.buyerPaymentTermValue = result;
    })
    if (this._supplierBid.Expiration_Time__c) {
      this._supplierBid.Expiration_Time__c =  this._msToTime(this._supplierBid.Expiration_Time__c);
    }
    if(this.supplierBid.Supplier__c){
      this.setBDNCompany();
    }
    this.disabledBuyerBrokerCommssion = !Boolean(this.quote.fields.Broker__c.value);
    this.buyerBrokerCommissionLabel = this.disabledBuyerBrokerCommssion ? 'COMM: ' : 'COMM ' + this.quote.fields.Broker__r.displayValue
    this.actionExecuting = false;
    getQuoteBuyerBrokers({ quoteId: this.quote.id }).then((result) => {
      let quoteBuyerBrokerList = [];
      result.forEach(item => {
        quoteBuyerBrokerList.push({
          ...item,
          label: "Comm: " + item.Buyer_Broker__r.Name + " (Secondary)",
          commission: null
        })
      })
      getPartialBuyerInfo({quoteId: this.quote.id}).then((result) => {
        if(result){
          this.partialBuyerCia = result[0].Partial_Buyer_CIA__c;
          this.isDisabledPartialCIA = !Boolean(result[0].Partial_Buyer_CIA__c);
          this.partialLumpsumSellAt = result[0].Partial_Lumpsum_Sell_At__c;
        }
      })
      this.quoteBuyerBrokers = quoteBuyerBrokerList;
    })  
  }

  setBDNCompany(){
    getBDNCompany({supplierId: this.supplierBid.Supplier__c}).then((result) => {
      this.supplierBid.BDN_Company__c = this.supplierBid.BDN_Company__c ? this.supplierBid.BDN_Company__c : result;
    })
  }

  get supplierBid() {
    return this._supplierBid;
  }

  get buyer(){
    return getFieldValue(this.quote, "Quote.Quote_Buyer__c")
  }

  get buyersBroker(){
    return getFieldValue(this.quote, "Quote.Broker__c")
  }

  get buyersBrokerHiddenComission(){
    return getFieldValue(this.quote, "Quote.Broker__r.Hidden_Commission__c") ? getFieldValue(this.quote, "Quote.Broker__r.Hidden_Commission__c") : false;
  }

  @api
  set supplierBid(value) {
    this._supplierBid = {...value};
    this._supplierBid.Product2Id = this.supplierBidProduct.Id;
    this._supplierBid.ProductName = this.supplierBidProduct.Name;
    this._supplierBid.Transportation_Type_Sell__c = this._supplierBid.Transportation_Type_Buy__c
  }

  get supplierBidProduct() {
    return this._supplierBid.Alternative_Product__r ? this._supplierBid.Alternative_Product__r : this._supplierBid.Product__r;
  }

  get unitPrice() {
    let retVal;
    if (this._unitPrice === undefined) {
      retVal = (this._supplierBid.Supplier_Unit_Price__c !== undefined ? Number(this._supplierBid.Supplier_Unit_Price__c) : 0.00);
    } else {
      retVal = Number(this._unitPrice);
    }
    return retVal.toFixed(3);
  }

  set unitPrice(value) {
    this._unitPrice = value;
    this._supplierBid.UnitPrice = this._unitPrice;
    this._reassignObject();
  }

  get supplierUnitPrice() {
    return Number(this._supplierUnitPrice).toFixed(3);
  }

  set supplierUnitPrice(value) {
    this._supplierUnitPrice = value;
    this._supplierBid.Supplier_Unit_Price__c = this._supplierUnitPrice;
    this._reassignObject();
  }

  _reassignObject() {
    this._supplierBid['transportationChanged'] = false;
    this._supplierBid = {...this._supplierBid};
  }

  handleQuoteLineItemChange(event) {
    this._supplierBid[event.target.fieldName] = event.target.value;
    if(event.target.fieldName !== 'Transportation_Type_Sell__c' && event.target.fieldName !== 'Transportation_Type_Buy__c'){
      this._reassignObject();
    }
    if(event.target.fieldName == 'Supplier__c' && event.target.value){
      this.setBDNCompany();
    }
    if(event.target.fieldName == 'Partial_Buyer_CIA__c'){
      this.partialBuyerCia = event.target.value;
      this.isDisabledPartialCIA = !event.target.value;
    }
    if(event.target.fieldName == 'Partial_Lumpsum_Sell_At__c'){
      this.partialLumpsumSellAt = event.target.value;
    }
  }

  handlePaymentTermChange(event){
    this.buyerPaymentTermValue = event.detail.value;
  }

  handleTransportationChange(event){
    this._supplierBid[event.target.fieldName] = event.target.value;
    this._supplierBid['transportationChanged'] = true;
    this._supplierBid = {...this._supplierBid};
  }

  handleChangeExpirationDate(event){
    this._supplierBid.Expiration_Date__c = event.detail.value;
  }

  @wire(CurrentPageReference) pageRef;

  closeModal() {
    let closeEvent = new CustomEvent("close", {
      detail: {
        modal: "promotetoquote"
      }
    });
    this.actionExecuting = false;
    this.dispatchEvent(closeEvent);
  }

  handleQuantityRangeChange(event) {
    if (!event.target.value) {
      let updatedSupplierBid = { ...this._supplierBid };
      updatedSupplierBid["Quantity_Range_Maximum__c"] = undefined;
      this._supplierBid = { ...updatedSupplierBid };
    }
  }

  handleQuantityChange(event) {
    this._supplierBid['Quantity__c'] = event.detail.value;
    this._reassignObject();
  }

  handleChangeBuyerBrokerCommission(event){
    this.quoteBuyerBrokers.find(quoteBuyerBroker => quoteBuyerBroker.Id === event.target.dataset.id).commission = event.detail.value;
  }

  validateInputsAndGetValidationResult() {
    let fields = this.template.querySelectorAll('lightning-input-field');
    let isValid = true;
    fields.forEach(field => {
      if (field.fieldName !== 'IsQuantityRange__c' && field.fieldName !== 'Add_Supplier_Bid_To_Quote__c' && field.fieldName !== 'Partial_Buyer_CIA__c') {
        if (field.required && !field.value) {
          field.reportValidity();
          isValid = false;
        } else {
          field.reportValidity();
        }
      }
    });
    let customCurrencyFields = this.template.querySelectorAll('c-fcb-offer-broker-pricing-input');
    customCurrencyFields.forEach(currencyField => {
      let isCustomCurrencyFieldValid = currencyField.checkValidity();
      isValid = isValid && isCustomCurrencyFieldValid;
    });
    let offerLineItemExtraCostsComponent = this.template.querySelector('c-fcb-promoted-offer-line-item-extra-costs');
    offerLineItemExtraCostsComponent.isExtraCostTableValid();
    isValid = isValid && offerLineItemExtraCostsComponent.isExtraCostTableValid();
    return isValid;
  }



  handleAddAction() {
    this.actionExecuting = true;
  
    //checkExistingRecords({productId: this.supplierBid.Product2Id, portId: this.supplierBid.Port__c,  quoteId: this.quote.id}).then(result => {
      let isValid = this.validateInputsAndGetValidationResult();
      if (isValid) {
      const btn = this.template.querySelector(".hidden-btn");
      if (btn) {
        btn.click();
      } else {
        this.actionExecuting = false;
      }
    } else if(!isValid){
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Error",
          message: "Please fill all required fields",
          variant: "error"
        })
      );
      this.actionExecuting = false;
    }
    //});
    
  }

  handleSubmitForm(event) {
    try {
      event.preventDefault();
      let fields = event.detail.fields;
      fields = this._assignDateTimeFields(this.enquiryLineItem, fields);
      fields.Supplier_Unit_Price__c = this.supplierUnitPrice;
      fields.UnitPrice = this.unitPrice;
      fields = { ...fields, ...this._supplierBid };
      fields.Validity_Date__c = this._supplierBid.Expiration_Date__c;
      fields.Buyer_Payment_Term__c = this.buyerPaymentTermValue;
      this.template.querySelector("lightning-record-edit-form").submit(fields);
    } catch (error) {
      console.error(error)
    }

  }

  handleErrorForm(error) {
    this.actionExecuting = false;
  }

  handleSaveOffersComplete() {
    this.handleQuoteLineItemAdded();
  }

  calculateFormulas(event) {
    if (event.detail.fieldName === 'Supplier_Unit_Price__c') {
      this.supplierUnitPrice = event.detail.value;
    } else if (event.detail.fieldName === 'UnitPrice') {
      this.unitPrice = event.detail.value;
    } else if (event.detail.fieldName === 'Buyer_Broker_Commission__c') {
      this._supplierBid.Buyer_Broker_Commission__c = event.detail.value;
      this._reassignObject();
    } else if (event.detail.fieldName === 'Supplier_Broker_Commission__c') {
      this._supplierBid.Supplier_Broker_Commission__c = event.detail.value;
      this._reassignObject();
    }
  }

  handleQuoteLineItemAdded(event) {
    let offerLineItemExtraCostsComponent = this.template.querySelector('c-fcb-promoted-offer-line-item-extra-costs');
    offerLineItemExtraCostsComponent.upsertExtraCosts(event.detail.id, this.quote.id, this.buyerPaymentTermValue, this._supplierBid.Supplier_Payment_Term__c).then((result) => { 
      this.createQuoteLineItemBuyerBrokers(event.detail.id);
      updateExistingPaymentTerms({quoteId: this.quote.id, supplierId: this._supplierBid.Supplier__c,
                                  supplierPaymentTerm: this._supplierBid.Supplier_Payment_Term__c,
                                  buyerPaymentTerm: this.buyerPaymentTermValue});
      updateOfferLineItemBuyerPartialAmount({quoteId: this.quote.id, partialCia: this.partialBuyerCia, 
            partialAmount: this.partialLumpsumSellAt})
      const fields = {};
      fields["Id"] = this.quote.id;
      fields["Status"] = "Offer Sent & Negotiation";
      const recordToUpdate = { fields };
      updateRecord(recordToUpdate);
      this.dispatchEvent(
          new ShowToastEvent({
            title: "Success",
            message: "Supplier Bid has been added to Offer",
            variant: "success"
          })
      );
      this.closeModal();
      fireEvent(this.pageRef, "refreshQuoteLineItemsRelateList", true)
    }).catch((error) => {
      console.error(error);
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Error",
          message: error.body.message,
          variant: "error"
        })
      );
    });
  }

  createQuoteLineItemBuyerBrokers(quoteLineItemId){
    this.quoteBuyerBrokers.forEach(quoteBuyerBroker => {
      const fields = {};
      fields["Quote_Buyer_Broker__c"] = quoteBuyerBroker.Id;
      fields["Offer_Line_Item__c"] = quoteLineItemId;
      fields["Commission__c"] = quoteBuyerBroker.commission;
      const recordInput = { apiName: 'Quote_Line_Item_Buyer_Broker__c', fields: fields };
      createRecord(recordInput);
    })
  }

  _assignDateTimeFields(source, target) {
    target.ETA_Start_Date__c = source.ETA_Start_Date__c;
    target.ETA_Start_Time__c = source.ETA_Start_Time__c !== undefined ? this._msToTime(source.ETA_Start_Time__c) : null;
    target.ETA_End_Date__c = source.ETA_End_Date__c;
    target.ETA_End_Time__c = source.ETA_End_Time__c !== undefined ? this._msToTime(source.ETA_End_Time__c) : null;
    target.ETB_Start_Date__c = source.ETB_Start_Date__c;
    target.ETB_Start_Time__c = source.ETB_Start_Time__c  !== undefined ? this._msToTime(source.ETB_Start_Time__c) : null;
    target.ETB_End_Date__c = source.ETB_End_Date__c;
    target.ETB_End_Time__c = source.ETB_End_Time__c  !== undefined ? this._msToTime(source.ETB_End_Time__c) : null;
    target.ETD_Start_Date__c = source.ETD_Start_Date__c;
    target.ETD_Start_Time__c = source.ETD_Start_Time__c  !== undefined ? this._msToTime(source.ETD_Start_Time__c) : null;
    target.ETD_End_Date__c = source.ETD_End_Date__c;
    target.ETD_End_Time__c = source.ETD_End_Time__c  !== undefined ? this._msToTime(source.ETD_End_Time__c) : null;
    target.ETCD_Start_Date__c = source.ETCD_Start_Date__c;
    target.ETCD_Start_Time__c = source.ETCD_Start_Time__c  !== undefined ? this._msToTime(source.ETCD_Start_Time__c) : null;
    target.ETCD_End_Date__c = source.ETCD_End_Date__c;
    target.ETCD_End_Time__c = source.ETCD_End_Time__c  !== undefined ? this._msToTime(source.ETCD_End_Time__c) : null;
    if (source.ETA_ETB__c === 'ETA') {
      target.Expected_Delivery_Date__c = source.ETA_Start_Date__c;
    } else if (source.ETA_ETB__c === 'ETB') {
      target.Expected_Delivery_Date__c = source.ETB_Start_Date__c;
    } else {
      target.Expected_Delivery_Date__c = source.Supplier_Bids__r 
        ? source.Supplier_Bids__r[0].Expected_Delivery_Date__c 
        : source.CreatedDate;
    }
    return target;
  }

  _msToTime(duration) {
    if (duration === undefined || duration === '') return null;
    if (duration === 0) return '00:00:00';
    let seconds = Math.floor((duration / 1000) % 60);
    let minutes = Math.floor((duration / (1000 * 60)) % 60);
    let hours = Math.floor((duration / (1000 * 60 * 60)) % 24);
    hours = hours < 10 ? '0' + hours : hours;
    minutes = minutes < 10 ? '0' + minutes : minutes;
    seconds = seconds < 10 ? '0' + seconds : seconds;
    return hours + ':' + minutes + ':' + seconds;
  };

  _convertDate(date) {
    let day = date.getDate();
    day = day < 10 ? '0' + day : day;
    let month = date.getMonth() + 1;
    month = month < 10 ? '0' + month : month;
    let year = date.getFullYear();
    return year + '-' + month + '-' + day;
  }

  handleTimeChange(event){
    this.supplierBid.Expiration_Time__c = event.detail.value;
  }



}