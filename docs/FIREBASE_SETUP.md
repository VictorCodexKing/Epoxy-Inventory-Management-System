# Connecting EIMS to Firebase

EIMS runs on Firebase. This is pure configuration — no code changes — and everything here works on Firebase's free **Spark** plan.

## 1. Create the project

1. Go to [Firebase Console](https://console.firebase.google.com) → **Add project**. Google Analytics is not needed.
2. **Build → Firestore Database → Create database.** Choose region `asia-southeast1` (Singapore), the closest to Malaysia, and start in **production mode**.
3. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable.**
4. **Authentication → Settings → User actions:** untick **Enable create (sign-up)**. Accounts can then only be created by you in the console, which is how EIMS is designed: admins cannot create users.

## 2. Register the web app

**Project settings → General → Your apps → Web (`</>`)**. Copy the config values into `.env.local`; see [`.env.example`](../.env.example):

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

These values are public identifiers, not secrets. Access is enforced by the Security Rules.

## 3. Deploy the Security Rules

```bash
npm i -g firebase-tools
firebase login
firebase use --add            # pick your project
firebase deploy --only firestore:rules,firestore:indexes
```

The rules are in [`firestore.rules`](../firestore.rules). No composite indexes are needed.

## 4. Create the first Super Admin

1. **Authentication → Users → Add user** with an email and password.
2. Sign in to EIMS with that account. The app creates `users/{uid}` as a read-only **Normal User**.
3. In **Firestore → users → {uid}**, change `role` from `user` to `admin`. The app switches to Super Admin immediately, without a reload.

From then on, every new person is added like this:

1. You create their login in **Authentication → Add user**.
2. They sign in once and appear under **Settings → Users** as a Normal User.
3. A Super Admin can promote them, demote them or delete them there.

Deleting a user in EIMS removes their access immediately and permanently. To also remove the login itself, delete it in **Authentication → Users**.

## 5. Deploy on Vercel

1. Import the GitHub repo in Vercel. It detects the framework as Vite, and [`vercel.json`](../vercel.json) handles SPA routing.
2. Add the same `VITE_*` variables under **Settings → Environment Variables**, then redeploy.
3. Add your Vercel domain under **Firebase → Authentication → Settings → Authorized domains**.

## Local testing with the Emulator Suite (optional)

```bash
firebase emulators:start --project demo-eims     # Firestore :8080, Auth :9099, UI :4000
```

Then set `VITE_FIREBASE_USE_EMULATORS=true` and `VITE_FIREBASE_PROJECT_ID=demo-eims` in `.env.local`, and run `npm run dev`.

## Free-tier notes

- Firestore Spark limits are 50,000 reads, 20,000 writes and 1 GiB of storage. EIMS stays well inside them:
  - Each collection is loaded once per session through realtime listeners, and after that only changed documents are sent.
  - Pinia holds the data in memory, and Firestore's IndexedDB cache serves repeat visits.
  - The dashboard's movement feed is limited to the latest 60 entries.
- Vercel restricts the Hobby plan to personal, non-commercial use ([Vercel Hobby plan docs](https://vercel.com/docs/plans/hobby)). A business deployment may need Vercel Pro. Alternatively, the same `dist/` build can be served for free from **Firebase Hosting**: `firebase init hosting` → public dir `dist`, single-page app `yes`.
