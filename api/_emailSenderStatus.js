import { listGraphEmailRegistry } from './_graphEmail.js';

export async function emailSenderStatus(client, env = process.env) {
  if (!client) {
    const error = new Error('Email sender status requires an authenticated server database client.');
    error.status = 500;
    throw error;
  }
  return listGraphEmailRegistry(client, env);
}
