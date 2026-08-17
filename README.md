# US Visa Bot

Monitors the official U.S. visa appointment service and reschedules to the earliest qualifying appointment with an available time.

Use this project responsibly and in accordance with the appointment service terms. Availability can differ by account, facility, visa category, applicant group, and rescheduling eligibility.

## Requirements

- Node.js 20 or newer
- An existing account on `https://ais.usvisa-info.com/`
- A valid schedule and facility ID

## Install

```bash
npm install
cp .env.example .env
```

Configure `.env`:

| Variable | Description |
| --- | --- |
| `EMAIL` | Visa-site account email |
| `PASSWORD` | Visa-site account password |
| `COUNTRY_CODE` | Two-letter code from the site URL, such as `ca` |
| `SCHEDULE_ID` | Numeric schedule ID from the authenticated schedule URL |
| `FACILITY_ID` | Numeric consulate facility ID |
| `REFRESH_DELAY` | Poll interval in seconds; minimum 10, default 20 |
| `REQUEST_TIMEOUT_MS` | Request timeout in milliseconds; default 15000 |
| `TELEGRAM_BOT_TOKEN` | Optional Telegram bot token |
| `TELEGRAM_CHAT_ID` | Optional Telegram chat ID |

Never commit `.env`. It is ignored by Git.

## Usage

Search for any date earlier than the current appointment:

```bash
npm start -- --current 2027-04-30
```

Search only calendar year 2026:

```bash
npm start -- --current 2027-04-30 --min 2026-01-01 --max 2026-12-31
```

Verify detection without submitting a reschedule:

```bash
npm start -- --current 2027-04-30 --min 2026-01-01 --max 2026-12-31 --dry-run
```

Run one diagnostic poll and exit:

```bash
npm start -- --current 2027-04-30 --min 2026-01-01 --max 2026-12-31 --dry-run --once
```

All dates must use strict `YYYY-MM-DD` format. `--target` remains as a deprecated alias for `--max`; do not provide conflicting values.

## Behavior

The bot:

1. Logs in while preserving cookies across redirects.
2. Verifies that the configured schedule is accessible.
3. Polls near `REFRESH_DELAY` without progressively slowing ordinary empty checks.
4. Validates and filters every returned date.
5. Checks each qualifying date in chronological order, so a stale first date cannot block later dates.
6. Tries all reported times for a date when a slot race occurs.
7. Stops after a verified booking or after a dry-run match.

Requests have explicit timeouts. Authentication expiry causes a new login, transient failures use bounded backoff, and HTTP 429 responses honor the server's retry delay.

## Verification

```bash
npm test
npm audit --omit=dev
```

## Disclaimer

This project is provided for educational use. No software can guarantee that an appointment shown to another account will be available to your account.
