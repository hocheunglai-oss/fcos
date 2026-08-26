import { LightningElement , api, track , wire} from 'lwc';
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import getReconfirmInfo from '@salesforce/apex/ReconfirmProcessing.getReconfirmInfo';
import saveCiaChangesApex from '@salesforce/apex/ReconfirmProcessing.saveCiaChanges';
import getUsPublicDaysOff from '@salesforce/apex/ReconfirmProcessing.getUsPublicDaysOff';
import getStemsMessages from '@salesforce/apex/ReconfirmProcessing.getStemsMessages';
import updateStems from '@salesforce/apex/ReconfirmProcessing.updateStems';
import getVariableChargeSuppliers from '@salesforce/apex/ReconfirmProcessing.getVariableChargeSuppliers';
import saveVariableChargeRequirements from '@salesforce/apex/ReconfirmProcessing.saveVariableChargeRequirements';

export default class FcbReconfirmProcessing extends LightningElement {
  @api recordId;
  groupedItems;
  @track supplierCIArecords;
  @track draftValues = [];
  @track actionExecuting = false;
  daysOff;

  @track stems;
  @track disabledMessage = true;
  @track messageBusy = false;
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

  get showCiaSection() {
    return Array.isArray(this.supplierCIArecords) && this.supplierCIArecords.length > 0;
  }

  get messageSummary() {
    const count = Array.isArray(this.stems) ? this.stems.length : 0;
    return `${count} STEM message${count === 1 ? '' : 's'}`;
  }

  get ciaSummary() {
    const count = Array.isArray(this.supplierCIArecords) ? this.supplierCIArecords.length : 0;
    return `${count} CIA supplier${count === 1 ? '' : 's'}`;
  }

  get variableChargeSummary() {
    const count = this.variableChargeRows.filter((row) => row.effectiveRequired === true).length;
    return `${count} charge verification${count === 1 ? '' : 's'}`;
  }

  get ciaHasChanges() {
    return this.draftValues.length > 0;
  }

  get ciaActionsDisabled() {
    return this.actionExecuting || !this.ciaHasChanges;
  }

  get ciaSaveDisabled() {
    return this.ciaActionsDisabled;
  }

  get variableChargeSaveDisabled() {
    return this.variableChargeBusy || !this.variableChargeHasChanges;
  }

  get variableChargeHasChanges() {
    return this.variableChargeRows.some((row) => row.dirty === true);
  }

  get supplierCiaGroups() {
    return this.groupRowsByStem(this.supplierCIArecords || [], 'supplier');
  }

  get variableChargeGroups() {
    return this.groupRowsByStem(this.variableChargeRows, 'verification');
  }

  groupRowsByStem(rows, type) {
    const groups = new Map();
    rows.forEach((row) => {
      const key = row.stemId || row.stemName || 'unknown-stem';
      if (!groups.has(key)) {
        groups.set(key, { key, stemName: row.stemName || 'Unnamed STEM', rows: [] });
      }
      groups.get(key).rows.push(row);
    });
    return Array.from(groups.values()).map((group) => {
      const supplierCount = group.rows.length;
      const requiredCount = group.rows.filter((row) => row.effectiveRequired === true).length;
      return {
        ...group,
        supplierLabel: `${supplierCount} supplier${supplierCount === 1 ? '' : 's'}`,
        requiredLabel: type === 'verification'
          ? `${requiredCount} required`
          : '',
      };
    });
  }

  normalizeVariableChargeRows(rows) {
    return (rows || []).map((row) => {
      const effectiveRequired = row.isAgent === true || row.manualReviewRequired === true;
      const lineItemCount = Number(row.lineItemCount || 0);
      const extraCostCount = Number(row.extraCostCount || 0);
      const itemParts = [];
      if (lineItemCount) itemParts.push(`${lineItemCount} product line${lineItemCount === 1 ? '' : 's'}`);
      if (extraCostCount) itemParts.push(`${extraCostCount} extra cost${extraCostCount === 1 ? '' : 's'}`);
      const supplierStatus = row.supplierStatus || 'Pending';
      const statusToken = supplierStatus.toLowerCase().replace(/[^a-z]+/g, '-');
      const needsAssignment = effectiveRequired && row.assignmentStatus !== 'Resolved';
      return {
        ...row,
        dirty: false,
        effectiveRequired,
        supplierStatus: supplierStatus === 'Verified'
          ? 'Confirmed'
          : supplierStatus === 'Invalidated' ? 'Needs review again' : 'Not confirmed',
        itemSummary: itemParts.join(' · ') || 'No active charge rows',
        requirementLabel: 'Review required before supplier invoice',
        requirementHelp: row.isAgent === true
          ? 'Automatically required'
          : '',
        reviewState: needsAssignment ? 'Needs assignment' : effectiveRequired ? 'Required' : 'Optional',
        assignmentClass: row.assignmentStatus === 'Resolved'
          ? 'assignment-resolved'
          : 'assignment-error',
        sourceClass: row.isAgent === true
          ? 'source-pill source-pill_agent'
          : effectiveRequired
            ? 'source-pill source-pill_manual'
            : 'source-pill',
        statusClass: `status-pill status-pill_${statusToken}`,
        variableRowClass: `variable-row${effectiveRequired ? ' variable-row_required' : ''}`,
      };
    });
  }

  refreshVariableChargeSuppliers() {
    this.variableChargeBusy = true;
    getVariableChargeSuppliers({ enquiryId: this.recordId })
      .then((rows) => {
        this.variableChargeRows = this.normalizeVariableChargeRows(rows);
      })
      .catch((error) => this.showVariableChargeError(error))
      .finally(() => { this.variableChargeBusy = false; });
  }

  handleVariableChargeRequirement(event) {
    if (this.variableChargeBusy) return;
    const key = event.target.dataset.key;
    const checked = event.target.checked === true;
    this.variableChargeRows = this.variableChargeRows.map((row) => row.key === key
      ? {
          ...row,
          manualReviewRequired: checked,
          effectiveRequired: row.isAgent === true || checked,
          dirty: true,
          requirementHelp: '',
          reviewState: checked
            ? row.assignmentStatus === 'Resolved' ? 'Required' : 'Needs assignment'
            : 'Optional',
          sourceClass: checked ? 'source-pill source-pill_manual' : 'source-pill',
          requirementSource: checked ? 'Manual selection' : 'Not required',
          variableRowClass: `variable-row variable-row_dirty${checked ? ' variable-row_required' : ''}`,
        }
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
        this.variableChargeRows = this.normalizeVariableChargeRows(rows);
        this.dispatchEvent(new ShowToastEvent({
          title: 'Variable Charges updated',
          message: 'Supplier review requirements were saved.',
          variant: 'success',
        }));
      })
      .catch((error) => this.showVariableChargeError(error))
      .finally(() => { this.variableChargeBusy = false; });
  }

  showVariableChargeError(error) {
    this.showError('Variable Charges could not be updated.', error, 'Variable Charges error');
  }

  showError(fallbackMessage, error, title = 'Reconfirm error') {
    const message = error?.body?.message
      || error?.body?.output?.errors?.[0]?.message
      || error?.message
      || fallbackMessage;
    this.dispatchEvent(new ShowToastEvent({ title, message, variant: 'error' }));
  }

  refreshMessages() {
    this.messageBusy = true;
    return getStemsMessages({ enquiryId: this.recordId })
      .then((stems) => {
        this.stems = (stems || []).map((stem, index) => ({
          Id: stem.Id,
          Name: stem.Name,
          Message__c: stem.Message__c,
          messageLabel: stem.Name ? `${stem.Name} message` : `STEM ${index + 1} message`,
        }));
        this.showStemSection = this.stems.length > 0;
      })
      .catch((error) => this.showError('STEM messages could not be loaded.', error))
      .finally(() => { this.messageBusy = false; });
  }

  refreshData() {
    this.actionExecuting = true;
    return getReconfirmInfo({ enquiryIds: [this.recordId] })
      .then((result) => {
        this.groupedItems = this.groupBy(result, "stemId", "supplierId");
        this.supplierCIArecords = this.groupedItems.map((groupedItem) => ({
          ...groupedItem.value[0],
          key: groupedItem.key,
          ciaRowClass: 'cia-row',
        }));
        this.draftValues = [];
      })
      .catch((error) => this.showError('CIA supplier reconfirmation could not be loaded.', error))
      .finally(() => { this.actionExecuting = false; });
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


  updateCiaDraft(key, changes) {
    const existing = this.draftValues.find((row) => row.key === key) || { key };
    this.draftValues = [
      ...this.draftValues.filter((row) => row.key !== key),
      { ...existing, ...changes },
    ];
    this.supplierCIArecords = this.supplierCIArecords.map((row) => row.key === key
      ? { ...row, ...changes, ciaRowClass: 'cia-row cia-row_dirty' }
      : row);
  }

  handleCiaDateChange(event) {
    this.updateCiaDraft(event.target.dataset.key, { intendedPaymentDate: event.detail.value });
  }

  handleCiaReconfirmChange(event) {
    this.updateCiaDraft(event.target.dataset.key, { reconfirm: event.target.checked === true });
  }

  discardCiaChanges() {
    if (!this.ciaActionsDisabled) this.refreshData();
  }

  async saveCiaChanges() {
    if (this.ciaSaveDisabled) return;
    this.actionExecuting = true;
    const changes = [];

    this.draftValues.forEach((changedRecord) => {
      const group = this.groupedItems.find((item) => item.key === changedRecord.key);
      if (!group) return;
      const intendedPaymentDateChanged = Object.prototype.hasOwnProperty.call(changedRecord, 'intendedPaymentDate');
      const intendedPaymentDate = intendedPaymentDateChanged && changedRecord.intendedPaymentDate
        ? this.moveDate(new Date(changedRecord.intendedPaymentDate))
        : intendedPaymentDateChanged
          ? null
          : group.value[0].intendedPaymentDate;
      const reconfirmChanged = Object.prototype.hasOwnProperty.call(changedRecord, 'reconfirm');
      group.value.forEach((record) => {
        changes.push({
          recordId: record.id,
          intendedPaymentDate,
          intendedPaymentDateChanged,
          reconfirm: reconfirmChanged ? changedRecord.reconfirm === true : record.reconfirm === true,
          reconfirmChanged,
          expectedLastModifiedAt: record.lastModifiedAt,
        });
      });
    });

    try {
      const result = await saveCiaChangesApex({ enquiryId: this.recordId, changes });
      this.groupedItems = this.groupBy(result, "stemId", "supplierId");
      this.supplierCIArecords = this.groupedItems.map((groupedItem) => ({
        ...groupedItem.value[0],
        key: groupedItem.key,
        ciaRowClass: 'cia-row',
      }));
      this.draftValues = [];
      this.dispatchEvent(new ShowToastEvent({
        title: 'CIA reconfirmation saved',
        message: 'Supplier dates, reconfirmation requirements, and tasks were saved together.',
        variant: 'success',
      }));
    } catch (error) {
      this.showError('CIA supplier reconfirmation could not be saved.', error);
    } finally {
      this.actionExecuting = false;
    }
  }

  editMessages() {
    this.disabledMessage = false;
  }

  saveMessages() {
    this.messageBusy = true;
    updateStems({ stems: this.stems.map(({ Id, Message__c }) => ({ Id, Message__c })) })
      .then(() => this.refreshMessages())
      .then(() => {
        this.dispatchEvent(new ShowToastEvent({
          title: 'Messages saved',
          message: 'The STEM reconfirmation messages were updated.',
          variant: 'success',
        }));
        this.disabledMessage = true;
      })
      .catch((error) => this.showError('STEM messages could not be saved.', error))
      .finally(() => { this.messageBusy = false; });
  }

  cancelMessages() {
    this.disabledMessage = true;
    this.refreshMessages();
  }

  handleChangeMessage(event){
    const stemId = event.target.dataset.id;
    this.stems = this.stems.map((stem) => stem.Id === stemId
      ? { ...stem, Message__c: event.detail.value }
      : stem);
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
    return (this.daysOff || []).find(dayOff => Number(dayOff.Day__c) === date.getDate() && Number(dayOff.Month__c) === date.getMonth() + 1);
  }

  addDays(date){
    let findDayOff = (this.daysOff || []).find(dayOff => Number(dayOff.Day__c) === date.getDate() && Number(dayOff.Month__c) === date.getMonth() + 1);
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
