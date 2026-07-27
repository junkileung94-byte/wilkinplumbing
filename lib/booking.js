'use strict';
/* Booking requests and Roy's working schedule.
 *
 * Two blocks a day — morning and afternoon — and one job in each, so the calendar
 * cannot hand out a slot that is already spoken for. Customers request a slot; Roy
 * confirms it. A request that is pending still holds its slot, otherwise two people
 * could ask for the same morning and the point of the thing is lost.
 *
 * WHERE THIS LIVES, AND WHY IT MATTERS
 * ------------------------------------
 * Every other write in this app is committed back to GitHub (lib/github.js), because
 * the site is deployed from the repo. Booking data must NEVER take that path: the repo
 * is public, and these records hold a customer's name, phone number and home address.
 * So state lives in ADMIN_STATE_DIR (~/.wilkin-admin by default) next to the admin
 * credentials — outside the deploy directory, never staged, never pushed.
 *
 * Writes are atomic (temp file + rename). A crash mid-save leaves the previous file
 * intact rather than a truncated one.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const auth = require('./auth');

const DIR = path.join(auth.STATE_DIR, 'booking');
const SETTINGS_FILE = path.join(DIR, 'settings.json');
const REQUESTS_FILE = path.join(DIR, 'requests.json');

const TZ = 'America/Toronto';
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const STATUSES = ['pending', 'confirmed', 'declined', 'done', 'cancelled'];
/* Statuses that occupy a slot. A declined or cancelled request frees it again. */
const HOLDS = ['pending', 'confirmed', 'done'];

const MAX_REQUESTS = 5000;      // ring buffer guard; oldest resolved records drop first
const MAX_HORIZON = 120;

const DEFAULTS = {
  enabled: true,
  blocks: [
    { id: 'am', label: 'Morning', start: '08:00', end: '12:00' },
    { id: 'pm', label: 'Afternoon', start: '12:00', end: '17:00' },
  ],
  // Which blocks are offered on each weekday. Empty array = not working that day.
  weekly: {
    mon: ['am', 'pm'], tue: ['am', 'pm'], wed: ['am', 'pm'],
    thu: ['am', 'pm'], fri: ['am', 'pm'], sat: [], sun: [],
  },
  blockedDates: [],        // ['2026-08-13'] — whole day off
  blockedSlots: [],        // ['2026-08-14:pm'] — one block off
  leadTimeDays: 1,         // earliest bookable day, counted from today
  horizonDays: 28,         // how far ahead the public calendar shows
  maxPerDay: 2,            // jobs Roy will take in one day
  notifyEmail: '',         // where new requests are emailed (blank = admin inbox only)
  overlayTitle: 'Request a booking',
  overlayBlurb: 'Pick a time that suits you and tell me about the job. '
    + "I'll confirm by phone — usually the same day.",
};

// ------------------------------------------------------------------- dates ---
/* Everything is keyed on the local Ontario date, not the server's. Hostinger runs
 * UTC, so "today" after 7pm would otherwise roll over a day early. */
function isoInTz(d) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
  } catch (err) {
    return d.toISOString().slice(0, 10);   // ICU missing — UTC is close enough
  }
}

function todayIso() {
  return isoInTz(new Date());
}

function isIsoDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T12:00:00Z'));
}

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekdayOf(iso) {
  return WEEKDAYS[new Date(iso + 'T12:00:00Z').getUTCDay()];
}

function prettyDate(iso) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    }).format(new Date(iso + 'T12:00:00Z'));
  } catch (err) {
    return iso;
  }
}

// -------------------------------------------------------------------- store ---
function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
}

function writeAtomic(file, value) {
  ensureDir();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed == null ? fallback : parsed;
  } catch (err) {
    return fallback;
  }
}

function normalizeBlocks(value) {
  const out = [];
  const seen = new Set();
  for (const b of Array.isArray(value) ? value : []) {
    if (!b || typeof b !== 'object') continue;
    const id = String(b.id || '').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 12);
    if (!id || seen.has(id)) continue;
    const time = (v, fallback) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)) ? String(v) : fallback);
    seen.add(id);
    out.push({
      id,
      label: String(b.label || id).trim().slice(0, 40) || id,
      start: time(b.start, '08:00'),
      end: time(b.end, '17:00'),
    });
  }
  return out.length ? out : DEFAULTS.blocks.map((b) => ({ ...b }));
}

function normalizeSettings(raw) {
  const s = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  s.enabled = s.enabled !== false;
  s.blocks = normalizeBlocks(s.blocks);
  const ids = new Set(s.blocks.map((b) => b.id));

  const weekly = {};
  for (const day of WEEKDAYS) {
    const offered = (raw && raw.weekly && Array.isArray(raw.weekly[day]))
      ? raw.weekly[day] : DEFAULTS.weekly[day];
    weekly[day] = s.blocks.map((b) => b.id).filter((id) => offered.includes(id));
  }
  s.weekly = weekly;

  s.blockedDates = [...new Set((Array.isArray(s.blockedDates) ? s.blockedDates : [])
    .filter(isIsoDate))].sort();
  s.blockedSlots = [...new Set((Array.isArray(s.blockedSlots) ? s.blockedSlots : [])
    .filter((v) => {
      const [d, b] = String(v).split(':');
      return isIsoDate(d) && ids.has(b);
    }))].sort();

  const int = (v, lo, hi, fallback) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
  };
  s.leadTimeDays = int(s.leadTimeDays, 0, 30, DEFAULTS.leadTimeDays);
  s.horizonDays = int(s.horizonDays, 1, MAX_HORIZON, DEFAULTS.horizonDays);
  s.maxPerDay = int(s.maxPerDay, 1, s.blocks.length, Math.min(DEFAULTS.maxPerDay, s.blocks.length));
  s.notifyEmail = String(s.notifyEmail || '').trim().slice(0, 200);
  s.overlayTitle = String(s.overlayTitle || DEFAULTS.overlayTitle).trim().slice(0, 80)
    || DEFAULTS.overlayTitle;
  s.overlayBlurb = String(s.overlayBlurb || DEFAULTS.overlayBlurb).trim().slice(0, 400)
    || DEFAULTS.overlayBlurb;
  return s;
}

function readSettings() {
  return normalizeSettings(readJson(SETTINGS_FILE, null));
}

function writeSettings(patch) {
  const next = normalizeSettings({ ...readSettings(), ...(patch || {}) });
  writeAtomic(SETTINGS_FILE, next);
  return next;
}

function readRequests() {
  const list = readJson(REQUESTS_FILE, []);
  return Array.isArray(list) ? list : [];
}

function writeRequests(list) {
  let out = list;
  if (out.length > MAX_REQUESTS) {
    // keep every open job, then the most recent resolved ones
    const open = out.filter((r) => r.status === 'pending' || r.status === 'confirmed');
    const rest = out.filter((r) => r.status !== 'pending' && r.status !== 'confirmed')
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, Math.max(0, MAX_REQUESTS - open.length));
    out = open.concat(rest);
  }
  writeAtomic(REQUESTS_FILE, out);
  return out;
}

// ------------------------------------------------------------- availability ---
function holdsFor(requests) {
  const held = new Map();   // 'date:block' -> request
  const perDay = new Map(); // date -> count
  for (const r of requests) {
    if (!HOLDS.includes(r.status)) continue;
    if (!isIsoDate(r.date) || !r.block) continue;
    held.set(`${r.date}:${r.block}`, r);
    perDay.set(r.date, (perDay.get(r.date) || 0) + 1);
  }
  return { held, perDay };
}

/** Why a slot cannot be booked, or null if it can. */
function slotBlockedReason(iso, blockId, settings, held, perDay, firstDay, lastDay) {
  if (iso < firstDay || iso > lastDay) return 'closed';
  if (!settings.weekly[weekdayOf(iso)].includes(blockId)) return 'closed';
  if (settings.blockedDates.includes(iso)) return 'blocked';
  if (settings.blockedSlots.includes(`${iso}:${blockId}`)) return 'blocked';
  if (held.has(`${iso}:${blockId}`)) return 'full';
  if ((perDay.get(iso) || 0) >= settings.maxPerDay) return 'full';
  return null;
}

/**
 * The public calendar. Returns only what a stranger may see: which slots are open.
 * Never leaks a customer name, and never says *why* a slot is unavailable beyond
 * "not open".
 */
function publicAvailability() {
  const settings = readSettings();
  const { held, perDay } = holdsFor(readRequests());
  const today = todayIso();
  const firstDay = addDays(today, settings.leadTimeDays);
  const lastDay = addDays(today, settings.leadTimeDays + settings.horizonDays - 1);

  const days = [];
  for (let i = 0; i < settings.horizonDays; i += 1) {
    const iso = addDays(firstDay, i);
    const slots = settings.blocks.map((b) => ({
      block: b.id,
      open: !slotBlockedReason(iso, b.id, settings, held, perDay, firstDay, lastDay),
    }));
    days.push({ date: iso, weekday: weekdayOf(iso), slots, any: slots.some((s) => s.open) });
  }

  return {
    enabled: settings.enabled,
    title: settings.overlayTitle,
    blurb: settings.overlayBlurb,
    blocks: settings.blocks.map((b) => ({ ...b })),
    firstDay,
    lastDay,
    days,
  };
}

/** The admin view: every slot in the window, with whoever holds it. */
function schedule(days = 21) {
  const settings = readSettings();
  const requests = readRequests();
  const { held, perDay } = holdsFor(requests);
  const today = todayIso();
  const firstDay = addDays(today, settings.leadTimeDays);
  const lastDay = addDays(today, settings.leadTimeDays + settings.horizonDays - 1);

  const out = [];
  for (let i = 0; i < Math.min(days, MAX_HORIZON); i += 1) {
    const iso = addDays(today, i);
    out.push({
      date: iso,
      weekday: weekdayOf(iso),
      pretty: prettyDate(iso),
      dayBlocked: settings.blockedDates.includes(iso),
      slots: settings.blocks.map((b) => {
        const job = held.get(`${iso}:${b.id}`) || null;
        return {
          block: b.id,
          label: b.label,
          reason: slotBlockedReason(iso, b.id, settings, held, perDay, firstDay, lastDay),
          slotBlocked: settings.blockedSlots.includes(`${iso}:${b.id}`),
          offered: settings.weekly[weekdayOf(iso)].includes(b.id),
          job: job ? { id: job.id, name: job.name, phone: job.phone, status: job.status } : null,
        };
      }),
    });
  }
  return out;
}

// ---------------------------------------------------------------- requests ---
/* Customer-supplied text goes into the admin UI and into an email. Strip control
 * characters, cap the length, and let the UI escape it — never build HTML here. */
function clean(value, max) {
  return String(value == null ? '' : value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanMultiline(value, max) {
  return String(value == null ? '' : value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function validate(input) {
  const rec = {
    name: clean(input.name, 80),
    phone: clean(input.phone, 32),
    email: clean(input.email, 160),
    address: clean(input.address, 200),
    job: cleanMultiline(input.job, 2000),
    date: clean(input.date, 10),
    block: clean(input.block, 12),
  };

  if (rec.name.length < 2) return { error: 'Please give me your name.' };
  const digits = rec.phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) {
    return { error: 'Please give a phone number I can reach you on.' };
  }
  if (rec.email && !/^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(rec.email)) {
    return { error: 'That email address does not look right.' };
  }
  if (rec.address.length < 5) return { error: 'Please give the address for the job.' };
  if (rec.job.length < 5) return { error: 'Please tell me a little about the job.' };
  if (!isIsoDate(rec.date)) return { error: 'Please choose a date.' };
  return { rec };
}

/**
 * Take a request from the public site. Re-checks availability under the current
 * settings — the browser's copy of the calendar may be minutes stale, and two people
 * can be looking at the same free morning.
 */
function createRequest(input, source = 'site') {
  const settings = readSettings();
  if (!settings.enabled && source === 'site') {
    return { error: 'Online booking is closed at the moment — please call instead.' };
  }

  const checked = validate(input || {});
  if (checked.error) return { error: checked.error };
  const rec = checked.rec;

  if (!settings.blocks.some((b) => b.id === rec.block)) {
    return { error: 'Please choose a morning or afternoon slot.' };
  }

  const requests = readRequests();
  const { held, perDay } = holdsFor(requests);

  if (source === 'site') {
    const today = todayIso();
    const firstDay = addDays(today, settings.leadTimeDays);
    const lastDay = addDays(today, settings.leadTimeDays + settings.horizonDays - 1);
    const reason = slotBlockedReason(rec.date, rec.block, settings, held, perDay, firstDay, lastDay);
    if (reason) {
      return {
        error: reason === 'full'
          ? 'Sorry — that slot was taken while you were filling this in. Please pick another.'
          : 'That slot is not available. Please pick another.',
        stale: true,
      };
    }
  } else if (held.has(`${rec.date}:${rec.block}`)) {
    // Roy adding a job by hand skips the lead time, weekly hours and day-off rules —
    // he has already agreed the visit. He does NOT skip the clash check: putting two
    // jobs in one slot is the exact thing this system exists to prevent.
    const clash = held.get(`${rec.date}:${rec.block}`);
    return { error: `${clash.name} already has that slot. Move or cancel that job first.` };
  }

  const now = new Date().toISOString();
  const record = {
    id: `bk_${crypto.randomBytes(8).toString('hex')}`,
    createdAt: now,
    updatedAt: now,
    status: 'pending',
    source,
    date: rec.date,
    block: rec.block,
    name: rec.name,
    phone: rec.phone,
    email: rec.email,
    address: rec.address,
    job: rec.job,
    notes: '',
  };
  writeRequests([record].concat(requests));
  return { record, settings };
}

/** Roy's edits: status changes, a reschedule, or a private note. */
function updateRequest(id, patch) {
  const requests = readRequests();
  const i = requests.findIndex((r) => r.id === id);
  if (i < 0) return { error: 'That booking no longer exists.' };
  const settings = readSettings();
  const next = { ...requests[i] };

  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status)) return { error: 'Unknown status.' };
    next.status = patch.status;
  }
  if (patch.notes !== undefined) next.notes = cleanMultiline(patch.notes, 2000);
  if (patch.name !== undefined) next.name = clean(patch.name, 80);
  if (patch.phone !== undefined) next.phone = clean(patch.phone, 32);
  if (patch.address !== undefined) next.address = clean(patch.address, 200);
  if (patch.job !== undefined) next.job = cleanMultiline(patch.job, 2000);

  if (patch.date !== undefined || patch.block !== undefined) {
    const date = patch.date === undefined ? next.date : clean(patch.date, 10);
    const block = patch.block === undefined ? next.block : clean(patch.block, 12);
    if (!isIsoDate(date)) return { error: 'That date is not valid.' };
    if (!settings.blocks.some((b) => b.id === block)) return { error: 'Unknown slot.' };
    // Roy may double-book deliberately, but not by accident — refuse a move onto a
    // slot another live job already holds.
    const clash = requests.some((r) => r.id !== id && HOLDS.includes(r.status)
      && r.date === date && r.block === block);
    if (clash) return { error: 'Another job already holds that slot.' };
    next.date = date;
    next.block = block;
  }

  next.updatedAt = new Date().toISOString();
  requests[i] = next;
  writeRequests(requests);
  return { record: next };
}

function deleteRequest(id) {
  const requests = readRequests();
  const next = requests.filter((r) => r.id !== id);
  if (next.length === requests.length) return { error: 'That booking no longer exists.' };
  writeRequests(next);
  return { ok: true };
}

/** Toggle a whole day, or one block on a day, off and on. */
function toggleBlocked({ date, block }) {
  if (!isIsoDate(date)) return { error: 'That date is not valid.' };
  const settings = readSettings();
  if (block) {
    if (!settings.blocks.some((b) => b.id === block)) return { error: 'Unknown slot.' };
    const key = `${date}:${block}`;
    const set = new Set(settings.blockedSlots);
    if (set.has(key)) set.delete(key); else set.add(key);
    return { settings: writeSettings({ blockedSlots: [...set] }) };
  }
  const set = new Set(settings.blockedDates);
  if (set.has(date)) set.delete(date); else set.add(date);
  return { settings: writeSettings({ blockedDates: [...set] }) };
}

function summary() {
  const requests = readRequests();
  const today = todayIso();
  return {
    pending: requests.filter((r) => r.status === 'pending').length,
    upcoming: requests.filter((r) => r.status === 'confirmed' && r.date >= today).length,
    total: requests.length,
  };
}

/** Newest first, with resolved jobs pushed behind the live ones. */
function listRequests() {
  const rank = { pending: 0, confirmed: 1, done: 2, declined: 3, cancelled: 4 };
  return readRequests().slice().sort((a, b) => {
    const ra = rank[a.status] === undefined ? 9 : rank[a.status];
    const rb = rank[b.status] === undefined ? 9 : rank[b.status];
    if (ra !== rb) return ra - rb;
    if (a.date !== b.date) return String(a.date).localeCompare(String(b.date));
    return String(a.block).localeCompare(String(b.block));
  });
}

module.exports = {
  DIR, SETTINGS_FILE, REQUESTS_FILE, DEFAULTS, WEEKDAYS, STATUSES, TZ,
  todayIso, addDays, weekdayOf, isIsoDate, prettyDate,
  readSettings, writeSettings, readRequests, writeRequests,
  publicAvailability, schedule, createRequest, updateRequest, deleteRequest,
  toggleBlocked, summary, listRequests,
};
