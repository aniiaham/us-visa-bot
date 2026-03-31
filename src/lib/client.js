import fetch from "node-fetch";
import cheerio from 'cheerio';
import { log } from './utils.js';
import { getBaseUri } from './config.js';

// Common headers
const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Cache-Control': 'no-store'
};

const DEFAULT_REQUEST_TIMEOUT_MS = 12000;
const DEFAULT_TRANSIENT_RETRIES = 2;
const DEFAULT_TRANSIENT_RETRY_BASE_MS = 700;

const SESSION_HTTP_STATUS_CODES = new Set([401, 403]);
const TRANSIENT_HTTP_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_NETWORK_ERROR_CODES = new Set([
  'ABORT_ERR',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT'
]);

function createTypedError(message, code, status) {
  const error = new Error(message);
  error.code = code;

  if (status !== undefined && status !== null) {
    error.status = status;
  }

  return error;
}

export class VisaHttpClient {
  constructor(countryCode, email, password, options = {}) {
    this.baseUri = getBaseUri(countryCode);
    this.email = email;
    this.password = password;
    this.requestTimeoutMs = options.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;
    this.transientRetries = Number.isInteger(options.transientRetries)
      ? options.transientRetries
      : DEFAULT_TRANSIENT_RETRIES;
    this.transientRetryBaseMs = options.transientRetryBaseMs || DEFAULT_TRANSIENT_RETRY_BASE_MS;
  }

  // Public API methods
  async login() {
    log('Logging in');

    const anonymousHeaders = await this._anonymousRequest(`${this.baseUri}/users/sign_in`)
      .then(response => this._extractHeaders(response));

    const loginData = {
      'utf8': '✓',
      'user[email]': this.email,
      'user[password]': this.password,
      'policy_confirmed': '1',
      'commit': 'Sign In'
    };

    return this._submitForm(`${this.baseUri}/users/sign_in`, anonymousHeaders, loginData)
      .then(res => ({
        ...anonymousHeaders,
        'Cookie': this._extractRelevantCookies(res)
      }));
  }

  async checkAvailableDate(headers, scheduleId, facilityId) {
    const url = `${this.baseUri}/schedule/${scheduleId}/appointment/days/${facilityId}.json?appointments[expedite]=false`;
    
    return this._jsonRequest(url, headers)
      .then(data => data.map(item => item.date));
  }

  async checkAvailableTime(headers, scheduleId, facilityId, date) {
    const url = `${this.baseUri}/schedule/${scheduleId}/appointment/times/${facilityId}.json?date=${date}&appointments[expedite]=false`;
    
    return this._jsonRequest(url, headers)
      .then(data => data['business_times'][0] || data['available_times'][0]);
  }

  async book(headers, scheduleId, facilityId, date, time) {
    const url = `${this.baseUri}/schedule/${scheduleId}/appointment`;

    const bookingHeaders = await this._anonymousRequest(url, headers)
      .then(response => this._extractHeaders(response));

    const bookingData = {
      'utf8': '✓',
      'authenticity_token': bookingHeaders['X-CSRF-Token'],
      'confirmed_limit_message': '1',
      'use_consulate_appointment_capacity': 'true',
      'appointments[consulate_appointment][facility_id]': facilityId,
      'appointments[consulate_appointment][date]': date,
      'appointments[consulate_appointment][time]': time,
      'appointments[asc_appointment][facility_id]': '',
      'appointments[asc_appointment][date]': '',
      'appointments[asc_appointment][time]': ''
    };

    return this._submitFormWithRedirect(url, bookingHeaders, bookingData);
  }

  // Private request methods
  async _anonymousRequest(url, headers = {}) {
    return this._fetchWithTimeout(url, {
      headers: {
        "User-Agent": "",
        "Accept": "*/*",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        ...headers
      }
    });
  }

  async _jsonRequest(url, headers = {}) {
    const maxAttempts = this.transientRetries + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await this._fetchWithTimeout(url, {
          headers: {
            ...headers,
            "Accept": "application/json",
            "X-Requested-With": "XMLHttpRequest"
          },
          cache: "no-store"
        });

        await this._assertJsonResponse(response);

        const json = await response.json();
        return this._handleErrors(json);
      } catch (err) {
        const normalizedError = this._normalizeRequestError(err);

        if (normalizedError.code === 'EAUTH') {
          throw normalizedError;
        }

        const isTransient = normalizedError.code === 'ETRANSIENT_HTTP' ||
          normalizedError.code === 'ETRANSIENT_NETWORK';

        if (!isTransient || attempt >= maxAttempts) {
          throw normalizedError;
        }

        const retryDelayMs = this._getRetryDelayMs(attempt);

        log(
          `Transient request issue: ${normalizedError.message}. ` +
          `Retry ${attempt}/${maxAttempts - 1} in ${retryDelayMs}ms...`
        );

        await this._sleepMs(retryDelayMs);
      }
    }

    throw new Error('Unexpected retry loop termination');
  }

  async _submitForm(url, headers = {}, formData = {}) {
    return this._fetchWithTimeout(url, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
      },
      body: new URLSearchParams(formData)
    });
  }

  async _submitFormWithRedirect(url, headers = {}, formData = {}) {
    return this._fetchWithTimeout(url, {
      method: "POST",
      redirect: "follow",
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(formData)
    });
  }

  // Private utility methods
  async _extractHeaders(res) {
    const cookies = this._extractRelevantCookies(res);
    const html = await res.text();
    const $ = cheerio.load(html);
    const csrfToken = $('meta[name="csrf-token"]').attr('content');

    if (!csrfToken) {
      throw createTypedError('Missing CSRF token in response', 'EAUTH');
    }

    return {
      ...COMMON_HEADERS,
      "Cookie": cookies,
      "X-CSRF-Token": csrfToken,
      "Referer": this.baseUri,
      "Referrer-Policy": "strict-origin-when-cross-origin"
    };
  }

  _extractRelevantCookies(res) {
    const cookieHeaders = this._getSetCookieHeaders(res);

    if (cookieHeaders.length === 0) {
      throw createTypedError('Missing session cookie in response', 'EAUTH');
    }

    const parsedCookies = this._parseCookieHeaders(cookieHeaders);

    if (!parsedCookies['_yatri_session']) {
      throw createTypedError('Missing _yatri_session cookie in response', 'EAUTH');
    }

    return `_yatri_session=${parsedCookies['_yatri_session']}`;
  }

  _getSetCookieHeaders(res) {
    const rawHeaders = res?.headers?.raw?.();

    if (rawHeaders && Array.isArray(rawHeaders['set-cookie'])) {
      return rawHeaders['set-cookie'];
    }

    const combinedCookieHeader = res?.headers?.get?.('set-cookie');

    if (!combinedCookieHeader) {
      return [];
    }

    return [combinedCookieHeader];
  }

  _parseCookieHeaders(cookieHeaders) {
    const parsedCookies = {};

    cookieHeaders.forEach(cookieHeader => {
      const firstCookieSegment = String(cookieHeader || '').split(';', 1)[0].trim();

      if (!firstCookieSegment) {
        return;
      }

      const separatorIndex = firstCookieSegment.indexOf('=');

      if (separatorIndex <= 0) {
        return;
      }

      const cookieName = firstCookieSegment.slice(0, separatorIndex).trim();
      const cookieValue = firstCookieSegment.slice(separatorIndex + 1).trim();

      if (!cookieName) {
        return;
      }

      parsedCookies[cookieName] = cookieValue;
    });

    return parsedCookies;
  }

  _handleErrors(response) {
    const errorMessage = response['error'];

    if (errorMessage) {
      const lowered = String(errorMessage).toLowerCase();

      if (lowered.includes('session') || lowered.includes('sign in') || lowered.includes('csrf')) {
        throw createTypedError(errorMessage, 'EAUTH');
      }

      if (lowered.includes('too many request') || lowered.includes('try again') || lowered.includes('temporarily')) {
        throw createTypedError(errorMessage, 'ETRANSIENT_HTTP');
      }

      throw new Error(errorMessage);
    }

    return response;
  }

  async _assertJsonResponse(response) {
    if (SESSION_HTTP_STATUS_CODES.has(response.status)) {
      throw createTypedError(
        `Session/authentication error (${response.status}) while requesting appointment data`,
        'EAUTH',
        response.status
      );
    }

    if (TRANSIENT_HTTP_STATUS_CODES.has(response.status)) {
      throw createTypedError(
        `Appointment endpoint returned ${response.status}`,
        'ETRANSIENT_HTTP',
        response.status
      );
    }

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`Appointment endpoint returned ${response.status}: ${responseText}`);
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();

    if (contentType.includes('application/json')) {
      return;
    }

    const responseText = await response.text();

    if (this._isLoginPage(responseText)) {
      throw createTypedError('Session expired: received sign-in page for JSON endpoint', 'EAUTH');
    }

    throw new Error('Expected JSON response but got non-JSON content');
  }

  async _fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal
      });
    } catch (err) {
      if (err && (err.name === 'AbortError' || err.type === 'aborted')) {
        throw createTypedError(
          `request timed out after ${this.requestTimeoutMs}ms`,
          'ETRANSIENT_NETWORK'
        );
      }

      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  _normalizeRequestError(err) {
    if (!err) return new Error('Unknown request error');

    if (err.code === 'EAUTH' || err.code === 'ETRANSIENT_HTTP' || err.code === 'ETRANSIENT_NETWORK') {
      return err;
    }

    if (TRANSIENT_NETWORK_ERROR_CODES.has(err.code)) {
      err.code = 'ETRANSIENT_NETWORK';
      return err;
    }

    const message = String(err.message || '').toLowerCase();
    if (message.includes('socket hang up') ||
        message.includes('network') ||
        message.includes('connection') ||
        message.includes('timed out') ||
        message.includes('fetch failed') ||
        message.includes('failed to fetch')) {
      err.code = 'ETRANSIENT_NETWORK';
      return err;
    }

    return err;
  }

  _isLoginPage(html = '') {
    const body = String(html).toLowerCase();
    return body.includes('/users/sign_in') ||
           body.includes('name="user[email]"') ||
           body.includes('name="user[password]"') ||
           body.includes('sign in');
  }

  _getRetryDelayMs(attemptNumber) {
    const exponential = this.transientRetryBaseMs * (2 ** Math.max(attemptNumber - 1, 0));
    const jitter = Math.floor(Math.random() * 200);
    return exponential + jitter;
  }

  async _sleepMs(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }
}
