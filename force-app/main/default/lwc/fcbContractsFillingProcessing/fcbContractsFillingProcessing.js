import { LightningElement , track } from 'lwc';
import getContracts from "@salesforce/apex/ContractsFillingProcessingController.getContracts";
import { loadStyle } from 'lightning/platformResourceLoader';
import ROW_STYLES from '@salesforce/resourceUrl/treeGridStyles';
import Nomination_Received from '@salesforce/schema/Nomination__c.Received__c';
import Nomination_ID_FIELD from '@salesforce/schema/Nomination__c.Id';
import {updateRecord} from "lightning/uiRecordApi";
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { subscribe, MessageContext } from 'lightning/empApi';
import runVesselUpload from '@salesforce/apex/ContractsFillingProcessingController.runVesselUpload';
import runCompanyUpload from '@salesforce/apex/ContractsFillingProcessingController.runCompanyUpload';


const COLS = [
  {
    label: "",
    fieldName: "blankText",
    type: "text",
    initialWidth: 10
  },
  {
    label: "STEM",
    fieldName: "StemUrl",
    type: "url",
    typeAttributes: {
      label: { fieldName: "StemName" },
      tooltip: { fieldName: "StemName" },
      target: "_blank"
    },
    initialWidth: 400,
    cellAttributes: {
      class: {
        fieldName: 'rowClass'
      }
    }
  },
  {
    label: "PDF",
    type: "text",
    fieldName: "PDF__c",
    initialWidth: 100,
    cellAttributes: {
      class: {
        fieldName: 'rowClass'
      }
    }
  },
  {
    label: "Contract",
    type: "navigationLink",
    fieldName: "RefCode",
    initialWidth: 100,
    typeAttributes: {
      fileUrl: { fieldName: "PDFUrl" },
      refCode: { fieldName: "RefCode" }
    },
    cellAttributes: {
      class: {
        fieldName: 'rowClass'
      }
    }
  },
  {
    label: "Account",
    fieldName: "AccountUrl",
    type: "url",
    typeAttributes: {
      label: { fieldName: "AccountName" },
      tooltip: { fieldName: "AccountName" },
      target: "_blank"
    },
    initialWidth: 300,
    cellAttributes: {
      class: {
        fieldName: 'rowClass'
      }
    }
  },
  {
    label: "Sent Status",
    fieldName: "Sent__c",
    type: "text",
    initialWidth: 100,
    cellAttributes: {
      class: {
        fieldName: 'rowClass'
      }
    }
  },
  {
    label: "Received Status",
    fieldName: "Received__c",
    type: "text",
    initialWidth: 100,
    cellAttributes: {
      class: {
        fieldName: 'rowClass'
      }
    }
  },
  {
    label: "Received Documents",
    type: "fileUpload",
    fieldName: "id",
    typeAttributes: {
      acceptedFileFormats: ".jpg,.jpeg,.pdf,.png,.doc,.docx",
      fileUploaded: { fieldName: "IsDocumentComplete__c" },
      uploadValue: { fieldName: "SignedFileName" },
      directUpload: true,
      uploadLabel: "Upload received document"
    },
    initialWidth: 300,
    cellAttributes: {
      class: {
        fieldName: 'rowClass'
      }
    }
  },
  {
    label: "Uploaded File",
    type: "navigationLink",
    fieldName: "UploadedFileName",
    initialWidth: 100,
    typeAttributes: {
      fileUrl: { fieldName: "UploadedFileUrl" },
      refCode: { fieldName: "UploadedFileName" }
    },
    cellAttributes: {
      class: {
        fieldName: 'rowClass'
      }
    }
  },
  {
    label: "Movement Upload",
    type: "fileUpload",
    fieldName: "id",
    typeAttributes: {
      acceptedFileFormats: ".jpg,.jpeg,.pdf,.png",
      fileUploaded: { fieldName: "SanctionFiles" },
      uploadValue: { fieldName: "MovementUpload" }
    },
    initialWidth: 300,
    cellAttributes: {
      class: {
        fieldName: 'rowClass'
      }
    }
  },
  {
    label: "Uploaded Movement File",
    type: "navigationLink",
    fieldName: "UploadedMovementFileName",
    initialWidth: 100,
    typeAttributes: {
      fileUrl: { fieldName: "UploadedMovementFileUrl" },
      refCode: { fieldName: "UploadedMovementFileName" }
    },
    cellAttributes: {
      class: {
        fieldName: 'rowClass'
      }
    }
  },
  {
    label: "Company Upload",
    type: "fileUpload",
    fieldName: "id",
    typeAttributes: {
      acceptedFileFormats: ".jpg,.jpeg,.pdf,.png",
      fileUploaded: { fieldName: "SanctionFiles" },
      uploadValue: { fieldName: "CompanyUpload" },
      directUpload: true,
      uploadLabel: "Upload company document"
    },
    initialWidth: 300,
    cellAttributes: {
      class: {
        fieldName: 'rowClass'
      }
    }
  },
  {
    label: "Uploaded Company File",
    type: "navigationLink",
    fieldName: "UploadedCompanyFileName",
    initialWidth: 100,
    typeAttributes: {
      fileUrl: { fieldName: "UploadedCompanyFileUrl" },
      refCode: { fieldName: "UploadedCompanyFileName" }
    },
    cellAttributes: {
      class: {
        fieldName: 'rowClass'
      }
    }
  },
  {
    label: "Others Upload",
    type: "fileUpload",
    fieldName: "id",
    typeAttributes: {
      acceptedFileFormats: ".jpg,.jpeg,.pdf,.png",
      fileUploaded: { fieldName: "SanctionFiles" },
      uploadValue: { fieldName: "OthersUpload" },
      directUpload: true,
      uploadLabel: "Upload other document"
    },
    initialWidth: 300,
    cellAttributes: {
      class: {
        fieldName: 'rowClass'
      }
    }
  },
  {
    label: "Uploaded Others File",
    type: "navigationLink",
    fieldName: "UploadedOthersFileName",
    initialWidth: 100,
    typeAttributes: {
      fileUrl: { fieldName: "UploadedOthersFileUrl" },
      refCode: { fieldName: "UploadedOthersFileName" }
    },
    cellAttributes: {
      class: {
        fieldName: 'rowClass'
      }
    }
  },
  {
    label: "Expected Delivery Date",
    fieldName: "ExpectedDeliveryDate",
    type: "text",
    initialWidth: 100,
    cellAttributes: {
      class: {
        fieldName: 'rowClass'
      }
    }
  },
  {
    label: "Delivery Date",
    fieldName: "DeliveryDate",
    type: "text",
    initialWidth: 100,
    cellAttributes: {
      class: {
        fieldName: 'rowClass'
      }
    }
  },
]

export default class FcbContractsFillingProcessing extends LightningElement {
  @track data;
  @track columns = COLS;
  @track selectedRows = [];

  @track accountFilter;
  @track startDateRange;
  @track endDateRange;
  stylesLoaded = false;

  pageSize = 20;
  offset = 0;
  @track hasMore = true;
  @track isLoading = false;

  subscription = {};

  renderedCallback() {
    if (this.stylesLoaded) {
      return;
    }
    this.stylesLoaded = true;

    loadStyle(this, ROW_STYLES);
  }

  connectedCallback() {
    this.offset = 0;
    this.hasMore = true;
    this.startDateRange = this._convertDate(this._addMonths(new Date(), -3));
    this.endDateRange = this._convertDate(this._addMonths(new Date(), 12));
    this.loadContracts(false);
    this.subscribeToPlatformEvent();
  }

  async subscribeToPlatformEvent() {
    try {
    const channel = '/event/Vessel_Processing_Done__e';
    this.subscription = await subscribe(channel, -1, (event) => {
      const message = event.data.payload.Message__c;
      const isError = message.startsWith('Error:');
      console.log(message);

      this.dispatchEvent(new ShowToastEvent({
        title: isError ? 'Processing Failed' : 'Processing Complete',
        message: message,
        variant: isError ? 'error' : 'success',
        mode: 'sticky'
      }));
      this.isLoading = false;
      this.resetLoading();
      this.loadContracts(false);
    });
    } catch (error) {
      console.error(error);
    }

  }

  loadContracts(isLoadMore = false) {
    console.log(this.isLoading);
    console.log(this.hasMore);


    if (this.isLoading || !this.hasMore) {
        return;
    }

    this.isLoading = true;

    getContracts({
        accountFilter: this.accountFilter,
        stemFilter: this.stemFilter,
        startDate: this.startDateRange,
        endDate: this.endDateRange,
        pageSize: this.pageSize,
        offsetSize: this.offset
    })
    .then(result => {
      console.log(result);

        if (result.length < this.pageSize) {
            this.hasMore = false;
        }

        const newContracts = [];

        result.forEach(confirmation => {
            let contract = this.convertContract(confirmation);

            confirmation.SupplierNominations__r?.forEach(nomination => {
                contract._children.push(this.convertContract(nomination));
            });

            newContracts.push(contract);
        });

        this.data = isLoadMore
            ? [...this.data, ...newContracts]
            : newContracts;

        this.offset += result.length;
        console.log(this.data);

    }).catch((error) => {
      console.error(error);

    })
    .finally(() => {
        this.isLoading = false;
    });
  }

  // refreshContractTable() {
  //   getContracts({ accountFilter: this.accountFilter, portFilter: this.portFilter, vesselFilter: this.vesselFilter, startDate: this.startDateRange, endDate: this.endDateRange }).then((result) => {
  //     console.log(result);
  //     let contractList = [];
  //     result.forEach((confirmation) => {
  //       let contract = this.convertContract(confirmation)
  //       confirmation.SupplierNominations__r?.forEach(nomination => {
  //         contract._children.push(this.convertContract(nomination));
  //       })
  //       contractList.push(contract);
  //     })
  //     this.data = contractList
  //   })
  // }

  convertContract(row) {
    let contract = { ...row }
    contract.id = row.Id;
    contract.StemName = row.STEM__r.Name;
    contract.StemUrl = `/${row.STEM__c}`;
    contract.AccountName = row.Account__r.Name;
    contract.AccountUrl = `/${row.Account__c}`;
    contract.PortName = row.STEM__r.Port__r.Name;
    contract.PortUrl = `/${row.STEM__r.Port__c}`;
    contract.VesselName = row.STEM__r?.Vessel__r?.Name;
    contract.VesselUrl = `/${row.STEM__r.Vessel__c}`;
    contract.VesselImo = row.STEM__r?.Vessel__r?.IMO__c;
    contract.ExpectedDeliveryDate = row.STEM__r.Expected_Delivery_Date__c
      ? new Date(row.STEM__r.Expected_Delivery_Date__c).toLocaleDateString("en-GB")
      : ''
    contract.DeliveryDate = row.STEM__r.Delivery_Date__c
      ? new Date(row.STEM__r.Delivery_Date__c).toLocaleDateString("en-GB")
      : ''
    contract.RefCode =
      row.RecordType.Name === "Supplier Nomination"
        ? row.Supplier_RefCode__c
        : row.RefCode__c;
    contract.SignedFileName = row.RecordType.Name === "Supplier Nomination"
      ? row.STEM__r.Name + ' - CON S'
      : row.STEM__r.Name + ' - NOM B';
    contract.MovementUpload = row.RecordType.Name === "Supplier Nomination"
      ? null
      : row.STEM__r.Name + ' - Movement';
    contract.CompanyUpload = row.RecordType.Name === "Supplier Nomination"
      ? null
      : row.STEM__r.Name + ' - Company';
    contract.OthersUpload = row.RecordType.Name === "Supplier Nomination"
      ? null
      : row.STEM__r.Name + ' - Others';
    contract.SanctionFiles = row.RecordType.Name === "Supplier Nomination"
      ? true
      : false;
    contract.rowClass =
      row.RecordType.Name === "Supplier Nomination"
       ? 'orange-row'
       : 'blue-row'
    contract.PDFUrl = row.File__c ? row.File__c.split('/').pop() : null;
    if (row.ContentDocumentLinks && Array.isArray(row.ContentDocumentLinks) && row.ContentDocumentLinks.length > 0) {
      contract.UploadedFileUrl = row.RecordType.Name === "Supplier Nomination"
        ? row.ContentDocumentLinks[0].ContentDocument.Id
        : row.ContentDocumentLinks.find(cdLink => cdLink.ContentDocument.Title.includes('NOM B'))?.ContentDocument.Id;
      contract.UploadedFileName = row.RecordType.Name === "Supplier Nomination"
        ? row.ContentDocumentLinks[0].ContentDocument.Title.split('-').pop()
        : row.ContentDocumentLinks.find(cdLink => cdLink.ContentDocument.Title.includes('NOM B'))?.ContentDocument.Title.split('-').pop();

      contract.UploadedMovementFileUrl = row.RecordType.Name === "Supplier Nomination"
        ? ''
        : row.ContentDocumentLinks.find(cdLink => cdLink.ContentDocument.Title.includes('Movement'))?.ContentDocument.Id;
      contract.UploadedMovementFileName = row.RecordType.Name === "Supplier Nomination"
        ? ''
        : row.ContentDocumentLinks.find(cdLink => cdLink.ContentDocument.Title.includes('Movement'))?.ContentDocument.Title.split('-').pop();

      contract.UploadedCompanyFileUrl = row.RecordType.Name === "Supplier Nomination"
        ? ''
        : row.ContentDocumentLinks.find(cdLink => cdLink.ContentDocument.Title.includes('Company'))?.ContentDocument.Id;
      contract.UploadedCompanyFileName = row.RecordType.Name === "Supplier Nomination"
        ? ''
        : row.ContentDocumentLinks.find(cdLink => cdLink.ContentDocument.Title.includes('Company'))?.ContentDocument.Title.split('-').pop();

      contract.UploadedOthersFileUrl = row.RecordType.Name === "Supplier Nomination"
        ? ''
        : row.ContentDocumentLinks.find(cdLink => cdLink.ContentDocument.Title.includes('Others'))?.ContentDocument.Id;
      contract.UploadedOthersFileName = row.RecordType.Name === "Supplier Nomination"
        ? ''
        : row.ContentDocumentLinks.find(cdLink => cdLink.ContentDocument.Title.includes('Others'))?.ContentDocument.Title.split('-').pop();
    }

    if(row.RecordType.Name !== "Supplier Nomination"){
      contract._children = [];
    }
    return contract;
  }

  resetLoading() {
    this.offset = 0;
    this.hasMore = true;
    this.data = [];
  }

  handleChangeAccountFilter(event) {
    this.accountFilter = event.detail.value;
    this.resetLoading();
    this.loadContracts(false);
  }

  handleChangeStemFilter(event) {
    this.stemFilter = event.detail.value;
    this.resetLoading();
    this.loadContracts(false);
  }

  handleChangeStartDateRange(event) {
    this.startDateRange = event.detail.value;
    this.resetLoading();
    this.loadContracts(false);
  }

  handleChangeEndDateRange(event) {
    this.endDateRange = event.detail.value;
    this.resetLoading();
    this.loadContracts(false);
  }

  handleLoadMore() {
    this.loadContracts(true);
  }

  handleUploadFinished(event) {
    try {
      event.stopPropagation();
      let temporaryNominations = JSON.parse(JSON.stringify(this.data));
      console.log(JSON.parse(JSON.stringify(event.detail.data)));

      const updatedElement = this.updateNominationInTree(
        temporaryNominations,
        event.detail.data.recordId,
        event.detail.data.fileName
      );

      if (updatedElement) {
        const fields = {};
        fields[Nomination_Received.fieldApiName] = updatedElement.Received__c;
        fields[Nomination_ID_FIELD.fieldApiName] = updatedElement.Id;

        const recordInput = { fields };

        updateRecord(recordInput)
          .then(() => {
            this.resetLoading();
            this.loadContracts(false);
          })
          .catch(error => {
            console.error(error);
            this.resetLoading();
          });
      } else{
        this.resetLoading();
        this.loadContracts(false);
      }
    } catch (error) {
      console.error(error)
    }
  }

  updateNominationInTree(data, recordId, fileName) {
    for (let element of data) {
      console.log(fileName);

      if (element.Id === recordId && (fileName.includes('CON S') || fileName.includes('NOM B'))) {
        element.Received__c = '🟢';
        return element;
      }

      if (element._children && element._children.length) {
        const found = this.updateNominationInTree(element._children, recordId, fileName);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }

  handleRowSelection(event) {
    const selected = event.detail.selectedRows;
    const parentIds = this.data.map(row => row.id);

    const parentRows = selected.filter(row => parentIds.includes(row.id));

    this.selectedRows = parentRows.map(row => row.id);
  }

  async handleUploadVesselReports(event) {
    const vesselsToProcess = this.data
      .filter(row => this.selectedRows.includes(row.id) && Boolean(row.VesselImo) === true && Boolean(row.UploadedMovementFileUrl) === false)
      .map(row => {
        return {
          imo: row.VesselImo,
          recordId: row.id,
          fileName: row.STEM__r.Name + ' - Movement.pdf',
          contentDocumentId: row.UploadedMovementFileUrl
        }
      });
    const vesselsWithMovement = this.data
      .filter(row => this.selectedRows.includes(row.id) && Boolean(row.VesselImo) === true && Boolean(row.UploadedMovementFileUrl) === true)
      .map(row => {
        return {
          imo: row.VesselImo,
          recordId: row.id,
          fileName: row.STEM__r.Name + ' - Movement.pdf',
          contentDocumentId: row.UploadedMovementFileUrl
        }
      });
    console.log(vesselsToProcess);
    this.isLoading = true;
    if (vesselsToProcess.length > 0) {
      try {
        await runVesselUpload({ vesselsJson: JSON.stringify(vesselsToProcess) });
        const message = vesselsWithMovement.length > 0
          ? "Processing... Note: " + vesselsWithMovement.length + " movement reports have already been uploaded and will be skipped."
          : "Processing..."
        this.dispatchEvent(
          new ShowToastEvent({
            title: 'Started',
            message: message,
            variant: 'warning'
          })
        );
      } catch (error) {
        this.isLoading = false;
        this.dispatchEvent(
          new ShowToastEvent({
            title: 'Error',
            message: error.body.message,
            variant: 'error'
          })
        );
      }
    } else{
      this.dispatchEvent(
        new ShowToastEvent({
          title: 'Error',
          message: 'Please select items where IMO is set and Movement.pdf is not uploaded',
          variant: 'error'
        })
      );
      this.isLoading = false;
    }

  }

  async handleUploadCompanyReports(event) {
    const vesselsToProcess = this.data
      .filter(row => this.selectedRows.includes(row.id) && Boolean(row.UploadedCompanyFileUrl) === false)
      .map(row => {
        return {
          accountName: row.AccountName ? row.AccountName.split(/\s+/).slice(0, 3).join(' ') : '',
          recordId: row.id,
          fileName: row.STEM__r.Name + ' - Company.pdf',
          contentDocumentId: row.UploadedCompanyFileUrl
        }
      });
    const vesselsWithCompany = this.data
      .filter(row => this.selectedRows.includes(row.id) && Boolean(row.UploadedCompanyFileUrl) === true)
      .map(row => {
        return {
          accountName: row.AccountName ? row.AccountName.split(/\s+/).slice(0, 3).join(' ') : '',
          recordId: row.id,
          fileName: row.STEM__r.Name + ' - Company.pdf',
          contentDocumentId: row.UploadedCompanyFileUrl
        }
      });
    console.log(vesselsToProcess);
    this.isLoading = true;
    if (vesselsToProcess.length > 0) {
      try {
        await runCompanyUpload({ vesselsJson: JSON.stringify(vesselsToProcess) });
        const message = vesselsWithCompany.length > 0
          ? "Processing... Note: " + vesselsWithCompany.length + " company reports have already been uploaded and will be skipped."
          : "Processing..."
        this.dispatchEvent(
          new ShowToastEvent({
            title: 'Started',
            message: message,
            variant: 'warning'
          })
        );
      } catch (error) {
        this.isLoading = false;
        this.dispatchEvent(
          new ShowToastEvent({
            title: 'Error',
            message: error.body.message,
            variant: 'error'
          })
        );
      }
    } else{
      this.dispatchEvent(
        new ShowToastEvent({
          title: 'Error',
          message: 'Please select items where Company.pdf is not uploaded',
          variant: 'error'
        })
      );
      this.isLoading = false;
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

  _addMonths(date, months) {
    const result = new Date(date);
    const day = result.getDate();

    result.setMonth(result.getMonth() + months);

    if (result.getDate() < day) {
        result.setDate(0);
    }
    return result;
  }
}