#!/usr/bin/env node

import { program } from 'commander';
import { botCommand } from './commands/bot.js';

program
  .name('us-visa-bot')
  .description('Automated US visa appointment booking and rescheduling bot')
  .version('0.0.1');

program
  .command('bot')
  .description('Monitor and book/reschedule visa appointments')
  .option('-c, --current <date>', 'current booked date (optional if --max is provided)')
  .option('-x, --max <date>', 'maximum acceptable date (upper bound for date range)')
  .option('-t, --target <date>', 'target date to stop at')
  .option('-m, --min <date>', 'minimum date acceptable')
  .option('--dry-run', 'only log what would be booked without actually booking')
  .action(botCommand);

// Default command for backward compatibility
program
  .option('-c, --current <date>', 'current booked date (optional if --max is provided)')
  .option('-x, --max <date>', 'maximum acceptable date (upper bound for date range)')
  .option('-t, --target <date>', 'target date to stop at')
  .option('-m, --min <date>', 'minimum date acceptable')
  .option('--dry-run', 'only log what would be booked without actually booking')
  .action(botCommand);

program.parse();
