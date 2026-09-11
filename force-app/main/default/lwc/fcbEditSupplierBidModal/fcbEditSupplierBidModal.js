import {LightningElement, api, wire, track} from 'lwc';
import {ShowToastEvent} from 'lightning/platformShowToastEvent';
import {CurrentPageReference} from 'lightning/navigation';
import getOrgUrl from '@salesforce/apex/SupplierBidManagerController.getOrgUrl';
import getPaymentTermOptions from '@salesforce/apex/SupplierBidManagerController.getPaymentTermOptions';
import getBDNCompany from '@salesforce/apex/SupplierBidManagerController.getBDNCompany';
import updateSupplierBids from '@salesforce/apex/SupplierBidManagerController.updateSupplierBids';
import updateOfferLineItemSupplierPartialAmount from '@salesforce/apex/SupplierBidManagerController.updateOfferLineItemSupplierPartialAmount';
import {fireEvent} from 'c/pubsub';

export default class FcbEditSupplierBidModal extends LightningElement {
  @api enquiryLineItems;
  @api quoteId;
  @api allSupplierBids;
  @wire(CurrentPageReference) pageRef;

  @track isQuantityRangeDisabled = true;
  @track isSupplierBrokerRequired = false;
  today = this._convertDate(new Date());
  orgUrl;
  @track enquiryLineItemId;
  @track _supplierBid;
  actionExecuting = true;
  paymentTermOptions;
  wiredPaymentTermOptions;
  supplierPaymentTermRecordType = 'Supplier';
  @track stemExtraCharges;
  @track productSupplierBids;
  transportationOptions;

  get supplierBid() {
    return this._supplierBid;
  }

  @api
  set supplierBid(value) {
    this._supplierBid = {...value};
    this._supplierBid.isDisabledPartialCIA = !this._supplierBid.Partial_CIA__c;
    this._supplierBid.ProductName = this._supplierBid.Product__r.Name;
  }

  msToTime(s) {
    let ms = s % 1000;
    s = (s - ms) / 1000;
    let secs = s % 60;
    s = (s - secs) / 60;
    let mins = s % 60;
    let hrs = (s - mins) / 60;
    hrs = hrs < 10 ? '0' + hrs : hrs;
    mins = mins < 10 ? '0' + mins : mins;
    return hrs + ':' + mins + ':00.000Z';
  }

  @wire(getPaymentTermOptions, {recordTypeName: '$supplierPaymentTermRecordType'})
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
          field.className = 'slds-theme_warning'
        } 
      });
    }
  }

  connectedCallback() {
    getOrgUrl().then(result => {
      this.orgUrl = result;
    })
    this.productSupplierBids = this.allSupplierBids
      .filter(sb => this.supplierBid.supplierBidIds.includes(sb.Id))
      .map(bid => ({
        ...bid, 
        disableComm: !Boolean(bid.Suppliers_Broker__c),
        isDisabledPartialCIA: !bid.Partial_CIA__c,
        transportationExtraCost: {
          id: '',
          product2Id: '',
          isTransportationTypeIncluded: false,
          productName: '',
          quantity: {
            value: '',
            className: 'slds-input'
          },
          isQuantityRange: false,
          isQuantityRangeDisabled: false,
          quantityMaximum: {
            value: '',
            className: 'slds-input'
          },
          unitCost: {
            value: null,
            className: 'slds-input',
            disabled: false
          },
          unitOfMeasure: '',
          fixedCost: false,
          isFixedCostDisabled: true,
          disableFixed: false,
          minimumBuyAt: {
            value: '',
            className: 'slds-input',
            disabled: false
          },
          lumpsumCostBuyAt: {
            value: '',
            className: 'slds-input',
            disabled: false
          },
        },
        extraCosts: []
      }));
      
    if (this._supplierBid.Expiration_Time__c) {
      this._supplierBid.Expiration_Time__c =  this.msToTime(this._supplierBid.Expiration_Time__c);
    }
    this.actionExecuting = false;
  }

  setBDNCompany(){
    this.actionExecuting = true;
    getBDNCompany({supplierId: this.supplierBid.Supplier__c}).then((result) => {
      this.productSupplierBids.forEach(productSupplierBid => {
        productSupplierBid.BDN_Company__c = productSupplierBid.BDN_Company__c ? productSupplierBid.BDN_Company__c : result;
      })
      this.template.querySelector('c-fcb-supplier-bid-extra-costs').refreshData([this.productSupplierBids]);
      getLastUnspecifiedSupplierBidId({enquiryId: this.enquiryId, supplierId: this.supplierBid.Supplier__c}).then((result) => {
        if(Array.isArray(result) && result.length > 0){
            if (result[0].Supplier__r.Name.includes("**NEW SUPPLIER")) {
                this.productSupplierBids.forEach(productSupplierBid => {
                    productSupplierBid.Unspecified_Supplier_Id__c = result[0].Unspecified_Supplier_Id__c 
                        ? result[0].Unspecified_Supplier_Id__c + 1 
                        : 1;
                })
            }
        }
        this.actionExecuting = false;
      })
    })
  }

  closeModal() {
    let closeEvent = new CustomEvent('close', {
      detail: {
        modal: 'editSupplierBid'
      }
    });
    this.actionExecuting = false;
    this.dispatchEvent(closeEvent);
  }

  handlePaymentTermChange(event){
    this._supplierBid.Supplier_Payment_Term__c = event.detail.value;
  }

  handleChangeExpirationDate(event){
    this._supplierBid.Expiration_Date__c = event.detail.value;
  }

  handleAddAction() {
    try {
      this.actionExecuting = true;
      let isValid = this.validateInputsAndGetValidationResult();
      if (!isValid) {
        this.actionExecuting = false;
        return;
      }
      const btn = this.template.querySelector('.hidden');
      if (btn) {
        btn.click();
      } else {
        this.actionExecuting = false;
      }  
    } catch (error) {
      console.error(error)
    }

  }

  handleSubmitForm(event) {
    try {
      event.preventDefault();
      const fields = event.detail.fields;
      fields['sobjectType'] = 'Supplier_Bid__c';
      let supplierBidToSave = [];
      this.productSupplierBids.forEach(productSupplierBid => {
        let obj = {
          Id: productSupplierBid.Id,
          Product__c: productSupplierBid.Product__c,
          Supplier_Unit_Price__c: productSupplierBid.Supplier_Unit_Price__c,
          Transportation_Type_Buy__c: productSupplierBid.Transportation_Type_Buy__c,
          Quantity__c: productSupplierBid.Quantity__c,
          Quantity_Range_Maximum__c: productSupplierBid.Quantity_Range_Maximum__c,
          IsQuantityRange__c: productSupplierBid.IsQuantityRange__c,
          BDN_Company__c: productSupplierBid.BDN_Company__c,
          Supplier_Broker_Commission__c: Number(productSupplierBid.Supplier_Broker_Commission__c),
          Unit_Transportation_Cost__c: Number(this.supplierBid.Unit_Transportation_Cost__c),
          Expected_Delivery_Date__c: this._supplierBid.Expected_Delivery_Date__c,
          Expiration_Date__c: this._supplierBid.Expiration_Date__c,
          Expiration_Time__c: this._supplierBid.Expiration_Time__c,
          Supplier_Payment_Term__c: this._supplierBid.Supplier_Payment_Term__c,
          Partial_CIA__c: this._supplierBid.Partial_CIA__c,
          Partial_Lumpsum_Buy_At__c: Number(this._supplierBid.Partial_Lumpsum_Buy_At__c)
        }
        console.log(obj);
        
        for (const field in fields) {
          if (field !== 'Id' && field !== 'Supplier_Unit_Price__c' && field !== 'Transportation_Type_Buy__c') {
            obj[field] = fields[field];
          }
        }
        supplierBidToSave.push(obj);
      })
      console.log(supplierBidToSave);
      
      updateSupplierBids({supplierBids: supplierBidToSave}).then((result) => {
        let supplierBidExtraCostsComponent = this.template.querySelector('c-fcb-supplier-bid-extra-costs');
        supplierBidExtraCostsComponent.upsertExtraCosts(result).then(() => {
          this.dispatchEvent(
            new ShowToastEvent({
              title: 'Success',
              message: 'Supplier Bid added',
              variant: 'success'
            })
          );
          this.closeModal();
          updateOfferLineItemSupplierPartialAmount({quoteId: this.quoteId, supplierId: this.supplierBid.Supplier__c,
                                            partialCia: this.supplierBid.Partial_CIA__c, partialAmount: this.supplierBid.Partial_Lumpsum_Buy_At__c
          })
        }).catch((error) => {
          this.dispatchEvent(
            new ShowToastEvent({
              title: 'Error',
              message: error.body.pageErrors[0]?.message ? error.body.pageErrors[0].message : error.body.fieldErrors?.Supplier__c[0]?.message,
              variant: 'error'
            })
          );
          this.actionExecuting = false;
        })
      }).catch((error) => {
        this.dispatchEvent(
          new ShowToastEvent({
            title: 'Error',
            message: error.body.pageErrors[0]?.message ? error.body.pageErrors[0].message : error.body.fieldErrors?.Supplier__c[0]?.message,
            variant: 'error'
          })
        );
        this.actionExecuting = false;
      });  
    } catch (error) {
      this.dispatchEvent(
        new ShowToastEvent({
          title: 'Error',
          message: error.body.pageErrors[0]?.message ? error.body.pageErrors[0].message : error.body.fieldErrors?.Supplier__c[0]?.message,
          variant: 'error'
        })
      );
      this.actionExecuting = false;
    }
  }

  handleErrorForm() {
    this.actionExecuting = false;
  }

  handleSupplierBidChange(event) {
    this.actionExecuting = true;
    let attribute = event.target.fieldName;
    if (attribute !== 'enquiryLineItems') {
      if (attribute === 'IsQuantityRange__c' && !event.target.value) {
        this.supplierBid[attribute] = event.target.value;
        this.supplierBid['Quantity_Range_Maximum__c'] = null;
      } else if (event.target.name === 'Expiration_Time__c') {
        this._supplierBid['Expiration_Time__c'] = event.target.value;
      } else {
        this.supplierBid[attribute] = event.target.value;
      }
    }
    if (attribute == 'Supplier__c' && event.target.value) {
      this.setBDNCompany();
    }
    if(attribute == 'Partial_CIA__c'){
      this.supplierBid[attribute] = event.target.value;
      this.supplierBid['isDisabledPartialCIA'] = !event.target.value;
      this._supplierBid['Partial_Lumpsum_Buy_At__c'] = null;
      this.productSupplierBids.forEach(productSupplierBid => {
        productSupplierBid[attribute] = event.target.value;
        productSupplierBid['isDisabledPartialCIA'] = !event.target.value;
      })
      if(attribute == 'Partial_Lumpsum_Buy_At__c'){
        this.supplierBid[attribute] = event.target.value;
      }
      this.template.querySelector('c-fcb-supplier-bid-extra-costs').refreshData(this.productSupplierBids);
      
    }
    if (attribute === "Suppliers_Broker__c") {
      this.productSupplierBids.forEach(productSupplierBid => {
        productSupplierBid["disableComm"] = !Boolean(event.target.value);
      })
      this.template.querySelector('c-fcb-supplier-bid-extra-costs').refreshData(this.productSupplierBids);
    }
    if (attribute !== 'Transportation_Type_Buy__c') {
      this._reassignObject();
    }
    this.actionExecuting = false;
  }

  _reassignObject() {
    this.supplierBid['transportationChanged'] = false;
    this._supplierBid = {...this._supplierBid};
  }

  handleQuantityChange(event) {
    let changedSupplierBid = this.productSupplierBids.find(bid => bid.Id === event.detail.supplierBidId);
    changedSupplierBid.Quantity__c = event.detail.quantity;
    changedSupplierBid.IsQuantityRange__c = event.detail.isQuantityRange;
    changedSupplierBid.Quantity_Range_Maximum__c = event.detail.quantityMaximum;
    this.template.querySelector('c-fcb-supplier-bid-extra-costs').refreshData([changedSupplierBid]);
}

  handleTransportationChange(event){
    this.actionExecuting = true;
    let changedSupplierBid = this.productSupplierBids.find(bid => bid.Id === event.detail.supplierBidId);
    changedSupplierBid.Transportation_Type_Buy__c = event.detail.value;
    changedSupplierBid['transportationChanged'] = true;
    this.template.querySelector('c-fcb-supplier-bid-extra-costs').refreshData([changedSupplierBid]);
    changedSupplierBid['transportationChanged'] = false;
    this.actionExecuting = false;
  }

  handlePriceChange(event) {
    let changedSupplierBid = this.productSupplierBids.find(bid => bid.Id === event.detail.supplierBidId);
    changedSupplierBid[event.detail.name] = event.detail.value;
  }

  handleCompanyChange(event) {
    let changedSupplierBid = this.productSupplierBids.find(bid => bid.Id === event.detail.supplierBidId);
    changedSupplierBid.BDN_Company__c = event.detail.value;
  }

  handleCustomCurrencyInputChange(event) {
    if (event.detail.fieldName === 'Supplier_Unit_Price__c') {
      this.productSupplierBids.find(bid => bid.Id === event.target.dataset.id)['Supplier_Unit_Price__c'] = event.target.value;
      this.template.querySelector('c-fcb-supplier-bid-extra-costs').refreshData(this.productSupplierBids);
    } else if (event.detail.fieldName === 'Unit_Transportation_Cost__c') {
      this.supplierBid['Unit_Transportation_Cost__c'] = event.detail.value;
    } else if (event.detail.fieldName === 'Supplier_Broker_Commission__c') {
      let brokerCommission = event.detail.value;
      this.supplierBid['Supplier_Broker_Commission__c'] = brokerCommission;
      this.isSupplierBrokerRequired = Boolean(brokerCommission && brokerCommission > 0);
    }
    this._reassignObject();
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
          label: this.today
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

  _convertDate(date) {
    let day = date.getDate();
    day = day < 10 ? '0' + day : day;
    let month = date.getMonth() + 1;
    month = month < 10 ? '0' + month : month;
    let year = date.getFullYear();
    return year + '-' + month + '-' + day;
  }

  async changeStops(event) {
    this.actionExecuting = true;
    this.enquiryLineItemId = event.detail.value;
    let enquiryLineItem = this.enquiryLineItems.find(enquiryLineItem => enquiryLineItem.Id === this.enquiryLineItemId);
    let autoPopulatedSupplierBid = {};
    autoPopulatedSupplierBid.Port__c = enquiryLineItem.Port__c;
    autoPopulatedSupplierBid.Product__c = enquiryLineItem.Product2Id;
    autoPopulatedSupplierBid.ProductName = enquiryLineItem.Product2.Name;
    autoPopulatedSupplierBid.Quantity__c = enquiryLineItem.Quantity;
    autoPopulatedSupplierBid.Unit_of_Measure__c = enquiryLineItem.Unit_of_Measure__c;
    autoPopulatedSupplierBid.IsQuantityRange__c = enquiryLineItem.IsQuantityRange__c;
    autoPopulatedSupplierBid.Quantity_Range_Maximum__c = enquiryLineItem.Quantity_Range_Maximum__c;
    autoPopulatedSupplierBid.Transportation_Type_Buy__c = '';
    if (enquiryLineItem.ETA_ETB__c === 'ETA') {
      autoPopulatedSupplierBid.Expected_Delivery_Date__c = enquiryLineItem.ETA_Start_Date__c;
    } else if (enquiryLineItem.ETA_ETB__c === 'ETB') {
      autoPopulatedSupplierBid.Expected_Delivery_Date__c = enquiryLineItem.ETB_Start_Date__c;
    } else {
      autoPopulatedSupplierBid.Expected_Delivery_Date__c = enquiryLineItem.Supplier_Bids__r
        ? enquiryLineItem.Supplier_Bids__r[0].Expected_Delivery_Date__c
        : enquiryLineItem.CreatedDate;
    }
    autoPopulatedSupplierBid.Enquiry_Line_Item__c = this.orgUrl + enquiryLineItem.Id;
    this.supplierBid = autoPopulatedSupplierBid;
    this.actionExecuting = false;
  }

  validateInputsAndGetValidationResult() {
    let fields = this.template.querySelectorAll('lightning-input-field');
    let isValid = true;
    fields.forEach(field => {
      if (field.fieldName !== 'Preferred_Supplier__c' && field.fieldName !== 'IsQuantityRange__c' && field.fieldName !== 'Partial_CIA__c') {
        if (field.required && !field.value) {
          field.reportValidity();
          isValid = false;
        } else {
          field.reportValidity();
        }
      }
    });
    let inputs = this.template.querySelectorAll('lightning-combobox');
    inputs.forEach(input => {
      if (input.required && !input.value) {
        input.reportValidity();
        isValid = false;
      }
    });
    let customCurrencyFields = this.template.querySelectorAll('c-fcb-offer-broker-pricing-input');
    customCurrencyFields.forEach(currencyField => {
      let isCustomCurrencyFieldValid = currencyField.checkValidity();
      isValid = isValid && isCustomCurrencyFieldValid;
    });    
    let offerLineItemExtraCostsComponent = this.template.querySelector('c-fcb-supplier-bid-extra-costs');
    isValid = isValid && offerLineItemExtraCostsComponent.isExtraCostTableValid();
    return isValid;
  }
}