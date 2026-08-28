import { LightningElement, api, wire , track} from 'lwc';
import { CurrentPageReference } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import STEM_LINE_ITEM_OBJECT from '@salesforce/schema/STEM_Line_Item__c';
import { generateRecordInputForCreate, getRecordCreateDefaults } from 'lightning/uiRecordApi';
import { fireEvent } from 'c/pubsub';
import getPaymentTermOptions from '@salesforce/apex/SupplierBidManagerController.getPaymentTermOptions';
import LightningConfirm from 'lightning/confirm';
import getBDNCompany from '@salesforce/apex/SupplierBidManagerController.getBDNCompany';
import updateExistingPaymentTerms from '@salesforce/apex/StemProcessingController.updateExistingPaymentTerms';
import isSameBdnItems from '@salesforce/apex/StemProcessingController.isSameBdnItems';
import updateExistingPartialAmount from '@salesforce/apex/StemProcessingController.updateExistingPartialAmount';
import getStemBuyerBrokers from '@salesforce/apex/StemProcessingController.getStemBuyerBrokers';
import getStemLineItemBuyerBrokers from '@salesforce/apex/StemProcessingController.getStemLineItemBuyerBrokers';
import { updateRecord, createRecord } from 'lightning/uiRecordApi';

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
 
export default class FcbEditStemLineItemModal extends LightningElement {
    @api recordId;
    @api stem
    @wire(CurrentPageReference) pageRef;
  
    @wire(getRecordCreateDefaults, { objectApiName: STEM_LINE_ITEM_OBJECT })
    stemLineItemObjectDefaults;
  
    actionExecuting = true;
    modalTitle;
    @track _currentStemLineItem;
    _unitSellAt = 0.000;
    _unitBuyAt = 0.000;
    _defaultPaymentTerm;
    _today = this._convertDate(new Date());
    isProductExtraCharge = true;
    paymentTermOptions;
    wiredPaymentTermOptions;
    supplierPaymentTermRecordType = 'Supplier';
    supplierPaymentTermRequired = false;
    savedOriginalSupplier;
    @track disabledBuyerBrokerComm = false;
    @track disabledSupplierBrokerComm = false;
    @track buyerBrokerCommissionLabel;

    @track stemBuyerBrokers;

    @track isDisabledPartialCIA;

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
            value: paymentTerm.Name,
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
          if (this.currentStemLineItem[field.fieldName.slice(0, -1) + 'r']?.Inactive_Suspended__c === true){       
            field.className = 'slds-theme_warning'
          }
        });
      }
    }
  
    connectedCallback() {    
      this.actionExecuting = false;
      this.savedOriginalSupplier = this.currentStemLineItem.Original_Supplier__c;
      if(this.currentStemLineItem.Original_Supplier__c){
        this.setBDNCompany();
      }
      if(!this.stem.Buyer_Broker__c.value){
        this.disabledBuyerBrokerComm = true;
      }
      if(!this.currentStemLineItem.Supplier_Broker__c){
        this.disabledSupplierBrokerComm = true;
      }
      console.log(this.currentStemLineItem);
      
      this.isDisabledPartialCIA = !this.currentStemLineItem.Partial_CIA__c;
      this.buyerBrokerCommissionLabel = this.disabledBuyerBrokerComm ? 'COMM: ' : 'COMM: ' + this.stem.Buyer_Broker__r.displayValue;

      getStemBuyerBrokers({ stemId: this.recordId }).then((brokers) => {
        getStemLineItemBuyerBrokers({stemLineItemId: this.currentStemLineItem.Id}).then(commissions => {
          let stemBuyerBrokerList = [];
          brokers.forEach(item => {
            const stemLineItemBuyerBroker = commissions.find(comm => comm.STEM_Buyer_Broker__c === item.Id);
            stemBuyerBrokerList.push({
              ...item,
              stemLineItemBuyerBrokerId: stemLineItemBuyerBroker?.Id,
              label: 'COMM: ' + item.Buyer_Broker__r.Name + " (Secondary)",
              commission: stemLineItemBuyerBroker?.Commission__c
            })
          })
          this.stemBuyerBrokers = stemBuyerBrokerList;
        })
      }) 
    }

    setBDNCompany(){
      getBDNCompany({supplierId: this.currentStemLineItem.Original_Supplier__c}).then((result) => {
        this.currentStemLineItem.BDN_Company__c = this.currentStemLineItem.BDN_Company__c ? this.currentStemLineItem.BDN_Company__c : result;
      })
    }
  
    get currentStemLineItem() {
      if (!this._currentStemLineItem) {
        if (!this.stemLineItemObjectDefaults.data) {
          return undefined;
        }
        const stemLineItemObjectInfo = this.stemLineItemObjectDefaults
                                            .data
                                            .objectInfos[STEM_LINE_ITEM_OBJECT.objectApiName];
        const recordDefaults = this.stemLineItemObjectDefaults.data.record;
        this._currentStemLineItem = { ...generateRecordInputForCreate(recordDefaults, stemLineItemObjectInfo).fields };
        return this._currentStemLineItem;
      } else {
        return this._currentStemLineItem;
      }
    }
  
    @api
    set currentStemLineItem(value) {
      this._currentStemLineItem = { ...value };
      this._defaultPaymentTerm = this._currentStemLineItem.Payment_Term__c;
      this._unitSellAt = Number(this._currentStemLineItem.Unit_Sell_At__c);
      this._unitBuyAt = Number(this._currentStemLineItem.Unit_Buy_At__c);
    }
  
    get unitSellAt() {
      let retVal;
      if (this._unitSellAt === undefined) {
        retVal = (this._unitBuyAt !== undefined ? Number(this._unitBuyAt) : 0.0);
      } else {
        retVal = Number(this._unitSellAt);
      }
      return retVal.toFixed(3);
    }
  
    set unitSellAt(value) {
      this._unitSellAt = value;
      this._currentStemLineItem.Unit_Sell_At__c = this._unitSellAt;
      this._reassignObject();
    }
  
    get unitBuyAt() {
      return Number(this._unitBuyAt).toFixed(3);
    }
  
    set unitBuyAt(value) {
      this._unitBuyAt = Number(value);
      this._currentStemLineItem.Unit_Buy_At__c = this._unitBuyAt;
      this._reassignObject();
    }
  
    _reassignObject() {
      this._currentStemLineItem['transportationChanged'] = false
      this._currentStemLineItem = { ...this._currentStemLineItem };
    }
  
    _convertDate(date) {
      let day = date.getDate();
      day = day < 10 ? '0' + day : day;
      let month = date.getMonth() + 1;
      month = month < 10 ? '0' + month : month;
      let year = date.getFullYear();
      return year + '-' + month + '-' + day;
    }
  
    /**
     * 
     * @returns 
     */
    validateInputsAndGetValidationResult() {
      try {
      let fields = this.template.querySelectorAll('lightning-input-field');
      let isValid = true;
      fields.forEach(field => {
        // FCBSF-402 skipping checkboxes for Required fields
        if (field.fieldName !== 'Is_Quantity_Range__c' && field.fieldName !== 'Partial_CIA__c') {
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
      let offerLineItemExtraCostsComponent = this.template.querySelector('c-fcb-stem-line-item-extra-costs');
      offerLineItemExtraCostsComponent.isExtraCostTableValid();
      isValid = isValid && offerLineItemExtraCostsComponent.isExtraCostTableValid();
      let unofficialCompensationComponent = this.template.querySelector('c-fcb-stem-unofficial-compensations');
      unofficialCompensationComponent.isExtraCostTableValid();
      isValid = isValid && unofficialCompensationComponent.isExtraCostTableValid();
      return isValid;  
      } catch (error) {
        console.error(error)
      }

    }
  
    closeModal() {
      let closeEvent = new CustomEvent('close', {
        detail: {
          modal: 'editstemlineitem'
        }
      });
      this.actionExecuting = false;
      this.dispatchEvent(closeEvent);
    }
  
    handleQuantityRangeChange(event) {
      this._resetQuantityRangeMaximum(event.target.value);
      this._reassignObject();
    }

    handlePaymentTermChange(event){
      this._currentStemLineItem.Payment_Term__c = event.detail.value;
    }

    handleTransportationSellChange(event){
      this._currentStemLineItem[event.target.fieldName] = event.target.value;
      this._currentStemLineItem['transportationChanged'] = 'Sell';
      this._currentStemLineItem = {...this._currentStemLineItem};
    }
  
    handleTransportationBuyChange(event){
      this._currentStemLineItem[event.target.fieldName] = event.target.value;
      this._currentStemLineItem['transportationChanged'] = 'Buy';
      this._currentStemLineItem = {...this._currentStemLineItem};
    }
  
    _resetQuantityRangeMaximum(isQuantityRange) {
      if (!isQuantityRange) {
        this._currentStemLineItem.Quantity_Max__c = null;
      }
    }

    handleChangeBuyerBrokerCommission(event){
      this.stemBuyerBrokers.find(stemBuyerBroker => stemBuyerBroker.Id === event.target.dataset.id).commission = event.detail.value;
      console.log(this.stemBuyerBrokers);
      
    }
  
    /**
     * 
     */
    handleAddAction() {
      try {
      this.actionExecuting = true;
      let isValid = this.validateInputsAndGetValidationResult();
      if (isValid) {
        const btn = this.template.querySelector('.slds-hidden');
        if (btn) {
          btn.click();
        } else {
          this.actionExecuting = false;
        }
      } else {
        this.actionExecuting = false;
      }  
      } catch (error) {
        this.actionExecuting = false;
        this.showOperationError('Unable to save line item', error);
      }

    }
  
    calculateFormulas(event) {
      if (event.detail.fieldName === 'Unit_Buy_At__c') {
        this.unitBuyAt = event.detail.value;
      } else if (event.detail.fieldName === 'Unit_Sell_At__c') {
        this.unitSellAt = event.detail.value;
      } else if (event.detail.fieldName === 'Buyers_Brokers_Commission_Per_Unit__c') {
        this._currentStemLineItem.Buyers_Brokers_Commission_Per_Unit__c = event.detail.value;
        this._reassignObject();
      } else if (event.detail.fieldName === 'Suppliers_Brokers_Commission_Per_Unit__c') {
        this._currentStemLineItem.Suppliers_Brokers_Commission_Per_Unit__c = event.detail.value;
        this._reassignObject();
      }
    }
  
    async handleSubmitForm(event) {
      try {
      event.preventDefault();
      let fields = event.detail.fields;
      let result = true;
      if(!fields.Original_Supplier__c){
        result = await LightningConfirm.open({
          message: "Are you sure you do not wish to associate this item with any supplier?",
          label: "Please Confirm",
          theme: "warning",
        });
      }
      if(result){
        if(this.currentStemLineItem.Original_Supplier__r.Name.includes('**NEW SUPPLIER')
           && this.savedOriginalSupplier !== fields.Original_Supplier__c){
          this.dispatchEvent(
            new ShowToastEvent({
              title: "Error Updating Supplier",
              message: 'Please update it in Edit Offer Line Item modal window',
              variant: "error",
            })
          );
          this.actionExecuting = false;
        } else{
          fields.Unit_Buy_At__c = this.unitBuyAt;
          fields.Unit_Sell_At__c = this.unitSellAt;
          fields = { ...fields, ...this._currentStemLineItem };
          this.template.querySelector('lightning-record-edit-form').submit(fields); 
        }
      } else{
        this.actionExecuting = false;
      }
      } catch (error) {
        this.actionExecuting = false;
        this.showOperationError('Unable to submit line item', error);
      }

    }

    handleStemLineItemChange(event) {
      try {
        let attribute = event.target.fieldName;
        let stemLineItem = { ...this._currentStemLineItem };
        stemLineItem[attribute] = event.target.value;
        this._currentStemLineItem = stemLineItem;
        console.log(attribute);
        if(attribute === "Original_Supplier__c" && event.target.value){
          this.supplierPaymentTermRequired = Boolean(event.target.value);
          this.setBDNCompany();
        } else if(attribute === "Supplier_Broker__c"){
          this.disabledSupplierBrokerComm = !Boolean(event.target.value);
        } else if(attribute === 'Partial_CIA__c'){
          this.isDisabledPartialCIA = !event.target.value;
          if(!event.target.value){
            this.currentStemLineItem.Partial_Lumpsum_Buy_At__c = null;
          }
        } 
        if(event.target.fieldName !== 'Transportation_Type_Sell__c' && event.target.fieldName !== 'Transportation_Type_Buy__c'){
          this._reassignObject();
        } 
      } catch (error) {
        console.error(error)
      }

    }
  
    handleErrorForm(event) {
      this.actionExecuting = false;
      this.showOperationError('Stem Line Item was not saved', event);
    }
  
    async handleStemLineItemAdded(event) {
      try {
        const offerLineItemExtraCostsComponent = this.template.querySelector('c-fcb-stem-line-item-extra-costs');
        await offerLineItemExtraCostsComponent.removeExtraCosts();
        await offerLineItemExtraCostsComponent.upsertExtraCosts(event.detail.id, this.recordId);
        await this.createStemLineItemBuyerBrokers(event.detail.id);

        let unofficialCompensationComponent = this.template.querySelector('c-fcb-stem-unofficial-compensations');
        unofficialCompensationComponent.saveStemUnofficialCompensations();

        await updateExistingPartialAmount({stemId: this.recordId,
          supplierId: this.currentStemLineItem.Original_Supplier__c,
          partialCia: this.currentStemLineItem.Partial_CIA__c,
          partialAmount: this.currentStemLineItem.Partial_Lumpsum_Buy_At__c
        });

        if (this.currentStemLineItem.Payment_Term__c !== this._defaultPaymentTerm) {
          const flag = await isSameBdnItems({
            recordId: this.currentStemLineItem.Id,
            stemId: this.recordId,
            supplierId: this.currentStemLineItem.Original_Supplier__c,
            bdnCompany: this.currentStemLineItem.BDN_Company__c
          });

          if (flag) {
            const result = await LightningConfirm.open({
              message: "Do you want to update payment terms of the same BDN?",
              label: "Please Confirm",
              theme: "warning",
            });

            if (result) {
              await updateExistingPaymentTerms({
                stemId: this.recordId,
                supplierId: this.currentStemLineItem.Original_Supplier__c,
                bdnCompany: this.currentStemLineItem.BDN_Company__c,
                paymentTerm: this.currentStemLineItem.Payment_Term__c
              });
            }
          }
        }

        this.dispatchEvent(
          new ShowToastEvent({
            title: 'Success',
            message: 'Stem Line Item is edited',
            variant: 'success'
          })
        );
        this.closeModal();
        fireEvent(this.pageRef, 'refreshStemLineItemList', true);
      } catch (error) {
        this.actionExecuting = false;
        this.showOperationError(
          'Related cost update failed',
          error,
          'The line item was saved, but transport or related cost records were not fully updated. Refresh before retrying.'
        );
      }
    }

    async createStemLineItemBuyerBrokers(stemLineItemId) {
      return Promise.all((this.stemBuyerBrokers || []).map(stemBuyerBroker => {
        const fields = {};
        fields["Id"] = stemBuyerBroker.stemLineItemBuyerBrokerId;
        fields["Commission__c"] = stemBuyerBroker.commission;

        if (stemBuyerBroker.stemLineItemBuyerBrokerId) {
          const recordInput = { fields };
          return updateRecord(recordInput);
        }

        delete fields.Id;
        fields["STEM_Line_Item__c"] = stemLineItemId;
        fields["STEM_Buyer_Broker__c"] = stemBuyerBroker.Id;
        const recordInput = { apiName: 'STEM_Line_Item_Buyer_Broker__c', fields: fields };
        return createRecord(recordInput);
      }));
    }

    showOperationError(title, error, prefix) {
      const detail = getErrorMessage(error);
      this.dispatchEvent(
        new ShowToastEvent({
          title,
          message: prefix ? `${prefix} ${detail}` : detail,
          variant: 'error',
          mode: 'sticky'
        })
      );
    }
}
