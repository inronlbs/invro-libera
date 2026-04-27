# Invro Libera

Invro Libera is an offline-first school e-library built with React, TypeScript, Vite, Firebase, Dexie, and PDF/EPUB readers. It supports student login, assigned book sync, offline downloads, favorites, reader TTS, and a Firebase-backed admin panel.

## Stack

- React 19 + TypeScript
- Vite with `rolldown-vite`
- Firebase Auth, Firestore, Storage
- Dexie/IndexedDB for offline state and downloads
- `react-pdf` and `react-reader`
- Tailwind CSS
- PWA via `vite-plugin-pwa`

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create local env config.

   Use `.env.local` for development. The repo includes `.env.example` as the template.

3. Start the dev server:

```bash
npm run dev -- --host 127.0.0.1
```

4. Validate before shipping:

```bash
npm run lint
npm run build
```

## Environment Variables

Required Firebase web config:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

Optional:

- `VITE_FIREBASE_MEASUREMENT_ID`
- `VITE_FIRESTORE_DATABASE_ID`
  Defaults to `libera`.
- `VITE_ALLOWED_DOWNLOAD_ORIGINS`
  Comma-separated allowlist for extra trusted book-download origins.

Bootstrap-only:

- `FIREBASE_SERVICE_ACCOUNT_PATH`
  Absolute path to a Firebase service account JSON file.
- `FIREBASE_SERVICE_ACCOUNT_JSON`
  Raw service account JSON as a single environment variable.
- `FIREBASE_ADMIN_DATABASE_ID`
  Optional Firestore database id for bootstrap scripts. Defaults to `libera`.

## Download Security

Book downloads are now restricted to trusted origins only. By default the app accepts:

- same-origin bundled book assets under `/assets/books/`
- Firebase Storage download URLs for the configured storage bucket
- extra origins explicitly listed in `VITE_ALLOWED_DOWNLOAD_ORIGINS`

If admin book metadata points at any other host, downloads will be blocked until that origin is added to the allowlist.

## Admin Auth Model

Admin access is backed by Firebase Auth plus Firestore `admin_users/{uid}` records.

- the signed-in Firebase user UID must match an `admin_users` document id
- the admin record must have `isActive: true`
- Firestore admin writes are protected by rules in `firestore.rules`

## First Admin Bootstrap

The first super admin cannot be created from the client app because [firestore.rules](firestore.rules#L99) only allow `admin_users` writes from an existing `super_admin`.

Use the included bootstrap script instead:

```bash
npm run bootstrap:admin -- --uid=<firebase-auth-uid> --email=<email> --name="Primary Admin"
```

Required before running it:

- create the user in Firebase Authentication first
- provide admin credentials through `FIREBASE_SERVICE_ACCOUNT_PATH` or `FIREBASE_SERVICE_ACCOUNT_JSON`

Example using the account you created:

```bash
npm run bootstrap:admin -- --uid=TmPaRcvgdKUzglyZ3UmL7PiaOtK2 --email=admin@invronlabs.com --name="Invron Labs Admin"
```

The script will:

- verify the Firebase Auth user exists
- confirm the email matches the UID
- create or update `admin_users/{uid}` as an active `super_admin`

After that, sign in through the app and use the Admin Accounts section in settings to create additional admins.

## Project Areas

- `src/App.tsx`: route composition, auth split, shell wiring
- `src/services/firebase.ts`: Firebase bootstrap and auth helpers
- `src/services/catalogSync.ts`: shared assigned-book sync
- `src/services/downloadManager.ts`: resumable download pipeline
- `src/components/readers/`: PDF and EPUB readers
- `src/pages/admin/`: admin CRUD and settings flows

## Current Baseline

- `npm run lint` passes
- `npm run build` passes
- dev server verified on `http://127.0.0.1:5173/`

## Deployment Notes

- Keep `.env.local` out of source control. The existing `.gitignore` already ignores `*.local`.
- Rotate any Firebase keys that were previously committed in source history.
- If you change the storage bucket or add a CDN, update `VITE_ALLOWED_DOWNLOAD_ORIGINS` accordingly.
