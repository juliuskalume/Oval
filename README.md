# Oval

Oval is a mobile-first opportunity discovery app prototype backed by Firebase on the frontend.

## Included flows

- Public browsing for feed, search, and details
- Email/password and Google auth
- Seeker actions for saved and applied states
- Creator posting flow and dashboard
- Firebase Firestore and Storage rules templates

## Run locally

Serve the folder over HTTP instead of opening the files directly:

```bash
python -m http.server 4173
```

Then open `http://127.0.0.1:4173`.

## Deploy on Vercel

This project is a plain static site, so it can be deployed to Vercel without a build step.

### Option 1: Deploy from GitHub

1. Import the GitHub repo into Vercel.
2. Keep the project as `Other`.
3. Leave the build command empty.
4. Leave the output directory empty so Vercel serves the repository root.
5. Deploy.

### Option 2: Deploy with Vercel CLI

```bash
npm i -g vercel
vercel
```

The included [vercel.json](vercel.json) sends `/` to [onboarding.html](onboarding.html) on Vercel.

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
