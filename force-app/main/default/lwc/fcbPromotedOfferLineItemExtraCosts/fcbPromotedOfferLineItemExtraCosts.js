import { api, LightningElement, track } from 'lwc';
import loadExtraCostProducts from '@salesforce/apex/OfferLineItemExtraCostController.loadExtraCostProducts';
import getUnitOfMeasurePickListValues
    from '@salesforce/apex/OfferLineItemExtraCostController.getUnitOfMeasurePickListValues';
import upsertProductExtraCosts from '@salesforce/apex/OfferLineItemExtraCostController.upsertProductExtraCosts';
import getOfferSTEMCharges from '@salesforce/apex/OfferLineItemExtraCostController.getOfferSTEMCharges';
import QUOTE_LINE_ITEM from '@salesforce/schema/QuoteLineItem';
import getSTEMCharges from '@salesforce/apex/SupplierBidManagerController.getSTEMCharges';
import { deleteRecord } from 'lightning/uiRecordApi';

export default class FcbPromotedOfferLineItemExtraCosts extends LightningElement {
    @api quoteId;
    @api enquiryLineItem;
    _quoteLineItem;
    @track extraCostProducts;
    @track extraCosts = [];
    @track extraCostsToDelete = [];
    @track total = { min: 0.00, max: 0.00, outputValue: '' };
    @track unitOfMeasureOptions;
    @track transportationExtraCostBuy;
    @track transportationExtraCostSell;
    transportationProducts = [];
    isTransportationExtraCostInitialized = false;
    @track stemCharges = [];
    supplierBidIds;


    get quoteLineItem() {
        return this._quoteLineItem;
    }

    @api
    set quoteLineItem(value) {
        this._quoteLineItem = this.redefineStringFieldsFromRecordWithNumberValues(value);
        this.transportationExtraCostBuy = this.repopulateTransportationExtraCostValue(this.transportationExtraCostBuy, this._quoteLineItem.Transportation_Type_Buy__c);
        if(this.quoteLineItem.transportationChanged){
            this.transportationExtraCostSell = this.repopulateTransportationExtraCostValue(this.transportationExtraCostSell, this._quoteLineItem.Transportation_Type_Sell__c);
            if (this.transportationExtraCostSell.fixedCost === this.transportationExtraCostBuy.fixedCost
                && this.transportationExtraCostSell.isTransportationTypeIncluded === this.transportationExtraCostBuy.isTransportationTypeIncluded) {
                this.resetFieldsForTransportationExtraCostSell();
            }
            this.updateAndRepopulateExtraCostValues();
        }
        this.calculateTotal();
        
    }

    repopulateTransportationExtraCostValue(transportationExtraCost, transportationType) {
        if (transportationType) {
            if (transportationExtraCost) {
                let product = this._getTransportationProductByTransportationType(transportationType);
                if (product.Name !== transportationExtraCost.productName) {
                    transportationExtraCost.unitCost = null;
                    transportationExtraCost.unitPrice.value = null;
                }
                transportationExtraCost.quantity.value = this.quoteLineItem.Quantity__c;
                transportationExtraCost.isQuantityRange = this._quoteLineItem.IsQuantityRange__c;
                transportationExtraCost.quantityMaximum.value = this._quoteLineItem.Quantity_Range_Maximum__c;
                transportationExtraCost.isTransportationTypeIncluded = transportationType.includes('Included');
                transportationExtraCost.isQuantityRangeDisabled = !this._quoteLineItem.IsQuantityRange__c || transportationExtraCost.fixedCost;
                transportationExtraCost.unitOfMeasure = this._quoteLineItem.Unit_of_Measure__c;
                transportationExtraCost.product2Id = product.Id;
                transportationExtraCost.productName = product.Name;
                transportationExtraCost.resetQuantityMaximumValidation();
                transportationExtraCost.disableFieldsIfTransportationIncluded(this._quoteLineItem);
                transportationExtraCost.updateAndRepopulateValues();
                transportationExtraCost.recalculate();
            } else {
                transportationExtraCost = this._addTransportationExtraCost(this._quoteLineItem, transportationExtraCost, transportationType);
                transportationExtraCost.recalculate();
            }
        } else {
            transportationExtraCost = null;
        }
        return transportationExtraCost;
    }

    _addTransportationExtraCost(record, transportationExtraCost, transportationType, nundinationType) {
        console.log(record);
        console.log(transportationExtraCost);
        
        let product = this._getTransportationProductByTransportationType(transportationType);
        if (!transportationExtraCost) {
            let result = {
                type: nundinationType,
                product2Id: product ? product.Id : null,
                productName: product ? product.Name : null,
                isTransportationTypeIncluded: transportationType.includes('Included'),
                quantity: {
                    value: record ? record.Quantity__c : null,
                    className: 'slds-input'
                },
                isQuantityRange: this._quoteLineItem.IsQuantityRange__c,
                isQuantityRangeDisabled: !this._quoteLineItem.IsQuantityRange__c || (record ? record.Fixed__c : false),
                quantityMaximum: {
                    value: record ? record.Quantity_Range_Maximum__c : null,
                    className: 'slds-input'
                },
                unitCost: record ? record.Unit_Cost__c : null,
                unitPrice: {
                    value: transportationType.includes('Included') ? null : record ? record.Unit_Cost__c : null,
                    disabled: transportationType.includes('Included'),
                    className: 'slds-input'
                },
                unitOfMeasure: record ? record.Unit_of_Measure__c : '1.',
                fixedCost: record ? record.Fixed__c : true,
                isFixedCostDisabled: record ? !record.Fixed__c : transportationType.includes('Included'),
                disableFixed: transportationType.includes('Included'),
                minimumBuyAt: {
                    value: record && record.Minimum__c ? record.Minimum__c : null,
                    className: 'slds-input'
                },
                minimumSellAt: {
                    value: null,
                    className: 'slds-input'
                },
                lumpsumCostBuyAt: {
                    value: record && record.Lumpsum_Cost__c ? record.Lumpsum_Cost__c : null,
                    className: 'slds-input'
                },
                lumpsumCostSellAt: {
                    value: transportationType.includes('Included') ? null : record ? record.Lumpsum_Cost__c : null,
                    disabled: transportationType.includes('Included'),
                    className: 'slds-input'
                },
                unitMargin: {
                    _min: 0.00,
                    _max: 0.00,
                    outputValue: ''
                },
                totalMargin: {
                    _min: 0.00,
                    _max: 0.00,
                    outputValue: ''
                },
                hasMinimum: false,
                totalCost: {
                    _min: 0.00,
                    _max: 0.00,
                    outputValue: ''
                },

                recalculate() {
                    this.recalculateUnitMargin();
                    this.recalculateTotalMargin();
                    this.recalculateTotalCost();
                  },
          
                  recalculateUnitMargin() {
                    if (this.fixedCost) {
                      this.unitMargin = {
                        _min: isNaN(this.lumpsumCostSellAt.value - this.lumpsumCostBuyAt.value) ? 0.00 : this.lumpsumCostSellAt.value - this.lumpsumCostBuyAt.value,
                        _max: 0.00,
                        outputValue: isNaN(this.lumpsumCostSellAt.value - this.lumpsumCostBuyAt.value) ? 0.00 : Number(this.lumpsumCostSellAt.value - this.lumpsumCostBuyAt.value).toFixed(2)
                      };
                    }
                  },
          
                  recalculateTotalMargin() {
                    let unitCost = this.unitCost != null && !isNaN(this.unitCost) ? this.unitCost : 0.00;
                    let unitPrice = this.unitPrice.value != null && !isNaN(this.unitPrice.value) ? this.unitPrice.value : 0.00;
                    if (this.fixedCost) {
                      this.totalMargin = {
                        _min: this.quantity.value * this.unitMargin._min,
                        _max: null,
                        outputValue: (this.quantity.value * this.unitMargin._min).toFixed(2)
                      };
                    } else {
                      if (this.isQuantityRange) {
                        let maxBuyAt, maxSellAt = 0.0;
                        maxBuyAt = isNaN(Math.max(this.minimumBuyAt.value, this.quantity.value * unitCost)) ? 0.00 : Math.max(this.minimumBuyAt.value, this.quantity.value * unitCost);
                        maxSellAt = isNaN(Math.max(this.minimumSellAt.value, this.quantity.value * unitPrice)) ? 0.00 : Math.max(this.minimumSellAt.value, this.quantity.value * unitPrice);
                        let minTotalMargin = maxSellAt - maxBuyAt;
                        let minUnitMargin = this.quantityMaximum.value == null
                        || isNaN(minTotalMargin / this.quantityMaximum.value)
                        || !isFinite(minTotalMargin / this.quantityMaximum.value)
                            ? 0 : (minTotalMargin / this.quantityMaximum.value).toFixed(2);
          
                        let secMaxBuyAt, secMaxSellAt = 0.00;
                        secMaxBuyAt = isNaN(Math.max(this.minimumBuyAt.value, this.quantityMaximum.value * unitCost)) ? 0.00 : Math.max(this.minimumBuyAt.value, this.quantityMaximum.value * unitCost);
                        secMaxSellAt = isNaN(Math.max(this.minimumSellAt.value, this.quantityMaximum.value * unitPrice)) ? 0.00 : Math.max(this.minimumSellAt.value, this.quantityMaximum.value * unitPrice);
                        let secMinTotalMargin = secMaxSellAt - secMaxBuyAt;
                        let secMinUnitMargin = !this.quantityMaximum.value
                        || isNaN(secMinTotalMargin / this.quantityMaximum.value)
                        || !isFinite(secMinTotalMargin / this.quantityMaximum.value)
                            ? 0 : (secMinTotalMargin / this.quantityMaximum.value).toFixed(2);
          
                        this.unitMargin = {
                          _min: minUnitMargin,
                          _max: secMinUnitMargin,
                          outputValue: minUnitMargin + ' - ' + secMinUnitMargin
                        };
          
                        this.totalMargin = {
                          _min: minTotalMargin,
                          _max: secMinTotalMargin,
                          outputValue: minTotalMargin.toFixed(2) + ' - ' + secMinTotalMargin.toFixed(2)
                        };
                      } else {
                        let maxBuyAt, maxSellAt = 0.00;
                        maxBuyAt = isNaN(Math.max(this.minimumBuyAt.value, this.quantity.value * unitCost)) ? 0.00 : Math.max(this.minimumBuyAt.value, this.quantity.value * unitCost);
                        maxSellAt = isNaN(Math.max(this.minimumSellAt.value, this.quantity.value * unitPrice)) ? 0.00 : Math.max(this.minimumSellAt.value, this.quantity.value * unitPrice);
                        let minTotalMargin = maxSellAt - maxBuyAt;
                        let minUnitMargin = !this.quantity.value
                        || isNaN(minTotalMargin / this.quantity.value)
                        || !isFinite(minTotalMargin / this.quantity.value)
                            ? 0.00 : (minTotalMargin / this.quantity.value).toFixed(2);
                        this.unitMargin = { _min: minUnitMargin, _max: 0.00, outputValue: minUnitMargin };
                        this.totalMargin = {
                          _min: minTotalMargin,
                          _max: null,
                          outputValue: minTotalMargin.toFixed(2)
                        };
                      }
                    }
                  },
          
                  recalculateTotalCost() {
                    if (this.fixedCost) {
                      let price = this.lumpsumCostSellAt.value;
                      this.totalCost = {
                        _min: price * this.quantity.value,
                        _max: price * this.quantity.value,
                        outputValue: (price * this.quantity.value).toFixed(2)
                      };
                    } else {
                      let price = this.unitPrice.value;
                      if (this.isQuantityRange) {
                        if (this.minimumSellAt.value != null) {
                          this.totalCost = {
                            _min: Math.max(price * this.quantity.value, this.minimumSellAt.value),
                            _max: Math.max(price * this.quantityMaximum.value, this.minimumSellAt.value),
                            outputValue: Math.max(price * this.quantity.value, this.minimumSellAt.value)
                                    .toFixed(2)
                                + ' - '
                                + Math.max(price * this.quantityMaximum.value, this.minimumSellAt.value)
                                    .toFixed(2)
                          };
                        } else {
                          this.totalCost = {
                            _min: isNaN(price * this.quantity.value) ? 0.00 : price * this.quantity.value,
                            _max: isNaN(price * this.quantityMaximum.value) ? 0.00 : price * this.quantityMaximum.value,
                            outputValue: (isNaN(price * this.quantity.value) ? 0.00 : (price * this.quantity.value).toFixed(2))
                                + ' - '
                                + (isNaN(price * this.quantityMaximum.value) ? 0.00: (price * this.quantityMaximum.value).toFixed(2))
                          };
                        }
                      } else {
                        if (this.minimumSellAt.value != null) {
                          this.totalCost = {
                            _min: Math.max(price * this.quantity.value, this.minimumSellAt.value),
                            _max: 0.00,
                            outputValue: Math.max(price * this.quantity.value, this.minimumSellAt.value).toFixed(2)
                          };
                        } else {
                          this.totalCost = {
                            _min: price * this.quantity.value,
                            _max: 0.00,
                            outputValue: (price * this.quantity.value).toFixed(2)
                          };
                        }
                      }
                    }
                  },

                updateAndRepopulateValues() {
                    this.repopulateValuesIfQuantityRange();
                    this.repopulateValuesIfFixedCost();
                },

                repopulateValuesIfQuantityRange() {
                    if (!this.isQuantityRange) {
                        this.quantityMaximum.value = null;
                    }
                },

                repopulateValuesIfFixedCost() {
                    if (this.fixedCost) {
                        if (this.isTransportationTypeIncluded) {
                            this.unitPrice.disabled = true;
                            this.lumpsumCostSellAt.value = null;
                            this.lumpsumCostSellAt.disabled = true;
                        } else {
                            this.lumpsumCostSellAt.disabled = false;
                        }
                        this.unitCost = null;
                        this.unitPrice.disabled = true;
                        this.unitPrice.value = null;
                        this.minimumBuyAt.value = null;
                        this.minimumSellAt.value = null;
                        this.quantity.value = 1.00;
                        this.quantityMaximum.value = null;
                        this.isQuantityRangeDisabled = true;
                        this.unitOfMeasure = '1.';
                    } else {
                        this.lumpsumCostBuyAt.value = null;
                        this.lumpsumCostSellAt.value = null;
                        this.isQuantityRangeDisabled = !this.isQuantityRange;
                    }
                },

                disableFieldsIfTransportationIncluded(quoteLineItem) {
                    this.unitPrice.disabled = this.isTransportationTypeIncluded;
                    if(this.isTransportationTypeIncluded){
                       this.fixedCost = true; 
                    } else if(this.type === 'Buy' || !quoteLineItem.transportationChanged){
                        this.fixedCost = this.fixedCost;
                    } else {
                        this.fixedCost = true;
                    }
                    this.isFixedCostDisabled = this.isTransportationTypeIncluded || !this.fixedCost;
                    this.disableFixed = this.isTransportationTypeIncluded;
                    if (this.isTransportationTypeIncluded) {
                        this.unitPrice.value = null;
                    }
                },

                revalidateFields() {
                    this.resetValidation();
                    this.validateFields();
                },

                resetValidation() {
                    this.quantity.className = 'slds-input';
                    this.resetQuantityMaximumValidation();
                    this.unitPrice.className = 'slds-input';
                    this.minimumBuyAt.className = 'slds-input';
                    this.minimumSellAt.className = 'slds-input';
                    this.lumpsumCostSellAt.className = 'slds-input';
                },

                resetQuantityMaximumValidation() {
                    this.quantityMaximum.className = 'slds-input';
                },

                validateFields() {
                    this.validateQuantity();
                    this.validateQuantityMaximum();
                    this.validateUnitPrice();
                    this.validateLumpsumCostSellAt();
                },

                validateQuantity() {
                    this.quantity.className = !this.fixedCost && this.quantity.value == null
                        ? 'slds-input slds-has-error' : 'slds-input';
                },

                validateQuantityMaximum() {
                    this.quantityMaximum.className = !this.fixedCost && this.isQuantityRange && this.quantityMaximum.value == null
                        ? 'slds-input slds-has-error' : 'slds-input ';
                },

                validateUnitPrice() {
                    this.unitPrice.className = (!this.fixedCost && !this.unitPrice.disabled) && this.unitPrice.value == null
                        ? 'slds-input slds-has-error' : 'slds-input';
                },

                validateLumpsumCostSellAt() {
                    this.lumpsumCostSellAt.className = (this.fixedCost && !this.lumpsumCostSellAt.disabled) && this.lumpsumCostSellAt.value == null
                        ? 'slds-input slds-has-error' : 'slds-input';
                }
            };

            transportationExtraCost = result;
        } else {
            transportationExtraCost.type = nundinationType
            transportationExtraCost.unitOfMeasure = record ? this._quoteLineItem.Unit_of_Measure__c : '1.';
            transportationExtraCost.isTransportationTypeIncluded = transportationType.includes('Included');
            transportationExtraCost.product2Id = product.Id;
            transportationExtraCost.productName = product.Name;
            transportationExtraCost.fixedCost = record?.Fixed__c || transportationType.includes('Included');
            transportationExtraCost.isFixedCostDisabled = transportationType.includes('Included') || !record.Fixed__c;
            transportationExtraCost.quantity.value = transportationExtraCost.fixedCost ? 1.00 : record ? record.Quantity__c : transportationExtraCost.quantity.value
            transportationExtraCost.isQuantityRange = this._quoteLineItem.IsQuantityRange__c;
            transportationExtraCost.isQuantityRangeDisabled = !this._quoteLineItem.IsQuantityRange__c || transportationExtraCost.fixedCost;
            transportationExtraCost.quantityMaximum.value = transportationExtraCost.fixedCost ? null : record ? record.Quantity_Range_Maximum__c : transportationExtraCost.quantityMaximum.value;
            transportationExtraCost.unitCost = record ? record.Unit_Cost__c : null;
            transportationExtraCost.unitPrice.value = 0;
            transportationExtraCost.minimumBuyAt.value = record ? record.Minimum__c : null;
            transportationExtraCost.lumpsumCostBuyAt.value = record ? record.Lumpsum_Cost__c : null;
            transportationExtraCost.resetQuantityMaximumValidation();
            transportationExtraCost.updateAndRepopulateValues();
        }
        return transportationExtraCost
    }

    _getTransportationProductByTransportationType(transportationType) {
        let transportationProduct;
        if (transportationType === 'Barge (Excluded)') {
            transportationProduct = this.transportationProducts.find(product => product.Name === 'Transport (Barge)');
        } else if (transportationType === 'Barge (Included)') {
            transportationProduct = this.transportationProducts.find(product => product.Name === 'Transport (Barge Included)');
        } else if (transportationType === 'Truck (Excluded)') {
            transportationProduct = this.transportationProducts.find(product => product.Name === 'Transport (Truck)');
        } else if (transportationType === 'Truck (Included)') {
            transportationProduct = this.transportationProducts.find(product => product.Name === 'Transport (Truck Included)');
        } else if (transportationType === 'Barge or Truck (Included)') {
            transportationProduct = this.transportationProducts.find(product => product.Name === 'Transport (Barge or Truck Included)');
        } else if (transportationType === 'Pipeline (Included)') {
            transportationProduct = this.transportationProducts.find(product => product.Name === 'Transport (Pipeline Included)');
        } else {
            transportationProduct = this.transportationProducts.find(product => product.Name === 'Transport (Unknown)');
        }
        return transportationProduct;
    }

    redefineStringFieldsFromRecordWithNumberValues(record) {
        let updatedRecord = { ...record };
        updatedRecord.UnitPrice = isNaN(parseFloat(updatedRecord.UnitPrice))
                                  ? 0.00 : parseFloat(updatedRecord.UnitPrice);
        updatedRecord.Supplier_Unit_Price__c = isNaN(parseFloat(updatedRecord.Supplier_Unit_Price__c))
                                               ? 0.00 : parseFloat(updatedRecord.Supplier_Unit_Price__c);
        updatedRecord.Quantity = isNaN(parseFloat(updatedRecord.Quantity__c))
                                 ? 0.00 : parseFloat(updatedRecord.Quantity__c);
        updatedRecord.Quantity_Range_Maximum__c = isNaN(parseFloat(updatedRecord.Quantity_Range_Maximum__c))
                                                  ? null : parseFloat(updatedRecord.Quantity_Range_Maximum__c);
        updatedRecord.Buyer_Broker_Commission__c = isNaN(parseFloat(updatedRecord.Buyer_Broker_Commission__c))
                                                   ? 0.00 : parseFloat(updatedRecord.Buyer_Broker_Commission__c);
        updatedRecord.Supplier_Broker_Commission__c = isNaN(parseFloat(updatedRecord.Supplier_Broker_Commission__c))
                                                      ? 0.00 : parseFloat(updatedRecord.Supplier_Broker_Commission__c);
        return updatedRecord;
    }

    resetFieldsForTransportationExtraCostSell(){
        if (this.transportationExtraCostBuy && this.transportationExtraCostSell) {
            this.transportationExtraCostSell.quantity.value = this.transportationExtraCostBuy.quantity.value;
            this.transportationExtraCostSell.quantityMaximum.value = this.transportationExtraCostBuy.quantityMaximum.value;
            this.transportationExtraCostSell.isQuantityRange = this.transportationExtraCostBuy.isQuantityRange;
            this.transportationExtraCostSell.isQuantityRangeDisabled = this.transportationExtraCostBuy.isQuantityRangeDisabled;
            this.transportationExtraCostSell.fixedCost = this.transportationExtraCostBuy.fixedCost;
            this.transportationExtraCostSell.isFixedCostDisabled = this.transportationExtraCostSell.isTransportationTypeIncluded || !this.transportationExtraCostSell.fixedCost;
            this.transportationExtraCostSell.unitCost = null;
            this.transportationExtraCostSell.unitPrice.value = this.transportationExtraCostSell.isTransportationTypeIncluded ? null : this.transportationExtraCostBuy.unitCost;
            this.transportationExtraCostSell.minimumBuyAt.value = null;
            this.transportationExtraCostSell.minimumSellAt.value = this.transportationExtraCostSell.isTransportationTypeIncluded ? null : this.transportationExtraCostBuy.minimumBuyAt.value;
            this.transportationExtraCostSell.lumpsumCostBuyAt.value = null;
            this.transportationExtraCostSell.lumpsumCostSellAt.value = this.transportationExtraCostSell.isTransportationTypeIncluded ? null : this.transportationExtraCostBuy.lumpsumCostBuyAt.value;
        }
    }

    connectedCallback() {
        getUnitOfMeasurePickListValues().then(data => {
            let result = [];
            Object.keys(data).forEach(key => {
                result.push({ label: key, value: data[key] });
            });
            this.unitOfMeasureOptions = result;
        }).then(() => {
            loadExtraCostProducts().then(data => {
                let result = [];
                data.forEach(product => {
                    if (product.Family === 'Transportation') {
                        this.transportationProducts.push(product);
                    } else {
                        result.push({
                            label: product.Name,
                            value: product.Id
                        });
                    }
                });
                this.quoteLineItem = this._quoteLineItem;
                this.extraCostProducts = result;
            }).then(() => {
                console.log(this.quoteLineItem.Supplier_Bid_Extra_Costs__r);
                
                if (this.quoteLineItem.Supplier_Bid_Extra_Costs__r) {
                    let transportationProductBuy = this._getTransportationProductByTransportationType(this.quoteLineItem.Transportation_Type_Buy__c);
                    let transportationProductSell = this._getTransportationProductByTransportationType(this.quoteLineItem.Transportation_Type_Sell__c);   
                    if (this.quoteLineItem.Supplier_Bid_Extra_Costs__r){
                        this.quoteLineItem.Supplier_Bid_Extra_Costs__r.forEach(extraCharge => {
                            if ((extraCharge.Product__c === transportationProductBuy.Id || extraCharge.Product__c === transportationProductSell.Id) && (this.quoteLineItem.Transportation_Type_Buy__c || this.quoteLineItem.Transportation_Type_Sell__c)) {
                                this.transportationExtraCostBuy = this._addTransportationExtraCost(extraCharge, this.transportationExtraCostBuy, this.quoteLineItem.Transportation_Type_Buy__c, 'Buy');
                                this.transportationExtraCostSell = this._addTransportationExtraCost(extraCharge, this.transportationExtraCostSell, this.quoteLineItem.Transportation_Type_Sell__c, 'Sell');
                            } else if(!extraCharge.STEM_Extra_Charge__c){
                                this.addExtraCostLine(extraCharge , false);
                            }
                        });
                        if(this.transportationExtraCostSell.fixedCost === this.transportationExtraCostBuy.fixedCost && this.transportationExtraCostSell.isTransportationTypeIncluded === this.transportationExtraCostBuy.isTransportationTypeIncluded){
                            this.resetFieldsForTransportationExtraCostSell();
                        }
                        
                        this.transportationExtraCostBuy.recalculate();
                        this.transportationExtraCostSell.recalculate();
                    }
                    this.calculateTotal();
                } else{
                    console.log('check');
                    
                    this.transportationExtraCostBuy = this._addTransportationExtraCost(null, this.transportationExtraCostBuy, this.quoteLineItem.Transportation_Type_Buy__c, 'Buy');
                    this.transportationExtraCostSell = this._addTransportationExtraCost(null, this.transportationExtraCostSell, this.quoteLineItem.Transportation_Type_Sell__c, 'Sell');
                    this.resetFieldsForTransportationExtraCostSell();
                    console.log(this.transportationExtraCostBuy);
                    console.log(this.transportationExtraCostSell);
                    
                }
                getSTEMCharges({ quoteId: this.quoteId, supplierId: this.quoteLineItem.Supplier__c }).then((stemCharges) => {
                    stemCharges.forEach(stemExtraCharge => {
                        this.addExtraCostLine(stemExtraCharge, true);
                    })
                    const stemChargesIds = this.stemCharges.map(charge => charge.id).filter(id => id);
                    getOfferSTEMCharges({supplierBidIds: stemChargesIds}).then((result) => {
                        this.supplierBidIds = result.map(charge => charge.Supplier_Bid_Extra_Cost__c).filter(id => id);
                    })
                })
            });
        });      
    }

    handleTransportationExtraCostSellChange(event) {
        let attribute = event.target.name;
        let value = event.target.value;
        switch (attribute) {
            case 'product2Id':
                this.transportationExtraCostSell[attribute] = value;
                break;
            case 'quantity':
                this.transportationExtraCostSell[attribute].value = isNaN(parseInt(value, 10)) ? null : parseInt(value, 10);
                this.transportationExtraCostSell.validateQuantity();
                break;
            case 'quantityMaximum':
                this.transportationExtraCostSell[attribute].value = isNaN(parseInt(value, 10)) ? null : parseInt(value, 10);
                this.transportationExtraCostSell.validateQuantityMaximum();
                break;
            case 'unitOfMeasure':
                this.transportationExtraCostSell[attribute] = value;
                break;
            case 'unitCost':
                this.transportationExtraCostSell[attribute] = parseFloat(value);
                /*
                if (!this.transportationExtraCostSell.isTransportationTypeIncluded && !this.transportationExtraCostSell.unitPrice.value) {
                    this.transportationExtraCostSell.unitPrice.value = parseFloat(value);
                }
                */
                break;
            case 'unitPrice':
                this.transportationExtraCostSell[attribute].value = isNaN(parseFloat(value)) ? null : parseFloat(value);
                this.transportationExtraCostSell.validateUnitPrice();
                break;
            case 'fixedCost':
                this.transportationExtraCostSell[attribute] = event.target.checked;
                this.transportationExtraCostSell.isFixedCostDisabled = !event.target.checked;
                this.transportationExtraCostSell.quantity.value = this._quoteLineItem.Quantity;
                this.transportationExtraCostSell.quantityMaximum.value = this._quoteLineItem.Quantity_Range_Maximum__c;
                this.transportationExtraCostSell.unitOfMeasure = event.target.checked ? '1.' : this._quoteLineItem.Unit_of_Measure__c;
                this.transportationExtraCostSell.resetValidation();
                this.transportationExtraCostSell.repopulateValuesIfFixedCost();
                if(this.transportationExtraCostSell.fixedCost === this.transportationExtraCostBuy.fixedCost && this.transportationExtraCostSell.isTransportationTypeIncluded === this.transportationExtraCostBuy.isTransportationTypeIncluded){
                    this.resetFieldsForTransportationExtraCostSell();
                }
                break;
            case 'minimumBuyAt':
                this.transportationExtraCostSell[attribute].value = isNaN(parseFloat(value)) ? null : parseFloat(value);
                break;
            case 'minimumSellAt':
                this.transportationExtraCostSell[attribute].value = isNaN(parseFloat(value)) ? null : parseFloat(value);
                break;
            case 'lumpsumCostBuyAt':
                this.transportationExtraCostSell[attribute].value = parseFloat(value);
                if (!this.transportationExtraCostSell.lumpsumCostSellAt.disabled && !this.transportationExtraCostSell.lumpsumCostSellAt.value) {
                    this.transportationExtraCostSell.lumpsumCostSellAt.value = parseFloat(value);
                }
                break;
            case 'lumpsumCostSellAt':
                this.transportationExtraCostSell[attribute].value = isNaN(parseFloat(value)) ? null : parseFloat(value);
                this.transportationExtraCostSell.validateLumpsumCostSellAt();
                break;
            default:
                this.transportationExtraCostSell[attribute] = value;
                break;
        }
        this.transportationExtraCostSell.recalculate();
        this.calculateTotal();
    }

    handleTransportationExtraCostBuyChange(event) {
        let attribute = event.target.name;
        let value = event.target.value;
        switch (attribute) {
            case 'product2Id':
                this.transportationExtraCostBuy[attribute] = value;
                break;
            case 'quantity':
                this.transportationExtraCostBuy[attribute].value = isNaN(parseInt(value, 10)) ? null : parseInt(value, 10);
                this.transportationExtraCostBuy.validateQuantity();
                break;
            case 'quantityMaximum':
                this.transportationExtraCostBuy[attribute].value = isNaN(parseInt(value, 10)) ? null : parseInt(value, 10);
                this.transportationExtraCostBuy.validateQuantityMaximum();
                break;
            case 'unitOfMeasure':
                this.transportationExtraCostBuy[attribute] = value;
                break;
            case 'unitCost':
                this.transportationExtraCostBuy[attribute] = parseFloat(value);
                /*
                if (!this.transportationExtraCostBuy.isTransportationTypeIncluded && !this.transportationExtraCostBuy.unitPrice.value) {
                    this.transportationExtraCostBuy.unitPrice.value = parseFloat(value);
                }
                */
                break;
            case 'unitPrice':
                this.transportationExtraCostBuy[attribute].value = isNaN(parseFloat(value)) ? null : parseFloat(value);
                this.transportationExtraCostBuy.validateUnitPrice();
                break;
            case 'fixedCost':
                this.transportationExtraCostBuy[attribute] = event.target.checked;
                this.transportationExtraCostBuy.isFixedCostDisabled = !event.target.checked;
                this.transportationExtraCostBuy.quantity.value = this._quoteLineItem.Quantity;
                this.transportationExtraCostBuy.quantityMaximum.value = this._quoteLineItem.Quantity_Range_Maximum__c;
                this.transportationExtraCostBuy.unitOfMeasure = event.target.checked ? '1.' : this._quoteLineItem.Unit_of_Measure__c;
                this.transportationExtraCostBuy.resetValidation();
                this.transportationExtraCostBuy.repopulateValuesIfFixedCost();
                break;
            case 'minimumBuyAt':
                this.transportationExtraCostBuy[attribute].value = isNaN(parseFloat(value)) ? null : parseFloat(value);
                break;
            case 'minimumSellAt':
                this.transportationExtraCostBuy[attribute].value = isNaN(parseFloat(value)) ? null : parseFloat(value);
                break;
            case 'lumpsumCostBuyAt':
                this.transportationExtraCostBuy[attribute].value = parseFloat(value);
                if (!this.transportationExttransportationExtraCostBuyraCostSell.lumpsumCostSellAt.disabled && !this.transportationExtraCostBuy.lumpsumCostSellAt.value) {
                    this.transportationExtraCostBuy.lumpsumCostSellAt.value = parseFloat(value);
                }
                break;
            case 'lumpsumCostSellAt':
                this.transportationExtraCostBuy[attribute].value = isNaN(parseFloat(value)) ? null : parseFloat(value);
                this.transportationExtraCostBuy.validateLumpsumCostSellAt();
                break;
            default:
                this.transportationExtraCostBuy[attribute] = value;
                break;
        }
        this.transportationExtraCostBuy.recalculate();
        this.calculateTotal();
    }

    updateAndRepopulateExtraCostValues() {
        this.extraCosts.forEach(record => {
            record.quantity.value = this.quoteLineItem.Quantity__c;
            record.quantityMaximum.value = this.quoteLineItem.IsQuantityRange__c ? this.quoteLineItem.Quantity_Range_Maximum__c : null;
            record.isQuantityRange = this.quoteLineItem.IsQuantityRange__c;
            record.isQuantityRangeDisabled = !this.quoteLineItem.IsQuantityRange__c || record.fixedCost;
            record.resetQuantityMaximumValidation();
            record.updateAndRepopulateValues();
            record.recalculate();
        });
    }

    calculateTotal() {
        let calculatedTotal = this.extraCosts.reduce((result, item) => {
            result.min = Number(result.min) + Number(item.totalCost._min);
            result.max = Number(result.max) + Number(item.totalCost._max);
            return result;
        }, { min: 0.00, max: 0.00 });
        if (this.quoteLineItem.IsQuantityRange__c) {
            calculatedTotal.min = calculatedTotal.min + this.productTotalCost.min;
            calculatedTotal.max = calculatedTotal.max + this.productTotalCost.max;
            calculatedTotal.outputValue = calculatedTotal.min.toFixed(2) + ' - ' + calculatedTotal.max.toFixed(2);
        } else {
            calculatedTotal.min = calculatedTotal.min + this.productTotalCost.min;
            calculatedTotal.max = 0.00;
            calculatedTotal.outputValue = calculatedTotal.min.toFixed(2);
        }
        if (this.transportationExtraCostBuy) {
            if (this.quoteLineItem.IsQuantityRange__c) {
                calculatedTotal.min = calculatedTotal.min + (isNaN(Number(this.transportationExtraCostBuy.totalCost._min)) ? 0.00 : Number(this.transportationExtraCostBuy.totalCost._min));
                calculatedTotal.max = calculatedTotal.max + (isNaN(Number(this.transportationExtraCostBuy.totalCost._max)) ? 0.00 : Number(this.transportationExtraCostBuy.totalCost._max));
                calculatedTotal.outputValue = calculatedTotal.min.toFixed(2) + ' - ' + calculatedTotal.max.toFixed(2);
            } else {
                calculatedTotal.min = calculatedTotal.min + (isNaN(Number(this.transportationExtraCostBuy.totalCost._min)) ? 0.00 : Number(this.transportationExtraCostBuy.totalCost._min));
                calculatedTotal.outputValue = calculatedTotal.min.toFixed(2);
            }
        }
        if (this.transportationExtraCostSell) {
            if (this.quoteLineItem.IsQuantityRange__c) {
                calculatedTotal.min = calculatedTotal.min + (isNaN(Number(this.transportationExtraCostSell.totalCost._min)) ? 0.00 : Number(this.transportationExtraCostSell.totalCost._min));
                calculatedTotal.max = calculatedTotal.max + (isNaN(Number(this.transportationExtraCostSell.totalCost._max)) ? 0.00 : Number(this.transportationExtraCostSell.totalCost._max));
                calculatedTotal.outputValue = calculatedTotal.min.toFixed(2) + ' - ' + calculatedTotal.max.toFixed(2);
            } else {
                calculatedTotal.min = calculatedTotal.min + (isNaN(Number(this.transportationExtraCostSell.totalCost._min)) ? 0.00 : Number(this.transportationExtraCostSell.totalCost._min));
                calculatedTotal.outputValue = calculatedTotal.min.toFixed(2);
            }
        }
        this.total = calculatedTotal;
    }

    get productUnitMargin() {
        let value = this.quoteLineItem.UnitPrice - this.quoteLineItem.Supplier_Unit_Price__c - this.quoteLineItem.Buyer_Broker_Commission__c - this.quoteLineItem.Supplier_Broker_Commission__c;
        return {
            value: value,
            outputValue: value.toFixed(2)
        };
    }

    get productTotalMargin() {
        let totalMargin = { min: 0.00, max: 0.00, outputValue: '' };
        if (this.quoteLineItem.IsQuantityRange__c) {
            totalMargin.min = this.quoteLineItem.Quantity * this.productUnitMargin.value;
            totalMargin.max = this.quoteLineItem.Quantity_Range_Maximum__c * this.productUnitMargin.value;
            totalMargin.outputValue = totalMargin.min.toFixed(2) + ' - ' + totalMargin.max.toFixed(2);
        } else {
            totalMargin.min = this.quoteLineItem.Quantity * this.productUnitMargin.value;
            totalMargin.max = null;
            totalMargin.outputValue = totalMargin.min.toFixed(2);
        }
        return totalMargin;
    }

    get productTotalCost() {
        let totalCost = { min: 0.00, max: 0.00, outputValue: '' };
        if (this.quoteLineItem.IsQuantityRange__c) {
            totalCost.min = Number(this.quoteLineItem.UnitPrice) * Number(this.quoteLineItem.Quantity);
            totalCost.max = Number(this.quoteLineItem.UnitPrice) * Number(this.quoteLineItem.Quantity_Range_Maximum__c);
            totalCost.outputValue = totalCost.min.toFixed(2) + ' - ' + totalCost.max.toFixed(2);
        } else {
            totalCost.min = Number(this.quoteLineItem.UnitPrice) * Number(this.quoteLineItem.Quantity);
            totalCost.max = 0.00;
            totalCost.outputValue = totalCost.min.toFixed(2);
        }
        return totalCost;
    }

    handleChange(event) {
        let id = event.target.dataset.id;
        let attribute = event.target.name;
        [...this.stemCharges, ...this.extraCosts].map(cost => {
            if (id === cost.uniqueIndex) {
                let value = event.target.value;
                switch (attribute) {
                    case 'product2Id':
                        cost[attribute] = value;
                        break;
                    case 'quantity':
                        cost[attribute].value = isNaN(parseInt(value, 10)) ? null : parseInt(value, 10);
                        cost.validateQuantity();
                        break;
                    case 'quantityMaximum':
                        cost[attribute].value = isNaN(parseInt(value, 10)) ? null : parseInt(value, 10);
                        cost.validateQuantityMaximum();
                        break;
                    case 'unitOfMeasure':
                        cost[attribute] = value;
                        break;
                    case 'unitCost':
                        cost[attribute] = parseFloat(value);
                        if (!cost.unitPrice.value) {
                            cost.unitPrice.value = parseFloat(value);
                        }
                        break;
                    case 'unitPrice':
                        cost[attribute].value = isNaN(parseFloat(value)) ? null : parseFloat(value);
                        cost.validateUnitPrice();
                        break;
                    case 'fixedCost':
                        cost[attribute] = event.target.checked;
                        cost.isFixedCostDisabled = !event.target.checked;
                        cost.quantity.value = this.quoteLineItem.Quantity__c;
                        cost.quantityMaximum.value = this.quoteLineItem.Quantity_Range_Maximum__c;
                        cost.unitOfMeasure = event.target.checked ? '1.' : this.quoteLineItem.Unit_of_Measure__c;
                        cost.resetValidation();
                        cost.repopulateValuesIfFixedCost();
                        break;
                    case 'minimumBuyAt':
                        cost[attribute].value = isNaN(parseFloat(value)) ? null : parseFloat(value);
                        break;
                    case 'minimumSellAt':
                        cost[attribute].value = isNaN(parseFloat(value)) ? null : parseFloat(value);
                        break;
                    case 'lumpsumCostBuyAt':
                        cost[attribute].value = parseFloat(value);
                        if (!cost.lumpsumCostSellAt.value) {
                            cost.lumpsumCostSellAt.value = parseFloat(value);
                        }
                        break;
                    case 'lumpsumCostSellAt':
                        cost[attribute].value = isNaN(parseFloat(value)) ? null : parseFloat(value);
                        cost.validateLumpsumCostSellAt();
                        break;
                    default:
                        cost[attribute] = value;
                        break;
                }
                cost.recalculate();
            }
        });
        this.calculateTotal();
    }

    removeExtraCostLine(event) {
        let uniqueId = event.target.dataset.id;

        let stemChargeIndex = this.stemCharges.findIndex(record => record.uniqueIndex === uniqueId);
        let extraCostIndex = this.extraCosts.findIndex(record => record.uniqueIndex === uniqueId);

        if (stemChargeIndex !== -1) {
            this.stemCharges.splice(stemChargeIndex, 1);
        } else if (extraCostIndex !== -1) {
            this.extraCosts.splice(extraCostIndex, 1);
        }

        let deletedRecord = stemChargeIndex !== -1 ? this.stemCharges[stemChargeIndex] : this.extraCosts[extraCostIndex];
        if (deletedRecord && deletedRecord.id) {
            this.extraCostsToDelete.push(deletedRecord.id);
        }

        this.calculateTotal();
    }

    addNewStemCharge(){
        this.addExtraCostLine(null, true);
    }

    addNewTableLine() {
        this.addExtraCostLine(null, false);
    }

    addExtraCostLine(record, isExtraCharge) {
        let row = {
            id: record?.Id,
            uniqueIndex: this.makeId(5),
            product2Id: record ? record.Product__c : this.extraCostProducts[0].value,
            product2Name: record ? record.Product__r.Name : '',
            quantity: {
                value: record?.Quantity__c ? record.Quantity__c : 1.00,
                className: 'slds-input'
            },
            isQuantityRange: this.quoteLineItem.IsQuantityRange__c,
            isQuantityRangeDisabled: !this.quoteLineItem.IsQuantityRange__c || (record ? record.Fixed__c : false),
            quantityMaximum: {
                value: record?.Quantity_Range_Maximum__c ? record.Quantity_Range_Maximum__c : this.quoteLineItem.IsQuantityRange__c && !record?.Fixed__c ? this.quoteLineItem.Quantity_Range_Maximum__c : null,
                className: 'slds-input'
            },
            unitCost: record ? record.Unit_Cost__c : null,
            unitPrice: {
                value: record ? record.Unit_Cost__c : null,
                className: 'slds-input'
            },
            unitOfMeasure: record ? record.Unit_of_Measure__c : '1.',
            fixedCost: record ? record.Fixed__c : true,
            isFixedCostDisabled: record ? !record.Fixed__c : false,
            disableFixed: false,
            minimumBuyAt: {
                value: record && record.Minimum__c ? record.Minimum__c : null,
                className: 'slds-input'
            },
            minimumSellAt: {
                value: record && record.Minimum__c ? record.Minimum__c : null,
                className: 'slds-input'
            },
            lumpsumCostBuyAt: {
                value: record && record.Lumpsum_Cost__c ? record.Lumpsum_Cost__c : null,
                className: 'slds-input'
            },
            lumpsumCostSellAt: {
                value: record && record.Lumpsum_Cost__c ? record.Lumpsum_Cost__c : null,
                className: 'slds-input'
            },
            unitMargin: {
                _min: 0.00,
                _max: 0.00,
                outputValue: ''
            },
            totalMargin: {
                _min: 0.00,
                _max: 0.00,
                outputValue: ''
            },
            hasMinimum: false,
            totalCost: {
                _min: 0.00,
                _max: 0.00,
                outputValue: ''
            },
            stemCharge: isExtraCharge,
            recalculate() {
                this.recalculateUnitMargin();
                this.recalculateTotalMargin();
                this.recalculateTotalCost();
            },

            recalculateUnitMargin() {
                if (this.fixedCost) {
                    this.unitMargin = {
                        _min: isNaN(this.lumpsumCostSellAt.value - this.lumpsumCostBuyAt.value) ? 0.00 : this.lumpsumCostSellAt.value - this.lumpsumCostBuyAt.value,
                        _max: 0.00,
                        outputValue: isNaN(this.lumpsumCostSellAt.value - this.lumpsumCostBuyAt.value) ? 0.00 : Number(this.lumpsumCostSellAt.value - this.lumpsumCostBuyAt.value).toFixed(2)
                    };
                }
            },

            recalculateTotalMargin() {
                let unitCost = this.unitCost != null && !isNaN(this.unitCost) ? this.unitCost : 0.00;
                let unitPrice = this.unitPrice.value != null && !isNaN(this.unitPrice.value) ? this.unitPrice.value : 0.00;
                if (this.fixedCost) {
                    this.totalMargin = {
                        _min: this.quantity.value * this.unitMargin._min,
                        _max: null,
                        outputValue: (this.quantity.value * this.unitMargin._min).toFixed(2)
                    };
                } else {
                    if (this.isQuantityRange) {
                        let maxBuyAt, maxSellAt = 0.0;
                        maxBuyAt = isNaN(Math.max(this.minimumBuyAt.value, this.quantity.value * unitCost)) ? 0.00 : Math.max(this.minimumBuyAt.value, this.quantity.value * unitCost);
                        maxSellAt = isNaN(Math.max(this.minimumSellAt.value, this.quantity.value * unitPrice)) ? 0.00 : Math.max(this.minimumSellAt.value, this.quantity.value * unitPrice);
                        let minTotalMargin = maxSellAt - maxBuyAt;
                        let minUnitMargin = this.quantityMaximum.value == null
                                            || isNaN(minTotalMargin / this.quantityMaximum.value)
                                            || !isFinite(minTotalMargin / this.quantityMaximum.value)
                                                ? 0 : (minTotalMargin / this.quantityMaximum.value).toFixed(2);

                        let secMaxBuyAt, secMaxSellAt = 0.00;
                        secMaxBuyAt = isNaN(Math.max(this.minimumBuyAt.value, this.quantityMaximum.value * unitCost)) ? 0.00 : Math.max(this.minimumBuyAt.value, this.quantityMaximum.value * unitCost);
                        secMaxSellAt = isNaN(Math.max(this.minimumSellAt.value, this.quantityMaximum.value * unitPrice)) ? 0.00 : Math.max(this.minimumSellAt.value, this.quantityMaximum.value * unitPrice);
                        let secMinTotalMargin = secMaxSellAt - secMaxBuyAt;
                        let secMinUnitMargin = !this.quantityMaximum.value
                                               || isNaN(secMinTotalMargin / this.quantityMaximum.value)
                                               || !isFinite(secMinTotalMargin / this.quantityMaximum.value)
                                                   ? 0 : (secMinTotalMargin / this.quantityMaximum.value).toFixed(2);

                        this.unitMargin = {
                            _min: minUnitMargin,
                            _max: secMinUnitMargin,
                            outputValue: minUnitMargin + ' - ' + secMinUnitMargin
                        };

                        this.totalMargin = {
                            _min: minTotalMargin,
                            _max: secMinTotalMargin,
                            outputValue: minTotalMargin.toFixed(2) + ' - ' + secMinTotalMargin.toFixed(2)
                        };
                    } else {
                        let maxBuyAt, maxSellAt = 0.00;
                        maxBuyAt = isNaN(Math.max(this.minimumBuyAt.value, this.quantity.value * unitCost)) ? 0.00 : Math.max(this.minimumBuyAt.value, this.quantity.value * unitCost);
                        maxSellAt = isNaN(Math.max(this.minimumSellAt.value, this.quantity.value * unitPrice)) ? 0.00 : Math.max(this.minimumSellAt.value, this.quantity.value * unitPrice);
                        let minTotalMargin = maxSellAt - maxBuyAt;
                        let minUnitMargin = !this.quantity.value
                                            || isNaN(minTotalMargin / this.quantity.value)
                                            || !isFinite(minTotalMargin / this.quantity.value)
                                                ? 0.00 : (minTotalMargin / this.quantity.value).toFixed(2);
                        this.unitMargin = { _min: minUnitMargin, _max: 0.00, outputValue: minUnitMargin };
                        this.totalMargin = {
                            _min: minTotalMargin,
                            _max: null,
                            outputValue: minTotalMargin.toFixed(2)
                        };
                    }
                }
            },

            recalculateTotalCost() {
                if (this.fixedCost) {
                    let price = this.lumpsumCostSellAt.value;
                    this.totalCost = {
                        _min: price * this.quantity.value,
                        _max: price * this.quantity.value,
                        outputValue: (price * this.quantity.value).toFixed(2)
                    };
                } else {
                    let price = this.unitPrice.value;
                    if (this.isQuantityRange) {
                        if (this.minimumSellAt.value != null) {
                            this.totalCost = {
                                _min: Math.max(price * this.quantity.value, this.minimumSellAt.value),
                                _max: Math.max(price * this.quantityMaximum.value, this.minimumSellAt.value),
                                outputValue: Math.max(price * this.quantity.value, this.minimumSellAt.value)
                                                 .toFixed(2)
                                             + ' - '
                                             + Math.max(price * this.quantityMaximum.value, this.minimumSellAt.value)
                                                   .toFixed(2)
                            };
                        } else {
                            this.totalCost = {
                                _min: isNaN(price * this.quantity.value) ? 0.00 : price * this.quantity.value,
                                _max: isNaN(price * this.quantityMaximum.value) ? 0.00 : price * this.quantityMaximum.value,
                                outputValue: (isNaN(price * this.quantity.value) ? 0.00 : (price * this.quantity.value).toFixed(2))
                                             + ' - '
                                             + (isNaN(price * this.quantityMaximum.value) ? 0.00: (price * this.quantityMaximum.value).toFixed(2))
                            };
                        }
                    } else {
                        if (this.minimumSellAt.value != null) {
                            this.totalCost = {
                                _min: Math.max(price * this.quantity.value, this.minimumSellAt.value),
                                _max: 0.00,
                                outputValue: Math.max(price * this.quantity.value, this.minimumSellAt.value).toFixed(2)
                            };
                        } else {
                            this.totalCost = {
                                _min: price * this.quantity.value,
                                _max: 0.00,
                                outputValue: (price * this.quantity.value).toFixed(2)
                            };
                        }
                    }
                }
            },

            updateAndRepopulateValues() {
                this.repopulateValuesIfQuantityRange();
                this.repopulateValuesIfFixedCost();
            },

            repopulateValuesIfQuantityRange() {
                if (!this.isQuantityRange) {
                    this.quantityMaximum.value = null;
                }
            },

            repopulateValuesIfFixedCost() {
                if (this.fixedCost) {
                    this.unitCost = null;
                    this.unitPrice.value = null;
                    this.minimumBuyAt.value = null;
                    this.minimumSellAt.value = null;
                    this.quantity.value = 1.00;
                    this.quantityMaximum.value = null;
                    this.isQuantityRangeDisabled = true;
                    this.unitOfMeasure = '1.';
                } else {
                    this.lumpsumCostBuyAt.value = null;
                    this.lumpsumCostSellAt.value = null;
                    this.isQuantityRangeDisabled = !this.isQuantityRange;
                }
            },

            revalidateFields() {
                this.resetValidation();
                this.validateFields();
            },

            resetValidation() {
                this.quantity.className = 'slds-input';
                this.resetQuantityMaximumValidation();
                this.unitPrice.className = 'slds-input';
                this.minimumBuyAt.className = 'slds-input';
                this.minimumSellAt.className = 'slds-input';
                this.lumpsumCostSellAt.className = 'slds-input';
            },

            resetQuantityMaximumValidation() {
                this.quantityMaximum.className = 'slds-input';
            },

            validateFields() {
                this.validateQuantity();
                this.validateQuantityMaximum();
                this.validateUnitPrice();
                this.validateLumpsumCostSellAt();
            },

            validateQuantity() {
                this.quantity.className = !this.fixedCost && this.quantity.value == null
                    ? 'slds-input slds-has-error' : 'slds-input';
            },

            validateQuantityMaximum() {
                this.quantityMaximum.className = !this.fixedCost && this.isQuantityRange && this.quantityMaximum.value == null
                    ? 'slds-input slds-has-error' : 'slds-input ';
            },

            validateUnitPrice() {
                this.unitPrice.className = !this.fixedCost && this.unitPrice.value == null
                    ? 'slds-input slds-has-error' : 'slds-input';
            },

            validateLumpsumCostSellAt() {
                this.lumpsumCostSellAt.className = this.fixedCost && this.lumpsumCostSellAt.value == null
                    ? 'slds-input slds-has-error' : 'slds-input';
            }

        };
        if(row.stemCharge){
            this.stemCharges.push(row);
        }else{
            this.extraCosts.push(row);
        }
        return row;
    }

    makeId(length) {
        let result = '';
        let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let charactersLength = characters.length;
        for (let i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
        }
        return result;
    }

    @api
    isExtraCostTableValid() {
        this.extraCosts.forEach(record => {
            record.revalidateFields();
        });
        let isValid = this.extraCosts.every(record => {
            return !(record.quantity.className.includes('slds-has-error') ||
                record.quantityMaximum.className.includes('slds-has-error') ||
                record.unitPrice.className.includes('slds-has-error') ||
                record.minimumBuyAt.className.includes('slds-has-error') ||
                record.minimumSellAt.className.includes('slds-has-error') ||
                record.lumpsumCostSellAt.className.includes('slds-has-error'));
        });
        if (this.transportationExtraCostSell) {
            this.transportationExtraCostSell.revalidateFields();
            isValid = isValid && !(this.transportationExtraCostSell.quantity.className.includes('slds-has-error') ||
                                   this.transportationExtraCostSell.quantityMaximum.className.includes('slds-has-error') ||
                                   this.transportationExtraCostSell.lumpsumCostSellAt.className.includes('slds-has-error') ||
                                   this.transportationExtraCostSell.unitPrice.className.includes('slds-has-error') ||
                                   this.transportationExtraCostSell.minimumSellAt.className.includes('slds-has-error') ||
                                   this.transportationExtraCostSell.minimumBuyAt.className.includes('slds-has-error'));
        }
        if (this.transportationExtraCostBuy) {
            this.transportationExtraCostBuy.revalidateFields();
            isValid = isValid && !(this.transportationExtraCostBuy.quantity.className.includes('slds-has-error') ||
                                   this.transportationExtraCostBuy.quantityMaximum.className.includes('slds-has-error') ||
                                   this.transportationExtraCostBuy.unitPrice.className.includes('slds-has-error') ||
                                   this.transportationExtraCostBuy.minimumSellAt.className.includes('slds-has-error') ||
                                   this.transportationExtraCostBuy.minimumBuyAt.className.includes('slds-has-error'));
        }
        return isValid;
    }

    _assignDateTimeFields(source, target) {
        target.ETA_Start_Date__c = source.ETA_Start_Date__c;
        target.ETA_Start_Time__c = source.ETA_Start_Time__c;
        target.ETA_End_Date__c = source.ETA_End_Date__c;
        target.ETA_End_Time__c = source.ETA_End_Time__c;
        target.ETB_Start_Date__c = source.ETB_Start_Date__c;
        target.ETB_Start_Time__c = source.ETB_Start_Time__c;
        target.ETB_End_Date__c = source.ETB_End_Date__c;
        target.ETB_End_Time__c = source.ETB_End_Time__c;
        target.ETD_Start_Date__c = source.ETD_Start_Date__c;
        target.ETD_Start_Time__c = source.ETD_Start_Time__c;
        target.ETD_End_Date__c = source.ETD_End_Date__c;
        target.ETD_End_Time__c = source.ETD_End_Time__c;
        target.ETCD_Start_Date__c = source.ETCD_Start_Date__c;
        target.ETCD_Start_Time__c = source.ETCD_Start_Time__c;
        target.ETCD_End_Date__c = source.ETCD_End_Date__c;
        target.ETCD_End_Time__c = source.ETCD_End_Time__c;
        return target;
      }

    @api
    async upsertExtraCosts(productLineItemId, quoteId, buyerPaymentTerm, supplierPaymentTerm) {
        try {
            let extraCostsToInsert = [];
            if (this.extraCosts.length !== 0 || this.stemCharges.length !== 0) {
                [...this.stemCharges, ...this.extraCosts].forEach(value => {
                    if (!this.supplierBidIds.includes(value.id)) {
                        let fields = {};
                        //fields['Id'] = value.id;
                        fields['Product2Id'] = value.product2Id;
                        fields['Quantity'] = value.quantity.value;
                        fields['IsQuantityRange__c'] = this.quoteLineItem.IsQuantityRange__c;
                        fields['Quantity_Range_Maximum__c'] = value.quantityMaximum.value;
                        fields['Supplier_Unit_Price__c'] = value.unitCost;
                        fields['UnitPrice'] = value.fixedCost ? 0.00 : value.unitPrice.value;
                        fields['Lumpsum_Buy_At__c'] = value.lumpsumCostBuyAt.value;
                        fields['Lumpsum_Sell_At__c'] = value.lumpsumCostSellAt.value;
                        fields['Minimum_Buy_At__c'] = value.minimumBuyAt.value;
                        fields['Minimum_Sell_At__c'] = value.minimumSellAt.value;
                        fields['Fixed__c'] = value.fixedCost;
                        fields['Unit_of_Measure__c'] = value.unitOfMeasure;
                        fields['Product_Line_Item__c'] = value.stemCharge ? null : productLineItemId;
                        fields['QuoteId'] = quoteId;
                        fields['Opportunity_Line_Item__c'] = this.quoteLineItem.Opportunity_Line_Item__c;
                        fields['ETA_ETB__c'] = this.quoteLineItem.Opportunity_Line_Item__r.ETA_ETB__c;
                        fields['Expected_Delivery_Date__c'] = this.quoteLineItem.Expected_Delivery_Date__c;
                        fields['Supplier__c'] = this.quoteLineItem.Supplier__c;
                        fields['Port__c'] = this.quoteLineItem.Port__c;
                        fields['Buyer_Payment_Term__c'] = buyerPaymentTerm;
                        fields['Supplier_Payment_Term__c'] = supplierPaymentTerm;
                        fields['STEM_Extra_Charge__c'] = value.stemCharge;
                        if (value.stemCharge) {
                            fields['Supplier_Bid_Extra_Cost__c'] = value.id;
                            fields = this._assignDateTimeFields(this.enquiryLineItem, fields);
                        }
                        fields['sobjectType'] = QUOTE_LINE_ITEM.objectApiName;
                        extraCostsToInsert.push(fields);
                    }
                });
            }
            this.transportationExtraCostBuy.type = 'Buy';
            this.transportationExtraCostSell.type = 'Sell'
            let transportationExtraCosts = [this.transportationExtraCostSell, this.transportationExtraCostBuy];
            transportationExtraCosts.forEach((transportationExtraCost) => {
                if (transportationExtraCost) {
                    let fields = {};
                    fields['Product2Id'] = transportationExtraCost.product2Id;
                    fields['Quantity'] = transportationExtraCost.quantity.value;
                    fields['IsQuantityRange__c'] = this.quoteLineItem.IsQuantityRange__c;
                    fields['Quantity_Range_Maximum__c'] = transportationExtraCost.quantityMaximum.value;
                    fields['Supplier_Unit_Price__c'] = transportationExtraCost.unitCost;
                    fields['UnitPrice'] = !transportationExtraCost.unitPrice.value ? 0.00 : transportationExtraCost.unitPrice.value;
                    fields['Lumpsum_Buy_At__c'] = transportationExtraCost.lumpsumCostBuyAt.value;
                    fields['Lumpsum_Sell_At__c'] = transportationExtraCost.lumpsumCostSellAt.value;
                    fields['Minimum_Buy_At__c'] = transportationExtraCost.minimumBuyAt.value;
                    fields['Minimum_Sell_At__c'] = transportationExtraCost.minimumSellAt.value;
                    fields['Fixed__c'] = transportationExtraCost.fixedCost;
                    fields['Unit_of_Measure__c'] = transportationExtraCost.unitOfMeasure;
                    fields['Product_Line_Item__c'] = productLineItemId;
                    fields['QuoteId'] = quoteId;
                    fields['Opportunity_Line_Item__c'] = this.quoteLineItem.Opportunity_Line_Item__c;
                    fields['ETA_ETB__c'] = this.quoteLineItem.Opportunity_Line_Item__r.ETA_ETB__c;
                    fields['Expected_Delivery_Date__c'] = this.quoteLineItem.Expected_Delivery_Date__c;
                    fields['Supplier__c'] = this.quoteLineItem.Supplier__c;
                    fields['Port__c'] = this.quoteLineItem.Port__c;
                    fields['Buyer_Payment_Term__c'] = buyerPaymentTerm;
                    fields['Supplier_Payment_Term__c'] = supplierPaymentTerm;
                    fields['Nundination_Type__c'] = transportationExtraCost.type;
                    fields['sobjectType'] = QUOTE_LINE_ITEM.objectApiName;
                    extraCostsToInsert.push(fields);
                }
            })
            return upsertProductExtraCosts({ quoteLineItemExtraCosts: extraCostsToInsert , quoteId: quoteId});
        } catch (error) {
            console.error(error)
        }
        
    }

    @api
    async removeExtraCosts() {
        return Promise.all(this.extraCostsToDelete.map(recordId => deleteRecord(recordId)));
    }
}