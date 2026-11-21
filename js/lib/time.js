/* Date and time helpers. Itinerary dates are plain "YYYY-MM-DD" strings in
   Japan local time; nothing here depends on the viewer's own time zone. */

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function parseDate(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return { y, m, d, utc: Date.UTC(y, m - 1, d) };
}

export function dateParts(iso) {
  const p = parseDate(iso);
  const dow = new Date(p.utc).getUTCDay();
  return { ...p, dow: DOW[dow], dowLong: DOW_LONG[dow], mon: MON[p.m - 1], monLong: MON_LONG[p.m - 1] };
}

export const fmtShort = (iso) => { const p = dateParts(iso); return `${p.mon} ${p.d}`; };
export const fmtLong = (iso) => { const p = dateParts(iso); return `${p.dowLong}, ${p.monLong} ${p.d}`; };
export const fmtDow = (iso) => { const p = dateParts(iso); return `${p.dow} ${p.mon} ${p.d}`; };

export function fmtRange(a, b) {
  const pa = dateParts(a), pb = dateParts(b);
  return pa.m === pb.m ? `${pa.mon} ${pa.d}–${pb.d}` : `${pa.mon} ${pa.d} – ${pb.mon} ${pb.d}`;
}

export function nightsBetween(a, b) {
  return Math.round((parseDate(b).utc - parseDate(a).utc) / 86400000);
}

/** "14:30" → "2:30 PM" */
export function fmtTime(t) {
  if (!t) return '';
  const [H, M] = t.split(':').map(Number);
  const h = H % 12 === 0 ? 12 : H % 12;
  return `${h}:${String(M).padStart(2, '0')} ${H < 12 ? 'AM' : 'PM'}`;
}

export const minutesOf = (t) => { const [H, M] = t.split(':').map(Number); return H * 60 + M; };

/** Today's date in Japan, as "YYYY-MM-DD". */
export function todayInJapan(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return parts; // en-CA gives YYYY-MM-DD
}

/** Whole days from today (viewer's local calendar day) until an ISO date. */
export function daysUntil(isoDate, now = new Date()) {
  const p = parseDate(isoDate);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((p.utc - today) / 86400000);
}

export function countdownParts(targetISO, now = new Date()) {
  const ms = new Date(targetISO).getTime() - now.getTime();
  const abs = Math.abs(ms);
  return {
    past: ms < 0,
    days: Math.floor(abs / 86400000),
    hours: Math.floor((abs % 86400000) / 3600000),
    minutes: Math.floor((abs % 3600000) / 60000),
  };
}
