export function sleep(seconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });
}

export function log(message) {
  console.log(`[${new Date().toISOString()}]`, message);
}

const TRANSIENT_ERROR_CODES = new Set([
  'ABORT_ERR',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'ETRANSIENT_HTTP',
  'ETRANSIENT_NETWORK'
]);

const TRANSIENT_HTTP_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const SESSION_ERROR_CODES = new Set(['EAUTH', 'ESESSION']);
const SESSION_HTTP_STATUS_CODES = new Set([401, 403]);

function getErrorStatus(err) {
  if (!err) return null;
  return Number(err.status || err.statusCode || 0) || null;
}

function getErrorMessage(err) {
  return String(err?.message || '').toLowerCase();
}

export function isSocketHangupError(err) {
  if (!err) return false;

  const message = getErrorMessage(err);

  return err.code === 'ECONNRESET' ||
         err.code === 'ENOTFOUND' ||
         err.code === 'ETIMEDOUT' ||
         err.code === 'EAI_AGAIN' ||
         message.includes('socket hang up') ||
         message.includes('network') ||
         message.includes('connection reset') ||
         message.includes('timed out');
}

export function isTransientRequestError(err) {
  if (!err) return false;
  if (TRANSIENT_ERROR_CODES.has(err.code)) return true;

  const status = getErrorStatus(err);
  if (status && TRANSIENT_HTTP_STATUS_CODES.has(status)) return true;

  if (isSocketHangupError(err)) return true;

  const message = getErrorMessage(err);
  return message.includes('temporarily unavailable') ||
         message.includes('request timed out') ||
         message.includes('failed to fetch') ||
         message.includes('fetch failed') ||
         message.includes('too many requests');
}

export function isSessionError(err) {
  if (!err) return false;
  if (SESSION_ERROR_CODES.has(err.code)) return true;

  const status = getErrorStatus(err);
  if (status && SESSION_HTTP_STATUS_CODES.has(status)) return true;

  const message = getErrorMessage(err);
  return message.includes('session expired') ||
         message.includes('authentication') ||
         message.includes('unauthorized') ||
         message.includes('forbidden') ||
         message.includes('csrf') ||
         message.includes('sign in');
}
