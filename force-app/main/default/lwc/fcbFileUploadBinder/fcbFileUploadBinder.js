import {LightningElement, track, api, wire} from 'lwc';
import uploadFile from '@salesforce/apex/FileUploadBinderController.uploadFile';
import getFiles from '@salesforce/apex/FileUploadBinderController.getFiles';
import { refreshApex } from "@salesforce/apex";
import { deleteRecord } from 'lightning/uiRecordApi';

export default class FcbFileUploadBinder extends LightningElement {

    @api relatedTo;
    @api uploaderLabel;
    @api uploaderValue;
    @api disabled;
    @track uploadedFile;
    @track allowedExtensions = ['.jpg,.jpeg,.pdf,.png'];
    @track fileId;
    @track fileName;
    @track fileType;
    @track fileUrls = [];
    @track wiredFileUrls = [];
    error;
    
    handleUploadFinished(event) {
        let {documentId, name} = event.detail.files[0];
        this.fileId = documentId;
        this.fileName = name.split(',')[0];
        const extension = name.split('.').pop().toLowerCase();
        this.fileType = extension;

        this.dispatchEvent(new CustomEvent('change'));
    }

    @wire(getFiles, { objectId: "$relatedTo", title: "$uploaderValue" })
    getFiles(value) { 
      this.wiredFileUrls = value;
      const { data, error } = value;  
      if (data) {
        this.fileUrls = JSON.parse(data);
        console.log(this.fileUrls);
        
        this.error = undefined;
      } else if (error) {
        console.error(error)
        this.error = error;
      }
    }

    @api
    async bindWithParent() {
        if (this.fileId) {
            await uploadFile({
                fileId: this.fileId,
                relatedTo: this.relatedTo,
                title: this.uploaderValue,
                extension: this.fileType
            });
            await refreshApex(this.wiredFileUrls);
            this.handleReset();
        }
    }

    removeFile() {
        deleteRecord(this.fileId);
        this.handleReset();
    }

    handleReset(){
        this.fileId = null;
        this.fileName = null;
        this.fileType = null;
    }
}
