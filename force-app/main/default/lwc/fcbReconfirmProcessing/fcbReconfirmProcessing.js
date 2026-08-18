import { LightningElement , api, track , wire} from 'lwc';
import { updateRecord } from 'lightning/uiRecordApi';
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import getReconfirmInfo from '@salesforce/apex/ReconfirmProcessing.getReconfirmInfo';
import sendReconfirmNotification from '@salesforce/apex/ReconfirmProcessing.sendReconfirmNotification';
import getUsPublicDaysOff from '@salesforce/apex/ReconfirmProcessing.getUsPublicDaysOff';
import getStemsMessages from '@salesforce/apex/ReconfirmProcessing.getStemsMessages';
import completeTasks from '@salesforce/apex/ReconfirmProcessing.completeTasks';
import cancelTasks from '@salesforce/apex/ReconfirmProcessing.cancelTasks';
import getPayablePayments from '@salesforce/apex/ReconfirmProcessing.getPayablePayments';
import updateStems from '@salesforce/apex/ReconfirmProcessing.updateStems';
import getVariableChargeSuppliers from '@salesforce/apex/ReconfirmProcessing.getVariableChargeSuppliers';
import saveVariableChargeRequirements from '@salesforce/apex/ReconfirmProcessing.saveVariableChargeRequirements';


const COLS = [
  {
    label: 'Supplier Name',
    fieldName: 'supplierName',
    type: 'text'
  },
  {
    label: 'Intended Payment Date',
    fieldName: 'intendedPaymentDate',
    type: 'date-local',
    editable: true,
    typeAttributes: {
      day: "numeric",
      month: "numeric",
      year: "numeric"
    }
  },
  {
    label: 'Reconfirm',
    fieldName: 'reconfirm',
    type: 'boolean',
    editable: {fieldName: 'isEditable'},
  }
];

export default class FcbReconfirmProcessing extends LightningElement {
  @api recordId;
  columns = COLS;
  groupedItems;
  @track supplierCIArecords;
  @track draftValues = [];
  @track actionExecuting = false;
  daysOff;

  @track stems;
  @track disabledMessage = true;
  @track showStemSection = false;
  @track variableChargeRows = [];
  @track variableChargeBusy = false;

  connectedCallback() {
    this.refreshData();
    this.refreshMessages();
    this.refreshVariableChargeSuppliers();
    getUsPublicDaysOff().then(result => {
      this.daysOff = result;
    })
    // getUsPublicDaysOff().then(result => {
    //   let text = JSON.parse(result);
    //   let wholeText = '';
    //   text.forEach(row => {
    //     wholeText += row.name + ': ' + new Date(row.date).toLocaleDateString('en-GB') + ' (' + row.types + ')\n'
    //   })
    //   this.daysOff = result;
    // })
  }

  get showVariableChargeSection() {
    return this.variableChargeRows.length > 0;
  }

  get variableChargeHasChanges() {
    return this.variableChargeRows.some((row) => row.dirty === true);
  }

  refreshVariableChargeSuppliers() {
    this.variableChargeBusy = true;
    getVariableChargeSuppliers({ enquiryId: this.recordId })
      .then((rows) => {
        this.variableChargeRows = (rows || []).map((row) => ({
          ...row,
          dirty: false,
          effectiveRequired: row.isAgent === true || row.manualReviewRequired === true,
          assignmentClass: row.assignmentStatus === 'Resolved'
            ? 'slds-text-color_success'
            : 'slds-text-color_error',
        }));
      })
      .catch((error) => this.showVariableChargeError(error))
      .finally(() => { this.variableChargeBusy = false; });
  }

  handleVariableChargeRequirement(event) {
    const key = event.target.dataset.key;
    const checked = event.target.checked === true;
    this.variableChargeRows = this.variableChargeRows.map((row) => row.key === key
      ? { ...row, manualReviewRequired: checked, effectiveRequired: row.isAgent === true || checked, dirty: true }
      : row);
  }

  saveVariableChargeRequirements() {
    const changes = this.variableChargeRows.filter((row) => row.dirty).map((row) => ({
      stemId: row.stemId,
      supplierId: row.supplierId,
      manualReviewRequired: row.manualReviewRequired === true,
      expectedStageLastModifiedAt: row.stageLastModifiedAt || null,
      expectedStemLastModifiedAt: row.stemLastModifiedAt,
      expectedAccountLastModifiedAt: row.accountLastModifiedAt,
    }));
    if (!changes.length) return;
    this.variableChargeBusy = true;
    saveVariableChargeRequirements({ changes, enquiryId: this.recordId })
      .then((rows) => {
        this.variableChargeRows = (rows || []).map((row) => ({
          ...row,
          dirty: false,
          effectiveRequired: row.isAgent === true || row.manualReviewRequired === true,
          assignmentClass: row.assignmentStatus === 'Resolved' ? 'slds-text-color_success' : 'slds-text-color_error',
        }));
        this.dispatchEvent(new ShowToastEvent({
          title: 'Variable Charges updated',
          message: 'Final supplier charge requirements were saved atomically.',
          variant: 'success',
        }));
      })
      .catch((error) => this.showVariableChargeError(error))
      .finally(() => { this.variableChargeBusy = false; });
  }

  showVariableChargeError(error) {
    const message = error?.body?.message || error?.body?.output?.errors?.[0]?.message || error?.message || 'Variable Charges could not be updated.';
    this.dispatchEvent(new ShowToastEvent({ title: 'Variable Charges error', message, variant: 'error' }));
  }

  refreshMessages() {
    getStemsMessages({ enquiryId: this.recordId }).then((stems) => {
      let messageList = [];
      stems.forEach(stem => {
        messageList.push({ Id: stem.Id, Message__c: stem.Message__c });
      });
      this.stems = messageList;
      this.showStemSection = messageList.length > 0;
    })
  }

  refreshData(){
    this.actionExecuting = true;
    getReconfirmInfo({ enquiryIds: [this.recordId] }).then((result) => {
      getPayablePayments({enquiryId: this.recordId}).then((paymentMap) => {
        this.groupedItems = this.groupBy(result, "stemId", "supplierId");

        let records = [];
        this.groupedItems.forEach(groupedItem => {
          records.push(
            {
              ...groupedItem.value[0],
              key: groupedItem.key,
              isEditable: true
            }
          );
        });
        this.supplierCIArecords = records;
        this.actionExecuting = false;
      })
    })
  }

  groupBy(array, stemId, supplierId) {
    const grouped = array.reduce((result, currentItem) => {
      const groupKey = `${currentItem[stemId]}-${currentItem[supplierId]}`;

      if (!result[groupKey]) {
        result[groupKey] = [];
      }

      result[groupKey].push(currentItem);

      return result;
    }, {});

    return Object.keys(grouped).map(groupKey => ({
      key: groupKey,
      value: grouped[groupKey]
    }));
  }


  handleSave(event) {
    this.actionExecuting = true;
    let updatePromises = [];
    let intendedPaymentTaskRecords = [];
    const uniqueIntendedPaymentTaskRecords = new Set();
    let reconfirmTaskRecords = [];
    const uniqueReconfirmTaskRecords = new Set();
    let cancelledTaskRecords = [];
    const uniqueCancelledTaskRecords = new Set();
    event.detail.draftValues.forEach((changedRecord) => {
      let group = this.groupedItems.find(item => item.key === changedRecord.key);
      if(group){
        group.value.forEach((record) => {
          let intendedPaymentDate = this.moveDate(new Date(changedRecord.intendedPaymentDate));
          const fields = {};
          fields.Id = record.id;
          fields.Reconfirm__c = changedRecord.reconfirm !== null ? changedRecord.reconfirm : record.reconfirm;
          fields.Intended_Payment_Date__c = changedRecord.intendedPaymentDate ? intendedPaymentDate : record.intendedPaymentDate;
          const recordInput = { fields };
          updatePromises.push(updateRecord(recordInput));
          if(changedRecord.intendedPaymentDate){
            const uniqueKey = `${record.stemId}-${record.supplierId}`;
            if (!uniqueIntendedPaymentTaskRecords.has(uniqueKey)) {
              uniqueIntendedPaymentTaskRecords.add(uniqueKey);
              intendedPaymentTaskRecords.push({
                enquiryId: record.enquiryId,
                stemId: record.stemId,
                stemName: record.stemName,
                supplierId: record.supplierId,
                supplierName: record.supplierName,
                intendedPaymentDate: changedRecord.intendedPaymentDate ? intendedPaymentDate : record.intendedPaymentDate
              });
            }
          }
          if(changedRecord.reconfirm){
            const uniqueKey = `${record.stemId}-${record.supplierId}`;
            if (!uniqueReconfirmTaskRecords.has(uniqueKey)) {
              uniqueReconfirmTaskRecords.add(uniqueKey);
              reconfirmTaskRecords.push({
                enquiryId: record.enquiryId,
                stemId: record.stemId,
                stemName: record.stemName,
                supplierId: record.supplierId,
                supplierName: record.supplierName,
                intendedPaymentDate: changedRecord.intendedPaymentDate ? intendedPaymentDate : record.intendedPaymentDate,
                ownerId: record.ownerId
              });
            }
          }
          if(changedRecord.reconfirm != undefined && changedRecord.reconfirm === false){
            const uniqueKey = `${record.stemId}-${record.supplierId}`;
            if (!uniqueCancelledTaskRecords.has(uniqueKey)) {
              uniqueCancelledTaskRecords.add(uniqueKey);
              cancelledTaskRecords.push({
                enquiryId: record.enquiryId,
                stemId: record.stemId,
                stemName: record.stemName,
                supplierId: record.supplierId,
                supplierName: record.supplierName,
                intendedPaymentDate: changedRecord.intendedPaymentDate ? intendedPaymentDate : record.intendedPaymentDate,
                ownerId: record.ownerId
              });
            }
          }
        })
      }  
    })
    sendReconfirmNotification({ reconfirmItems: JSON.parse(JSON.stringify(intendedPaymentTaskRecords)) }).then(() => {
      completeTasks({ reconfirmItems: JSON.parse(JSON.stringify(reconfirmTaskRecords)) }).then(() => {
        cancelTasks({ reconfirmItems: JSON.parse(JSON.stringify(cancelledTaskRecords)) }).then(() => {
          Promise.all(updatePromises)
            .then(() => {
              this.dispatchEvent(
                new ShowToastEvent({
                  title: "Success",
                  message: "Items have been updated",
                  variant: "success"
                })
              );
              this.refreshData();
              this.template.querySelector("lightning-datatable").draftValues = [];
            })
            .catch(error => {
              this.dispatchEvent(
                new ShowToastEvent({
                  title: "Error",
                  variant: "error"
                })
              );
              this.template.querySelector("lightning-datatable").draftValues = [];
              this.actionExecuting = false;
            });
        })
      })
    })
      .catch(error => {
        this.dispatchEvent(
          new ShowToastEvent({
            title: "Error",
            variant: "error"
          })
        );
        this.template.querySelector("lightning-datatable").draftValues = [];
        this.actionExecuting = false;
      });
  }

  editMessages(event){
    try {
      this.copyText();
      this.disabledMessage = false;  
    } catch (error) {
      console.error(error)
    }
    
  }

  copyText() {
    const text = 'Hello World';

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';

    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }

  saveMessages(event) {
    updateStems({ stems: this.stems }).then(() => {

      this.refreshMessages();
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Success",
          message: "Message is saved.",
          variant: "success"
        })
      );
      this.disabledMessage = true;
    })
  }

  cancel(){
    this.disabledMessage = true;
  }

  handleChangeMessage(event){
    this.stems.find(stem => stem.Id === event.target.dataset.id).Message__c = event.detail.value;
  }

  moveDate(selectedDate){
    try {
      if(selectedDate.getDay() === 0 || selectedDate.getDay() === 6){
        this.dispatchEvent(
          new ShowToastEvent({
            title: "Warning",
            message:"The date you have entered falls on weekend. The system will adjust your input to the previous working day.",
            variant: "warning"
          })
        );    
        return this.addDays(selectedDate);
      } else if(this.findDayOff(selectedDate)){
        this.dispatchEvent(
          new ShowToastEvent({
            title: "Warning",
            message:"The date you have entered falls on a US bank holiday. The system will adjust your input to the previous working day.",
            variant: "warning"
          })
        );
        return this.addDays(selectedDate);
      }else{
        return this._convertDate(selectedDate);
      }
    } catch (error) {
      console.error(error)
    }
    
  }

  findDayOff(date){
    return this.daysOff.find(dayOff => Number(dayOff.Day__c) === date.getDate() && Number(dayOff.Month__c) === date.getMonth() + 1);
  }

  addDays(date){
    console.log(this.daysOff);
    
    let findDayOff = this.daysOff.find(dayOff => Number(dayOff.Day__c) === date.getDate() && Number(dayOff.Month__c) === date.getMonth() + 1);
    if (date.getDay() === 0 || date.getDay() === 6 || findDayOff) {
      date = new Date(date.setDate(date.getDate() - 1));
      return this.addDays(date);
    } else {
      return this._convertDate(date);
    }
  }

  _convertDate(date) {
    if(!date){
      return undefined
    }else {
      let day = date.getDate();
      day = day < 10 ? '0' + day : day;
      let month = date.getMonth() + 1;
      month = month < 10 ? '0' + month : month;
      let year = date.getFullYear();
      return year + '-' + month + '-' + day;
    }
  }
}
