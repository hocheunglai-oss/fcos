import { authenticatedFunction } from './_authenticatedFunction.js';
import {
  workNotificationsList,
  workNotificationsRead,
  workNotificationsState,
} from './_workNotifications.js';

const OPERATIONS = Object.freeze({
  workNotificationsList: { mutation: false, execute: workNotificationsList },
  workNotificationsRead: { mutation: true, execute: workNotificationsRead },
  workNotificationsState: { mutation: true, execute: workNotificationsState },
});

export default authenticatedFunction({
  handlerName(req) {
    const requested = String(req?.headers?.['x-fcos-function-name'] || '');
    return Object.hasOwn(OPERATIONS, requested) ? requested : 'workNotifications';
  },
  mutation(req) {
    return String(req?.headers?.['x-fcos-function-name'] || '') !== 'workNotificationsList';
  },
  async execute(body, req, context) {
    const requested = String(req?.headers?.['x-fcos-function-name'] || '');
    const operation = OPERATIONS[requested];
    if (!operation) {
      throw Object.assign(new Error('Unsupported notification operation.'), {
        status: 404,
        code: 'FCOS_NOTIFICATION_OPERATION_UNKNOWN',
      });
    }
    return operation.execute(body, context);
  },
});
