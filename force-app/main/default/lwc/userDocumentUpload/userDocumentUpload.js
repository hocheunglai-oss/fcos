import {api, LightningElement, track, wire} from "lwc";
import LightningConfirm from 'lightning/confirm';
import {NavigationMixin} from "lightning/navigation";
import {updateRecord} from "lightning/uiRecordApi";
import {refreshApex} from "@salesforce/apex";
import {ShowToastEvent} from "lightning/platformShowToastEvent";
import getNominationTypesByOpportunityId from "@salesforce/apex/NominationController.getNominationTypesByOpportunityId";
import getStemItems from "@salesforce/apex/NominationController.getStemItems";
import updateTasksOwner from '@salesforce/apex/ReconfirmProcessing.updateTasksOwner';
import Nomination_Received from '@salesforce/schema/Nomination__c.Received__c';
import Nomination_ID_FIELD from '@salesforce/schema/Nomination__c.Id';
import {publish, MessageContext} from "lightning/messageService";
import messageChannel from "@salesforce/messageChannel/MyChannel__c";
import { registerListener } from "c/pubsub";
import { CurrentPageReference } from 'lightning/navigation';
import { createRecord} from 'lightning/uiRecordApi';
import { subscribe } from 'lightning/empApi';


const columnList = [
  {
    label: "PDF",
    type: "text",
    fieldName: "PDF__c",
    initialWidth: 20,
    cellAttributes: {
      class: {
        fieldName: 'cancelledBackground'
      }
    }
  },
  {
    label: "RefCode",
    type: "navigationLink",
    fieldName: "RefCode",
    typeAttributes: {
      fileUrl: { fieldName: "PDFUrl" },
      refCode: { fieldName: "RefCode" }
    },
    initialWidth: 115,
    cellAttributes: {
      class: {
        fieldName: 'cancelledBackground'
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
    cellAttributes: {
      class: {
        fieldName: 'originatedClass'
      }
    }
  },
  {
    label: "Payment Term",
    fieldName: "Payment_Term__c",
    cellAttributes: {
      class: {
        fieldName: 'originatedClass'
      }
    },
    initialWidth: 50,
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
    initialWidth: 250,
    cellAttributes: {
      class: {
        fieldName: 'cancelledBackground'
      }
    }
  },
  {
    label: "Replaced",
    fieldName: "IsReplaced",
    type: "boolean",
    cellAttributes: {
      class: {
        fieldName: 'cancelledBackground'
      }
    }
  },
  {
    label: "Sent Status",
    fieldName: "Sent",
    type: "text",
    cellAttributes: {
      class: {
        fieldName: 'cancelledBackground'
      }
    }
  },
  {
    label: "Received Status",
    fieldName: "Received",
    type: "text",
    cellAttributes: {
      class: {
        fieldName: 'cancelledBackground'
      }
    }
  },
  {
    label: "Remarks",
    fieldName: "Remarks__c",
    editable: true,
    cellAttributes: {
      class: {
        fieldName: 'cancelledBackground'
      }
    }
  },
  {
    label: "BT/ST",
    type: "buyerSupplierTrader",
    fieldName: "Buyer_Supplier_Trader__c",
    typeAttributes: {
      parentId: { fieldName: "Id" },
      buyerSupplierTraderValue: { fieldName: "Buyer_Supplier_Trader__c" },
    },
    initialWidth: 150,
    cellAttributes: {
      class: {
        fieldName: 'cancelledBackground'
      }
    }
  },
  {
    label: "Contact",
    fieldName: "Contact__c",
    type: "contactType",
    initialWidth : 200,
    typeAttributes: {
      selectedContactId: {fieldName: "Contact__c"},
      selectedContactName: {fieldName: "contactName"},
      parentId: {fieldName: "Id"}
    },
    editable: true,
    sortable: true
  },
  {
    label: "Commission Advice",
    type: "navigationLink",
    fieldName: "AdditionalText",
    typeAttributes: {
      fileUrl: { fieldName: "AdditionalPDFUrl" },
      refCode: { fieldName: "AdditionalText" }
    },
    initialWidth: 115,
    cellAttributes: {
      class: {
        fieldName: 'cancelledBackground'
      }
    }
  },
  // {
  //   label: "Sanctions Complinace",
  //   type: "navigationLink",
  //   fieldName: "sanctionsComplianceText",
  //   typeAttributes: {
  //     fileUrl: { fieldName: "sanctionsComplianceUrl" },
  //     refCode: { fieldName: "sanctionsComplianceText" }
  //   },
  //   initialWidth: 115,
  //   cellAttributes: {
  //     class: {
  //       fieldName: 'cancelledBackground'
  //     }
  //   }
  // },
];


const FCBS_NAME = 'FRATELLI COSULICH BUNKERS (S) PTE LTD';
const TRUSTEE_SERVICE = 'TRUSTEE SERVICE';

export default class PatientDocumentUpload extends NavigationMixin(
  LightningElement
) {
  @track data = [];
  @track columns = columnList;
  @api recordId;

  stems;
  @track _nominations;
  contentDocumentIds;
  isLoading = false;
  @wire(MessageContext)
  messageContext;

  @wire(CurrentPageReference) pageRef;
  quotesEvent = '/event/SynchronizeBrokers__e';

  get nominations() {
    return this._nominations;
  }

  set nominations(data) {
    if (data) {
      let stemIds = data.map(item => item.STEM__c)
      getStemItems({stemIds: stemIds}).then(stems => {
      this.stems = stems;
      let preparedSuppliers = [];
        data.forEach(nomination => {
          let preparedSupplier = { ...nomination };
          let foundStem = stems.find(stem => stem.Id === nomination.STEM__c)
          let cancelledBackground = nomination.RecordType.Name === "Buyer Confirmation"
          ? foundStem.Invoice_Status__c == 'Cancelled'
            ? 'slds-color__background_gray-7'
            : ''
          : foundStem.STEM_Line_Items__r?.filter(lineItem => lineItem.Original_Supplier__c === nomination.Account__c && lineItem.Payment_Term__c === nomination.Payment_Term__c && lineItem.Cancelled__c === false).length > 0
            || foundStem.STEM_Extra_Costs__r?.filter(extraCost => extraCost.Supplier__c === nomination.Account__c && extraCost.Payment_Term__c === nomination.Payment_Term__c && extraCost.Cancelled__c === false).length > 0
            ? ''
            : 'slds-color__background_gray-7';
          preparedSupplier.cancelledBackground = cancelledBackground
          preparedSupplier.RefCode =
              nomination.RecordType.Name === "Supplier Nomination"
                  ? nomination.Supplier_RefCode__c
                  : nomination.RefCode__c;
          preparedSupplier.Id = nomination.Id;
          preparedSupplier.id = nomination.Id;
          preparedSupplier.PDF__c = nomination.PDF__c
          preparedSupplier.Enquiry__c = nomination.Enquiry__c;
          preparedSupplier.AccountName = nomination.Account__r.Name;
          preparedSupplier.Contact__c = nomination.Contact__c;
          preparedSupplier.contactName = nomination.Contact__c ? nomination.Contact__r.Name : '';
          preparedSupplier.AccountUrl = `/${nomination.Account__c}`;
          preparedSupplier.originatedClass = nomination.Account__r.Inactive_Suspended__c === false
            ? cancelledBackground
            : 'slds-theme_warning';
          preparedSupplier.Type = nomination.Type__c;
          preparedSupplier.Remarks__c = nomination.Remarks__c;
          preparedSupplier.Expected_Delivery_Date__c = nomination.Expected_Delivery_Date__c;
          preparedSupplier.Sent = nomination.Sent__c;
          preparedSupplier.Received = nomination.Received__c;
          preparedSupplier.STEM__c = nomination.STEM__c;
          preparedSupplier.Buyer_Supplier_Trader__c = nomination.Buyer_Supplier_Trader__c;
          preparedSupplier.Payment_Term__c = nomination.Payment_Term__c;
          preparedSupplier.IsReplaced = nomination.Replaced__c;
          if (!nomination.Name.includes("Supplier Confirmation")) {
            let portId = nomination.Name.split("-").pop();
            preparedSupplier.Name = nomination.Name.replace(portId, nomination.Port__r.Name);
          } else {
            preparedSupplier.Name = nomination.Name;
          }

          let fileId = nomination.File__c ? nomination.File__c.split('/').pop() : null;
          preparedSupplier.PDFUrl = fileId;
          preparedSupplier.AdditionalPDFUrl = nomination.Additional_File__c ? nomination.Additional_File__c.split('/').pop() : null;
          preparedSupplier.AdditionalText = nomination.Additional_File__c ? 'Commission Advice' : null;
          preparedSupplier.SignedFileName = nomination.RecordType.Name === "Supplier Nomination"
            ? nomination.STEM__r.Name + ' - CON S'
            : nomination.STEM__r.Name + ' - NOM B'
          preparedSupplier.sanctionsComplianceText = nomination.Sanctions_Compliance_File__c ? 'Sanctions Compliance' : null;;
          preparedSupplier.sanctionsComplianceUrl = nomination.Sanctions_Compliance_File__c ? nomination.Sanctions_Compliance_File__c.split('/').pop() : null;
          preparedSuppliers.push(preparedSupplier);
        });
        this.data = preparedSuppliers;
        this.error = undefined;
        this._nominations = data;
        this.contentDocumentIds = data.map(nomination => {
          if(nomination.File__c){
            return nomination.File__c.split('/').pop()
          }
        });
      })
    } else if (error) {
      this.error = error;
    }
    this._nominations = data;
  }

  connectedCallback() {
    getNominationTypesByOpportunityId({ enquiryId: this.recordId }).then((result) => {
      this.nominations = result;
    })
    registerListener("refreshNominations",this.handleRefreshNominations,this);
    this.handleSubscribe();
  }

  handleSubscribe() {
    subscribe(this.quotesEvent, -1, (response) => this.messageCallbackProcessor(response)).then(response => {
        this.subscription = response;
    }).catch(error=>{
        console.log(error);
    });
  }

  messageCallbackProcessor(response) {
    getNominationTypesByOpportunityId({ enquiryId: this.recordId }).then((result) => {
      this.nominations = result;
      this.isLoading = false;
    });
  }

  constructor() {
    super();
    this.columns = this.columns.concat([
      {
        type: "action",
        typeAttributes: { rowActions: this.getRowActions },
        cellAttributes: {
          class: {
            fieldName: "cancelledBackground",
          },
        },
      },
    ]);
  }

  getRowActions(row, doneCallback) {
    try {
      let actions = [
        { label: "View", name: "view" },
      ];
      let stemIds = [row.STEM__c];
      getStemItems({ stemIds: stemIds }).then(stems => {
        if (row.STEM__c && row.Buyer_Supplier_Trader__c) {
          let foundStem = stems.find(stem => stem.Id === row.STEM__c);
          const lineItemsForSupplier =
            foundStem.STEM_Line_Items__r
              ?.filter(li => li.Original_Supplier__c === row.Account__c) || [];

          const extraCostsForSupplier =
            foundStem.STEM_Extra_Costs__r
              ?.filter(ec => ec.Supplier__c === row.Account__c) || [];

          const hasTrusteeServiceExtraCost =
            extraCostsForSupplier.some(
              ec => ec.Product2Id__r?.Name === TRUSTEE_SERVICE
            );

          const hasOnlyTrusteeServiceExtraCosts =
            extraCostsForSupplier.length > 0 &&
            extraCostsForSupplier.every(
              ec => ec.Product2Id__r?.Name === TRUSTEE_SERVICE
            );
          if (row.STEM__r.Invoice_Status__c !== "Cancelled") {
            actions = actions.concat([
              { label: "N/A", name: "n_a" },
              { label: "Fresh Contract Form", name: "fresh_contract_form" },
              { label: "Last Saved Contract Form", name: "last_saved_contract_form" },
            ])
            if (!(
              row.RecordType.Name === "Supplier Nomination" &&
              row.AccountName === FCBS_NAME &&
              lineItemsForSupplier.length === 0 &&
              hasOnlyTrusteeServiceExtraCosts
            )) {
              actions.push({ label: row.RecordType.Name === 'Buyer Confirmation' ? "Send Email (Confirmation)" : "Send Email (Nomination)", name: "send_email" });
            }
          }
          if (
            row.RecordType.Name === "Supplier Nomination" &&
            row.AccountName === FCBS_NAME &&
            hasTrusteeServiceExtraCost
          ) {
            actions.push({
              label: 'Send Email (Trustee)',
              name: 'send_email_trustee'
            });
          }
          if (row.STEM__r.Buyer_Broker__c) {
            if (row.RecordType.Name === 'Buyer Confirmation' && row.STEM__r.Buyer_Broker__c) {
              if (!row.STEM__r.Buyer_Broker__r.Hidden_Broker__c && !row.STEM__r.Buyer_Broker__r.Hidden_Broker_Company__c) {
                if (!row.STEM__r.Buyer_Broker__r.Company_Code__c) {
                  actions.push({ label: "Send Email (Commission)", name: "send_additional_email" })
                } else if (!row.STEM__r.Buyer_Broker__r.Company_Code__c.startsWith('HK*BC')) {
                  actions.push({ label: "Send Email (Commission)", name: "send_additional_email" })
                }
              }
            }
          }
          if (row.Account__r.Name.includes("**NEW SUPPLIER")) {
            actions.push({ label: "Clone", name: "clone" });
            actions.push({ label: "Deprecate", name: "deprecate" })
          }
          // if(row.RecordType.Name === 'Buyer Confirmation'){
          //   actions.push({ label: "Upload Sanctions Compliance", name: "uploadSanctionsCompliance" });
          // }
        }
        setTimeout(() => {
          doneCallback(actions);
        }, 200);
      })

    } catch (error) {
      console.error(error);

    }

  }

  handleRefreshNominations(ref) {
    if (ref) {
      this.handleTableRefresh();
    }
  }

  handleCancel(event){
    let message = {};
    publish(this.messageContext, messageChannel, message);
  }

  handleSelectedBuyerSupplierTrader(event) {
    let buyerSupplierTraderValue = event.detail.buyerSupplierTraderValue;
    let rowId = event.detail.rowId;

    const fields = {
      Id: rowId,
      Buyer_Supplier_Trader__c: buyerSupplierTraderValue
    };

    updateRecord({ fields })
      .then(() => {
        updateTasksOwner({ nominationIds: [rowId] })
          .then(() => {
            this.dispatchEvent(
              new ShowToastEvent({
                title: "Success",
                message: "Trader updated",
                variant: "success"
              })
            );

            this.handleTableRefresh();

            let dataTable = this.template.querySelector("c-file-upload-data-table");
            if (dataTable) {
              dataTable.draftValues = dataTable.draftValues.filter(dv => dv.Id !== rowId);
            }

            let message = { recordSaved: this.recordSaved };
            publish(this.messageContext, messageChannel, message);
          });
      })
      .catch((error) => {
        this.dispatchEvent(
          new ShowToastEvent({
            title: "Error",
            message: error.body?.output?.errors[0]?.message || error.message,
            variant: "error"
          })
        );
        console.error(error);
      });
  }

  handleSelectedContact(event) {
    let selectedContactRecordId = event.detail.selectedContactRecordId;
    let rowId = event.detail.rowId;
    let draftValues = [
      ...this.template.querySelector("c-file-upload-data-table").draftValues
    ];
    const foundIndex = draftValues.findIndex((x) => x.Id === rowId);

    if (foundIndex !== -1) {
      let updated = {
        ...draftValues[foundIndex],
        Contact__c: selectedContactRecordId
      };
      draftValues[foundIndex] = updated;
    } else {
      draftValues.push({
        Id: rowId,
        Contact__c: selectedContactRecordId
      });
    }
    console.log(draftValues);

    this.template.querySelector("c-file-upload-data-table").draftValues = draftValues;
  }

  handleSave(event) {
    let recordsToUpdate = [];
    event.detail.draftValues.forEach((changedRecord) => {
      let record = this.data.find((value) => {
        return value.Id === changedRecord.Id;
      });
      if (record) {
        const fields = {};
        fields.Id = changedRecord.Id;
        fields.Contact__c = changedRecord.Contact__c;
        fields.Remarks__c = changedRecord.Remarks__c;
        recordsToUpdate.push({ fields });
      }
    });
    Promise.all(recordsToUpdate.map((record) => updateRecord(record)))
      .then((record) => {
        this.template.querySelector("c-file-upload-data-table").draftValues = [];
        let message = { recordSaved: this.recordSaved };
        publish(this.messageContext, messageChannel, message);
        this.handleTableRefresh();

      }).then((record) => {
      })
      .catch((error) => {
        this.dispatchEvent(
          new ShowToastEvent({
            title: "Error",
            message: error.body.output.errors[0].message,
            variant: "error"
          })
        );
        console.error(error)
      });
  }


  handleTableRefresh() {
    this.isLoading = true;
    getNominationTypesByOpportunityId({ enquiryId: this.recordId }).then((result) => {
      this.nominations = result;
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Success",
          message: "Contract updated",
          variant: "success",
        })
      );
      this.isLoading = false;
    });
  }

  getIconByStatus(status) {
    if (status === "Pending") return "utility:sync";
    else if (status === "Completed") return "utility:success";
    else if (status === "N/A") return "utility:unlinked";
    else return "";
  }

  async handleRowAction(event) {
    try {
      const action = event.detail.action;
    const row = event.detail.row;
    switch (action.name) {
      case "view":
        this[NavigationMixin.Navigate]({
          type: "standard__recordPage",
          attributes: {
            recordId: row.Id,
            objectApiName: "Nomination__c",
            actionName: "view",
          },
        });
        break;
      case "n_a":
        this.isLoading = true;
        const fields = {};
        fields["Id"] = row.Id;
        fields["Received__c"] = "🟡";
        fields["Sent__c"] = "🟡";
        const nominationForUpdate = { fields };
        updateRecord(nominationForUpdate)
          .then(() => {
            this.dispatchEvent(
              new ShowToastEvent({
                title: "Success",
                message: "Contract updated",
                variant: "success",
              })
            );
            getNominationTypesByOpportunityId({ enquiryId: this.recordId }).then((result) => {
              this.nominations = result;
              this.isLoading = false;
            })
          })
          .catch((error) => {
            this.dispatchEvent(
              new ShowToastEvent({
                title: "Error updating record",
                message: error.body.message,
                variant: "error",
              })
            );
          });
        break;
      case "send_email":
        if(row.File__c){
          let sendEmailModal = this.template.querySelector(
            "c-fcb-email-nomination-confirmation-modal"
          );
          sendEmailModal.openModal(row);
        } else{
          this.dispatchEvent(
            new ShowToastEvent({
              title: "Error",
              message: "No file has been created for this Contract",
              variant: "error",
            })
          );
        }
        break;
      case "send_additional_email":
        let sendAdditionalEmailModal = this.template.querySelector(
          "c-fcb-email-additional-confirmation-modal"
        );
        sendAdditionalEmailModal.openModal(row);
        break;
      case "send_email_trustee":
        let sendTrusteeEmailModal = this.template.querySelector(
          "c-fcb-email-trustee-modal"
        );
        sendTrusteeEmailModal.openModal(row);
        break;
      case "fresh_contract_form":
        let result = false;
        if (row.File__c) {
          result = await LightningConfirm.open({
            message: "Are you sure you would like to regenerate this Contract? This will override previous.",
            label: "Please Confirm",
            theme: 'warning',
          });
        }
        if(result || !row.File__c){
          if (row.RecordType.Name === 'Buyer Confirmation') {
            let contractFormModal = this.template.querySelector(
              "c-fcb-buyer-confirmation-form"
            );
            contractFormModal.openModal(row, false);
          } else {
            let contractFormModal = this.template.querySelector(
              "c-fcb-supplier-nomination-form"
            );
            contractFormModal.openModal(row, false);
          }
        }
        break;
      case "last_saved_contract_form":
        if (row.Last_Saved_Inputs__c) {
          let result = false;
          if (row.File__c) {
            result = await LightningConfirm.open({
              message: "Are you sure you would like to regenerate this Contract? This will override previous.",
              label: "Please Confirm",
              theme: 'warning',
            });
          }
          if (result || !row.File__c) {
            if (row.RecordType.Name === 'Buyer Confirmation') {
              let contractFormModal = this.template.querySelector(
                "c-fcb-buyer-confirmation-form"
              );
              contractFormModal.openModal(row, true);
            } else {
              let contractFormModal = this.template.querySelector(
                "c-fcb-supplier-nomination-form"
              );
              contractFormModal.openModal(row, true);
            }
          }
        } else {
          this.dispatchEvent(
            new ShowToastEvent({
              title: "Error",
              message: "No form has been created for this Contract",
              variant: "error",
            })
          );
        }
        break;
      case "clone":
        let cloneFields = {};
        cloneFields["Name"] = row.Name;
        cloneFields["Buyer_Confirmation__c"] = row.Buyer_Confirmation__c;
        cloneFields["Port__c"] = row.Port__c;
        cloneFields["Account__c"] = row.Account__c;
        cloneFields["RecordTypeId"] = row.RecordTypeId;
        cloneFields["Expected_Delivery_Date__c"] = new Date(row.Expected_Delivery_Date__c);
        cloneFields["Enquiry__c"] = row.Enquiry__c;
        cloneFields["STEM__c"] = row.STEM__c;
        cloneFields["RefCode__c"] = row.RefCode__c;
        let lastSupplierRefcodeIndex = this.data.filter(item => item.STEM__c === row.STEM__c && item.RecordTypeId === row.RecordTypeId)
          .map(item => item.Supplier_RefCode_Index__c)
          .sort()[0];
        cloneFields["Supplier_RefCode_Index__c"] = Number(lastSupplierRefcodeIndex) + 1;
        cloneFields["Buyer_Supplier_Trader__c"] = row.Buyer_Supplier_Trader__c;
        const recordInput = { apiName: 'Nomination__c', fields: cloneFields };
        createRecord(recordInput).then(() => {
          getNominationTypesByOpportunityId({ enquiryId: this.recordId }).then((result) => {
            this.nominations = result;
            this.dispatchEvent(
              new ShowToastEvent({
                title: "Success",
                message: "Contract cloned",
                variant: "success",
              })
            );
            this.isLoading = false;
          });
        })
        break;
      case "deprecate":
        this.isLoading = true;
        const fieldsToUpdate = {};
        fieldsToUpdate["Id"] = row.Id;
        fieldsToUpdate["Deprecated__c"] = true;
        const deprecatedNomination = { fields: fieldsToUpdate };
        updateRecord(deprecatedNomination)
          .then(() => {
            this.dispatchEvent(
              new ShowToastEvent({
                title: "Success",
                message: "Contract updated",
                variant: "success",
              })
            );
            getNominationTypesByOpportunityId({ enquiryId: this.recordId }).then((result) => {
              this.nominations = result;
              this.isLoading = false;
            })
          })
          .catch((error) => {
            this.dispatchEvent(
              new ShowToastEvent({
                title: "Error updating record",
                message: error.body.message,
                variant: "error",
              })
            );
          });
        break;
      // case 'uploadSanctionsCompliance':
      //   let uploadSanctionsComplianceModalWindow = this.template.querySelector(
      //     "c-fcb-upload-sanctions-compliance"
      //   );
      //   uploadSanctionsComplianceModalWindow.openModal(row.Id);
      //   break;
      default:
        break;
    }
    } catch (error) {
      console.error(error)
    }

  }

  handleUploadFinished(event) {
    try {
      event.stopPropagation();
      console.log(event.detail.data.recordId);

      let temporaryNominations = JSON.parse(JSON.stringify(this.nominations))
      temporaryNominations.find(element => {
        if(element.Id === event.detail.data.recordId){
          element.Received__c = '🟢';
          const fields = {};
          fields[Nomination_Received.fieldApiName] = element.Received__c;
          fields[Nomination_ID_FIELD.fieldApiName] =  element.Id;
          const recordInput = { fields };
          updateRecord(recordInput)
        }
      });
      this.nominations = temporaryNominations;
      //refreshApex(this.nominations);
    } catch (error) {
      console.error(error)
    }

  }
}