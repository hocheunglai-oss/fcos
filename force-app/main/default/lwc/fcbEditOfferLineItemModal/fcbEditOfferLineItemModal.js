import { LightningElement, api, wire , track } from 'lwc';
import { CurrentPageReference } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import OFFER_LINE_ITEM_OBJECT from '@salesforce/schema/QuoteLineItem';
import { generateRecordInputForCreate, getRecordCreateDefaults } from 'lightning/uiRecordApi';
import { fireEvent } from 'c/pubsub';
import updateExistingPaymentTerms from "@salesforce/apex/QuoteLineItemTableController.updateExistingPaymentTerms"
import getPaymentTermOptions from '@salesforce/apex/SupplierBidManagerController.getPaymentTermOptions';
import updateOfferLineItemBuyerPartialAmount from '@salesforce/apex/SupplierBidManagerController.updateOfferLineItemBuyerPartialAmount';
import LightningConfirm from 'lightning/confirm';
import getBDNCompany from '@salesforce/apex/SupplierBidManagerController.getBDNCompany';
import { updateRecord, createRecord } from 'lightning/uiRecordApi';
import getQuoteBuyerBrokers from '@salesforce/apex/QuoteLineItemTableController.getQuoteBuyerBrokers';
import getQuoteLineItemBuyerBrokers from '@salesforce/apex/QuoteLineItemTableController.getQuoteLineItemBuyerBrokers';


export default class FcbEditOfferLineItemModal extends LightningElement {
  @api recordId;
  @api enquiryLineItems;
  @api quote;
  
  @wire(CurrentPageReference) pageRef;

  @wire(getRecordCreateDefaults, { objectApiName: OFFER_LINE_ITEM_OBJECT })
  offerLineItemObjectDefaults;

  actionExecuting = true;
  modalTitle;
  @track _currentOfferLineItem;
  _unitPrice = 0.000;
  _supplierUnitPrice = 0.000;
  _today = this._convertDate(new Date());
  paymentTermOptions;
  wiredPaymentTermOptions;
  buyerPaymentTermRecordType = 'Buyer';
  @track disabledSupplierBrokerComm;
  @track disabledBuyerBrokerComm;
  @track buyerBrokerCommissionLabel;
  @track isDisabledPartialCIA = false;

  @track quoteBuyerBrokers;

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
        if (this.currentOfferLineItem[field.fieldName.slice(0, -1) + 'r']?.Inactive_Suspended__c === true){       
          field.className = field.className.includes('slds-theme_warning') ? field.className : 'slds-form-element_stacked slds-form-element slds-theme_warning';
        } else if(this.quote[field.fieldName.slice(0, -1) + 'r']?.Inactive_Suspended__c === true){
          field.className = field.className.includes('slds-theme_warning') ? field.className : 'slds-form-element_stacked slds-form-element slds-theme_warning';
        }  
      });
    }
  }

  connectedCallback() {
    if(this.currentOfferLineItem.Validity_Time__c){
      this.currentOfferLineItem.Validity_Time__c = this._currentOfferLineItem.Validity_Time__c + ':00.000Z';
    } else this.currentOfferLineItem.Validity_Time__c = undefined;
    if(this.currentOfferLineItem.Supplier__c){
      this.setBDNCompany();
    }
    this.disabledSupplierBrokerComm = !Boolean(this.currentOfferLineItem.Suppliers_Broker__c); 
    this.disabledBuyerBrokerComm = !Boolean(this.quote.Broker__c);
    this.isDisabledPartialCIA = !(Boolean(this.currentOfferLineItem.Partial_Buyer_CIA__c));
    this.buyerBrokerCommissionLabel = this.disabledBuyerBrokerComm ? 'COMM: ' : 'COMM ' + this.quote.Broker__r.Name
    this.actionExecuting = false;

    getQuoteBuyerBrokers({ quoteId: this.quote.Id }).then((brokers) => {
      getQuoteLineItemBuyerBrokers({quoteLineItemId: this.currentOfferLineItem.Id}).then(commissions => {
        let quoteBuyerBrokerList = [];
        brokers.forEach(item => {
          const quoteLineItemBuyerBroker = commissions.find(comm => comm.Quote_Buyer_Broker__c === item.Id);
          quoteBuyerBrokerList.push({
            ...item,
            quoteLineItemBuyerBrokerId: quoteLineItemBuyerBroker?.Id,
            label: 'COMM: ' + item.Buyer_Broker__r.Name + " (Secondary)",
            commission: quoteLineItemBuyerBroker?.Commission__c
          })
        })
        this.quoteBuyerBrokers = quoteBuyerBrokerList;
      })
      
    }) 
  }

  setBDNCompany(){
    getBDNCompany({supplierId: this.currentOfferLineItem.Supplier__c}).then((result) => {
      this.currentOfferLineItem.BDN_Company__c = this.currentOfferLineItem.BDN_Company__c ? this.currentOfferLineItem.BDN_Company__c : result;
    })
  }

  get currentOfferLineItem() {
    if (!this._currentOfferLineItem) {
      if (!this.offerLineItemObjectDefaults.data) {
        return undefined;
      }
      const offerLineItemObjectInfo = this.offerLineItemObjectDefaults
                                          .data
                                          .objectInfos[OFFER_LINE_ITEM_OBJECT.objectApiName];
      const recordDefaults = this.offerLineItemObjectDefaults.data.record;
      this._currentOfferLineItem = { ...generateRecordInputForCreate(recordDefaults, offerLineItemObjectInfo).fields };
      return this._currentOfferLineItem;
    } else {
      return this._currentOfferLineItem;
    }
  }

  @api
  set currentOfferLineItem(value) {
    this._currentOfferLineItem = { ...value };
    this._unitPrice = Number(this._currentOfferLineItem.UnitPrice);
    this.modalTitle = !this.modalTitle ? this._generateModalHeader(this._currentOfferLineItem) : this.modalTitle;
    this._supplierUnitPrice = Number(this._currentOfferLineItem.Supplier_Unit_Price__c);
  }

  _generateModalHeader(offerLineItem) {
    return offerLineItem.ProductName + ' - ' + offerLineItem.Port__r.Name + ' - ' + offerLineItem.Expected_Delivery_Date__c;
  }

  get unitPrice() {
    let retVal;
    if (this._unitPrice === undefined) {
      retVal = (this._supplierUnitPrice !== undefined ? Number(this._supplierUnitPrice) : 0.0);
    } else {
      retVal = Number(this._unitPrice);
    }
    return retVal.toFixed(3);
  }

  set unitPrice(value) {
    this._unitPrice = value;
    this._currentOfferLineItem.UnitPrice = this._unitPrice;
    this._reassignObject();
  }

  get supplierUnitPrice() {
    return Number(this._supplierUnitPrice).toFixed(3);
  }

  set supplierUnitPrice(value) {
    this._supplierUnitPrice = Number(value);
    this._currentOfferLineItem.Supplier_Unit_Price__c = this._supplierUnitPrice;
    this._reassignObject();
  }

  _reassignObject() {
    this._currentOfferLineItem['transportationChanged'] = false;
    this._currentOfferLineItem = { ...this._currentOfferLineItem };
  }

  _convertDate(date) {
    let day = date.getDate();
    day = day < 10 ? '0' + day : day;
    let month = date.getMonth() + 1;
    month = month < 10 ? '0' + month : month;
    let year = date.getFullYear();
    return year + '-' + month + '-' + day;
  }

  get options() {
    let result = [];
    this.enquiryLineItems.forEach(enquiryLineItem => {
      if (enquiryLineItem.ETA_ETB__c === 'ETA') {
        result.push({
          label: enquiryLineItem.ETA_Start_Date__c
            + '-'
            + enquiryLineItem.Port__r.Name
            + '-'
            + enquiryLineItem.Product2.Name,
          value: enquiryLineItem.Id
        });
      } else if (enquiryLineItem.ETA_ETB__c === 'ETB') {
        result.push({
          label: enquiryLineItem.ETB_Start_Date__c
            + '-'
            + enquiryLineItem.Port__r.Name
            + '-'
            + enquiryLineItem.Product2.Name,
          value: enquiryLineItem.Id
        });
      } else {
        result.push({
          label: this._today
            + '-'
            + enquiryLineItem.Port__r.Name
            + '-'
            + enquiryLineItem.Product2.Name,
          value: enquiryLineItem.Id
        });
      }
    });
    return result;
  }

  get hasEnquiryLineItems() {
    return this.enquiryLineItems && this.enquiryLineItems.length > 0;
  }

  handlePaymentTermChange(event){
    this.currentOfferLineItem.Buyer_Payment_Term__c = event.detail.value;
  }

  handleChangeExpirationDate(event){
    this.currentOfferLineItem.Validity_Date__c = event.detail.value;
  }

  handleChangeExpectedDeliverynDate(event){
    this.currentOfferLineItem.Expected_Delivery_Date__c = event.detail.value;
  }

  handleStopChange(event) {
    this.actionExecuting = true;
    let lineItemId = event.detail.value;
    let enquiryLineItem = this.enquiryLineItems.find(lineItem => lineItem.Id === lineItemId);
    let autoPopulatedOfferLineItem = {};
    autoPopulatedOfferLineItem.Agent__c = enquiryLineItem.Agent__c;
    autoPopulatedOfferLineItem.Port__c = enquiryLineItem.Port__c;
    autoPopulatedOfferLineItem.ETA_ETB__c = enquiryLineItem.ETA_ETB__c;
    autoPopulatedOfferLineItem.Expected_Delivery_Date__c = enquiryLineItem.Expected_Delivery_Date__c;
    autoPopulatedOfferLineItem.Product2Id = enquiryLineItem.Product2Id;
    autoPopulatedOfferLineItem.ProductName = enquiryLineItem.Product2.Name;
    autoPopulatedOfferLineItem.Quantity = enquiryLineItem.Quantity;
    autoPopulatedOfferLineItem.Unit_of_Measure__c = enquiryLineItem.Unit_of_Measure__c;
    autoPopulatedOfferLineItem.IsQuantityRange__c = enquiryLineItem.IsQuantityRange__c;
    autoPopulatedOfferLineItem.Quantity_Range_Maximum__c = !autoPopulatedOfferLineItem.IsQuantityRange__c
                                                           ? null : enquiryLineItem.Quantity_Range_Maximum__c;
    autoPopulatedOfferLineItem = this._assignDateTimeFields(enquiryLineItem, autoPopulatedOfferLineItem);
    this.currentOfferLineItem = {
      ...autoPopulatedOfferLineItem,
      Id: this._currentOfferLineItem.Id,
      UnitPrice: this._currentOfferLineItem.UnitPrice,
      Supplier_Unit_Price__c: this._currentOfferLineItem.Supplier_Unit_Price__c
    };
    this.actionExecuting = false;
  }

  _assignDateTimeFields(source, target) {
    target.ETA_Start_Date__c = source.ETA_Start_Date__c;
    target.ETA_Start_Time__c = source.ETA_Start_Time__c ? this._msToTime(source.ETA_Start_Time__c) : null;
    target.ETA_End_Date__c = source.ETA_End_Date__c;
    target.ETA_End_Time__c = source.ETA_End_Time__c ? this._msToTime(source.ETA_End_Time__c) : null;
    target.ETB_Start_Date__c = source.ETB_Start_Date__c;
    target.ETB_Start_Time__c = source.ETB_Start_Time__c ? this._msToTime(source.ETB_Start_Time__c) : null;
    target.ETB_End_Date__c = source.ETB_End_Date__c;
    target.ETB_End_Time__c = source.ETB_End_Time__c ? this._msToTime(source.ETB_End_Time__c) : null;
    target.ETD_Start_Date__c = source.ETD_Start_Date__c;
    target.ETD_Start_Time__c = source.ETD_Start_Time__c ? this._msToTime(source.ETD_Start_Time__c) : null;
    target.ETD_End_Date__c = source.ETD_End_Date__c;
    target.ETD_End_Time__c = source.ETD_End_Time__c ? this._msToTime(source.ETD_End_Time__c) : null;
    target.ETCD_Start_Date__c = source.ETCD_Start_Date__c;
    target.ETCD_Start_Time__c = source.ETCD_Start_Time__c ? this._msToTime(source.ETCD_Start_Time__c) : null;
    target.ETCD_End_Date__c = source.ETCD_End_Date__c;
    target.ETCD_End_Time__c = source.ETCD_End_Time__c ? this._msToTime(source.ETCD_End_Time__c) : null;
    if (source.ETA_ETB__c === 'ETA') {
      target.Expected_Delivery_Date__c = source.ETA_Start_Date__c;
    } else if (source.ETA_ETB__c === 'ETB') {
      target.Expected_Delivery_Date__c = source.ETB_Start_Date__c;
    } else {
      console.log(source);
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

  handleQuoteLineItemChange(event) {
    let attribute = event.target.fieldName;
    if (attribute !== 'enquiryLineItems') {
      let offerLineItem = { ...this._currentOfferLineItem };
      offerLineItem[attribute] = event.target.value;
      this._currentOfferLineItem = offerLineItem; 
      if (event.target.name === 'Validity_Time__c') {
        this._currentOfferLineItem.Validity_Time__c = event.target.value;
      }
      if(event.target.fieldName !== 'Transportation_Type_Sell__c' && event.target.fieldName !== 'Transportation_Type_Buy__c'){
        this._reassignObject();
      }
      if(attribute == 'Supplier__c' && event.target.value){
        this.setBDNCompany();
      }
      if(attribute === 'Suppliers_Broker__c'){
        this.disabledSupplierBrokerComm = !Boolean(event.target.value); 
      }
      if(attribute === 'Partial_Buyer_CIA__c'){
        this.isDisabledPartialCIA = !event.target.value
      }
    }
  }

  handleTransportationSellChange(event){
    this._currentOfferLineItem[event.target.fieldName] = event.target.value;
    this._currentOfferLineItem['transportationChanged'] = 'Sell';
    this._currentOfferLineItem = {...this._currentOfferLineItem};
  }

  handleTransportationBuyChange(event){
    this._currentOfferLineItem[event.target.fieldName] = event.target.value;
    this._currentOfferLineItem['transportationChanged'] = 'Buy';
    this._currentOfferLineItem = {...this._currentOfferLineItem};
  }

  /**
   * 
   * @returns 
   */
  validateInputsAndGetValidationResult() {
    let fields = this.template.querySelectorAll('lightning-input-field');
    let isValid = true;
    fields.forEach(field => {
      // FCBSF-402 skipping checkboxes for Required fields
      if (field.fieldName !== 'IsQuantityRange__c' && field.fieldName !== 'Add_Supplier_Bid_To_Quote__c' && field.fieldName !== 'Partial_CIA__c' && field.fieldName !== 'Partial_Buyer_CIA__c') {
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
    let offerLineItemExtraCostsComponent = this.template.querySelector('c-fcb-offer-line-item-extra-costs');
    offerLineItemExtraCostsComponent.isExtraCostTableValid();
    isValid = isValid && offerLineItemExtraCostsComponent.isExtraCostTableValid();
    return isValid;
  }

  closeModal() {
    let closeEvent = new CustomEvent('close', {
      detail: {
        modal: 'editofferlineitem'
      }
    });
    this.actionExecuting = false;
    this.dispatchEvent(closeEvent);
  }

  handleQuantityRangeChange(event) {
    this._resetQuantityRangeMaximum(event.target.value);
    this._reassignObject();
  }

  _resetQuantityRangeMaximum(isQuantityRange) {
    if (!isQuantityRange) {
      this._currentOfferLineItem.Quantity_Range_Maximum__c = null;
    }
  }

  handleChangeBuyerBrokerCommission(event){
    this.quoteBuyerBrokers.find(quoteBuyerBroker => quoteBuyerBroker.Id === event.target.dataset.id).commission = event.detail.value;
  }

  /**
   * 
   */
  handleAddAction() {
    this.actionExecuting = true;
    let isValid = this.validateInputsAndGetValidationResult();
    if (isValid) {
      const btn = this.template.querySelector('.hidden-btn');
      if (btn) {
        console.log(btn)
        btn.click();
      } else {
        this.actionExecuting = false;
      }
    } else {
      this.actionExecuting = false;
    }
  }

  handleSaveOffersComplete(event) {
    this.handleQuoteLineItemAdded(event);
  }

  calculateFormulas(event) {
    if (event.detail.fieldName === 'Supplier_Unit_Price__c') {
      this.supplierUnitPrice = event.detail.value;
    } else if (event.detail.fieldName === 'UnitPrice') {
      this.unitPrice = event.detail.value;
    } else if (event.detail.fieldName === 'Buyer_Broker_Commission__c') {
      this._currentOfferLineItem.Buyer_Broker_Commission__c = event.detail.value;
      this._reassignObject();
    } else if (event.detail.fieldName === 'Supplier_Broker_Commission__c') {
      this._currentOfferLineItem.Supplier_Broker_Commission__c = event.detail.value;
      this._reassignObject();
    }
  }

  async handleSubmitForm(event) {
    try {
    event.preventDefault();
    let isValid = this.validateQuoteBuyerAndBroker();
    if(isValid){
      let fields = event.detail.fields;
      let result = true;
      if(!fields.Supplier__c){
        result = await LightningConfirm.open({
          message: "Are you sure you do not wish to associate this item with any supplier?",
          label: "Please Confirm",
          theme: "warning",
        });
      }
      if(result){
        fields.Supplier_Unit_Price__c = this.supplierUnitPrice;
        fields.UnitPrice = this.unitPrice;
        fields.Validity_Time__c = this._currentOfferLineItem.Validity_Time__c
        fields.Buyer_Payment_Term__c = 
        fields = { ...fields, ...this._currentOfferLineItem };
        this.template.querySelector('lightning-record-edit-form').submit(fields); 
      } else{
        this.actionExecuting = false;
      }
    } else{
      this.dispatchEvent(
        new ShowToastEvent({
          title: 'Error',
          message: 'Buyer or Broker is not Active',
          variant: 'error'
        })
      );
      this.actionExecuting = false;
    }
    
    } catch (error) {
      console.error(error)
    }
  }

  validateQuoteBuyerAndBroker(){
    if (
      !this.quote.Quote_Buyer__r.Inactive_Suspended__c &&
      (this.quote.Broker__r === undefined || this.quote.Broker__r?.Inactive_Suspended__c === false)
    ) {
      return true;
    } else {
      return false;
    }
  }

  handleErrorForm() {
    this.actionExecuting = false;
  }

  async handleQuoteLineItemAdded(event) {
    try {
      let offerLineItemExtraCostsComponent = this.template.querySelector('c-fcb-offer-line-item-extra-costs');
      this.createQuoteLineItemBuyerBrokers(event.detail.id);
      await offerLineItemExtraCostsComponent.removeExtraCosts();
      offerLineItemExtraCostsComponent.upsertExtraCosts(event.detail.id, this.recordId, event).then(() => {
        if (this.quote.Status !== 'Closed Won') {
          console.log(this.currentOfferLineItem);
          
          updateOfferLineItemBuyerPartialAmount({quoteId: this.quote.Id, partialCia: this.currentOfferLineItem.Partial_Buyer_CIA__c, 
            partialAmount: Number(this.currentOfferLineItem.Partial_Lumpsum_Sell_At__c)})
          updateExistingPaymentTerms({
            quoteId: this.quote.Id, supplierId: this._currentOfferLineItem.Supplier__c,
            supplierPaymentTerm: this._currentOfferLineItem.Supplier_Payment_Term__c, buyerPaymentTerm: this._currentOfferLineItem.Buyer_Payment_Term__c
          });
        }
        this.dispatchEvent(
          new ShowToastEvent({
            title: 'Success',
            message: 'Offer Line Item is edited',
            variant: 'success'
          })
        );
        this.closeModal();
        fireEvent(this.pageRef, 'refreshQuoteLineItemsRelateList', true);
      });  
    } catch (error) {
      console.error(error)
    }
    
  }

  createQuoteLineItemBuyerBrokers(quoteLineItemId){
    this.quoteBuyerBrokers.forEach(quoteBuyerBroker => {
      const fields = {};
      fields["Id"] = quoteBuyerBroker.quoteLineItemBuyerBrokerId;
      fields["Offer_Line_Item__c"] = quoteLineItemId;
      fields["Commission__c"] = quoteBuyerBroker.commission;
      if(quoteBuyerBroker.quoteLineItemBuyerBrokerId){
        const recordInput = { fields };
        updateRecord(recordInput);
      } else{
        fields["Quote_Buyer_Broker__c"] = quoteBuyerBroker.Id;
        const recordInput = { apiName: 'Quote_Line_Item_Buyer_Broker__c', fields: fields };
        createRecord(recordInput);
      }
      
    })
  }
}