export function publicApiErrorPayload(error, status, requestId) {
  const exposeMessage = status < 500 || error?.expose === true;
  const codeToken = String(error?.code || (status >= 500 ? 'FCOS_INTERNAL_ERROR' : 'FCOS_REQUEST_REJECTED'))
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .slice(0, 100) || 'FCOS_INTERNAL_ERROR';
  const message = exposeMessage
    ? String(error?.message || 'The FCOS request could not be completed.')
    : 'FCOS could not complete this operation. Use the request reference when reporting the problem.';
  const conflictDetails = status === 409 && error?.details !== undefined
    ? JSON.parse(JSON.stringify(error.details))
    : undefined;
  return {
    error: message,
    message,
    code: codeToken,
    requestId,
    ...(conflictDetails !== undefined ? { details: conflictDetails } : {}),
    ...(status === 409 && error?.details?.current !== undefined ? { current: error.details.current } : {}),
  };
}
