import dotenv from 'dotenv';

dotenv.config();

export function getConfig() {
  const config = {
    email: process.env.EMAIL,
    password: process.env.PASSWORD,
    scheduleId: process.env.SCHEDULE_ID,
    facilityId: process.env.FACILITY_ID,
    countryCode: process.env.COUNTRY_CODE,
    refreshDelay: Number(process.env.REFRESH_DELAY || 3),
    requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 12000),
    transientRetries: Number(process.env.TRANSIENT_RETRIES || 2),
    transientRetryBaseMs: Number(process.env.TRANSIENT_RETRY_BASE_MS || 700),
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID
  };

  validateConfig(config);
  return config;
}

function validateConfig(config) {
  const required = ['email', 'password', 'scheduleId', 'facilityId', 'countryCode'];
  const missing = required.filter(key => !config[key]);

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.map(k => k.toUpperCase()).join(', ')}`);
    process.exit(1);
  }

  if (!Number.isFinite(config.refreshDelay) || config.refreshDelay <= 0) {
    console.error('REFRESH_DELAY must be a positive number (seconds).');
    process.exit(1);
  }

  if (!Number.isFinite(config.requestTimeoutMs) || config.requestTimeoutMs < 1000) {
    console.error('REQUEST_TIMEOUT_MS must be a number >= 1000.');
    process.exit(1);
  }

  if (!Number.isInteger(config.transientRetries) || config.transientRetries < 0) {
    console.error('TRANSIENT_RETRIES must be an integer >= 0.');
    process.exit(1);
  }

  if (!Number.isFinite(config.transientRetryBaseMs) || config.transientRetryBaseMs < 100) {
    console.error('TRANSIENT_RETRY_BASE_MS must be a number >= 100.');
    process.exit(1);
  }
}

export function getBaseUri(countryCode) {
  return `https://ais.usvisa-info.com/en-${countryCode}/niv`;
}
