import { authenticatedFunction } from './_authenticatedFunction.js';
import { emailRouterBackgroundSyncHandler } from './_emailRouterBackgroundSync.js';

export default authenticatedFunction({
  handlerName: 'emailRouterBackgroundSync',
  moduleId: 'email_router',
  mutation: false,
  execute(body, req, context) {
    return emailRouterBackgroundSyncHandler(req, body, {
      client: context.client,
      profile: context.profile,
    });
  },
});
