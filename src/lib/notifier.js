import fetch from 'node-fetch';
import { log } from './utils.js';

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export class Notifier {
  constructor(config) {
    this.botToken = config.telegramBotToken;
    this.chatId = config.telegramChatId;
  }

  isEnabled() {
    return !!(this.botToken && this.chatId);
  }

  async send(message) {
    if (!this.isEnabled()) return;

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: message,
          parse_mode: 'HTML'
        })
      });

      if (!response.ok) {
        const body = await response.text();
        log(`Telegram notification failed (${response.status}): ${body}`);
      }
    } catch (err) {
      log(`Telegram notification error: ${err.message}`);
    }
  }

  async notifyStarted(currentDate, targetDate, maxDate, minDate, dryRun) {
    let message = '<b>US Visa Bot Started</b>\n\n';

    if (maxDate) {
      const from = minDate || 'earliest available';
      message += `Searching for dates: <b>${from}</b> to <b>${maxDate}</b>`;
      if (currentDate) message += `\nCurrent booking: <b>${currentDate}</b>`;
    } else {
      message += `Monitoring for dates earlier than <b>${currentDate}</b>`;
      if (minDate) message += `\nMinimum date: <b>${minDate}</b>`;
    }

    if (targetDate) message += `\nTarget date: <b>${targetDate}</b>`;
    if (dryRun) message += `\n\n<i>Running in dry-run mode</i>`;
    return this.send(message);
  }

  async notifyBooked(date, time, dryRun) {
    const prefix = dryRun ? '[DRY RUN] ' : '';
    const message = `<b>${prefix}Appointment Booked!</b>\n\nDate: <b>${date}</b>\nTime: <b>${time}</b>`;
    return this.send(message);
  }

  async notifyError(errorMessage, cooldown) {
    let message = `<b>Bot Error</b>\n\n${escapeHtml(errorMessage)}`;
    if (cooldown) {
      message += `\n\nRestarting after ${cooldown}s cooldown...`;
    } else {
      message += `\n\nRetrying immediately...`;
    }
    return this.send(message);
  }
}
