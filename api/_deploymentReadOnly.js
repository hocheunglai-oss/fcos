/** A Preview or explicitly read-only CI deployment cannot grant mutation authority. */
export function isDeploymentReadOnly(env = process.env) {
  return String(env.VERCEL_ENV || '').trim().toLowerCase() === 'preview'
    || String(env.FCOS_ENABLE_READ_ONLY_CI || '').trim().toLowerCase() === 'true';
}

export function requireDeploymentMutationAllowed(mutation, env = process.env) {
  if (!mutation || !isDeploymentReadOnly(env)) return;
  throw Object.assign(new Error('This verification environment permits read-only operations.'), {
    status: 403,
    code: 'FCOS_DEPLOYMENT_READ_ONLY',
  });
}
