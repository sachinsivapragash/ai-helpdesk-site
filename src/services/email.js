// Booking emails through the Brevo HTTP API (free tier). Render's free plan blocks SMTP ports,
// so an HTTP email API is used instead of SMTP. Email is best-effort: a failed or slow email
// never fails the booking itself, and the result is shown on the health page.
const config = require('../config');

let lastStatus = {
  ok: null,
  detail: config.mail.apiKey && config.mail.from ? 'not used yet' : 'BREVO_API_KEY or MAIL_FROM not set - emails disabled',
  at: null,
};

const enabled = () => Boolean(config.mail.apiKey && config.mail.from);

function escape(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatDate(date) {
  const d = new Date(date);
  const tz = config.site.timezone;
  return `${d.toLocaleDateString('en-IN', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ` +
    d.toLocaleTimeString('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
}

function layout(title, intro, rows, footer) {
  const table = rows.map(([k, v]) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#64748b">${escape(k)}</td><td style="padding:6px 0;font-weight:600">${escape(v)}</td></tr>`).join('');
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0f172a">
  <div style="background:#4f46e5;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-size:18px;font-weight:700">${escape(config.site.name)}</div>
  <div style="border:1px solid #e2e8f0;border-top:0;padding:20px;border-radius:0 0 12px 12px">
    <h2 style="margin:0 0 8px">${escape(title)}</h2>
    <p style="margin:0 0 16px">${escape(intro)}</p>
    <table style="border-collapse:collapse;margin-bottom:16px">${table}</table>
    <p style="margin:0;color:#64748b;font-size:14px">${escape(footer)}</p>
  </div>
</div>`;
}

async function send({ to, name, subject, html, text }) {
  if (!enabled()) return 'disabled';
  const started = Date.now();
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': config.mail.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      signal: AbortSignal.timeout(config.mail.timeoutMs),
      body: JSON.stringify({
        sender: { name: config.site.name, email: config.mail.from },
        to: [{ email: to, name }],
        subject,
        htmlContent: html,
        textContent: text,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`Brevo responded ${res.status}${body.message ? `: ${body.message}` : ''}`);
    }
    lastStatus = { ok: true, detail: `last email sent in ${Date.now() - started} ms`, at: new Date() };
    return 'sent';
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? `timed out after ${config.mail.timeoutMs} ms` : err.message;
    lastStatus = { ok: false, detail: `last email failed: ${reason}`, at: new Date() };
    console.warn(`[email] ${subject} to ${to} failed: ${reason}`);
    return 'failed';
  }
}

function bookingConfirmed(b) {
  const rows = [['Reference', b.reference], ['Event', b.event], ['When', formatDate(b.starts_at)], ['Venue', b.venue], ['Seats', String(b.seats)]];
  const footer = 'Bring this reference and your college ID. To cancel, open a support ticket with your reference.';
  return send({
    to: b.email,
    name: b.name,
    subject: `Booking confirmed: ${b.event} (${b.reference})`,
    html: layout(`You're booked, ${b.name}!`, 'Your seats are reserved. Here are your booking details:', rows, footer),
    text: `Hi ${b.name},\n\nYour booking is confirmed.\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${footer}\n\n${config.site.name}`,
  });
}

function bookingCancelled(b) {
  const rows = [['Reference', b.reference], ['Event', b.event], ['When', formatDate(b.starts_at)], ['Seats released', String(b.seats)]];
  const footer = 'If you did not ask for this, open a support ticket on the website.';
  return send({
    to: b.email,
    name: b.name,
    subject: `Booking cancelled: ${b.event} (${b.reference})`,
    html: layout('Your booking was cancelled', `Hi ${b.name}, the organisers have cancelled this booking:`, rows, footer),
    text: `Hi ${b.name},\n\nYour booking was cancelled.\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${footer}\n\n${config.site.name}`,
  });
}

module.exports = {
  bookingConfirmed,
  bookingCancelled,
  status: () => ({ configured: enabled(), from: enabled() ? config.mail.from : null, ...lastStatus }),
};
