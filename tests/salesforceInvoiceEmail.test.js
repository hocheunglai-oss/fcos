import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const modalUrl = new URL('../force-app/main/default/lwc/fcbEmailInvoiceModal/fcbEmailInvoiceModal.js', import.meta.url);

async function loadModal({ getEmailData, sendEmail, attachment, inputs = [] }) {
  let source = await readFile(modalUrl, 'utf8');
  source = source
    .replace("import { api, track, LightningElement } from 'lwc';", 'const { api, track, LightningElement } = __mocks.lwc;')
    .replace("import sendEmail from '@salesforce/apex/EmailInvoiceController.sendEmail';", 'const sendEmail = __mocks.sendEmail;')
    .replace("import getEmailData from '@salesforce/apex/EmailInvoiceController.getEmailData';", 'const getEmailData = __mocks.getEmailData;')
    .replace("import { ShowToastEvent } from 'lightning/platformShowToastEvent';", 'const { ShowToastEvent } = __mocks.toast;')
    .replaceAll('@api', '')
    .replaceAll('@track', '')
    .replace('export default class FcbEmailInvoiceModal', 'class FcbEmailInvoiceModal')
    .concat('\nmodule.exports = FcbEmailInvoiceModal;');

  class LightningElement {
    constructor() {
      this.events = [];
      this.template = {
        querySelector: (selector) => selector === 'c-fcb-email-stem-line-item' ? attachment : null,
        querySelectorAll: () => inputs
      };
    }

    dispatchEvent(event) {
      this.events.push(event);
      return true;
    }
  }

  class ShowToastEvent {
    constructor(detail) {
      this.type = 'toast';
      Object.assign(this, detail);
    }
  }

  const module = { exports: {} };
  new Function('__mocks', 'module', source)({
    lwc: { api: () => {}, track: () => {}, LightningElement },
    sendEmail,
    getEmailData,
    toast: { ShowToastEvent }
  }, module);
  return new module.exports();
}

function emailData() {
  return {
    toAddress: 'accounts@example.test',
    toCCAddress: '',
    toBCCAddress: '',
    subject: 'Invoice',
    textBody: 'Please find attached',
    stemLineItems: [],
    stemExtraCosts: []
  };
}

function validInput() {
  return { reportValidity() {}, checkValidity() { return true; } };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('a rejected Apex send remains open, exposes the FCOS recovery task, clears busy state, and permits retry', async () => {
  let attempts = 0;
  const attachment = { getDocuments() {}, getSelectedDocuments() { return ['069xx']; } };
  const component = await loadModal({
    attachment,
    inputs: [validInput()],
    getEmailData: async () => emailData(),
    sendEmail: async () => {
      attempts += 1;
      if (attempts === 1) throw { body: { message: 'Confirm buyer charges in FCOS before creating the final Buyer Invoice. https://fcos.fcuno.com/payment-collections' } };
    }
  });

  await component.openModal('a0Hfu00000HibwXEAR', [{ Id: 'a0Kfu00000LKqZSEA1' }]);
  await component.sendEmail();

  assert.equal(component.isModalOpen, true);
  assert.equal(component.emailTemplate.toAddress, 'accounts@example.test');
  assert.equal(component.actionExecuted, true);
  assert.equal(component.isSending, false);
  assert.match(component.operationError, /Confirm buyer charges/i);
  assert.equal(component.fcosTaskUrl, 'https://fcos.fcuno.com/payment-collections?tab=variable-charges&stemId=a0Hfu00000HibwXEAR');
  assert.equal(component.events.at(-1).title, 'Invoice email not sent');
  assert.equal(component.events.at(-1).mode, 'sticky');

  await component.sendEmail();
  assert.equal(attempts, 2);
  assert.equal(component.isModalOpen, false);
});

test('duplicate Send Email clicks issue one Apex request while the first request is pending', async () => {
  const request = deferred();
  let attempts = 0;
  const component = await loadModal({
    attachment: { getDocuments() {}, getSelectedDocuments() { return ['069xx']; } },
    inputs: [validInput()],
    getEmailData: async () => emailData(),
    sendEmail: () => {
      attempts += 1;
      return request.promise;
    }
  });

  await component.openModal('a0Hfu00000HibwXEAR', [{ Id: 'a0Kfu00000LKqZSEA1' }]);
  const firstSend = component.sendEmail();
  const secondSend = component.sendEmail();
  assert.equal(attempts, 1);
  assert.equal(component.isSending, true);

  request.resolve();
  await Promise.all([firstSend, secondSend]);
  assert.equal(component.isSending, false);
});

test('Send Email remains blocked while the email template is loading', async () => {
  const loading = deferred();
  let attempts = 0;
  const component = await loadModal({
    attachment: { getDocuments() {}, getSelectedDocuments() { return ['069xx']; } },
    inputs: [validInput()],
    getEmailData: () => loading.promise,
    sendEmail: async () => { attempts += 1; }
  });

  const opening = component.openModal('a0Hfu00000HibwXEAR', [{ Id: 'a0Kfu00000LKqZSEA1' }]);
  await component.sendEmail();
  assert.equal(component.actionExecuted, false);
  assert.equal(component.isSendDisabled, true);
  assert.equal(attempts, 0);

  loading.resolve(emailData());
  await opening;
  assert.equal(component.actionExecuted, true);
});

test('email-template load rejection stays visible and restores the modal from its busy state', async () => {
  const component = await loadModal({
    attachment: { getDocuments() {}, getSelectedDocuments() { return []; } },
    getEmailData: async () => { throw new Error('Buyer email settings are unavailable'); },
    sendEmail: async () => {}
  });

  await component.openModal('a0Hfu00000HibwXEAR', [{ Id: 'a0Kfu00000LKqZSEA1' }]);
  assert.equal(component.isModalOpen, true);
  assert.equal(component.actionExecuted, true);
  assert.equal(component.operationError, 'Buyer email settings are unavailable');
  assert.equal(component.events.at(-1).title, 'Invoice email not sent');
});

test('a synchronous attachment selector failure is surfaced without calling Apex or discarding the drafted email', async () => {
  let attempts = 0;
  const component = await loadModal({
    attachment: {
      getDocuments() {},
      getSelectedDocuments() { throw new Error('Attachment list is not ready'); }
    },
    inputs: [validInput()],
    getEmailData: async () => emailData(),
    sendEmail: async () => { attempts += 1; }
  });

  await component.openModal('a0Hfu00000HibwXEAR', [{ Id: 'a0Kfu00000LKqZSEA1' }]);
  await component.sendEmail();
  assert.equal(attempts, 0);
  assert.equal(component.isModalOpen, true);
  assert.equal(component.emailTemplate.subject, 'Invoice');
  assert.equal(component.actionExecuted, true);
  assert.equal(component.isSending, false);
  assert.equal(component.operationError, 'Attachment list is not ready');
});

test('Master Contract failures use the fixed Master Contracts task instead of the variable-charge task', async () => {
  const component = await loadModal({
    attachment: { getDocuments() {}, getSelectedDocuments() { return ['069xx']; } },
    inputs: [validInput()],
    getEmailData: async () => emailData(),
    sendEmail: async () => { throw { body: { message: 'Master Contract approval is required in FCOS.' } }; }
  });

  await component.openModal('a0Hfu00000HibwXEAR', [{ Id: 'a0Kfu00000LKqZSEA1' }]);
  await component.sendEmail();
  assert.equal(component.fcosTaskUrl, 'https://fcos.fcuno.com/master-contracts');
  assert.equal(component.fcosTaskLabel, 'Open FCOS task');
});

test('a successful send closes and refreshes the modal exactly once', async () => {
  const component = await loadModal({
    attachment: { getDocuments() {}, getSelectedDocuments() { return ['069xx']; } },
    inputs: [validInput()],
    getEmailData: async () => emailData(),
    sendEmail: async () => {}
  });
  await component.openModal('a0Hfu00000HibwXEAR', [{ Id: 'a0Kfu00000LKqZSEA1' }]);

  let closeCalls = 0;
  const closeModal = component.closeModal.bind(component);
  component.closeModal = () => {
    closeCalls += 1;
    return closeModal();
  };
  await component.sendEmail();

  assert.equal(closeCalls, 1);
  assert.equal(component.isModalOpen, false);
  assert.equal(component.events.filter((event) => event.type === 'refreshinvoicetable').length, 1);
  assert.equal(component.events.filter((event) => event.type === 'toast' && event.variant === 'success').length, 1);
});
