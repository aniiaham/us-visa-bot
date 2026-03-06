import { Bot } from '../lib/bot.js';
import { getConfig } from '../lib/config.js';
import { Notifier } from '../lib/notifier.js';
import { log, sleep, isSocketHangupError } from '../lib/utils.js';

const COOLDOWN = 3600; // 1 hour in seconds

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

  return _runBot(bot, notifier, config, options);
}

async function _runBot(bot, notifier, config, options) {
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

    while (true) {
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

          // If no prior booking, this was a first-time book — exit
          if (!currentBookedDate) {
            log(`Successfully booked appointment on ${availableDate} at ${result.time}`);
            process.exit(0);
          }

          // Update current date to the new available date
          currentBookedDate = availableDate;

          options = {
            ...options,
            current: currentBookedDate
          };

          if (targetDate && availableDate <= targetDate) {
            log(`Target date reached! Successfully booked appointment on ${availableDate}`);
            process.exit(0);
          }
        }
      }

      await sleep(config.refreshDelay);
    }
  } catch (err) {
    if (isSocketHangupError(err)) {
      log(`Socket hangup error: ${err.message}. Trying again after ${COOLDOWN} seconds...`);
      notifier.notifyError(err.message, COOLDOWN);
      await sleep(COOLDOWN);
    } else {
      log(`Session/authentication error: ${err.message}. Retrying immediately...`);
      await notifier.notifyError(err.message);
    }
    return _runBot(bot, notifier, config, options);
  }
}
