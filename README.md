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

## Firebase setup

Use the configuration already wired in [scripts/firebase.js](scripts/firebase.js), then enable:

- Firebase Authentication: Email/Password and Google
- Firestore
- Firebase Storage

Apply the rules from [firestore.rules](firestore.rules) and [storage.rules](storage.rules).
