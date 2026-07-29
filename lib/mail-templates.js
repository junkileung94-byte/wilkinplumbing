'use strict';
/* The branded appointment-confirmation email, sent when Roy approves a request.
 *
 * Roy edits the words — subject, opening paragraph, closing paragraph — in the booking
 * settings screen. The chrome around them (logo, colours, the details table) is fixed
 * here so a stray edit cannot produce a broken-looking email.
 *
 * The admin preview renders through this same function against a sample booking, so
 * what Roy previews is exactly what a customer receives. Do not add a second renderer.
 *
 * Layout is deliberately old-fashioned: tables, inline styles, hex colours. Email
 * clients are not browsers — no flexbox, no grid, no oklch(), no <style> in Outlook.
 */

const booking = require('./booking');

// From brand/tokens.json. Hex, because oklch() means nothing to a mail client.
const NAVY = '#002D72';
const ORANGE = '#FF6400';
const PAPER = '#F7F6F5';
const TEXT = '#303030';
const MUTED = '#5E5E5E';

const PHONE = '705 888 2651';
const SITE = 'https://wilkinplumbing.ca';
const LOGO = `${SITE}/brand/logo/wilkin-logo.png`;

/** A sample booking, for the settings-screen preview. Never written anywhere. */
const SAMPLE = {
  id: 'bk_5f2c9ab41d0e',
  name: 'Sample Customer',
  phone: '705 555 0134',
  email: 'sample@example.com',
  address: '14 Dunlop Street East, Barrie',
  job: 'Kitchen tap dripping steadily, and the shut-off under the sink is seized.',
  date: null,        // filled in at render time — the sample should never look stale
  block: null,
};

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Plain text → HTML paragraphs, so Roy can hit Enter twice and get what he expects. */
function paragraphs(text, style) {
  return String(text || '').split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => `<p style="${style}">${escapeHtml(chunk).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function referenceOf(record) {
  return String(record.id || '').replace('bk_', '').slice(0, 6).toUpperCase();
}

/**
 * The values Roy can drop into his wording. Kept small and obvious — every one of them
 * is something he would otherwise have to type out by hand.
 */
/* Roy sets slot times as 24-hour because that is what a time input gives him. Customers
 * read a clock — the booking overlay already shows "8am – 12pm", and the confirmation
 * must not contradict it. Mirrors clock() in site/assets/booking.js. */
function clock(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  if (!Number.isFinite(h)) return String(hhmm);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `.${String(m).padStart(2, '0')}` : ''}${suffix}`;
}

function tokensFor(record, settings) {
  const block = (settings.blocks || []).find((b) => b.id === record.block);
  const slot = block
    ? `${block.label} (${clock(block.start)} – ${clock(block.end)})`
    : String(record.block || '');
  const day = booking.prettyDate(record.date);
  return {
    name: record.name || '',
    first_name: String(record.name || '').trim().split(/\s+/)[0] || record.name || '',
    date: day,
    slot,
    when: `${day}, ${slot}`,
    address: record.address || '',
    phone: record.phone || '',
    job: record.job || '',
    reference: referenceOf(record),
  };
}

/** Replaces {{token}}. An unknown token is left alone rather than blanked, so a typo
 *  is visible in the preview instead of silently deleting a line. */
function fill(template, tokens) {
  return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key) => (
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : whole
  ));
}

const TOKEN_HELP = [
  'name', 'first_name', 'date', 'slot', 'when', 'address', 'phone', 'job', 'reference',
];

function detailRow(label, value) {
  return `<tr>
    <td style="padding:10px 0;border-bottom:1px solid #e6e4e2;color:${MUTED};font-size:14px;width:110px;vertical-align:top">${escapeHtml(label)}</td>
    <td style="padding:10px 0;border-bottom:1px solid #e6e4e2;color:${TEXT};font-size:15px;font-weight:600;vertical-align:top">${escapeHtml(value)}</td>
  </tr>`;
}

/**
 * Render the confirmation.
 * @returns {{subject:string, text:string, html:string}}
 */
function confirmation(record, settings) {
  const cfg = settings.confirmEmail || {};
  const tokens = tokensFor(record, settings);
  const subject = fill(cfg.subject, tokens);
  const intro = fill(cfg.intro, tokens);
  const closing = fill(cfg.closing, tokens);

  const bodyStyle = `margin:0 0 14px;color:${TEXT};font-size:15px;line-height:1.6`;

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:24px 12px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">

      <tr><td style="background:${NAVY};padding:24px 28px" align="center">
        <img src="${LOGO}" alt="Wilkin Plumbing" width="150" style="display:block;border:0;width:150px;max-width:60%;height:auto">
      </td></tr>

      <tr><td style="height:4px;background:${ORANGE};font-size:0;line-height:0">&nbsp;</td></tr>

      <tr><td style="padding:28px">
        <p style="margin:0 0 4px;color:${ORANGE};font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:700">Appointment confirmed</p>
        <h1 style="margin:0 0 18px;color:${NAVY};font-size:22px;line-height:1.3">${escapeHtml(tokens.when)}</h1>

        ${paragraphs(intro, bodyStyle)}

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border-top:1px solid #e6e4e2">
          ${detailRow('When', tokens.when)}
          ${detailRow('Address', tokens.address)}
          ${detailRow('Job', tokens.job)}
          ${detailRow('Reference', tokens.reference)}
        </table>

        ${paragraphs(closing, bodyStyle)}

        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 0">
          <tr><td style="background:${ORANGE};border-radius:8px">
            <a href="tel:+17058882651" style="display:inline-block;padding:13px 26px;color:${NAVY};font-size:15px;font-weight:700;text-decoration:none">Call ${PHONE}</a>
          </td></tr>
        </table>
      </td></tr>

      <tr><td style="background:${PAPER};padding:18px 28px;color:${MUTED};font-size:12px;line-height:1.6">
        Wilkin Plumbing · ${PHONE} · <a href="${SITE}" style="color:${NAVY}">wilkinplumbing.ca</a><br>
        Licensed plumbing across Barrie and Simcoe County.
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;

  // The plain-text alternative carries the same information — it is what a customer
  // reading mail in a terminal, or a client that blocks HTML, actually sees.
  const text = [
    'APPOINTMENT CONFIRMED',
    tokens.when,
    '',
    intro,
    '',
    `When:       ${tokens.when}`,
    `Address:    ${tokens.address}`,
    `Job:        ${tokens.job}`,
    `Reference:  ${tokens.reference}`,
    '',
    closing,
    '',
    '--',
    `Wilkin Plumbing · ${PHONE}`,
    SITE,
  ].filter((line) => line !== null).join('\n');

  return { subject, text, html };
}

/** The same thing, against a sample booking, for the settings preview. */
function samplePreview(settings) {
  const days = booking.publicAvailability().days || [];
  const open = days.find((d) => d.any) || days[0];
  const record = {
    ...SAMPLE,
    date: open ? open.date : booking.todayIso(),
    block: (settings.blocks && settings.blocks[0] && settings.blocks[0].id) || 'am',
  };
  return confirmation(record, settings);
}

/** "Tue, Jul 28, 2026, Morning (8am – 12pm)" — the one phrasing every customer-facing
 *  message uses, so the receipt and the confirmation never describe a slot differently. */
function whenOf(record, settings) {
  return tokensFor(record, settings).when;
}

module.exports = {
  confirmation, samplePreview, referenceOf, whenOf, TOKEN_HELP, escapeHtml,
};
