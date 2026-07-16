import { VisaHttpClient } from './client.js';
import { log } from './utils.js';

export class Bot {
  constructor(config, options = {}) {
    this.config = config;
    this.dryRun = options.dryRun || false;
    this.bookedDates = new Set();
    this.client = new VisaHttpClient(this.config.countryCode, this.config.email, this.config.password);
  }

  async initialize() {
    log('Initializing visa bot...');
    return await this.client.login();
  }

  async checkAvailableDate(sessionHeaders, currentBookedDate, minDate, maxDate) {
    const dates = await this.client.checkAvailableDate(
      sessionHeaders,
      this.config.scheduleId,
      this.config.facilityId
    );

    if (!dates || dates.length === 0) {
      log("no dates available");
      return null;
    }

    const useRangeMode = !!maxDate;

    const goodDates = dates.filter(date => {
      // Lower bound: skip dates before minDate
      if (minDate && date < minDate) {
        log(`date ${date} is before minimum date (${minDate})`);
        return false;
      }

      if (useRangeMode) {
        // Range mode: accept dates up to maxDate
        if (date > maxDate) {
          log(`date ${date} is after maximum date (${maxDate})`);
          return false;
        }
        // Still respect current booking if one exists — don't book a worse date
        if (currentBookedDate && date >= currentBookedDate) {
          log(`date ${date} is further than already booked (${currentBookedDate})`);
          return false;
        }
      } else {
        // Original mode: only accept dates earlier than current booking
        if (date >= currentBookedDate) {
          log(`date ${date} is further than already booked (${currentBookedDate})`);
          return false;
        }
      }

      return true;
    });

    if (goodDates.length === 0) {
      log("no good dates found after filtering");
      return null;
    }

    // Sort dates and return the earliest one
    goodDates.sort();
    const earliestDate = goodDates[0];
    
    log(`found ${goodDates.length} good dates: ${goodDates.join(', ')}, using earliest: ${earliestDate}`);
    return earliestDate;
  }

  async bookAppointment(sessionHeaders, date) {
    if (this.bookedDates.has(date)) {
      log(`date ${date} was already booked this session, skipping`);
      return null;
    }

    const times = await this.client.checkAvailableTimes(
      sessionHeaders,
      this.config.scheduleId,
      this.config.facilityId,
      date
    );

    if (!times || times.length === 0) {
      log(`no available time slots for date ${date}`);
      return null;
    }

    if (this.dryRun) {
      const time = times[0];
      log(`[DRY RUN] Would book appointment at ${date} ${time} (not actually booking)`);
      this.bookedDates.add(date);
      return { booked: true, time };
    }

    for (const time of times) {
      try {
        await this.client.book(
          sessionHeaders,
          this.config.scheduleId,
          this.config.facilityId,
          date,
          time
        );

        this.bookedDates.add(date);
        log(`booked time at ${date} ${time}`);
        return { booked: true, time };
      } catch (err) {
        log(`failed to book ${date} ${time}: ${err.message}`);
      }
    }

    log(`all available time slots failed for date ${date}`);
    return null;
  }

}
