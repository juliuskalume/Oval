import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createNotificationAndPush } from "./_lib/push.js";

const DEADLINE_REMINDER_STAGES = [
  { key: "1w", label: "1 week", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "3d", label: "3 days", ms: 3 * 24 * 60 * 60 * 1000 },
  { key: "1d", label: "1 day", ms: 24 * 60 * 60 * 1000 },
  { key: "1h", label: "1 hour", ms: 60 * 60 * 1000 },
];

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

function authorizeCron(request) {
  const cronSecret = String(process.env.CRON_SECRET || "").trim();
  const authHeader = String(request.headers.authorization || "");
  if (cronSecret) {
    if (authHeader !== `Bearer ${cronSecret}`) {
      throw new HttpError(401, "Unauthorized.");
    }
    return;
  }
  throw new HttpError(503, "CRON_SECRET is required for reminder processing.");
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

function opportunityOpeningDate(opportunity) {
  return toDate(opportunity?.openingAt || opportunity?.openingDate || opportunity?.opensAt);
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

async function processOpeningReminders(db, now, stats) {
  const snapshot = await db.collectionGroup("states").where("openingReminder", "==", true).get();
  const opportunityCache = new Map();

  for (const stateDoc of snapshot.docs) {
    const userRef = stateDoc.ref.parent.parent;
    if (!userRef) {
      continue;
    }
    const userId = userRef.id;
    const opportunityId = stateDoc.id;

    let opportunity = opportunityCache.get(opportunityId);
    if (opportunity === undefined) {
      const opportunitySnap = await db.collection("opportunities").doc(opportunityId).get();
      opportunity = opportunitySnap.exists ? {
        id: opportunitySnap.id,
        ...opportunitySnap.data(),
      } : null;
      opportunityCache.set(opportunityId, opportunity);
    }
    if (!opportunity || opportunity.status !== "published") {
      continue;
    }

    const openingAt = opportunityOpeningDate(opportunity);
    if (!openingAt || openingAt.getTime() > now.getTime()) {
      continue;
    }
    if (stateDoc.data()?.openingReminderSentAt) {
      continue;
    }

    await createNotificationAndPush(userId, {
      type: "opening-reminder",
      title: "Opportunity is now open",
      body: `${opportunity.title} is now open.`,
      opportunityId,
    }, { db, createdAt: now });

    await stateDoc.ref.set({
      openingReminder: true,
      openingReminderSentAt: now,
      updatedAt: now,
    }, { merge: true });
    stats.openingReminders += 1;
  }
}

async function processDeadlineReminders(db, now, stats) {
  const snapshot = await db.collectionGroup("states").where("saved", "==", true).get();
  const opportunityCache = new Map();

  for (const stateDoc of snapshot.docs) {
    const userRef = stateDoc.ref.parent.parent;
    if (!userRef) {
      continue;
    }
    const userId = userRef.id;
    const opportunityId = stateDoc.id;
    const state = stateDoc.data() || {};

    let opportunity = opportunityCache.get(opportunityId);
    if (opportunity === undefined) {
      const opportunitySnap = await db.collection("opportunities").doc(opportunityId).get();
      opportunity = opportunitySnap.exists ? {
        id: opportunitySnap.id,
        ...opportunitySnap.data(),
      } : null;
      opportunityCache.set(opportunityId, opportunity);
    }
    if (!opportunity || opportunity.status !== "published") {
      continue;
    }

    const expiry = deadlineExpiryDate(opportunity);
    if (!expiry) {
      continue;
    }

    const timeRemaining = expiry.getTime() - now.getTime();
    if (timeRemaining <= 0) {
      continue;
    }

    const sentStages = new Set(Array.isArray(state.deadlineReminderStages) ? state.deadlineReminderStages : []);
    const nextStage = DEADLINE_REMINDER_STAGES
      .filter((stage) => !sentStages.has(stage.key) && timeRemaining <= stage.ms)
      .at(-1);

    if (nextStage) {
      await createNotificationAndPush(userId, {
        type: "deadline-reminder",
        title: "Saved opportunity nearing deadline",
        body: `${opportunity.title} closes in ${nextStage.label}.`,
        opportunityId,
      }, { db, createdAt: now });

      sentStages.add(nextStage.key);
      await stateDoc.ref.set({
        deadlineReminderStages: Array.from(sentStages),
        updatedAt: now,
      }, { merge: true });
      stats.deadlineReminders += 1;
    }
  }
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    json(response, 405, { error: "Method not allowed." });
    return;
  }

  try {
    authorizeCron(request);
    const db = getFirestore(getFirebaseApp());
    const now = new Date();
    const stats = {
      openingReminders: 0,
      deadlineReminders: 0,
      processedAt: now.toISOString(),
    };

    await processOpeningReminders(db, now, stats);
    await processDeadlineReminders(db, now, stats);

    json(response, 200, {
      ok: true,
      ...stats,
    });
  } catch (error) {
    console.error("process-reminders failed", error);
    json(response, error instanceof HttpError ? error.status : 500, {
      error: error instanceof Error ? error.message : "Reminder processing failed.",
    });
  }
}
