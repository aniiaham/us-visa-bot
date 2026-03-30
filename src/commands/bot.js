import { Bot } from '../lib/bot.js';
import { getConfig } from '../lib/config.js';
import { Notifier } from '../lib/notifier.js';
import { log, sleep, isTransientRequestError, isSessionError } from '../lib/utils.js';

const SESSION_BACKOFF_STEPS_SECONDS = [2, 5, 10, 20];
const TRANSIENT_BACKOFF_STEPS_SECONDS = [1, 2, 4, 6];

export async function botCommand(rawOptions, command) {
  const options = normalizeOptions(rawOptions, command);
  const config = getConfig();
  const bot = new Bot(config, { dryRun: options.dryRun });
  const notifier = new Notifier(config);

  // Validate: need at least --current or --max to define an upper bound
  if (!options.current && !options.max) {
    console.error('Error: You must provide either --current or --max (or both).');
    console.error('  --current <date>  Your existing booked appointment date');
    console.error('  --max <date>      Maximum acceptable date (upper bound for search range)');
    process.exit(1);
  }

  if (notifier.isEnabled()) {
    log('Telegram notifications enabled');
  }

  return _runBot(bot, notifier, config, options);
}

function normalizeOptions(rawOptions, command) {
  const directOptions = extractOptions(rawOptions);
  const commandOptions = extractOptions(command);
  const parentOptions = extractOptions(command?.parent);

  return {
    ...parentOptions,
    ...commandOptions,
    ...directOptions
  };
}

function extractOptions(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }

  if (typeof value.opts === 'function') {
    return value.opts();
  }

  return value;
}

async function _runBot(bot, notifier, config, options) {
  let currentBookedDate = options.current || null;
  const targetDate = options.target;
  const minDate = options.min;
  const maxDate = options.max;
  let sessionHeaders = null;
  let sessionFailureCount = 0;
  let transientFailureCount = 0;

  if (currentBookedDate) {
    log(`Current booked date: ${currentBookedDate}`);
  } else {
    log('No current booking — will book first available date in range');
  }

  if (maxDate) {
    log(`Maximum date: ${maxDate}`);
  }

  if (minDate) {
    log(`Minimum date: ${minDate}`);
  }

  if (options.dryRun) {
    log('[DRY RUN MODE] Bot will only log what would be booked without actually booking');
  }

  if (targetDate) {
    log(`Target date: ${targetDate}`);
  }

  await notifier.notifyStarted(currentBookedDate, targetDate, maxDate, minDate, options.dryRun);

  while (true) {
    try {
      if (!sessionHeaders) {
        sessionHeaders = await bot.initialize();
        sessionFailureCount = 0;
      }

      const availableDate = await bot.checkAvailableDate(
        sessionHeaders,
        currentBookedDate,
        minDate,
        maxDate
      );

      if (availableDate) {
        const result = await bot.bookAppointment(sessionHeaders, availableDate);

        if (result) {
          await notifier.notifyBooked(availableDate, result.time, options.dryRun);

          if (!currentBookedDate) {
            log(`Successfully booked appointment on ${availableDate} at ${result.time}`);
            process.exit(0);
          }

          currentBookedDate = availableDate;

          if (targetDate && availableDate <= targetDate) {
            log(`Target date reached! Successfully booked appointment on ${availableDate}`);
            process.exit(0);
          }
        }
      }

      transientFailureCount = 0;

      await sleep(config.refreshDelay);
    } catch (err) {
      if (isTransientRequestError(err) && !isSessionError(err)) {
        transientFailureCount += 1;
        const cooldownSeconds = getTransientCooldownSeconds(transientFailureCount);

        log(`Transient request error: ${err.message}. Trying again after ${cooldownSeconds} seconds...`);
        await notifier.notifyError(err.message, cooldownSeconds);

        await sleep(cooldownSeconds);
        continue;
      }

      const nextFailureCount = sessionFailureCount + 1;
      const cooldownSeconds = getSessionCooldownSeconds(nextFailureCount);

      if (isSessionError(err)) {
        log(`Session/authentication error: ${err.message}. Trying again after ${cooldownSeconds} seconds...`);
      } else {
        log(`Unexpected error: ${err.message}. Trying again after ${cooldownSeconds} seconds...`);
      }

      await notifier.notifyError(err.message, cooldownSeconds);

      sessionHeaders = null;
      sessionFailureCount = nextFailureCount;
      transientFailureCount = 0;

      await sleep(cooldownSeconds);
    }
  }
}

function getSessionCooldownSeconds(failureCount) {
  const index = Math.min(Math.max(failureCount - 1, 0), SESSION_BACKOFF_STEPS_SECONDS.length - 1);
  const baseCooldown = SESSION_BACKOFF_STEPS_SECONDS[index];
  const jitter = Math.floor(Math.random() * 2);

  return baseCooldown + jitter;
}

function getTransientCooldownSeconds(failureCount) {
  const index = Math.min(Math.max(failureCount - 1, 0), TRANSIENT_BACKOFF_STEPS_SECONDS.length - 1);
  const baseCooldown = TRANSIENT_BACKOFF_STEPS_SECONDS[index];
  const jitter = Math.floor(Math.random() * 2);

  return baseCooldown + jitter;
}
