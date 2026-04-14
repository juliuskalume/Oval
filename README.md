# Oval

Oval is a mobile-first opportunity discovery app backed by Firebase, with Vercel serverless functions for Groq-assisted automatic post review, push notification fanout, reminder processing, and automatic archival of expired posts.

## Included flows

- Public browsing for feed, search, and details
- Email/password and Google auth
- Unified user actions for saving, applying, posting, and dashboard tracking
- Admin approval flow before posts go live publicly
- Firebase Firestore and Storage rules templates

## Run locally

Serve the folder over HTTP instead of opening the files directly:

```bash
python -m http.server 4173
```

Then open `http://127.0.0.1:4173`.

This static local server is enough for frontend work, but the AI moderation route only runs when the Vercel serverless function and its environment variables are available.

## Deploy on Vercel

This project serves static app files from the repo root and uses Vercel serverless functions for Groq-assisted post moderation, push notifications, reminder processing, and automatic archival of expired published posts.

### Option 1: Deploy from GitHub

1. Import the GitHub repo into Vercel.
2. Keep the project as `Other`.
3. Leave the build command empty.
4. Leave the output directory empty so Vercel serves the repository root.
5. Add the environment variables listed below.
6. Deploy.

### Option 2: Deploy with Vercel CLI

```bash
npm i -g vercel
vercel
```

The included [vercel.json](vercel.json) sends `/` to [onboarding.html](onboarding.html) on Vercel.

### Required Vercel environment variables

The auto-approval flow runs in [api/review-opportunity.js](api/review-opportunity.js) and needs:

- `GROQ_API_KEY`
- `OVAL_GROQ_MODEL` (optional, defaults in code)
- `OVAL_GROQ_VISION_MODEL` (optional, defaults in code for image-based media review)
- `OVAL_FIREBASE_PROJECT_ID`
- `OVAL_FIREBASE_CLIENT_EMAIL`
- `OVAL_FIREBASE_PRIVATE_KEY`
- `OVAL_FIREBASE_VAPID_KEY` for web push in the PWA
- `OVAL_APP_BASE_URL` (recommended, for push notification links)

If the moderation endpoint is unavailable, Oval falls back to manual admin review for new submissions. Live post edits by non-admins intentionally do not bypass that server review path.

Expired published posts are hidden immediately by the client once their deadline passes, and Vercel also runs a daily production cron to flip their Firestore status to `archived` automatically. Both the archival job and reminder job accept Vercel cron requests or an authenticated Firebase admin bearer token, so there is no separate cron secret to manage.

Push notifications are sent for inbox activity and reminders when device/browser tokens are registered. The PWA uses Firebase Cloud Messaging plus a VAPID key, and the Android wrapper uses native Firebase Messaging.

## Firebase setup

Use the configuration already wired in [scripts/firebase.js](scripts/firebase.js), then enable:

- Firebase Authentication: Email/Password and Google
- Firestore
- Firebase Storage

Apply the rules from [firestore.rules](firestore.rules) and [storage.rules](storage.rules).

Current upload limits:

- Cover image: 5 MB
- Cover video: 10 MB
- Attachments: 5 MB each
- Attachments per post: 5

Current reminder behavior:

- Admins get notified when a new post is pending approval
- Users get push notifications for inbox items when supported
- Users can set opening-date reminders for future opportunities
- Saved opportunities generate reminder notifications at 1 week, 3 days, 1 day, and 1 hour before deadline

### Required for deployed auth

After the first Vercel deploy, add your deployed domain in Firebase:

1. Firebase Console
2. Authentication
3. Settings
4. Authorized domains

Add:

- `your-project.vercel.app`
- your custom domain, if you use one
