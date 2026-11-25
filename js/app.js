import { store, uid } from './store.js';
import { startSync, syncAvailable, syncStatus, newFamilyId } from './sync.js';
import {
  esc, fmtTime, fmtDay, fmtDur, fmtClock, fmtAgo, startOfDay, dayKey, toLocalInput, fromLocalInput,
  babyAge, fmtAmount, ML_PER_OZ, MIN, DAY, calendarLinkForMoment, calendarLinkForRoutine, icsForRoutines, isIOS,
} from './util.js';

const $ = (s, el = document) => el.querySelector(s);
const main = $('#main');
const sheet = $('#sheet');
let view = 'home';
let logDay = startOfDay(Date.now());

// ------------------------------------------------------------------ helpers
const S = () => store.settings;
const unit = () => S().unit || 'ml';
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DIAPER = { wet: '💧 Wet', dirty: '💩 Dirty', both: '💧💩 Both', dry: '◻️ Dry' };

function breastTotals(e) {
  const t = { L: 0, R: 0 };
  let activeSide = null, activeStart = null;
  (e.segments || []).forEach((s) => {
    if (s.end) t[s.side] += s.end - s.start;
    else { activeSide = s.side; activeStart = s.start; }
  });
  return { ...t, activeSide, activeStart };
}

const lastSideOf = (e) => {
  const segs = e?.segments || [];
  return segs.length ? segs[segs.length - 1].side : null;
};

function describe(e) {
  const u = unit();
  if (e.type === 'feed') {
    if (e.kind === 'bottle') return { icon: '🍼', title: `Bottle ${fmtAmount(e.amount, u)}`, sub: e.milk === 'formula' ? 'Formula' : 'Breast milk' };
    const t = breastTotals(e);
    const parts = [];
    if (t.L || t.activeSide === 'L') parts.push(`L ${fmtDur(t.L)}`);
    if (t.R || t.activeSide === 'R') parts.push(`R ${fmtDur(t.R)}`);
    return { icon: '🤱', title: 'Breastfeed', sub: parts.join(' · ') || 'Started' };
  }
  if (e.type === 'sleep') return { icon: '😴', title: 'Sleep', sub: e.end ? fmtDur(e.end - e.start) : 'Sleeping now' };
  if (e.type === 'diaper') return { icon: '🧷', title: 'Diaper', sub: DIAPER[e.diaper] || '' };
  if (e.type === 'pump') return { icon: '🥛', title: `Pumped ${fmtAmount(e.amount, u)}`, sub: '' };
  return { icon: '📝', title: 'Note', sub: '' };
}

function nextFeedDue() {
  const f = store.lastFeed();
  if (!f) return null;
  return f.start + (S().feedIntervalMin || 180) * MIN;
}

function daySummary(from) {
  const to = from + DAY;
  const es = store.list().filter((e) => e.start >= from && e.start < to);
  const feeds = es.filter((e) => e.type === 'feed');
  const bottleMl = feeds.filter((e) => e.kind === 'bottle').reduce((a, e) => a + (e.amount || 0), 0);
  const diapers = es.filter((e) => e.type === 'diaper');
  // Sleep overlapping this day, clipped to it.
  const sleepMs = store.list('sleep').reduce((a, e) => {
    const s = Math.max(e.start, from), en = Math.min(e.end || Date.now(), to);
    return a + Math.max(0, en - s);
  }, 0);
  return {
    feeds: feeds.length, bottleMl,
    wet: diapers.filter((d) => d.diaper === 'wet' || d.diaper === 'both').length,
    dirty: diapers.filter((d) => d.diaper === 'dirty' || d.diaper === 'both').length,
    sleepMs,
  };
}

function routineDueToday(r) {
  return r.days.includes(new Date().getDay());
}

// ------------------------------------------------------------------ actions
const actions = {
  nav: (el) => { view = el.dataset.view; render(); window.scrollTo(0, 0); },

  breast: (el) => {
    const side = el.dataset.side;
    const now = Date.now();
    const act = store.active('feed');
    if (act && act.kind === 'breast') return switchSide(act, side);
    store.putEntry({ type: 'feed', kind: 'breast', start: now, end: null, segments: [{ side, start: now, end: null }] });
  },
  side: (el) => { const a = store.active('feed'); if (a) switchSide(a, el.dataset.side); },
  pauseFeed: () => {
    const a = store.active('feed'); if (!a) return;
    const now = Date.now();
    store.putEntry({ ...a, segments: a.segments.map((s) => (s.end ? s : { ...s, end: now })) });
  },
  stopFeed: () => {
    const a = store.active('feed'); if (!a) return;
    const now = Date.now();
    store.putEntry({ ...a, end: now, segments: (a.segments || []).map((s) => (s.end ? s : { ...s, end: now })) });
    toast('Feed saved');
  },
  sleep: () => {
    const a = store.active('sleep');
    if (a) { store.putEntry({ ...a, end: Date.now() }); toast(`Slept ${fmtDur(Date.now() - a.start)}`); }
    else store.putEntry({ type: 'sleep', start: Date.now(), end: null });
  },
  diaperSheet: () => openSheet('diaper'),
  diaper: (el) => {
    store.putEntry({ type: 'diaper', diaper: el.dataset.kind, start: Date.now(), end: Date.now() });
    closeSheet(); toast(`${DIAPER[el.dataset.kind]} diaper logged`);
  },
  bottleSheet: () => openSheet('bottle'),
  edit: (el) => openSheet('edit', store.entries.get(el.dataset.id)),
  addPast: () => openSheet('pickType'),
  newOfType: (el) => {
    const t = el.dataset.type, now = Date.now();
    const base = { id: uid(), start: now - 30 * MIN, end: now, _new: true };
    const tpl = {
      breast: { type: 'feed', kind: 'breast', segments: [{ side: 'L', start: now - 30 * MIN, end: now - 15 * MIN }, { side: 'R', start: now - 15 * MIN, end: now }] },
      bottle: { type: 'feed', kind: 'bottle', amount: 60, milk: 'breast', end: now - 30 * MIN },
      sleep: { type: 'sleep' },
      diaper: { type: 'diaper', diaper: 'wet', start: now, end: now },
      pump: { type: 'pump', amount: 60, start: now, end: now },
    }[t];
    openSheet('edit', { ...base, ...tpl });
  },
  closeSheet: () => closeSheet(),
  chip: (el) => {
    const group = el.closest('[data-chips]');
    group.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === el));
    const input = group.querySelector('input[type=hidden]') || $(`[name="${group.dataset.chips}"]`, group.closest('form'));
    if (input) input.value = el.dataset.value;
  },
  dayToggle: (el) => el.classList.toggle('on'),
  deleteEntry: (el) => {
    if (!confirmTwice(el)) return;
    store.deleteEntry(el.dataset.id); closeSheet(); toast('Deleted');
  },
  logPrev: () => { logDay -= DAY; render(); },
  logNext: () => { logDay = Math.min(startOfDay(Date.now()), logDay + DAY); render(); },

  routineDone: (el) => {
    const r = store.routines.get(el.dataset.id); const k = dayKey();
    const done = { ...(r.done || {}) };
    if (done[k]) delete done[k]; else done[k] = store.device.me || 'done';
    // keep only the last 14 days of ticks
    Object.keys(done).sort().slice(0, -14).forEach((d) => delete done[d]);
    store.putRoutine({ ...r, done });
  },
  editRoutine: (el) => openSheet('routine', el.dataset.id ? store.routines.get(el.dataset.id) : null),
  deleteRoutine: (el) => { if (!confirmTwice(el)) return; store.deleteRoutine(el.dataset.id); closeSheet(); },

  enableNotify: async () => {
    if (!('Notification' in window)) return toast(isIOS() ? 'Add the app to your Home Screen first' : 'Notifications not supported here');
    const p = await Notification.requestPermission();
    store.saveDevice({ notify: p === 'granted' });
    toast(p === 'granted' ? 'Reminders on for this phone' : 'Notifications were blocked');
  },
  disableNotify: () => store.saveDevice({ notify: false }),

  createFamily: () => {
    store.saveDevice({ householdId: newFamilyId(), needsUpload: true });
    startSync(); render();
  },
  joinFamily: () => {
    const code = ($('#joinCode')?.value || '').trim().toLowerCase();
    if (code.replace(/-/g, '').length < 12) return toast('That code looks too short');
    store.saveDevice({ householdId: code, needsUpload: true });
    startSync(); render(); toast('Joined. Syncing…');
  },
  leaveFamily: (el) => {
    if (!confirmTwice(el)) return;
    store.saveDevice({ householdId: '' }); store.backend = null; location.reload();
  },
  shareFamily: async () => {
    const url = `${location.origin}${location.pathname}#join=${store.device.householdId}`;
    const text = `Join our baby log: open this link on your phone, then add it to your Home Screen.\n${url}`;
    if (navigator.share) { try { await navigator.share({ title: 'Nestling', text, url }); return; } catch { /* cancelled */ } }
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { prompt('Copy this link', url); }
  },
  exportData: () => {
    const blob = new Blob([JSON.stringify({ entries: store.list(), routines: store.routineList(), settings: S() }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `nestling-${dayKey()}.json`; a.click();
  },
};

function switchSide(act, side) {
  const now = Date.now();
  const segs = (act.segments || []).map((s) => (s.end ? s : { ...s, end: now }));
  segs.push({ side, start: now, end: null });
  store.putEntry({ ...act, segments: segs });
}

// Destructive buttons need a second tap (no blocking browser dialogs).
function confirmTwice(el) {
  if (el.dataset.armed) return true;
  el.dataset.armed = '1';
  const old = el.textContent;
  el.textContent = 'Tap again to confirm';
  setTimeout(() => { delete el.dataset.armed; el.textContent = old; }, 3000);
  return false;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ------------------------------------------------------------------ forms
const forms = {
  welcome: (f) => {
    store.saveDevice({ me: f.me.value.trim(), welcomed: true });
    const patch = {};
    if (f.babyName.value.trim()) patch.babyName = f.babyName.value.trim();
    if (f.birthDate.value) patch.birthDate = f.birthDate.value;
    if (Object.keys(patch).length) store.putSettings(patch);
    if (f.joinCode.value.trim()) {
      store.saveDevice({ householdId: f.joinCode.value.trim().toLowerCase(), needsUpload: true });
      startSync();
    }
    closeSheet();
  },
  bottle: (f) => {
    const amt = Number(f.amount.value);
    const ml = unit() === 'oz' ? amt * ML_PER_OZ : amt;
    const start = fromLocalInput(f.start.value) || Date.now();
    store.putEntry({ type: 'feed', kind: 'bottle', amount: Math.round(ml), milk: f.milk.value, start, end: start, note: f.note.value });
    closeSheet(); toast('Bottle logged');
  },
  edit: (f) => {
    const e = { ...sheet._data }; delete e._new;
    e.start = fromLocalInput(f.start.value) ?? e.start;
    if (f.end) e.end = f.end.value ? fromLocalInput(f.end.value) : null;
    if (f.amount) { const a = Number(f.amount.value); e.amount = Math.round(unit() === 'oz' ? a * ML_PER_OZ : a); }
    if (f.milk) e.milk = f.milk.value;
    if (f.diaper) { e.diaper = f.diaper.value; e.end = e.start; }
    if (e.type === 'pump') e.end = e.start;
    if (f.minL) {
      const l = Number(f.minL.value) * MIN, r = Number(f.minR.value) * MIN;
      const first = f.firstSide.value;
      const a = first === 'L' ? l : r, b = first === 'L' ? r : l;
      e.segments = [];
      if (a) e.segments.push({ side: first, start: e.start, end: e.start + a });
      if (b) e.segments.push({ side: first === 'L' ? 'R' : 'L', start: e.start + a, end: e.start + a + b });
      e.end = e.start + a + b;
    }
    if (e.end != null && e.end < e.start) return toast('End is before start');
    e.note = f.note.value;
    store.putEntry(e); closeSheet(); toast('Saved');
  },
  routine: (f) => {
    const days = [...f.querySelectorAll('.daypick .on')].map((b) => Number(b.dataset.d));
    if (!f.title.value.trim()) return toast('Give it a name');
    if (!days.length) return toast('Pick at least one day');
    const r = sheet._data || {};
    store.putRoutine({ ...r, title: f.title.value.trim(), time: f.time.value || '09:00', icon: f.icon.value || '⏰', days, remind: f.remind.checked });
    closeSheet();
  },
  settings: (f) => {
    store.putSettings({
      babyName: f.babyName.value.trim(), birthDate: f.birthDate.value,
      feedIntervalMin: Number(f.interval.value), unit: f.unit.value,
    });
    store.saveDevice({ me: f.me.value.trim() });
    toast('Saved');
  },
};

// ------------------------------------------------------------------ views
function syncBadge() {
  if (!store.device.householdId) return `<span class="badge">This phone only</span>`;
  const st = syncStatus();
  const label = { live: 'Synced', offline: 'Offline, will sync', connecting: 'Connecting…', error: 'Sync problem', off: 'Not syncing' }[st];
  return `<span class="badge ${st}"><i></i>${label}</span>`;
}

function header() {
  const s = S();
  return `<header class="top">
    <div><h1>${esc(s.babyName || 'Baby')}</h1><p class="muted">${esc(babyAge(s.birthDate) || 'Add birth date in Settings')}</p></div>
    ${syncBadge()}
  </header>`;
}

function activeFeedCard(a) {
  const t = breastTotals(a);
  const sideBtn = (side) => {
    const on = t.activeSide === side;
    return `<button class="side ${on ? 'on' : ''}" data-action="side" data-side="${side}">
      <b>${side === 'L' ? 'Left' : 'Right'}</b>
      <span class="mono" ${on ? `data-base="${t[side]}" data-from="${t.activeStart}"` : ''}>${fmtClock(t[side])}</span>
      <small>${on ? 'feeding' : 'tap to switch'}</small></button>`;
  };
  return `<section class="card live feed">
    <div class="row"><h2>🤱 Feeding</h2><span class="mono big" data-from="${a.start}">${fmtClock(Date.now() - a.start)}</span></div>
    <p class="muted">Started ${fmtTime(a.start)}${a.by ? ` by ${esc(a.by)}` : ''}</p>
    <div class="sides">${sideBtn('L')}${sideBtn('R')}</div>
    <div class="row gap">
      ${t.activeSide ? `<button class="btn ghost" data-action="pauseFeed">Pause</button>` : ''}
      <button class="btn primary grow" data-action="stopFeed">Done feeding</button>
    </div>
  </section>`;
}

function activeSleepCard(a) {
  return `<section class="card live sleep">
    <div class="row"><h2>😴 Sleeping</h2><span class="mono big" data-from="${a.start}">${fmtClock(Date.now() - a.start)}</span></div>
    <p class="muted">Fell asleep ${fmtTime(a.start)}${a.by ? ` · logged by ${esc(a.by)}` : ''}</p>
    <button class="btn primary wide" data-action="sleep">Woke up</button>
  </section>`;
}

function nextFeedCard() {
  const last = store.lastFeed();
  if (!last) return `<section class="card"><h2>Next feed</h2><p class="muted">Log the first feed and I'll work out when the next one is due.</p></section>`;
  const due = nextFeedDue();
  const left = due - Date.now();
  const lastSide = last.kind === 'breast' ? lastSideOf(last) : null;
  const suggest = lastSide ? (lastSide === 'L' ? 'Right' : 'Left') : null;
  const d = describe(last);
  return `<section class="card next ${left < 0 ? 'overdue' : left < 20 * MIN ? 'soon' : ''}">
    <p class="label">Next feed</p>
    <div class="row"><h2 class="huge">${fmtTime(due)}</h2>
      <span class="pill">${left < 0 ? `${fmtDur(-left)} overdue` : `in ${fmtDur(left)}`}</span></div>
    <p class="muted">Last: ${d.icon} ${esc(d.title)} ${d.sub ? `(${esc(d.sub)})` : ''} · ${fmtAgo(last.start)}${last.by ? ` · ${esc(last.by)}` : ''}</p>
    ${suggest ? `<p class="hint">Start on the <b>${suggest}</b> side next time</p>` : ''}
    <a class="link" href="${calendarLinkForMoment('🍼 Feed due', due)}" target="_blank" rel="noopener" ${isIOS() ? 'download="next-feed.ics"' : ''}>＋ Put this in my calendar</a>
  </section>`;
}

function quickActions() {
  const feeding = store.active('feed');
  const sleeping = store.active('sleep');
  return `<section class="quick">
    ${feeding ? '' : `<button class="qa" data-action="breast" data-side="L"><span>🤱</span>Breast L</button>
    <button class="qa" data-action="breast" data-side="R"><span>🤱</span>Breast R</button>`}
    <button class="qa" data-action="bottleSheet"><span>🍼</span>Bottle</button>
    <button class="qa" data-action="diaperSheet"><span>🧷</span>Diaper</button>
    ${sleeping ? '' : `<button class="qa" data-action="sleep"><span>😴</span>Sleep</button>`}
  </section>`;
}

function todayCard() {
  const s = daySummary(startOfDay(Date.now()));
  return `<section class="card">
    <h2>Today so far</h2>
    <div class="stats">
      <div><b>${s.feeds}</b><span>feeds</span></div>
      <div><b>${s.bottleMl ? fmtAmount(s.bottleMl, unit()) : '—'}</b><span>by bottle</span></div>
      <div><b>${s.wet}</b><span>wet</span></div>
      <div><b>${s.dirty}</b><span>dirty</span></div>
      <div><b>${fmtDur(s.sleepMs)}</b><span>sleep</span></div>
    </div>
  </section>`;
}

function routineRow(r, compact = false) {
  const done = r.done?.[dayKey()];
  return `<div class="routine ${done ? 'done' : ''}">
    <button class="check" data-action="routineDone" data-id="${r.id}" aria-label="Mark done">${done ? '✓' : ''}</button>
    <div class="grow" ${compact ? '' : `data-action="editRoutine" data-id="${r.id}"`}>
      <b>${esc(r.icon || '')} ${esc(r.title)}</b>
      <span class="muted">${fmtTime(new Date(`2000-01-01T${r.time}`).getTime())}${done && done !== 'done' ? ` · done by ${esc(done)}` : ''}${compact ? '' : ` · ${r.days.length === 7 ? 'Every day' : r.days.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}`}</span>
    </div>
    ${compact ? '' : `<a class="iconbtn" title="Add to calendar" href="${calendarLinkForRoutine(r)}" target="_blank" rel="noopener" ${isIOS() ? `download="${esc(r.title)}.ics"` : ''}>📅</a>`}
  </div>`;
}

function upNextCard() {
  const today = store.routineList().filter(routineDueToday);
  if (!today.length) return '';
  const nowHM = new Date().toTimeString().slice(0, 5);
  const pending = today.filter((r) => !r.done?.[dayKey()]);
  const show = [...pending.filter((r) => r.time >= nowHM), ...pending.filter((r) => r.time < nowHM)].slice(0, 4);
  return `<section class="card">
    <div class="row"><h2>Routines today</h2><span class="muted">${today.length - pending.length}/${today.length} done</span></div>
    ${show.length ? show.map((r) => routineRow(r, true)).join('') : '<p class="muted">All done for today 🎉</p>'}
  </section>`;
}

function recentCard() {
  const items = store.list().slice(0, 5);
  if (!items.length) return '';
  return `<section class="card"><div class="row"><h2>Recent</h2><button class="link" data-action="nav" data-view="log">See all</button></div>
    ${items.map(entryRow).join('')}</section>`;
}

function entryRow(e) {
  const d = describe(e);
  return `<button class="entry" data-action="edit" data-id="${e.id}">
    <span class="ic">${d.icon}</span>
    <span class="grow"><b>${esc(d.title)}</b><span class="muted">${esc(d.sub)}${e.note ? ` · ${esc(e.note)}` : ''}</span></span>
    <span class="when">${fmtTime(e.start)}${e.by ? `<small>${esc(e.by)}</small>` : ''}</span>
  </button>`;
}

function homeView() {
  const af = store.active('feed'), as = store.active('sleep');
  return `${header()}
  <div class="cols">
    <div class="col">
      ${af && af.kind === 'breast' ? activeFeedCard(af) : ''}
      ${as ? activeSleepCard(as) : ''}
      ${af ? '' : nextFeedCard()}
      ${quickActions()}
    </div>
    <div class="col">
      ${todayCard()}
      ${upNextCard()}
      ${recentCard()}
    </div>
  </div>`;
}

function logView() {
  const from = logDay, to = from + DAY;
  const items = store.list().filter((e) => e.start >= from && e.start < to);
  const s = daySummary(from);
  const isToday = from === startOfDay(Date.now());
  return `<header class="top"><h1>Log</h1><button class="btn small" data-action="addPast">＋ Add</button></header>
  <div class="daynav">
    <button class="iconbtn" data-action="logPrev" aria-label="Previous day">‹</button>
    <b>${fmtDay(from)}</b>
    <button class="iconbtn" data-action="logNext" aria-label="Next day" ${isToday ? 'disabled' : ''}>›</button>
  </div>
  <div class="cols">
    <div class="col"><section class="card">
      <div class="stats">
        <div><b>${s.feeds}</b><span>feeds</span></div>
        <div><b>${s.bottleMl ? fmtAmount(s.bottleMl, unit()) : '—'}</b><span>bottle</span></div>
        <div><b>${s.wet}/${s.dirty}</b><span>wet/dirty</span></div>
        <div><b>${fmtDur(s.sleepMs)}</b><span>sleep</span></div>
      </div></section></div>
    <div class="col"><section class="card list">
      ${items.length ? items.map(entryRow).join('') : '<p class="muted center">Nothing logged this day.</p>'}
    </section></div>
  </div>`;
}

function routinesView() {
  const rs = store.routineList();
  return `<header class="top"><h1>Routines</h1><button class="btn small" data-action="editRoutine">＋ New</button></header>
  <p class="muted pad">Tick them off as you go; both phones see who did what. Tap 📅 to add one to your own calendar as a repeating reminder.</p>
  <section class="card list">${rs.length ? rs.map((r) => routineRow(r)).join('') : '<p class="muted center">No routines yet.</p>'}</section>
  ${rs.length ? `<a class="btn ghost wide" href="${icsForRoutines(rs)}" download="nestling-routines.ics">Download all as a calendar file (.ics)</a>` : ''}`;
}

function settingsView() {
  const s = S(), d = store.device;
  const iv = [90, 120, 150, 180, 210, 240];
  const family = d.householdId
    ? `<p>Family code: <b class="mono">${esc(d.householdId)}</b></p>
       <p class="muted">Anyone with this code can see and add to your log.</p>
       <div class="row gap"><button type="button" class="btn primary grow" data-action="shareFamily">Invite partner</button>
       <button type="button" class="btn ghost" data-action="leaveFamily">Leave</button></div>`
    : syncAvailable()
      ? `<p class="muted">Share one log between both phones. Create a family on one phone, then send the invite link to the other.</p>
         <button type="button" class="btn primary wide" data-action="createFamily">Create family</button>
         <div class="row gap" style="margin-top:10px"><input id="joinCode" placeholder="or enter a family code" class="grow"><button type="button" class="btn" data-action="joinFamily">Join</button></div>`
      : `<p class="muted">Syncing between phones isn't switched on yet: it needs the Firebase setup in README.md. Until then everything is saved on this phone only.</p>`;
  return `<header class="top"><h1>Settings</h1></header>
  <div class="cols"><div class="col">
  <form class="card form" data-form="settings">
    <label>Your name on this phone<input name="me" value="${esc(d.me)}" placeholder="e.g. Shrey"></label>
    <label>Baby's name<input name="babyName" value="${esc(s.babyName)}" placeholder="Baby"></label>
    <label>Birth date (or due date for now)<input type="date" name="birthDate" value="${esc(s.birthDate)}"></label>
    <label>Feed every<select name="interval">${iv.map((m) => `<option value="${m}" ${m === s.feedIntervalMin ? 'selected' : ''}>${fmtDur(m * MIN)}</option>`).join('')}</select></label>
    <label>Bottle units<select name="unit"><option value="ml" ${s.unit !== 'oz' ? 'selected' : ''}>ml</option><option value="oz" ${s.unit === 'oz' ? 'selected' : ''}>oz</option></select></label>
    <button class="btn primary wide">Save</button>
  </form></div><div class="col">
  <section class="card"><h2>Share with partner</h2>${family}</section>
  <section class="card"><h2>Feed reminders</h2>
    <p class="muted">${d.notify ? 'On for this phone.' : 'Get a notification on this phone when a feed is due.'}
    ${isIOS() ? ' On iPhone, add the app to the Home Screen first.' : ''} Phones may hold back alerts when the app has been closed for a while, so the "Put this in my calendar" link on the home screen is the most reliable alarm.</p>
    ${d.notify ? `<button type="button" class="btn ghost wide" data-action="disableNotify">Turn off</button>` : `<button type="button" class="btn wide" data-action="enableNotify">Turn on reminders</button>`}
  </section>
  <section class="card"><h2>Your data</h2><button type="button" class="btn ghost wide" data-action="exportData">Download a backup (JSON)</button></section>
  </div></div>`;
}

// ------------------------------------------------------------------ sheets
function openSheet(kind, data = null) {
  sheet._data = data;
  sheet._kind = kind;
  const u = unit();
  const amounts = u === 'oz' ? [1, 2, 3, 4, 5, 6] : [30, 60, 90, 120, 150, 180];
  const chips = (name, opts, cur) => `<div class="chips" data-chips="${name}">
    ${opts.map(([v, l]) => `<button type="button" class="chip ${String(v) === String(cur) ? 'on' : ''}" data-action="chip" data-value="${v}">${l}</button>`).join('')}
    <input type="hidden" name="${name}" value="${esc(cur)}"></div>`;

  let html = '';
  if (kind === 'welcome') {
    html = `<form data-form="welcome"><h2>Welcome 👋</h2>
      <p class="muted">A shared log for feeds, sleep, diapers and routines.</p>
      <label>Your name<input name="me" required placeholder="e.g. Shrey"></label>
      <label>Baby's name (optional)<input name="babyName" value="${esc(S().babyName)}"></label>
      <label>Birth date or due date (optional)<input type="date" name="birthDate" value="${esc(S().birthDate)}"></label>
      <label>Family code from your partner (optional)<input name="joinCode" value="${esc(sheet._join || '')}" placeholder="xxxx-xxxx-xxxx"></label>
      <button class="btn primary wide">Start</button></form>`;
  } else if (kind === 'diaper') {
    html = `<h2>Diaper change</h2><div class="grid2">
      ${Object.entries(DIAPER).map(([k, l]) => `<button class="qa" data-action="diaper" data-kind="${k}">${l}</button>`).join('')}</div>
      <button class="btn ghost wide" data-action="closeSheet">Cancel</button>`;
  } else if (kind === 'bottle') {
    html = `<form data-form="bottle"><h2>🍼 Bottle</h2>
      <label>Amount (${u})<input name="amount" type="number" inputmode="decimal" step="any" value="${amounts[1]}" required></label>
      <div class="chips" data-chips="amount">${amounts.map((a) => `<button type="button" class="chip" data-action="chip" data-value="${a}">${a}</button>`).join('')}</div>
      <label>Milk</label>${chips('milk', [['breast', 'Breast milk'], ['formula', 'Formula']], 'breast')}
      <label>Time<input type="datetime-local" name="start" value="${toLocalInput(Date.now())}"></label>
      <label>Note<input name="note" placeholder="optional"></label>
      <div class="row gap"><button type="button" class="btn ghost" data-action="closeSheet">Cancel</button><button class="btn primary grow">Save</button></div></form>`;
  } else if (kind === 'pickType') {
    html = `<h2>Add a past entry</h2><div class="grid2">
      <button class="qa" data-action="newOfType" data-type="breast">🤱 Breastfeed</button>
      <button class="qa" data-action="newOfType" data-type="bottle">🍼 Bottle</button>
      <button class="qa" data-action="newOfType" data-type="sleep">😴 Sleep</button>
      <button class="qa" data-action="newOfType" data-type="diaper">🧷 Diaper</button>
      <button class="qa" data-action="newOfType" data-type="pump">🥛 Pumping</button></div>
      <button class="btn ghost wide" data-action="closeSheet">Cancel</button>`;
  } else if (kind === 'edit' && data) {
    const e = data, d = describe(e);
    const amt = e.amount != null ? (u === 'oz' ? (e.amount / ML_PER_OZ).toFixed(1) : e.amount) : '';
    let fields = `<label>${e.type === 'sleep' ? 'Fell asleep' : 'Time'}<input type="datetime-local" name="start" value="${toLocalInput(e.start)}"></label>`;
    if (e.type === 'sleep') fields += `<label>Woke up (empty = still asleep)<input type="datetime-local" name="end" value="${e.end ? toLocalInput(e.end) : ''}"></label>`;
    if (e.kind === 'bottle' || e.type === 'pump') fields += `<label>Amount (${u})<input name="amount" type="number" step="any" inputmode="decimal" value="${amt}"></label>`;
    if (e.kind === 'bottle') fields += `<label>Milk</label>${chips('milk', [['breast', 'Breast milk'], ['formula', 'Formula']], e.milk || 'breast')}`;
    if (e.type === 'diaper') fields += `<label>Kind</label>${chips('diaper', Object.entries(DIAPER), e.diaper)}`;
    if (e.kind === 'breast' && e.end) {
      const t = breastTotals(e);
      fields += `<div class="row gap"><label class="grow">Left (min)<input name="minL" type="number" inputmode="numeric" value="${Math.round(t.L / MIN)}"></label>
        <label class="grow">Right (min)<input name="minR" type="number" inputmode="numeric" value="${Math.round(t.R / MIN)}"></label></div>
        <label>Started on</label>${chips('firstSide', [['L', 'Left'], ['R', 'Right']], e.segments?.[0]?.side || 'L')}`;
    }
    fields += `<label>Note<input name="note" value="${esc(e.note || '')}" placeholder="optional"></label>`;
    html = `<form data-form="edit"><h2>${d.icon} ${e._new ? 'Add' : 'Edit'} ${esc(d.title.split(' ')[0].toLowerCase())}</h2>
      ${e.by && !e._new ? `<p class="muted">Logged by ${esc(e.by)}</p>` : ''}${fields}
      <div class="row gap">${e._new ? `<button type="button" class="btn ghost" data-action="closeSheet">Cancel</button>` : `<button type="button" class="btn danger" data-action="deleteEntry" data-id="${e.id}">Delete</button>`}
      <button class="btn primary grow">Save</button></div></form>`;
  } else if (kind === 'routine') {
    const r = data || { title: '', time: '09:00', icon: '⏰', days: [0, 1, 2, 3, 4, 5, 6], remind: true };
    html = `<form data-form="routine"><h2>${data ? 'Edit routine' : 'New routine'}</h2>
      <div class="row gap"><label style="width:70px">Icon<input name="icon" value="${esc(r.icon)}" maxlength="4"></label>
      <label class="grow">Name<input name="title" value="${esc(r.title)}" placeholder="e.g. Vitamin D drops" required></label></div>
      <label>Time<input type="time" name="time" value="${esc(r.time)}"></label>
      <label>Days</label><div class="daypick">${DAYS.map((l, i) => `<button type="button" data-action="dayToggle" data-d="${i}" class="${r.days.includes(i) ? 'on' : ''}">${l}</button>`).join('')}</div>
      <label class="check-row"><input type="checkbox" name="remind" ${r.remind ? 'checked' : ''}> Notify on this phone</label>
      <div class="row gap">${data ? `<button type="button" class="btn danger" data-action="deleteRoutine" data-id="${r.id}">Delete</button>` : `<button type="button" class="btn ghost" data-action="closeSheet">Cancel</button>`}
      <button class="btn primary grow">Save</button></div></form>`;
  }
  $('#sheetBody').innerHTML = html;
  sheet.classList.add('open');
  document.body.classList.add('noscroll');
}

function closeSheet() {
  sheet.classList.remove('open');
  document.body.classList.remove('noscroll');
  sheet._data = null; sheet._kind = null;
}

// ------------------------------------------------------------------ render
function render() {
  main.innerHTML = { home: homeView, log: logView, routines: routinesView, settings: settingsView }[view]();
  document.querySelectorAll('nav [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  const af = store.active('feed'), as = store.active('sleep');
  document.title = af ? `🤱 ${fmtClock(Date.now() - af.start)} · Nestling` : as ? '😴 Sleeping · Nestling' : 'Nestling';
}

// Update running clocks every second without rebuilding the page.
function tick() {
  const now = Date.now();
  document.querySelectorAll('[data-from]').forEach((el) => {
    el.textContent = fmtClock(Number(el.dataset.base || 0) + now - Number(el.dataset.from));
  });
}

// ------------------------------------------------------------------ reminders
// Checked every 30 s while the app is open or recently backgrounded.
function checkReminders() {
  if (!store.device.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const fired = JSON.parse(localStorage.getItem('nestling.fired') || '{}');
  const notes = [];
  const due = nextFeedDue();
  if (due && !store.active('feed') && Date.now() >= due && Date.now() - due < 2 * 60 * MIN && !fired[`feed${due}`]) {
    fired[`feed${due}`] = 1;
    notes.push(['🍼 Feed due', `It's been ${fmtDur((S().feedIntervalMin || 180) * MIN)} since the last feed.`]);
  }
  const hm = new Date().toTimeString().slice(0, 5);
  store.routineList().filter((r) => r.remind && routineDueToday(r) && !r.done?.[dayKey()]).forEach((r) => {
    const key = `r${r.id}${dayKey()}`;
    if (r.time <= hm && !fired[key] && hm < addMinutes(r.time, 60)) { fired[key] = 1; notes.push([`${r.icon || '⏰'} ${r.title}`, `Routine for ${r.time}`]); }
  });
  if (!notes.length) return;
  Object.keys(fired).slice(0, -50).forEach((k) => delete fired[k]);
  localStorage.setItem('nestling.fired', JSON.stringify(fired));
  navigator.serviceWorker?.ready.then((reg) => notes.forEach(([t, b]) => reg.showNotification(t, { body: b, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: t })))
    .catch(() => notes.forEach(([t, b]) => new Notification(t, { body: b })));
}
const addMinutes = (hm, n) => { const [h, m] = hm.split(':').map(Number); const t = h * 60 + m + n; return `${String(Math.min(23, Math.floor(t / 60))).padStart(2, '0')}:${String(t >= 1440 ? 59 : t % 60).padStart(2, '0')}`; };

// ------------------------------------------------------------------ wiring
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) { if (ev.target === sheet) closeSheet(); return; }
  const fn = actions[el.dataset.action];
  if (fn) { ev.preventDefault(); fn(el); }
});
document.addEventListener('submit', (ev) => {
  const f = ev.target.closest('[data-form]');
  if (!f) return;
  ev.preventDefault();
  forms[f.dataset.form]?.(f);
});
// Amount chips also fill the amount box.
document.addEventListener('click', (ev) => {
  const c = ev.target.closest('[data-chips="amount"] .chip');
  if (c) c.closest('form').amount.value = c.dataset.value;
});

store.addEventListener('change', () => {
  // Don't rebuild a form the person is typing into.
  if (view === 'settings' && document.activeElement?.closest('form')) return;
  render();
});

const joinMatch = location.hash.match(/join=([\w-]+)/);
if (joinMatch) {
  history.replaceState(null, '', location.pathname);
  if (!store.device.householdId) {
    if (store.device.welcomed) { store.saveDevice({ householdId: joinMatch[1], needsUpload: true }); toast('Joined your family log'); }
    else sheet._join = joinMatch[1];
  }
}

render();
if (!store.device.welcomed) openSheet('welcome');
startSync();
setInterval(tick, 1000);
setInterval(() => { if (!sheet.classList.contains('open') && !document.activeElement?.closest('form')) render(); checkReminders(); }, 30e3);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (['error', 'off'].includes(syncStatus()) && store.device.householdId) startSync();
  render(); checkReminders();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
