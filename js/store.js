// Data store: keeps entries, routines and settings in memory, caches them in
// localStorage, and hands every change to an optional sync backend.
// Conflict rule: last write wins, by updatedAt.

const LS_KEY = 'nestling.data.v1';
const LS_DEVICE = 'nestling.device.v1';

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const defaultSettings = () => ({
  id: 'settings',
  babyName: '',
  birthDate: '',
  feedIntervalMin: 180, // GUESS: newborns usually feed every 2-3 h; editable
  unit: 'ml',
  updatedAt: 0,
});

// Starter routines (GUESS: common newborn routines; all editable/deletable).
const starterRoutines = () => [
  { title: 'Vitamin D drops', time: '09:00', icon: '💧' },
  { title: 'Tummy time', time: '10:30', icon: '🧸' },
  { title: 'Bath', time: '19:00', icon: '🛁', days: [0, 3] },
  { title: 'Bedtime routine', time: '20:00', icon: '🌙' },
].map((r, i) => ({
  id: 'starter' + i,
  days: [0, 1, 2, 3, 4, 5, 6],
  remind: true,
  done: {},
  updatedAt: 1,
  deleted: false,
  ...r,
}));

class Store extends EventTarget {
  constructor() {
    super();
    this.entries = new Map();
    this.routines = new Map();
    this.settings = defaultSettings();
    this.device = { me: '', householdId: '', notify: false };
    this.backend = null;
    this._load();
  }

  _load() {
    try {
      const d = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (d) {
        d.entries?.forEach((e) => this.entries.set(e.id, e));
        d.routines?.forEach((r) => this.routines.set(r.id, r));
        if (d.settings) this.settings = { ...defaultSettings(), ...d.settings };
      } else {
        starterRoutines().forEach((r) => this.routines.set(r.id, r));
      }
    } catch { /* ignore broken cache */ }
    try {
      this.device = { ...this.device, ...JSON.parse(localStorage.getItem(LS_DEVICE) || '{}') };
    } catch { /* ignore */ }
  }

  _save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        entries: [...this.entries.values()],
        routines: [...this.routines.values()],
        settings: this.settings,
      }));
    } catch { /* storage full or blocked */ }
  }

  saveDevice(patch) {
    this.device = { ...this.device, ...patch };
    try { localStorage.setItem(LS_DEVICE, JSON.stringify(this.device)); } catch { /* */ }
    this._emit();
  }

  _emit() {
    this._save();
    this.dispatchEvent(new Event('change'));
  }

  // ---- writes (local first, then pushed to backend) ----
  _stamp(obj) {
    return { ...obj, updatedAt: Date.now(), by: obj.by || this.device.me || '' };
  }

  putEntry(e) {
    const rec = this._stamp({ deleted: false, ...e, id: e.id || uid() });
    this.entries.set(rec.id, rec);
    this._emit();
    this.backend?.write('entries', rec);
    return rec;
  }
  deleteEntry(id) {
    const e = this.entries.get(id);
    if (e) this.putEntry({ ...e, deleted: true });
  }

  putRoutine(r) {
    const rec = { deleted: false, done: {}, ...r, id: r.id || uid(), updatedAt: Date.now() };
    this.routines.set(rec.id, rec);
    this._emit();
    this.backend?.write('routines', rec);
    return rec;
  }
  deleteRoutine(id) {
    const r = this.routines.get(id);
    if (r) this.putRoutine({ ...r, deleted: true });
  }

  putSettings(patch) {
    this.settings = { ...this.settings, ...patch, id: 'settings', updatedAt: Date.now() };
    this._emit();
    this.backend?.write('meta', this.settings);
  }

  // ---- merges from backend ----
  applyRemote(kind, rec) {
    if (kind === 'meta') {
      if ((rec.updatedAt || 0) >= (this.settings.updatedAt || 0)) {
        this.settings = { ...defaultSettings(), ...rec };
      }
    } else {
      const map = kind === 'entries' ? this.entries : this.routines;
      const cur = map.get(rec.id);
      if (!cur || (rec.updatedAt || 0) >= (cur.updatedAt || 0)) map.set(rec.id, rec);
    }
  }
  remoteBatchDone() { this._emit(); }

  // Upload everything local (used when a phone first joins/creates a family).
  allRecords() {
    return [
      ...[...this.entries.values()].map((r) => ['entries', r]),
      ...[...this.routines.values()].map((r) => ['routines', r]),
      ['meta', this.settings],
    ];
  }

  // ---- reads ----
  list(type) {
    return [...this.entries.values()]
      .filter((e) => !e.deleted && (!type || e.type === type))
      .sort((a, b) => b.start - a.start);
  }
  active(type) {
    return this.list(type).find((e) => !e.end);
  }
  lastFeed() {
    return this.list('feed')[0];
  }
  routineList() {
    return [...this.routines.values()]
      .filter((r) => !r.deleted)
      .sort((a, b) => a.time.localeCompare(b.time));
  }
}

export const store = new Store();
