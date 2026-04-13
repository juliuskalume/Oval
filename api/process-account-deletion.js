import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const BOOTSTRAP_ADMIN_EMAILS = new Set([
  "juliuskalume906@gmail.com",
  "sentira.official@gmail.com",
]);

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

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeUsernameValue(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 32);
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

async function ensureAdmin(auth, db, request) {
  const authHeader = String(request.headers.authorization || "");
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!idToken) {
    throw new HttpError(401, "Authentication required.");
  }
  const decoded = await auth.verifyIdToken(idToken);
  const email = normalizeEmail(decoded.email);
  const profileSnap = await db.collection("users").doc(decoded.uid).get();
  const role = profileSnap.exists ? profileSnap.data()?.role : "";
  const isAdmin = role === "admin" || BOOTSTRAP_ADMIN_EMAILS.has(email);
  if (!isAdmin) {
    throw new HttpError(403, "Admin access required.");
  }
  return {
    uid: decoded.uid,
    email,
  };
}

function chunk(items, size = 400) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

function addOpportunityAdjustment(adjustments, opportunityId, field, amount = 1) {
  if (!opportunityId || !field || amount <= 0) {
    return;
  }
  if (!adjustments.has(opportunityId)) {
    adjustments.set(opportunityId, {
      savesCount: 0,
      appliedCount: 0,
      likesCount: 0,
      commentsCount: 0,
    });
  }
  adjustments.get(opportunityId)[field] += amount;
}

async function deleteDocRefs(db, refs) {
  const uniqueRefs = [];
  const seen = new Set();
  refs.forEach((ref) => {
    if (!ref || seen.has(ref.path)) {
      return;
    }
    seen.add(ref.path);
    uniqueRefs.push(ref);
  });

  for (const group of chunk(uniqueRefs)) {
    const batch = db.batch();
    group.forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

async function applyOpportunityAdjustments(db, adjustments, excludedOpportunityIds = new Set()) {
  for (const [opportunityId, delta] of adjustments.entries()) {
    if (!opportunityId || excludedOpportunityIds.has(opportunityId)) {
      continue;
    }
    const opportunityRef = db.collection("opportunities").doc(opportunityId);
    const snapshot = await opportunityRef.get();
    if (!snapshot.exists) {
      continue;
    }

    const data = snapshot.data() || {};
    const updates = {};
    let changed = false;

    ["savesCount", "appliedCount", "likesCount", "commentsCount"].forEach((field) => {
      if (!delta[field]) {
        return;
      }
      updates[field] = Math.max(Number(data[field] || 0) - Number(delta[field] || 0), 0);
      changed = true;
    });

    if (!changed) {
      continue;
    }

    updates.updatedAt = new Date();
    await opportunityRef.update(updates);
  }
}

async function cancelDeletionRequest(db, targetUid) {
  const requestRef = db.collection("accountDeletionRequests").doc(targetUid);
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists) {
    throw new HttpError(404, "Deletion request not found.");
  }
  await requestRef.delete();
  await db.collection("users").doc(targetUid).collection("notifications").add({
    type: "account-deletion-canceled",
    title: "Deletion request canceled",
    body: "An admin canceled your account deletion request. Your account will stay active.",
    read: false,
    createdAt: new Date(),
  });
}

async function approveDeletionRequest(auth, db, targetUid) {
  const requestRef = db.collection("accountDeletionRequests").doc(targetUid);
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists) {
    throw new HttpError(404, "Deletion request not found.");
  }

  const profileRef = db.collection("users").doc(targetUid);
  const profileSnap = await profileRef.get();
  const profile = profileSnap.exists ? profileSnap.data() || {} : {};

  try {
    await auth.deleteUser(targetUid);
  } catch (error) {
    if (error?.code !== "auth/user-not-found") {
      throw error;
    }
  }

  const refsToDelete = [requestRef, profileRef];
  const opportunityAdjustments = new Map();
  const username = normalizeUsernameValue(profile.username || requestSnap.data()?.username || "");
  if (username) {
    refsToDelete.push(db.collection("usernames").doc(username));
  }

  const opportunitiesSnap = await db.collection("opportunities").where("creatorUid", "==", targetUid).get();
  const ownedOpportunityIds = new Set();
  for (const opportunityDoc of opportunitiesSnap.docs) {
    ownedOpportunityIds.add(opportunityDoc.id);
    refsToDelete.push(opportunityDoc.ref);
    const commentSnap = await opportunityDoc.ref.collection("comments").get();
    commentSnap.forEach((commentDoc) => refsToDelete.push(commentDoc.ref));
  }

  const statesSnap = await profileRef.collection("states").get();
  statesSnap.forEach((docSnap) => {
    refsToDelete.push(docSnap.ref);
    if (ownedOpportunityIds.has(docSnap.id)) {
      return;
    }
    const data = docSnap.data() || {};
    if (data.saved === true) {
      addOpportunityAdjustment(opportunityAdjustments, docSnap.id, "savesCount");
    }
    if (data.applied === true) {
      addOpportunityAdjustment(opportunityAdjustments, docSnap.id, "appliedCount");
    }
    if (data.liked === true) {
      addOpportunityAdjustment(opportunityAdjustments, docSnap.id, "likesCount");
    }
  });

  const notificationsSnap = await profileRef.collection("notifications").get();
  notificationsSnap.forEach((docSnap) => refsToDelete.push(docSnap.ref));

  const followingSnap = await profileRef.collection("following").get();
  followingSnap.forEach((docSnap) => {
    refsToDelete.push(docSnap.ref);
    refsToDelete.push(db.collection("users").doc(docSnap.id).collection("followers").doc(targetUid));
  });

  const followersSnap = await profileRef.collection("followers").get();
  followersSnap.forEach((docSnap) => {
    refsToDelete.push(docSnap.ref);
    refsToDelete.push(db.collection("users").doc(docSnap.id).collection("following").doc(targetUid));
  });

  const authoredCommentsSnap = await db.collectionGroup("comments").where("authorUid", "==", targetUid).get();
  authoredCommentsSnap.forEach((docSnap) => {
    const opportunityRef = docSnap.ref.parent.parent;
    if (!opportunityRef || ownedOpportunityIds.has(opportunityRef.id)) {
      return;
    }
    refsToDelete.push(docSnap.ref);
    addOpportunityAdjustment(opportunityAdjustments, opportunityRef.id, "commentsCount");
  });

  await deleteDocRefs(db, refsToDelete);
  await applyOpportunityAdjustments(db, opportunityAdjustments, ownedOpportunityIds);
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
    await ensureAdmin(auth, db, request);

    const body = readJsonBody(request);
    const action = String(body.action || "").trim();
    const targetUid = String(body.targetUid || "").trim();
    if (!targetUid) {
      throw new HttpError(400, "Target UID is required.");
    }

    if (action === "cancel") {
      await cancelDeletionRequest(db, targetUid);
      json(response, 200, { ok: true, action: "cancel" });
      return;
    }

    if (action !== "approve") {
      throw new HttpError(400, "Unsupported action.");
    }

    await approveDeletionRequest(auth, db, targetUid);
    json(response, 200, { ok: true, action: "approve" });
  } catch (error) {
    console.error("process-account-deletion failed", error);
    json(response, error instanceof HttpError ? error.status : 500, {
      error: error instanceof Error ? error.message : "Account deletion processing failed.",
    });
  }
}
