import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

function requireEnv(...names) {
  for (const name of names) {
    if (process.env[name]) {
      return process.env[name];
    }
  }
  throw new Error("Server admin tools are not configured.");
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

function getFirebaseDb() {
  return getFirestore(getFirebaseApp());
}

function getFirebaseMessagingClient() {
  return getMessaging(getFirebaseApp());
}

function appBaseUrl() {
  return String(process.env.OVAL_APP_BASE_URL || "https://oval-nine.vercel.app").replace(/\/+$/g, "");
}

function commentsPath(opportunityId, commentId = "") {
  const params = new URLSearchParams();
  params.set("id", opportunityId);
  if (commentId) {
    params.set("commentId", commentId);
  }
  return `/comments.html?${params.toString()}`;
}

function detailsPath(opportunityId) {
  return `/details.html?id=${encodeURIComponent(opportunityId)}`;
}

function profilePath(uid) {
  return `/profile.html?uid=${encodeURIComponent(uid)}`;
}

function notificationTargetPath(payload = {}) {
  if (payload.type === "follow" && payload.profileUid) {
    return profilePath(payload.profileUid);
  }
  if (payload.type === "admin-granted" || payload.type === "account-deletion-request") {
    return "/admin-moderation.html";
  }
  if (payload.type === "account-deletion-canceled") {
    return "/delete-account.html";
  }
  if ((payload.type === "comment" || payload.type === "comment-reply") && payload.opportunityId) {
    return commentsPath(payload.opportunityId, payload.commentId || "");
  }
  if (payload.opportunityId) {
    return detailsPath(payload.opportunityId);
  }
  if (payload.profileUid) {
    return profilePath(payload.profileUid);
  }
  return "/inbox.html";
}

function notificationTargetUrl(payload = {}) {
  try {
    return new URL(notificationTargetPath(payload), `${appBaseUrl()}/`).toString();
  } catch (error) {
    return `${appBaseUrl()}/inbox.html`;
  }
}

function stringifyData(value) {
  return value == null ? "" : String(value);
}

function buildPushData(payload = {}) {
  return {
    title: stringifyData(payload.title || "Oval"),
    body: stringifyData(payload.body || "You have a new Oval update."),
    type: stringifyData(payload.type || "system"),
    notificationId: stringifyData(payload.notificationId || ""),
    opportunityId: stringifyData(payload.opportunityId || ""),
    profileUid: stringifyData(payload.profileUid || ""),
    commentId: stringifyData(payload.commentId || ""),
    commentPreview: stringifyData(payload.commentPreview || ""),
    targetUrl: stringifyData(notificationTargetUrl(payload)),
  };
}

export async function createNotificationAndPush(uid, payload = {}, options = {}) {
  if (!uid) {
    return null;
  }
  const db = options.db || getFirebaseDb();
  const notificationRef = await db.collection("users").doc(uid).collection("notifications").add({
    ...payload,
    read: false,
    createdAt: options.createdAt || new Date(),
  });
  await sendPushToUser(uid, {
    ...payload,
    notificationId: notificationRef.id,
  }, { db });
  return notificationRef.id;
}

export async function sendPushToUser(uid, payload = {}, options = {}) {
  if (!uid) {
    return {
      sentCount: 0,
      failureCount: 0,
    };
  }

  const db = options.db || getFirebaseDb();
  const messaging = options.messaging || getFirebaseMessagingClient();
  const tokensSnapshot = await db.collection("users").doc(uid).collection("pushTokens").get();
  if (tokensSnapshot.empty) {
    return {
      sentCount: 0,
      failureCount: 0,
    };
  }

  const tokenEntries = tokensSnapshot.docs
    .map((docSnapshot) => ({
      id: docSnapshot.id,
      ref: docSnapshot.ref,
      ...docSnapshot.data(),
    }))
    .filter((entry) => entry.token);

  if (!tokenEntries.length) {
    return {
      sentCount: 0,
      failureCount: 0,
    };
  }

  const response = await messaging.sendEachForMulticast({
    tokens: tokenEntries.map((entry) => entry.token),
    data: buildPushData(payload),
    android: {
      priority: "high",
    },
    webpush: {
      headers: {
        Urgency: "high",
      },
    },
    apns: {
      headers: {
        "apns-priority": "10",
      },
      payload: {
        aps: {
          sound: "default",
        },
      },
    },
  });

  const invalidRefs = [];
  response.responses.forEach((item, index) => {
    if (item.success) {
      return;
    }
    const code = item.error?.code || "";
    if (
      code === "messaging/registration-token-not-registered"
      || code === "messaging/invalid-registration-token"
      || code === "messaging/invalid-argument"
    ) {
      invalidRefs.push(tokenEntries[index]?.ref);
    }
  });

  if (invalidRefs.length) {
    const batch = db.batch();
    invalidRefs.forEach((ref) => {
      if (ref) {
        batch.delete(ref);
      }
    });
    await batch.commit();
  }

  return {
    sentCount: response.successCount,
    failureCount: response.failureCount,
  };
}
