import {LightningElement, api, track} from 'lwc';
import loadExtraCostProducts from '@salesforce/apex/SupplierBidManagerController.loadExtraCostProducts';
import getUnitOfMeasurePickListValues
    from '@salesforce/apex/SupplierBidManagerController.getUnitOfMeasurePickListValues';
import upsertProductExtraCosts from '@salesforce/apex/SupplierBidManagerController.upsertProductExtraCosts';
import getSTEMCharges from '@salesforce/apex/SupplierBidManagerController.getSTEMCharges';
import SUPPLIER_BID_EXTRA_COST from '@salesforce/schema/Supplier_Bid_Extra_Cost__c';
import {deleteRecord} from 'lightning/uiRecordApi';

/**
 *
 */
export default class FcbSupplierBidExtraCosts extends LightningElement {
    @track _supplierBids;
    @track _stemCharges;
    @api enquiryId;
    @api quoteId;
    @track extraCostProducts;
    @track extraCosts = [];
    @track extraCostsToDelete = [];
    @track unitOfMeasureOptions;
    @track transportationExtraCost;
    @track transportationProducts = [];
    @track transportationOptions;
    @track stemCharges = [];
    @api supplierBids;

    // get supplierBids() {
    //     if (!this._supplierBids) {
    //         //this._supplierBid = {ProductName: ''};
    //         return  this._supplierBids;
    //     }
    //     return this._supplierBids;
    // }

    // @api
    // set supplierBids(value) {
    //     this._supplierBids = value;
    //     if (value) {
    //         value.forEach(supplierBid => {
    //             supplierBid = this.redefineStringFieldsFromRecordWithNumberValues(supplierBid);
    //             if (supplierBid.Transportation_Type_Buy__c) {
    //                 if (supplierBid.transportationExtraCost){
    //                     this._repopulateValuesOnTransportationExtraCostRow(supplierBid);
    //                 } else {
    //                     supplierBid = { ...supplierBid, transportationExtraCost: {} };
    //                     this._addTransportationExtraCost(null, supplierBid);
    //                 }
    //             } else {
    //                 if (supplierBid.transportationExtraCost?.id){
    //                     this.extraCostsToDelete.push(supplierBid.transportationExtraCost.id);
    //                 }
    //                 this._removeTransportationExtraCost();
    //             }
    //         });
    //         this.updateAndRepopulateExtraCostValues();
    //     }
    //     this._supplierBids = value;
    // }

    @api
    refreshData(values, reset) {
        try {
            if(reset){
               this._supplierBids = values;
            }
            values.forEach(value => {
                let supplierBid = this._supplierBids.find(bid => bid.Id === value.Id);
                for (const prop in value) {
                    if (prop !== 'transportationExtraCost' && prop !== 'extraCosts') {
                        supplierBid[prop] = value[prop];
                    }
                }
            });

            this._supplierBids.forEach((supplierBid) => {
                if(values.find(value => value.Id === supplierBid.Id)){
                    if (supplierBid.transportationExtraCost.id) {
                        this._repopulateValuesOnTransportationExtraCostRow(supplierBid);
                    } else if(supplierBid.transportationChanged || !supplierBid.transportationExtraCost.fixedCost){
                        this._addTransportationExtraCost(null, supplierBid);
                        supplierBid.transportationExtraCost.updateAndRepopulateValues();
                    }
                }
                this.updateAndRepopulateExtraCostValues(supplierBid);
            })
        } catch (error) {
            console.error(error)
        }

    }

    _addTransportationExtraCost(record, supplierBid) {
        let product = this._getTransportationProductByTransportationType(supplierBid);
        let result = {
            id: record?.Id ? record?.Id : '',
            product2Id: product?.Id,
            isTransportationTypeIncluded: product?.Name?.includes('Included'),
            productName: product?.Name,
            quantity: {
                value: record ? record.Quantity__c : supplierBid.Quantity__c,
                className: 'slds-input'
            },
            isQuantityRange: supplierBid.IsQuantityRange__c,
            isQuantityRangeDisabled: !supplierBid.IsQuantityRange__c,
            quantityMaximum: {
                value: record ? record.Quantity_Range_Maximum__c : supplierBid.Quantity_Range_Maximum__c,
                className: 'slds-input'
            },
            unitCost: {
                value: record ? record.Unit_Cost__c : null,
                className: 'slds-input',
                disabled: product?.Name?.includes('Included') ? true : record ? Boolean(record?.Fixed__c) : true
            },
            unitOfMeasure: product?.Name?.includes('Included') || record?.Fixed__c ? '1.' : record?.Unit_of_Measure__c ? record.Unit_of_Measure__c : supplierBid.Unit_of_Measure__c,
            fixedCost: product?.Name?.includes('Included') ? true : record ? record.Fixed__c : true,
            isFixedCostDisabled: product?.Name?.includes('Included') ? true : record ? !record.Fixed__c : false,
            disableFixed: false,
            minimumBuyAt: {
                value: record?.Minimum__c,
                className: 'slds-input',
                disabled: product?.Name?.includes('Included') ? true : record ? Boolean(record?.Fixed__c) : true
            },
            lumpsumCostBuyAt: {
                value: record?.Lumpsum_Cost__c,
                className: 'slds-input',
                disabled: product?.Name?.includes('Included')
            },
            updateAndRepopulateValues() {
                this.repopulateValuesIfQuantityRange();
                this.repopulateValuesIfFixedCost(record);
            },
            repopulateValuesIfQuantityRange() {
                if (!this.isQuantityRange) {
                    this.quantityMaximum.value = null;
                }
            },
            repopulateValuesIfFixedCost() {
                try {
                    if (this.fixedCost) {
                        this.unitCost.value = null;
                        this.minimumBuyAt.value = null;
                        this.quantity.value = 1.0;
                        this.quantityMaximum.value = null;
                        this.isQuantityRange = false;
                        this.isQuantityRangeDisabled = true;
                        this.unitOfMeasure = '1.';
                    } else {
                        this.lumpsumCostBuyAt.value = null;
                        this.isQuantityRangeDisabled = !this.isQuantityRange;
                    }
                } catch (error) {
                    console.error(error)
                }

            },

            revalidateFields() {
                this.resetValidation();
                this.validateFields();
            },

            resetValidation() {
                this.quantity.className = 'slds-input';
                this.resetQuantityMaximumValidation();
                this.minimumBuyAt.className = 'slds-input';
                this.unitCost.className = 'slds-input';
            },

            resetQuantityMaximumValidation() {
                this.quantityMaximum.className = 'slds-input';
            },

            validateFields() {
                this.validateQuantity();
                this.validateQuantityMaximum();
                console.log(this.quantity);

                console.log(this.isTransportationTypeIncluded);

                if (!this.isTransportationTypeIncluded) {
                    this.validateLumpsumCostBuyAt();
                    this.validateUnitCost();
                }
            },

            validateQuantity() {
                this.quantity.className = !this.fixedCost && this.quantity.value == null
                  ? 'slds-input slds-has-error' : 'slds-input';
            },

            validateQuantityMaximum() {
                this.quantityMaximum.className = !this.fixedCost && this.isQuantityRange && this.quantityMaximum.value == null
                  ? 'slds-input slds-has-error' : 'slds-input ';
            },

            validateLumpsumCostBuyAt() {
                this.lumpsumCostBuyAt.className = this.fixedCost && this.lumpsumCostBuyAt.value == null
                  ? 'slds-input slds-has-error' : 'slds-input ';
            },

            validateUnitCost() {
                this.unitCost.className = !this.fixedCost && !this.isTransportationTypeIncluded && (!this.unitCost.value && this.unitCost.value !== 0)
                  ? 'slds-input slds-has-error' : 'slds-input ';
            }
        };
        supplierBid.transportationExtraCost = result;
    }

    _removeTransportationExtraCost() {
        this.transportationExtraCost = null;
    }

    _repopulateValuesOnTransportationExtraCostRow(supplierBid) {
        try {
            let product = this._getTransportationProductByTransportationType(supplierBid);
            supplierBid.transportationExtraCost.product2Id = product.Id;
            supplierBid.transportationExtraCost.productName = product.Name;
            supplierBid.transportationExtraCost.isTransportationTypeIncluded = product?.Name?.includes('Included');
            if (product?.Name?.includes('Included')) {
                supplierBid.transportationExtraCost.fixedCost = true;
                supplierBid.transportationExtraCost.unitCost.value = 1.00;
                supplierBid.transportationExtraCost.minimumBuyAt.value = null;
                supplierBid.transportationExtraCost.isFixedCostDisabled = true;
            } else if(supplierBid.transportationChanged){
                supplierBid.transportationExtraCost.fixedCost = true;
                supplierBid.transportationExtraCost.isFixedCostDisabled = false;
            }
            if(!supplierBid.transportationExtraCost.fixedCost){
                supplierBid.transportationExtraCost.quantity.value = supplierBid.Quantity__c;
                supplierBid.transportationExtraCost.isQuantityRange = supplierBid.IsQuantityRange__c;
                supplierBid.transportationExtraCost.isQuantityRangeDisabled = !supplierBid.IsQuantityRange__c || supplierBid.transportationExtraCost.fixedCost;
                supplierBid.transportationExtraCost.quantityMaximum.value = supplierBid.IsQuantityRange__c && !supplierBid.transportationExtraCost.fixedCost ? supplierBid.Quantity_Range_Maximum__c : null;
            }
            supplierBid.transportationExtraCost.unitOfMeasure = supplierBid.transportationExtraCost.fixedCost ? '1.' : supplierBid.Unit_of_Measure__c;
            supplierBid.transportationExtraCost.unitCost.disabled = product?.Name?.includes('Included') || supplierBid.transportationExtraCost.fixedCost;
            supplierBid.transportationExtraCost.minimumBuyAt.disabled = product?.Name?.includes('Included') || supplierBid.transportationExtraCost.fixedCost;
            supplierBid.transportationExtraCost.lumpsumCostBuyAt.value = supplierBid.transportationExtraCost.isTransportationTypeIncluded ? null : supplierBid.transportationExtraCost.lumpsumCostBuyAt.value;
            supplierBid.transportationExtraCost.lumpsumCostBuyAt.disabled = !supplierBid.transportationExtraCost.fixedCost;
            console.log(supplierBid.transportationExtraCost.unitOfMeasure);

            supplierBid.transportationExtraCost.resetQuantityMaximumValidation();
            supplierBid.transportationExtraCost.updateAndRepopulateValues();
        } catch (error) {
            console.error(error)
        }

    }

    _getTransportationProductByTransportationType(supplierBid) {
        let transportationProduct;
        if (supplierBid.Transportation_Type_Buy__c === 'Barge (Excluded)') {
            transportationProduct = this.transportationProducts.find(product => product.Name === 'Transport (Barge)');
        } else if (supplierBid.Transportation_Type_Buy__c === 'Barge (Included)') {
            transportationProduct = this.transportationProducts.find(product => product.Name === 'Transport (Barge Included)');
        } else if (supplierBid.Transportation_Type_Buy__c === 'Truck (Excluded)') {
            transportationProduct = this.transportationProducts.find(product => product.Name === 'Transport (Truck)');
        } else if (supplierBid.Transportation_Type_Buy__c === 'Truck (Included)') {
            transportationProduct = this.transportationProducts.find(product => product.Name === 'Transport (Truck Included)');
        } else if (supplierBid.Transportation_Type_Buy__c === 'Barge or Truck (Included)') {
            transportationProduct = this.transportationProducts.find(product => product.Name === 'Transport (Barge or Truck Included)');
        } else if (supplierBid.Transportation_Type_Buy__c === 'Pipeline (Included)') {
            transportationProduct = this.transportationProducts.find(product => product.Name === 'Transport (Pipeline Included)');
        } else {
            transportationProduct = this.transportationProducts.find(product => product.Name === 'Transport (Unknown)');
        }
        return transportationProduct;
    }

    _getTransportationTypeByTransportationProduct(transportationProduct) {
        let transportationType;
        if (transportationProduct === 'Transport (Barge)') {
            transportationType = 'Barge (Excluded)';
        } else if (transportationProduct === 'Transport (Barge Included)') {
            transportationType = 'Barge (Included)';
        } else if (transportationProduct === 'Transport (Truck)') {
            transportationType = 'Truck (Excluded)';
        } else if (transportationProduct === 'Transport (Truck Included)') {
            transportationType = 'Truck (Included)';
        } else if (transportationProduct === 'Transport (Barge or Truck Included)') {
            transportationType = 'Barge or Truck (Included)';
        } else if (transportationProduct === 'Transport (Pipeline Included)') {
            transportationType = 'Pipeline (Included)';
        } else {
            transportationType = 'Unknown';
        }
        return transportationType;
    }

    handleTransportationExtraCostChange(event) {
        try {
            let attribute = event.target.name;
            let value = event.target.value;
            let supplierBid = this._supplierBids.find(sb => sb.Id === event.target.dataset.supplierBidId);
            switch (attribute) {
                case 'product2Id':
                    supplierBid.transportationExtraCost[attribute] = value;
                    break;
                case 'quantity':
                    supplierBid.transportationExtraCost[attribute].value = isNaN(parseInt(value, 10)) ? null : parseInt(value, 10);
                    supplierBid.transportationExtraCost.validateQuantity();
                    break;
                case 'quantityMaximum':
                    supplierBid.transportationExtraCost[attribute].value = isNaN(parseInt(value, 10)) ? null : parseInt(value, 10);
                    supplierBid.transportationExtraCost.validateQuantityMaximum();
                    break;
                case 'unitOfMeasure':
                    supplierBid.transportationExtraCost[attribute] = value;
                    break;
                case 'unitCost':
                    supplierBid.transportationExtraCost[attribute].value = parseFloat(value);
                    break;
                case 'fixedCost':
                    supplierBid.transportationExtraCost[attribute] = event.target.checked;
                    supplierBid.transportationExtraCost.isFixedCostDisabled = !event.target.checked;
                    supplierBid.transportationExtraCost.quantity.value = supplierBid.transportationExtraCost.fixedCost ? '1' : supplierBid.Quantity__c;
                    supplierBid.transportationExtraCost.isQuantityRange = supplierBid.IsQuantityRange__c;
                    supplierBid.transportationExtraCost.quantityMaximum.value = !supplierBid.transportationExtraCost.fixedCost && supplierBid.transportationExtraCost.isQuantityRange ? supplierBid.Quantity_Range_Maximum__c : null;
                    supplierBid.transportationExtraCost.unitOfMeasure = event.target.checked ? '1.' : supplierBid.Unit_of_Measure__c;
                    supplierBid.transportationExtraCost.unitCost.disabled = supplierBid.transportationExtraCost.isTransportationTypeIncluded || supplierBid.transportationExtraCost.fixedCost;
                    supplierBid.transportationExtraCost.minimumBuyAt.disabled = supplierBid.transportationExtraCost.isTransportationTypeIncluded || supplierBid.transportationExtraCost.fixedCost;
                    supplierBid.transportationExtraCost.lumpsumCostBuyAt.disabled = supplierBid.transportationExtraCost.isTransportationTypeIncluded || !supplierBid.transportationExtraCost.fixedCost;
                    supplierBid.transportationExtraCost.resetValidation();
                    supplierBid.transportationExtraCost.repopulateValuesIfFixedCost();
                    break;
                case 'minimumBuyAt':
                    supplierBid.transportationExtraCost[attribute].value = isNaN(parseFloat(value)) ? null : parseFloat(value);
                    break;
                case 'lumpsumCostBuyAt':
                    supplierBid.transportationExtraCost[attribute].value = parseFloat(value);
                    break;
                default:
                    supplierBid.transportationExtraCost[attribute] = value;
                    break;
            }
        } catch (error) {
            console.error(error)
        }
    }

    handleChangeBDNCompany(event){
        this._supplierBids.find(bid => bid.Id === event.target.dataset.id).BDN_Company__c = event.target.value;
        this.dispatchEvent(
            new CustomEvent("changecompany", {
              detail: {
                supplierBidId: event.target.dataset.id,
                value: event.target.value
              }
            })
        );
    }

    handleChangePrice(event){
        try {
            let foundSupplierBid = this._supplierBids.find(bid => bid.Id === event.target.dataset.id);
            foundSupplierBid[event.target.name] = event.target.value;
            this.dispatchEvent(
                new CustomEvent("changeprice", {
                  detail: {
                    supplierBidId: event.target.dataset.id,
                    value: event.target.value,
                    name: event.target.name
                  }
                })
            );
        } catch (error) {
            console.error(error)
        }

    }

    handleChangeQuantity(event){
        let foundSupplierBid = this._supplierBids.find(bid => bid.Id === event.target.dataset.id);
        if(event.target.name === 'IsQuantityRange__c'){
            foundSupplierBid[event.target.name] = event.target.checked;
            foundSupplierBid.isQuantityRangeDisabled = !event.target.checked;
            if(!event.target.checked){
                foundSupplierBid.Quantity_Range_Maximum__c = null;
            }
        } else{
            foundSupplierBid[event.target.name] = event.target.value;
        }
        this.dispatchEvent(
            new CustomEvent("changequantity", {
              detail: {
                supplierBidId: event.target.dataset.id,
                quantity: foundSupplierBid.Quantity__c,
                isQuantityRange: foundSupplierBid.IsQuantityRange__c,
                quantityMaximum: foundSupplierBid.Quantity_Range_Maximum__c
              }
            })
        );
    }

    handleChangeTransportationProduct(event){
        let value = this._getTransportationTypeByTransportationProduct(this.transportationOptions.find(product => product.value === event.detail.value).label);
        this._supplierBids.find(bid => bid.Id === event.target.dataset.supplierBidId).Transportation_Type_Buy__c = value;
        this.dispatchEvent(
            new CustomEvent("changetransportationtype", {
              detail: {
                supplierBidId: event.target.dataset.supplierBidId,
                value: value
              }
            })
        );
    }

    redefineStringFieldsFromRecordWithNumberValues(record) {
        let updatedRecord = {...record};
        updatedRecord.Supplier_Unit_Price__c = isNaN(parseFloat(updatedRecord.Supplier_Unit_Price__c))
            ? 0.0 : parseFloat(updatedRecord.Supplier_Unit_Price__c);
        updatedRecord.Quantity__c = isNaN(parseFloat(updatedRecord.Quantity__c))
            ? 0.0 : parseFloat(updatedRecord.Quantity__c);
        updatedRecord.Quantity_Range_Maximum__c = isNaN(parseFloat(updatedRecord.Quantity_Range_Maximum__c))
            ? 0.0 : parseFloat(updatedRecord.Quantity_Range_Maximum__c);
        return updatedRecord;
    }

    connectedCallback() {
        try {
            getUnitOfMeasurePickListValues().then(data => {
                let result = [];
                Object.keys(data).forEach(key => {
                    result.push({label: key, value: data[key]});
                });
                this.unitOfMeasureOptions = result;
            }).then(() => {
                loadExtraCostProducts().then(data => {
                    let result = [];
                    let options = [];
                    data.forEach(product => {
                        if (product.Family === 'Transportation') {
                            this.transportationProducts.push(product);

                            options.push({
                                label: product.Name,
                                value: product.Id
                            })
                        } else {
                            result.push({
                                label: product.Name,
                                value: product.Id
                            });
                        }
                    });
                    this.transportationOptions = options;
                    this._supplierBids = this.supplierBids ?
                        JSON.parse(JSON.stringify(this.supplierBids)).map(supplierBid => {
                            return {
                                ...supplierBid,
                                isQuantityRangeDisabled: !supplierBid.IsQuantityRange__c
                            };
                        })
                        : [];
                    this.extraCostProducts = result;
                    console.log(this._supplierBids);

                }).then(() => {
                    this._supplierBids.forEach(supplierBid => {
                        if (supplierBid.Supplier_Bid_Extra_Costs__r) {
                            let transportationProduct = this._getTransportationProductByTransportationType(supplierBid);
                            if (supplierBid.Supplier_Bid_Extra_Costs__r){
                                supplierBid.Supplier_Bid_Extra_Costs__r.forEach(extraCharge => {
                                    if (extraCharge.Product__c === transportationProduct.Id && supplierBid.Transportation_Type_Buy__c) {
                                        this._addTransportationExtraCost(extraCharge, supplierBid);
                                        supplierBid.transportationExtraCost.updateAndRepopulateValues();
                                    } else if(!extraCharge.STEM_Extra_Charge__c ){
                                        this.addExtraCostLine(extraCharge, supplierBid, false);
                                    }
                                });
                            }
                        }  else{
                            this._addTransportationExtraCost({}, supplierBid);
                            supplierBid.transportationExtraCost.updateAndRepopulateValues();
                        }
                    });
                    if(this._supplierBids.length > 0){
                        if(this._supplierBids[0].Supplier__c){
                            getSTEMCharges({ quoteId: this.quoteId, supplierId: this._supplierBids[0].Supplier__c }).then((stemCharges) => {
                                stemCharges.forEach(stemExtraCharge => {
                                    this.addExtraCostLine(stemExtraCharge, null, true);
                                })
                            })
                        }
                    }
                });
            });
        } catch (error) {
            console.error(error)
        }

    }

    updateAndRepopulateExtraCostValues(supplierBid) {
        supplierBid.extraCosts.forEach(record => {
            record.quantity.value = supplierBid.Quantity__c;
            record.quantityMaximum.value = supplierBid.IsQuantityRange__c ? supplierBid.Quantity_Range_Maximum__c : null;
            record.isQuantityRange = supplierBid.IsQuantityRange__c;
            record.isQuantityRangeDisabled = !supplierBid.IsQuantityRange__c || record.fixedCost;
            record.resetQuantityMaximumValidation();
            record.updateAndRepopulateValues();
        });
    }

    handleChange(event) {
        let id = event.target.dataset.id;
        let attribute = event.target.name;
        let supplierBidId = event.target.dataset.supplierBidId;
        let foundSupplierBid = supplierBidId ? this._supplierBids.find(bid => bid.Id === supplierBidId) : null;
        [...this.stemCharges, ...this._supplierBids.map(bid => bid.extraCosts)].flat(1).map(cost => {
            if (id === cost.uniqueIndex) {
                let value = event.target.value;
                switch (attribute) {
                    case 'product2Id':
                        cost[attribute].value = value;
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
                        cost[attribute].value = isNaN(parseFloat(value)) ? null : parseFloat(value);
                        cost.validateUnitCost();
                        break;
                    case 'fixedCost':
                        cost[attribute] = event.target.checked;
                        cost.isFixedCostDisabled = !event.target.checked;
                        cost.quantity.value = foundSupplierBid?.Quantity__c;
                        cost.isQuantityRange = foundSupplierBid?.IsQuantityRange__c;
                        cost.quantityMaximum.value = foundSupplierBid?.Quantity_Range_Maximum__c;
                        cost.unitOfMeasure = event.target.checked ? '1.' : foundSupplierBid?.Unit_of_Measure__c;
                        cost.resetValidation();
                        cost.repopulateValuesIfFixedCost();
                        break;
                    case 'minimumBuyAt':
                        cost[attribute].value = isNaN(parseFloat(value)) ? null : parseFloat(value);
                        break;
                    case 'lumpsumCostBuyAt':
                        cost[attribute].value = parseFloat(value);
                        break;
                    default:
                        cost[attribute] = value;
                        break;
                }
            }
        });
    }

    removeExtraCostLine(event) {
        try {
            let uniqueId = event.target.dataset.id;
            let supplierBidId = event.target.dataset.supplierBidId;
            let stemChargeIndex = this.stemCharges.findIndex(record => record.uniqueIndex === uniqueId);
            let extraCostIndex;
            if(supplierBidId){
                extraCostIndex = this._supplierBids.find(bid => bid.Id === supplierBidId).extraCosts.findIndex(record => record.uniqueIndex === uniqueId);
            }
            let deletedRecord = stemChargeIndex !== -1 ? this.stemCharges[stemChargeIndex] : this._supplierBids.find(bid => bid.Id === supplierBidId).extraCosts[extraCostIndex];
            if (stemChargeIndex !== -1) {
                this.stemCharges.splice(stemChargeIndex, 1);
            } else if (extraCostIndex !== -1) {
                this._supplierBids.find(bid => bid.Id === supplierBidId).extraCosts.splice(extraCostIndex, 1);
            }
            if (deletedRecord && deletedRecord.id) {
                this.extraCostsToDelete.push(deletedRecord.id);
            }
        } catch (error) {
            console.error(error)
        }

    }

    addNewStemCharge(){
        this.addExtraCostLine(null, null, true);
    }

    addNewTableLine(event) {
        let supplierBid = this._supplierBids.find(bid => bid.Id === event.target.dataset.supplierBidId);
        this.addExtraCostLine(null, supplierBid, false);
    }

    addExtraCostLine(record, supplierBid, isExtraCharge) {
        try {
            let row = {
                id: record?.Id,
                uniqueIndex: this.makeId(5),
                product2Id: {
                    value: record?.Product__c,
                    className: ''
                },
                product2Name: record ? record.Product__r.Name : '',
                quantity: {
                    value: record?.Quantity__c ? record.Quantity__c : 1.00,
                    className: 'slds-input'
                },
                isQuantityRange: supplierBid ? supplierBid.IsQuantityRange__c : false,
                isQuantityRangeDisabled: supplierBid ? !supplierBid.IsQuantityRange__c || record?.Fixed__c : record ? !record.Is_Quantity_Range__c : true,
                quantityMaximum: {
                    value: record?.Quantity_Range_Maximum__c ? record.Quantity_Range_Maximum__c : supplierBid?.IsQuantityRange__c && !record?.Fixed__c ? supplierBid?.Quantity_Range_Maximum__c : null,
                    className: 'slds-input'
                },
                unitCost: {
                    value: record?.Unit_Cost__c,
                    className: 'slds-input'
                },
                unitOfMeasure: record?.Unit_of_Measure__c ? record?.Unit_of_Measure__c : '1.',
                fixedCost: record ? record.Fixed__c : true,
                isFixedCostDisabled: record ? !record.Fixed__c : false,
                minimumBuyAt: {
                    value: record?.Minimum__c,
                    className: 'slds-input'
                },
                lumpsumCostBuyAt: {
                    value: record?.Lumpsum_Cost__c,
                    className: 'slds-input'
                },
                stemCharge: isExtraCharge,
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
                    try {
                        if (this.fixedCost) {
                            this.unitCost.value = null;
                            this.minimumBuyAt.value = null;
                            this.quantity.value = 1.0;
                            this.quantityMaximum.value = null;
                            this.isQuantityRangeDisabled = true;
                            this.unitOfMeasure = '1.';
                        } else {
                            this.lumpsumCostBuyAt.value = null;
                            this.isQuantityRangeDisabled = this.stemCharge ? false : !this.isQuantityRange;
                        }
                    } catch (error) {
                        console.error(error)
                    }

                },

                revalidateFields() {
                    this.resetValidation();
                    this.validateFields();
                    this.validateLumpsumCostBuyAt();
                    this.validateUnitCost();
                },

                resetValidation() {
                    this.quantity.className = 'slds-input';
                    this.product2Id.className = '';
                    this.resetQuantityMaximumValidation();
                    this.minimumBuyAt.className = 'slds-input';
                    this.lumpsumCostBuyAt.className = 'slds-input';
                },

                resetQuantityMaximumValidation() {
                    this.quantityMaximum.className = 'slds-input';
                },

                validateFields() {
                    this.validateProduct();
                    this.validateQuantity();
                    this.validateQuantityMaximum();
                },

                validateProduct() {
                    this.product2Id.className = this.product2Id.value == null
                        ? 'slds-has-error' : '';
                },

                validateQuantity() {
                    this.quantity.className = !this.fixedCost && this.quantity.value == null
                        ? 'slds-input slds-has-error' : 'slds-input';
                },

                validateQuantityMaximum() {
                    this.quantityMaximum.className = !this.fixedCost && this.isQuantityRange && this.quantityMaximum.value == null
                        ? 'slds-input slds-has-error' : 'slds-input ';
                },

                validateLumpsumCostBuyAt() {
                    this.lumpsumCostBuyAt.className = this.fixedCost && this.lumpsumCostBuyAt.value == null
                        ? 'slds-input slds-has-error' : 'slds-input ';
                },

                validateUnitCost() {
                    this.unitCost.className = !this.fixedCost && (!this.unitCost.value && this.unitCost.value !== 0)
                    ? 'slds-input slds-has-error' : 'slds-input ';
                },

            };
            if(row.stemCharge){
                this.stemCharges.push(row);
            }else{
                supplierBid.extraCosts.push(row);
            }
            return row;
        } catch (error) {
            console.error(error)
        }

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

        [...this.stemCharges, ...this._supplierBids.map(bid => bid.extraCosts)].flat(1).forEach(record => {
            record.revalidateFields();
        });
        let isValid = [...this.stemCharges, ...this._supplierBids.map(bid => bid.extraCosts)].flat(1).every(record => {
            return !(record.quantity.className.includes('slds-has-error') ||
                     record.quantityMaximum.className.includes('slds-has-error') ||
                     record.product2Id.className.includes('slds-has-error') ||
                     record.lumpsumCostBuyAt.className.includes('slds-has-error') ||
                     record.minimumBuyAt.className.includes('slds-has-error') ||
                     record.unitCost.className.includes('slds-has-error'));
        });

        this._supplierBids.forEach(supplierBid => {
            supplierBid.transportationExtraCost.revalidateFields();
            isValid = isValid && !(supplierBid.transportationExtraCost.quantity.className.includes('slds-has-error') ||
                supplierBid.transportationExtraCost.quantityMaximum.className.includes('slds-has-error') ||
                supplierBid.transportationExtraCost.lumpsumCostBuyAt.className.includes('slds-has-error') ||
                supplierBid.transportationExtraCost.unitCost.className.includes('slds-has-error') ||
                supplierBid.transportationExtraCost.minimumBuyAt.className.includes('slds-has-error'));
        })

        return isValid;
    }

    @api
    async upsertExtraCosts(savedSupplierBids) {
        await this.removeExtraCosts();
        let extraCostsToInsert = [];
        this.stemCharges.forEach(value => {
            let fields = {};
            fields['Id'] = value.id;
            fields['Enquiry__c'] = this.enquiryId;
            fields['Product__c'] = value.product2Id.value;
            fields['Quantity__c'] = value.quantity.value;
            fields['Is_Quantity_Range__c'] = Boolean(value.quantityMaximum.value);
            fields['Quantity_Range_Maximum__c'] = value.quantityMaximum.value;
            fields['Unit_Cost__c'] = value.unitCost.value;
            fields['Minimum__c'] = value.minimumBuyAt.value;
            fields['Lumpsum_Cost__c'] = value.lumpsumCostBuyAt.value;
            fields['Fixed__c'] = value.fixedCost;
            fields['Unit_of_Measure__c'] = value.unitOfMeasure;
            fields['Supplier_Bid__c'] = savedSupplierBids.find(bid => savedSupplierBids.find(bid => this.supplierBids[0].Product__c === bid.Product__c).Product__c === bid.Product__c).Id;
            fields['Expected_Delivery_Date__c'] = savedSupplierBids.find(bid => this.supplierBids[0].Product__c === bid.Product__c).Expected_Delivery_Date__c;
            fields['Supplier__c'] = savedSupplierBids.find(bid => this.supplierBids[0].Product__c === bid.Product__c).Supplier__c;
            fields['Port__c'] = this._supplierBids[0].Port__c;
            fields['STEM_Extra_Charge__c'] = value.stemCharge;
            fields['Quote__c'] = this.quoteId
            fields['sobjectType'] = SUPPLIER_BID_EXTRA_COST.objectApiName;
            extraCostsToInsert.push(fields);
        });
        this._supplierBids.forEach(supplierBid => {
            supplierBid.extraCosts.forEach(value => {
                let fields = {};
                fields['Id'] = value.id;
                fields['Enquiry__c'] = this.enquiryId;
                fields['Product__c'] = value.product2Id.value;
                fields['Quantity__c'] = value.quantity.value;
                fields['Is_Quantity_Range__c'] = value.isQuantityRange;
                fields['Quantity_Range_Maximum__c'] = value.quantityMaximum.value;
                fields['Unit_Cost__c'] = value.unitCost.value;
                fields['Minimum__c'] = value.minimumBuyAt.value;
                fields['Lumpsum_Cost__c'] = value.lumpsumCostBuyAt.value;
                fields['Fixed__c'] = value.fixedCost;
                fields['Unit_of_Measure__c'] = value.unitOfMeasure;
                fields['Supplier_Bid__c'] = supplierBid.Id.length >= 15 ? supplierBid.Id: savedSupplierBids.find(bid => supplierBid.Product__c === bid.Product__c).Id;
                fields['Expected_Delivery_Date__c'] = savedSupplierBids.find(bid => this.supplierBids[0].Product__c === bid.Product__c).Expected_Delivery_Date__c;
                fields['Supplier__c'] = savedSupplierBids.find(bid => this.supplierBids[0].Product__c === bid.Product__c).Supplier__c;
                fields['Port__c'] = this._supplierBids[0].Port__c;
                fields['STEM_Extra_Charge__c'] = value.stemCharge;
                fields['Quote__c'] = this.quoteId
                fields['sobjectType'] = SUPPLIER_BID_EXTRA_COST.objectApiName;
                extraCostsToInsert.push(fields);
            })
        })
        this._supplierBids.forEach(supplierBid => {
            let fields = {};
            fields['Id'] = supplierBid.transportationExtraCost.id.length >= 15 ? supplierBid.transportationExtraCost.id : null;
            fields['Product__c'] = supplierBid.transportationExtraCost.product2Id;
            fields['Quantity__c'] = supplierBid.transportationExtraCost.quantity.value;
            fields['Is_Quantity_Range__c'] = supplierBid.transportationExtraCost.isQuantityRange;
            fields['Quantity_Range_Maximum__c'] = supplierBid.transportationExtraCost.quantityMaximum.value;
            fields['Unit_Cost__c'] = supplierBid.transportationExtraCost.unitCost.value;
            fields['Minimum__c'] = supplierBid.transportationExtraCost.minimumBuyAt.value;
            fields['Lumpsum_Cost__c'] = supplierBid.transportationExtraCost.lumpsumCostBuyAt.value;
            fields['Fixed__c'] = supplierBid.transportationExtraCost.fixedCost;
            fields['Unit_of_Measure__c'] = supplierBid.transportationExtraCost.unitOfMeasure;
            fields['Supplier_Bid__c'] = supplierBid.Id.length >= 15 ? supplierBid.Id: savedSupplierBids.find(bid => supplierBid.Product__c === bid.Product__c).Id;
            fields['Expected_Delivery_Date__c'] = savedSupplierBids.find(bid => this.supplierBids[0].Product__c === bid.Product__c).Expected_Delivery_Date__c;
            fields['Supplier__c'] = savedSupplierBids.find(bid => this.supplierBids[0].Product__c === bid.Product__c).Supplier__c;
            fields['Port__c'] = savedSupplierBids.find(bid => this.supplierBids[0].Product__c === bid.Product__c).Port__c;
            fields['sobjectType'] = SUPPLIER_BID_EXTRA_COST.objectApiName;
            extraCostsToInsert.push(fields);
        });
        return upsertProductExtraCosts({supplierBidExtraCosts: extraCostsToInsert});
    }

    async removeExtraCosts() {
        return Promise.all(this.extraCostsToDelete.map(recordId => deleteRecord(recordId)));
    }
}
