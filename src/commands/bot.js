import { Bot } from '../lib/bot.js';
import { getConfig } from '../lib/config.js';
import { Notifier } from '../lib/notifier.js';
import { log, sleep, isSocketHangupError } from '../lib/utils.js';

const BACKOFF_STEPS_SECONDS = [15, 30, 60, 90];
const TRANSIENT_RETRY_DELAYS_SECONDS = [6, 12, 24];
const POLL_DELAY_MULTIPLIERS = [1, 2, 3, 4];
const POLL_STREAK_STEP = 3;
const JITTER_FACTOR = 0.2;

export async function botCommand(options) {
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

  return _runBot(bot, notifier, config, options, 0);
}

async function _runBot(bot, notifier, config, options, failureCount = 0) {
  let currentBookedDate = options.current || null;
  const targetDate = options.target;
  const minDate = options.min;
  const maxDate = options.max;

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

  try {
    const sessionHeaders = await bot.initialize();
    await notifier.notifyStarted(currentBookedDate, targetDate, maxDate, minDate, options.dryRun);
    let noDateStreak = 0;

    while (true) {
      const availableDate = await checkAvailableDateWithRetries(
        bot,
        sessionHeaders,
        currentBookedDate,
        minDate,
        maxDate
      );

      if (availableDate) {
        noDateStreak = 0;
        const result = await bot.bookAppointment(sessionHeaders, availableDate);

        if (result) {
          await notifier.notifyBooked(availableDate, result.time, options.dryRun);
          log(`Successfully booked appointment on ${availableDate} at ${result.time}`);
          process.exit(0);
        }
      } else {
        noDateStreak += 1;
      }

      failureCount = 0;
      const pollDelay = getAdaptivePollDelaySeconds(config.refreshDelay, noDateStreak);
      await sleep(applyJitterSeconds(pollDelay));
    }
  } catch (err) {
    const nextFailureCount = failureCount + 1;
    const cooldownSeconds = getAdaptiveCooldownSeconds(nextFailureCount);

    if (isSocketHangupError(err)) {
      log(`Socket hangup error: ${err.message}. Trying again after ${cooldownSeconds} seconds...`);
      await notifier.notifyError(err.message, cooldownSeconds);
      await sleep(cooldownSeconds);
    } else {
      log(`Session/authentication error: ${err.message}. Trying again after ${cooldownSeconds} seconds...`);
      await notifier.notifyError(err.message, cooldownSeconds);
      await sleep(cooldownSeconds);
    }
    return _runBot(bot, notifier, config, options, nextFailureCount);
  }
}

function getAdaptiveCooldownSeconds(failureCount) {
  const index = Math.min(Math.max(failureCount - 1, 0), BACKOFF_STEPS_SECONDS.length - 1);
  const baseCooldown = BACKOFF_STEPS_SECONDS[index];
  return applyJitterSeconds(baseCooldown);
}

function getAdaptivePollDelaySeconds(baseRefreshDelay, noDateStreak) {
  const index = Math.min(Math.floor(noDateStreak / POLL_STREAK_STEP), POLL_DELAY_MULTIPLIERS.length - 1);
  const multiplier = POLL_DELAY_MULTIPLIERS[index];
  return Math.max(1, baseRefreshDelay * multiplier);
}

function applyJitterSeconds(baseSeconds) {
  const min = Math.max(1, baseSeconds * (1 - JITTER_FACTOR));
  const max = baseSeconds * (1 + JITTER_FACTOR);
  return Number((Math.random() * (max - min) + min).toFixed(1));
}

async function checkAvailableDateWithRetries(bot, sessionHeaders, currentBookedDate, minDate, maxDate) {
  let lastError;

  for (let attempt = 0; attempt <= TRANSIENT_RETRY_DELAYS_SECONDS.length; attempt++) {
    try {
      return await bot.checkAvailableDate(sessionHeaders, currentBookedDate, minDate, maxDate);
    } catch (err) {
      if (!isSocketHangupError(err)) {
        throw err;
      }

      lastError = err;

      if (attempt === TRANSIENT_RETRY_DELAYS_SECONDS.length) {
        break;
      }

      const delay = applyJitterSeconds(TRANSIENT_RETRY_DELAYS_SECONDS[attempt]);
      log(`Transient socket error (${err.message}). Retry ${attempt + 1}/${TRANSIENT_RETRY_DELAYS_SECONDS.length} in ${delay} seconds...`);
      await sleep(delay);
    }
  }

  throw lastError;
}
