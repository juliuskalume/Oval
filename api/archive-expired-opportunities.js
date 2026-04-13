import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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
  response.setHeader("Cache-Control", "no-store");
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

function isLocalHost(host) {
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(String(host || "").trim());
}

function authorizeCron(request) {
  const cronSecret = String(process.env.CRON_SECRET || "").trim();
  const authHeader = String(request.headers.authorization || "");
  if (cronSecret) {
    if (authHeader !== `Bearer ${cronSecret}`) {
      throw new HttpError(401, "Unauthorized.");
    }
    return;
  }

  if (process.env.VERCEL_ENV === "production") {
    throw new HttpError(503, "CRON_SECRET is not configured for production cron execution.");
  }

  if (!isLocalHost(request.headers.host)) {
    throw new HttpError(401, "Unauthorized.");
  }
}

function toDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value.toDate === "function") {
    const converted = value.toDate();
    return Number.isNaN(converted?.getTime?.()) ? null : converted;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function opportunityDeadline(opportunity) {
  return toDate(opportunity?.deadlineAt || opportunity?.deadline);
}

function deadlineExpiryDate(opportunity) {
  const deadline = opportunityDeadline(opportunity);
  if (!deadline) {
    return null;
  }
  const hasExplicitTime =
    deadline.getUTCHours() !== 0
    || deadline.getUTCMinutes() !== 0
    || deadline.getUTCSeconds() !== 0
    || deadline.getUTCMilliseconds() !== 0;

  if (hasExplicitTime) {
    return deadline;
  }

  return new Date(Date.UTC(
    deadline.getUTCFullYear(),
    deadline.getUTCMonth(),
    deadline.getUTCDate(),
    23,
    59,
    59,
    999,
  ));
}

function isOpportunityExpired(opportunity, now = new Date()) {
  const expiry = deadlineExpiryDate(opportunity);
  return Boolean(expiry && expiry.getTime() < now.getTime());
}

function chunk(items, size = 400) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

async function archiveExpiredPublishedOpportunities(db) {
  const now = new Date();
  const snapshot = await db.collection("opportunities").where("status", "==", "published").get();
  const expiredDocs = snapshot.docs.filter((docSnapshot) => isOpportunityExpired(docSnapshot.data(), now));

  for (const group of chunk(expiredDocs)) {
    const batch = db.batch();
    group.forEach((docSnapshot) => {
      batch.update(docSnapshot.ref, {
        status: "archived",
        updatedAt: now,
      });
    });
    await batch.commit();
  }

  return {
    inspectedPublishedPosts: snapshot.size,
    archivedCount: expiredDocs.length,
    archivedOpportunityIds: expiredDocs.slice(0, 50).map((docSnapshot) => docSnapshot.id),
    processedAt: now.toISOString(),
  };
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    json(response, 405, { error: "Method not allowed." });
    return;
  }

  try {
    authorizeCron(request);
    const app = getFirebaseApp();
    const db = getFirestore(app);
    const result = await archiveExpiredPublishedOpportunities(db);
    json(response, 200, {
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("archive-expired-opportunities failed", error);
    json(response, error instanceof HttpError ? error.status : 500, {
      error: error instanceof Error ? error.message : "Automatic archival failed.",
    });
  }
}
