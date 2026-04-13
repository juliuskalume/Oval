# Oval

Oval is a mobile-first opportunity discovery app backed by Firebase, with a Vercel serverless moderation endpoint for Groq-assisted automatic post review.

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

This project serves static app files from the repo root and uses a Vercel serverless function for Groq-assisted post moderation.

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
- `OVAL_FIREBASE_PROJECT_ID`
- `OVAL_FIREBASE_CLIENT_EMAIL`
- `OVAL_FIREBASE_PRIVATE_KEY`

If the moderation endpoint is unavailable, Oval falls back to manual admin review for new submissions. Live post edits by non-admins intentionally do not bypass that server review path.

## Firebase setup

Use the configuration already wired in [scripts/firebase.js](scripts/firebase.js), then enable:

- Firebase Authentication: Email/Password and Google
- Firestore
- Firebase Storage

Apply the rules from [firestore.rules](firestore.rules) and [storage.rules](storage.rules).

### Required for deployed auth

After the first Vercel deploy, add your deployed domain in Firebase:

1. Firebase Console
2. Authentication
3. Settings
4. Authorized domains

Add:

- `your-project.vercel.app`
- your custom domain, if you use one
