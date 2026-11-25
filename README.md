# Nestling – shared newborn log

A home-screen web app for two parents (Android + iPhone) to log feeds, sleep and
diapers, follow daily routines, and see when the next feed is due. Both phones
share one live log through Firebase.

## What's in v1
- **Home**: next feed time (counted from the start of the last feed), which breast to start on, running timers, today's totals, routines still to do, recent entries.
- **Breastfeeding timer** with Left/Right switching, pause, per-side totals. A running timer shows on both phones.
- **Bottle** (ml or oz, breast milk or formula), **pumping**, **diapers** (wet / dirty / both / dry), **sleep** timer.
- **Log**: day by day, tap any entry to fix it, add things you forgot.
- **Routines**: daily or chosen weekdays, tick off with who did it, add each to your own calendar as a repeating event.
- **Reminders**: phone notification when a feed or routine is due (works while the app is open or recently used) and a one-tap "Put this in my calendar" for the next feed (Google Calendar on Android, Apple Calendar on iPhone).
- Dark mode for night feeds, two-column layout on the unfolded Galaxy Fold, works offline and syncs later.

## One-time setup (about 10 minutes)

### 1. Firebase (shared data)
1. Open https://console.firebase.google.com → **Add project** (Analytics not needed).
2. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable**.
3. **Build → Firestore Database → Create database** (production mode, a region near you).
4. In Firestore **Rules**, paste the contents of `firestore.rules` and **Publish**.
5. **Project settings → Your apps → Web (</>)** → register an app → copy the `firebaseConfig` values into `firebase-config.js`.

### 2. Hosting (the link you both open)
**Firebase Hosting (keeps the repo private):** on a computer with Node.js, in this folder run
`npx firebase-tools login` then `npx firebase-tools deploy`. This publishes the app to
https://baby-care-2a43d.web.app and uploads `firestore.rules` in the same step.

**Or GitHub Pages:** needs a public repo (or a paid plan), then **Settings → Pages → Deploy from branch → main / root**.

### 3. Install on the phones
- **Galaxy Fold (Chrome or Samsung Internet)**: open the link → menu → **Add to Home screen / Install app**.
- **iPhone (Safari)**: open the link → Share → **Add to Home Screen**. Open it from the icon (needed for notifications).
- On the first phone: Settings → **Create family** → **Invite partner** and send the link. The second phone opens the link and joins.

## Privacy
Data lives in your own Firebase project. Anyone holding the family code can read and write the log, so only share it with each other. "Leave" on a phone stops syncing on that phone.

## Development
No build step. Serve the folder (`python3 -m http.server`) and open http://localhost:8000.
When you change files, bump `VERSION` in `sw.js` so installed phones pick up the update.
