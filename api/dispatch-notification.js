import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { sendPushToUser } from "./_lib/push.js";

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

function json(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function requireEnv(...names) {
  for (const name of names) {
    if (process.env[name]) {
      return process.env[name];
    }
  }
  throw new HttpError(503, "Server admin tools are not configured.");
}

function getFirebaseApp() {
  if (getApps().length) {
    return getApps()[0];
  }
  const projectId = process.env.OVAL_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "oval-by-sentirax";
  const clientEmail = requireEnv("OVAL_FIREBASE_CLIENT_EMAIL", "FIREBASE_CLIENT_EMAIL");
  const privateKey = requireEnv("OVAL_FIREBASE_PRIVATE_KEY", "FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n");
  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
    projectId,
  });
}

function readJsonBody(request) {
  if (request.body && typeof request.body === "object") {
    return request.body;
  }
  if (typeof request.body === "string" && request.body.trim()) {
    return JSON.parse(request.body);
  }
  return {};
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    json(response, 405, { error: "Method not allowed." });
    return;
  }

  try {
    const app = getFirebaseApp();
    const auth = getAuth(app);
    const db = getFirestore(app);

    const authHeader = String(request.headers.authorization || "");
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!idToken) {
      throw new HttpError(401, "Authentication required.");
    }
    await auth.verifyIdToken(idToken);

    const body = readJsonBody(request);
    const recipientUid = String(body.recipientUid || "").trim();
    const notificationId = String(body.notificationId || "").trim();
    if (!recipientUid || !notificationId) {
      throw new HttpError(400, "Recipient UID and notification ID are required.");
    }

    const notificationRef = db.collection("users").doc(recipientUid).collection("notifications").doc(notificationId);
    const notificationSnap = await notificationRef.get();
    if (!notificationSnap.exists) {
      throw new HttpError(404, "Notification not found.");
    }

    const result = await sendPushToUser(recipientUid, {
      notificationId,
      ...notificationSnap.data(),
    }, { db });

    json(response, 200, {
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("dispatch-notification failed", error);
    json(response, error instanceof HttpError ? error.status : 500, {
      error: error instanceof Error ? error.message : "Push dispatch failed.",
    });
  }
}
