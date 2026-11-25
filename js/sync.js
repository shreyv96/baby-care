// Live sync between phones through Firebase Firestore.
// Both phones join the same "family" (a long random id shared by link or code).
// Firestore keeps an offline cache, so logging works without signal and
// catches up when the phone is back online.

import { firebaseConfig } from '../firebase-config.js';
import { store } from './store.js';

let db, fs, status = 'off';
const listeners = [];

export const syncAvailable = () => !!(firebaseConfig && firebaseConfig.apiKey);
export const syncStatus = () => status;

function setStatus(s) {
  status = s;
  store.dispatchEvent(new Event('change'));
}

export function newFamilyId() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  // Readable code, no look-alike characters.
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  return [...a].map((n) => abc[n % abc.length]).join('').replace(/(.{4})(?!$)/g, '$1-');
}

export async function startSync() {
  const hid = store.device.householdId;
  if (!syncAvailable() || !hid) { setStatus('off'); return; }
  setStatus('connecting');
  try {
    // Firebase SDK v10.12.2 bundled locally (js/firebase.js) so the app also starts offline.
    const fb = await import('./firebase.js');
    const appMod = fb, authMod = fb;
    fs = fb;
    const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(firebaseConfig);
    await authMod.signInAnonymously(authMod.getAuth(app));
    if (!db) {
      db = fs.initializeFirestore(app, {
        localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
      });
    }
    listeners.splice(0).forEach((u) => u());

    const base = ['families', hid];
    store.backend = {
      write: (kind, rec) =>
        fs.setDoc(fs.doc(db, ...base, kind, rec.id), rec).catch((e) => console.warn('sync write', e)),
    };

    // Push what this phone already has (merge keeps the newest copy).
    if (store.device.needsUpload) {
      for (const [kind, rec] of store.allRecords()) store.backend.write(kind, rec);
      store.saveDevice({ needsUpload: false });
    }

    for (const kind of ['entries', 'routines', 'meta']) {
      listeners.push(fs.onSnapshot(
        fs.collection(db, ...base, kind),
        { includeMetadataChanges: false },
        (snap) => {
          snap.docChanges().forEach((ch) => {
            if (ch.type !== 'removed') store.applyRemote(kind, ch.doc.data());
          });
          store.remoteBatchDone();
          setStatus(snap.metadata.fromCache ? 'offline' : 'live');
        },
        (err) => { console.warn('sync', err); setStatus('error'); },
      ));
    }
  } catch (e) {
    console.warn('sync start failed', e);
    setStatus('error');
  }
}
