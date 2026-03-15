#!/usr/bin/env node
/**
 * Support Hours — End-to-End Unit Tests
 * Tests isWithinSupportHours() with deterministic dates.
 *
 * Generated via gpt-5.3-codex, reviewed and corrected.
 *
 * Run: node tests/support-hours-test.mjs
 */

// Copy of isWithinSupportHours from chat.jsx, with nowDate parameter for testability
function isWithinSupportHours(settings, nowDate = new Date()) {
  if (!settings?.supportSchedule) return { available: true };
  let schedule;
  try { schedule = JSON.parse(settings.supportSchedule); } catch { return { available: true }; }
  if (schedule.alwaysAvailable) return { available: true };
  const tz = schedule.timezone || 'America/New_York';
  const now = nowDate;
  const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz });
  const todayStr = dateFormatter.format(now);
  const timeFormatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' });
  const parts = timeFormatter.formatToParts(now);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const weekday = parts.find(p => p.type === 'weekday')?.value || '';
  const currentMinutes = hour * 60 + minute;
  if (schedule.overrides?.length) {
    const override = schedule.overrides.find(o => o.date === todayStr);
    if (override) {
      if (override.closed) return { available: false, reason: override.reason, displayText: schedule.displayText };
      const [startH, startM] = override.startTime.split(':').map(Number);
      const [endH, endM] = override.endTime.split(':').map(Number);
      const inRange = currentMinutes >= (startH * 60 + startM) && currentMinutes < (endH * 60 + endM);
      return inRange ? { available: true } : { available: false, reason: override.reason, displayText: schedule.displayText };
    }
  }
  if (!schedule.windows?.length) return { available: true };
  for (const window of schedule.windows) {
    if (!window.days.includes(weekday)) continue;
    const [startH, startM] = window.startTime.split(':').map(Number);
    const [endH, endM] = window.endTime.split(':').map(Number);
    if (currentMinutes >= (startH * 60 + startM) && currentMinutes < (endH * 60 + endM)) return { available: true };
  }
  return { available: false, displayText: schedule.displayText };
}

// ── Deep equality helper ─────────────────────────────────────────────
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a == null || b == null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (!deepEqual(aKeys, bKeys)) return false;
  for (const k of aKeys) if (!deepEqual(a[k], b[k])) return false;
  return true;
}

// ── Test fixtures ────────────────────────────────────────────────────
const DISPLAY = 'Monday-Friday 9am-5pm ET';
const TZ = 'America/New_York';

const baseSchedule = {
  timezone: TZ,
  displayText: DISPLAY,
  windows: [
    { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], startTime: '09:00', endTime: '17:00' }
  ],
  overrides: [],
  alwaysAvailable: false,
};

// 2023-10-10 = Tuesday, 2023-10-14 = Saturday
const tests = [
  {
    name: '1. No supportSchedule → available',
    settings: {},
    now: new Date('2023-10-10T10:00:00-04:00'),
    expected: { available: true },
  },
  {
    name: '2. alwaysAvailable: true → available',
    settings: { supportSchedule: JSON.stringify({ ...baseSchedule, alwaysAvailable: true }) },
    now: new Date('2023-10-10T20:00:00-04:00'),
    expected: { available: true },
  },
  {
    name: '3. Invalid JSON → fail open (available)',
    settings: { supportSchedule: '{not-json' },
    now: new Date('2023-10-10T10:00:00-04:00'),
    expected: { available: true },
  },
  {
    name: '4. Within weekday window (Tue 10am ET)',
    settings: { supportSchedule: JSON.stringify(baseSchedule) },
    now: new Date('2023-10-10T10:00:00-04:00'),
    expected: { available: true },
  },
  {
    name: '5. Outside weekday window (Tue 8pm ET)',
    settings: { supportSchedule: JSON.stringify(baseSchedule) },
    now: new Date('2023-10-10T20:00:00-04:00'),
    expected: { available: false, displayText: DISPLAY },
  },
  {
    name: '6. Saturday with no Sat window',
    settings: { supportSchedule: JSON.stringify(baseSchedule) },
    now: new Date('2023-10-14T10:00:00-04:00'),
    expected: { available: false, displayText: DISPLAY },
  },
  {
    name: '7. Closed holiday override (date matches)',
    settings: {
      supportSchedule: JSON.stringify({
        ...baseSchedule,
        overrides: [{ date: '2023-10-10', closed: true, reason: 'Holiday' }],
      }),
    },
    now: new Date('2023-10-10T10:00:00-04:00'),
    expected: { available: false, reason: 'Holiday', displayText: DISPLAY },
  },
  {
    name: '8. Custom hours override — within range',
    settings: {
      supportSchedule: JSON.stringify({
        ...baseSchedule,
        overrides: [{ date: '2023-10-10', startTime: '11:00', endTime: '13:00', reason: 'Special hours' }],
      }),
    },
    now: new Date('2023-10-10T12:00:00-04:00'),
    expected: { available: true },
  },
  {
    name: '9. Custom hours override — outside range',
    settings: {
      supportSchedule: JSON.stringify({
        ...baseSchedule,
        overrides: [{ date: '2023-10-10', startTime: '11:00', endTime: '13:00', reason: 'Special hours' }],
      }),
    },
    now: new Date('2023-10-10T10:00:00-04:00'),
    expected: { available: false, reason: 'Special hours', displayText: DISPLAY },
  },
  {
    name: '10. Empty windows array → available (no restrictions)',
    settings: {
      supportSchedule: JSON.stringify({ ...baseSchedule, windows: [] }),
    },
    now: new Date('2023-10-14T10:00:00-04:00'),
    expected: { available: true },
  },
];

// ── Run tests ────────────────────────────────────────────────────────
console.log('\n  Support Hours Tests\n');
let failures = 0;

for (const t of tests) {
  const actual = isWithinSupportHours(t.settings, t.now);
  const pass = deepEqual(actual, t.expected);
  if (!pass) failures++;
  console.log(`  ${pass ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'} ${t.name}`);
  if (!pass) {
    console.log(`       expected: ${JSON.stringify(t.expected)}`);
    console.log(`       actual:   ${JSON.stringify(actual)}`);
  }
}

console.log(`\n  ${tests.length - failures}/${tests.length} passed\n`);
if (failures > 0) process.exitCode = 1;
