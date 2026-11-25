export const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmtTime = (ms) =>
  new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export const fmtDay = (ms) => {
  const d = new Date(ms), t = new Date();
  const y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
};

export function fmtDur(ms) {
  ms = Math.max(0, ms);
  const m = Math.floor(ms / MIN);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function fmtClock(ms) {
  ms = Math.max(0, ms);
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`;
}

export const fmtAgo = (ms) => {
  const d = Date.now() - ms;
  return d < MIN ? 'just now' : `${fmtDur(d)} ago`;
};

export const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const dayKey = (ms = Date.now()) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const toLocalInput = (ms) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * MIN);
  return d.toISOString().slice(0, 16);
};
export const fromLocalInput = (s) => (s ? new Date(s).getTime() : null);

export function babyAge(birthDate) {
  if (!birthDate) return '';
  const b = new Date(birthDate + 'T00:00:00');
  const days = Math.floor((startOfDay(Date.now()) - b.getTime()) / DAY);
  if (days < 0) return `Due in ${-days} day${days === -1 ? '' : 's'}`;
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} old`;
  if (days < 7 * 13) {
    const w = Math.floor(days / 7), d = days % 7;
    return `${w} weeks${d ? ` ${d} day${d === 1 ? '' : 's'}` : ''} old`;
  }
  const now = new Date();
  let months = (now.getFullYear() - b.getFullYear()) * 12 + now.getMonth() - b.getMonth();
  if (now.getDate() < b.getDate()) months--;
  return months >= 12 ? `${Math.floor(months / 12)} year${months >= 24 ? 's' : ''} old` : `${months} months old`;
}

export const ML_PER_OZ = 29.5735;
export const fmtAmount = (ml, unit) =>
  ml == null ? '' : unit === 'oz' ? `${(ml / ML_PER_OZ).toFixed(1)} oz` : `${Math.round(ml)} ml`;

export const isIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ---- Calendar helpers ----
const icsDate = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsLocal = (d) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}T` +
  `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}00`;
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function rrule(days) {
  return days.length === 7 ? 'RRULE:FREQ=DAILY' : `RRULE:FREQ=WEEKLY;BYDAY=${days.map((d) => BYDAY[d]).join(',')}`;
}

function routineStart(r) {
  const [h, m] = r.time.split(':').map(Number);
  const d = new Date(); d.setHours(h, m, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  return d;
}

// One calendar event for a single moment (e.g. the next feed).
export function calendarLinkForMoment(title, ms, minutes = 15) {
  if (isIOS()) {
    return icsHref([
      'BEGIN:VEVENT', `UID:${ms}-nestling`, `DTSTAMP:${icsDate(Date.now())}`,
      `DTSTART:${icsDate(ms)}`, `DTEND:${icsDate(ms + minutes * MIN)}`, `SUMMARY:${title}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${title}`, 'TRIGGER:-PT0M', 'END:VALARM', 'END:VEVENT',
    ]);
  }
  const p = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${icsDate(ms)}/${icsDate(ms + minutes * MIN)}` });
  return `https://calendar.google.com/calendar/render?${p}`;
}

// A repeating calendar event for a routine.
export function calendarLinkForRoutine(r) {
  const s = routineStart(r), e = new Date(s.getTime() + 15 * MIN);
  if (isIOS()) return icsHref(routineVevent(r));
  const p = new URLSearchParams({
    action: 'TEMPLATE', text: r.title, dates: `${icsLocal(s)}/${icsLocal(e)}`,
    recur: rrule(r.days), ctz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

function routineVevent(r) {
  const s = routineStart(r), e = new Date(s.getTime() + 15 * MIN);
  return [
    'BEGIN:VEVENT', `UID:${r.id}-nestling`, `DTSTAMP:${icsDate(Date.now())}`,
    `DTSTART:${icsLocal(s)}`, `DTEND:${icsLocal(e)}`, rrule(r.days), `SUMMARY:${r.title}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${r.title}`, 'TRIGGER:-PT0M', 'END:VALARM', 'END:VEVENT',
  ];
}

export function icsForRoutines(routines) {
  return icsHref(routines.flatMap(routineVevent));
}

function icsHref(lines) {
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nestling//EN', ...lines, 'END:VCALENDAR'].join('\r\n');
  return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(body);
}
