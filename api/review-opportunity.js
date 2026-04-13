import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { Timestamp, getFirestore } from "firebase-admin/firestore";

const BOOTSTRAP_ADMIN_EMAILS = new Set([
  "juliuskalume906@gmail.com",
  "sentira.official@gmail.com",
]);

const DEFAULT_AVATAR =
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80";

const ALLOWED_CATEGORIES = new Set(["Job", "Internship", "Gig", "Scholarship"]);
const ALLOWED_WORK_MODES = new Set(["Remote", "Hybrid", "On-site", "Remote-friendly", "Global"]);
const DEFAULT_OPENAI_MODEL = process.env.OVAL_OPENAI_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";

class HttpError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.fallbackEligible = options.fallbackEligible === true;
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

function requireEnv(...names) {
  for (const name of names) {
    if (process.env[name]) {
      return process.env[name];
    }
  }
  throw new HttpError(503, "Server moderation is not configured yet.", {
    fallbackEligible: true,
  });
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

function compact(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => compact(item))
      .filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, compact(item)])
      .filter(([, item]) => item !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return value === undefined ? undefined : value;
}

function sanitizeString(value, maxLength, fallback = "") {
  const text = String(value ?? fallback).trim();
  return text.slice(0, maxLength);
}

function sanitizeOptionalUrl(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  try {
    const url = new URL(text);
    if (!/^https?:$/i.test(url.protocol)) {
      return "";
    }
    return url.toString();
  } catch (error) {
    return "";
  }
}

function assertPublicUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!/^https?:$/i.test(url.protocol)) {
    throw new HttpError(400, "Details URL must use http or https.");
  }
  const host = url.hostname.toLowerCase();
  const privateIpv4 =
    host === "localhost"
    || host === "127.0.0.1"
    || host === "0.0.0.0"
    || host.startsWith("10.")
    || host.startsWith("192.168.")
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  const privateIpv6 = host === "::1" || host === "[::1]";
  if (privateIpv4 || privateIpv6 || host.endsWith(".local")) {
    throw new HttpError(400, "Details URL must point to a public website.");
  }
  return url.toString();
}

function sanitizeList(value, options = {}) {
  const maxItems = options.maxItems || 12;
  const maxLength = options.maxLength || 140;
  const source = Array.isArray(value) ? value : [];
  return [...new Set(
    source
      .map((item) => sanitizeString(item, maxLength))
      .filter(Boolean),
  )].slice(0, maxItems);
}

function sanitizeHashtags(value) {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(
    source
      .map((item) => sanitizeString(item, 32).replace(/^#+/, "").toLowerCase())
      .filter(Boolean),
  )].slice(0, 10);
}

function sanitizeMedia(value, title) {
  const media = value && typeof value === "object" ? value : {};
  return compact({
    name: sanitizeString(media.name || title || "Cover", 160),
    url: sanitizeOptionalUrl(media.url),
    kind: sanitizeString(media.kind || "image/jpeg", 80),
    alt: sanitizeString(media.alt || title || "Opportunity cover", 160),
  });
}

function sanitizeAttachments(value) {
  const source = Array.isArray(value) ? value : [];
  return source
    .map((item) => {
      const attachment = item && typeof item === "object" ? item : {};
      const url = sanitizeOptionalUrl(attachment.url);
      if (!url) {
        return null;
      }
      return {
        name: sanitizeString(attachment.name || "Attachment", 180),
        url,
        kind: sanitizeString(attachment.kind || "file", 80),
      };
    })
    .filter(Boolean)
    .slice(0, 10);
}

function sanitizeHandle(value, fallback) {
  const raw = sanitizeString(value || fallback || "@oval", 48);
  if (!raw) {
    return "@oval";
  }
  return raw.startsWith("@") ? raw : `@${raw}`;
}

function defaultDisplayName(profile, email) {
  const candidate = sanitizeString(profile?.displayName, 80);
  if (candidate) {
    return candidate;
  }
  const localPart = sanitizeString(String(email || "").split("@")[0], 80);
  return localPart || "Oval User";
}

function normalizeDeadline(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  }
  return date.toISOString();
}

function extractHashtags(text) {
  const matches = String(text || "").match(/#[a-z0-9][a-z0-9_-]*/gi) || [];
  return [...new Set(matches.map((item) => item.slice(1).toLowerCase()))].slice(0, 10);
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

function stripTags(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractHtmlSignals(html) {
  const source = String(html || "");
  const title = sanitizeString((source.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "", 240);
  const metaDescription = sanitizeString(
    ((source.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
      || source.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)
      || [])[1]) || "",
    320,
  );
  const preview = sanitizeString(stripTags(source), 2000);
  return {
    title,
    metaDescription,
    preview,
  };
}

function tokenize(value) {
  return new Set(
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((item) => item.length >= 3)
      .slice(0, 80),
  );
}

function keywordOverlap(left, right) {
  if (!left.size || !right.size) {
    return 0;
  }
  let matches = 0;
  left.forEach((item) => {
    if (right.has(item)) {
      matches += 1;
    }
  });
  return matches;
}

async function inspectApplyUrl(url) {
  const verifiedUrl = assertPublicUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(verifiedUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
        "user-agent": "OvalVerifier/1.0 (+https://oval-nine.vercel.app/)",
      },
    });
    const finalUrl = assertPublicUrl(response.url || verifiedUrl);
    const contentType = sanitizeString(response.headers.get("content-type"), 120);
    let htmlSignals = {
      title: "",
      metaDescription: "",
      preview: "",
    };
    if (response.ok && contentType.toLowerCase().includes("text/html")) {
      const html = await response.text();
      htmlSignals = extractHtmlSignals(html);
    }
    return {
      reachable: response.ok,
      statusCode: response.status,
      finalUrl,
      host: new URL(finalUrl).hostname,
      contentType,
      ...htmlSignals,
      error: response.ok ? "" : `Returned HTTP ${response.status}.`,
    };
  } catch (error) {
    const reason = error?.name === "AbortError"
      ? "Request timed out while verifying the details URL."
      : error?.message || "The details URL could not be verified.";
    return {
      reachable: false,
      statusCode: 0,
      finalUrl: verifiedUrl,
      host: new URL(verifiedUrl).hostname,
      contentType: "",
      title: "",
      metaDescription: "",
      preview: "",
      error: reason,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function collectMetadataFlags(payload) {
  const flags = [];
  if (!payload.locationLabel) {
    flags.push("Location is missing.");
  }
  if (!payload.payLabel) {
    flags.push("Compensation is missing.");
  }
  if (!payload.eligibility.length) {
    flags.push("Eligibility is missing.");
  }
  if (!payload.requirements.length) {
    flags.push("Requirements are missing.");
  }
  if (!payload.perks.length) {
    flags.push("Perks are missing.");
  }
  if (!payload.responsibilities.length) {
    flags.push("Responsibilities are missing.");
  }
  if (!payload.aboutCompany) {
    flags.push("Company or creator background is missing.");
  }
  return flags;
}

async function reviewWithOpenAI(payload, inspection, metadataFlags) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      source: "rules",
      model: "",
      decision: "manual_review",
      confidence: "low",
      summary: "AI reviewer is not configured, so this submission was routed to admin review.",
      reasons: ["OpenAI API key is missing."],
      flags: metadataFlags,
    };
  }

  const prompt = {
    instruction:
      "Decide whether this opportunity should be auto-published or routed to manual admin review. Only approve when the metadata is coherent and the details page appears to match the opportunity. If key details are missing, contradictory, misleading, or unverifiable, choose manual_review.",
    requiredPolicy: [
      "The details URL is the strongest signal.",
      "Treat vague or unverifiable opportunities as manual_review.",
      "Prefer manual_review over false positives.",
      "Return JSON only.",
    ],
    opportunity: payload,
    verification: {
      ...inspection,
      keywordOverlap: keywordOverlap(
        tokenize(`${payload.title} ${payload.caption} ${payload.category} ${payload.locationLabel} ${payload.workMode}`),
        tokenize(`${inspection.title} ${inspection.metaDescription} ${inspection.preview}`),
      ),
      metadataFlags,
    },
    responseShape: {
      decision: "publish | manual_review",
      confidence: "high | medium | low",
      summary: "short sentence",
      reasons: ["string"],
      flags: ["string"],
      urlVerified: true,
    },
  };

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_OPENAI_MODEL,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a strict opportunity verification reviewer. Respond with valid JSON only. Never approve when the URL or metadata is not convincingly verifiable.",
          },
          {
            role: "user",
            content: JSON.stringify(prompt),
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `OpenAI returned HTTP ${response.status}`);
    }

    const data = await response.json();
    const rawContent = data?.choices?.[0]?.message?.content;
    const parsed = typeof rawContent === "string" ? JSON.parse(rawContent) : null;
    const decision = parsed?.decision === "publish" ? "publish" : "manual_review";
    const confidence = ["high", "medium", "low"].includes(parsed?.confidence) ? parsed.confidence : "low";
    return {
      source: "ai",
      model: sanitizeString(data?.model || DEFAULT_OPENAI_MODEL, 80),
      decision,
      confidence,
      summary: sanitizeString(parsed?.summary || "", 240),
      reasons: sanitizeList(parsed?.reasons, { maxItems: 6, maxLength: 180 }),
      flags: sanitizeList(parsed?.flags, { maxItems: 6, maxLength: 180 }),
      urlVerified: parsed?.urlVerified !== false,
    };
  } catch (error) {
    return {
      source: "rules",
      model: DEFAULT_OPENAI_MODEL,
      decision: "manual_review",
      confidence: "low",
      summary: "AI review was unavailable, so this submission was routed to admin review.",
      reasons: [sanitizeString(error?.message || "AI review failed.", 180)],
      flags: metadataFlags,
      urlVerified: false,
    };
  }
}

function decideReviewOutcome(payload, inspection, aiReview, metadataFlags) {
  const structuralCoverage = [
    payload.locationLabel,
    payload.payLabel,
    payload.eligibility.length,
    payload.requirements.length,
    payload.responsibilities.length,
    payload.perks.length,
    payload.aboutCompany,
  ].filter(Boolean).length;
  const combinedFlags = sanitizeList([
    ...(inspection.reachable ? [] : [inspection.error || "Details URL could not be verified."]),
    ...(structuralCoverage >= 3 ? [] : ["Submission lacks enough structured metadata for auto-approval."]),
    ...metadataFlags,
    ...(Array.isArray(aiReview.flags) ? aiReview.flags : []),
  ], { maxItems: 8, maxLength: 180 });

  const urlVerified = inspection.reachable && aiReview.urlVerified !== false;
  const publishable = urlVerified
    && structuralCoverage >= 3
    && aiReview.decision === "publish"
    && aiReview.confidence !== "low";

  const decision = publishable ? "auto_approved" : "manual_review";
  const summary = publishable
    ? sanitizeString(aiReview.summary || "Metadata and details page passed automatic verification.", 240)
    : sanitizeString(
      aiReview.summary
        || inspection.error
        || "This submission needs manual admin review because some details could not be verified confidently.",
      240,
    );
  const reasons = sanitizeList([
    ...(Array.isArray(aiReview.reasons) ? aiReview.reasons : []),
    ...(publishable ? [] : ["Manual review was chosen to avoid publishing unverifiable details."]),
  ], { maxItems: 8, maxLength: 180 });

  return {
    status: publishable ? "published" : "pending",
    review: compact({
      source: aiReview.source,
      model: aiReview.model,
      decision,
      summary,
      confidence: aiReview.confidence,
      reasons,
      flags: combinedFlags,
      urlVerified,
      urlStatusCode: inspection.statusCode || undefined,
      urlFinal: inspection.finalUrl,
      urlHost: inspection.host,
      pageTitle: inspection.title || undefined,
      checkedAt: Timestamp.now(),
    }),
    message: publishable
      ? "Opportunity approved automatically and is now live."
      : inspection.reachable
        ? "Opportunity submitted for admin review because some details still need manual verification."
        : "Opportunity submitted for admin review because the details URL could not be verified.",
  };
}

async function createNotification(db, uid, payload) {
  if (!uid) {
    return;
  }
  await db.collection("users").doc(uid).collection("notifications").add({
    ...payload,
    read: false,
    createdAt: Timestamp.now(),
  });
}

function sanitizeOpportunityPayload(rawPayload, user, profile, existingOpportunity = null) {
  const raw = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const title = sanitizeString(raw.title, 140);
  const caption = sanitizeString(raw.caption, 150);
  const applyUrl = sanitizeString(raw.applyUrl, 1000);
  if (title.length < 4) {
    throw new HttpError(400, "Title is too short.");
  }
  if (caption.length < 12) {
    throw new HttpError(400, "Description is too short.");
  }
  if (!applyUrl) {
    throw new HttpError(400, "Details URL is required.");
  }

  const category = ALLOWED_CATEGORIES.has(raw.category) ? raw.category : "Internship";
  const workMode = ALLOWED_WORK_MODES.has(raw.workMode) ? raw.workMode : "Remote";
  const fallbackHandle = `@${sanitizeString(profile?.username || normalizeEmail(user.email).split("@")[0] || "oval", 32).replace(/^@+/, "")}`;

  return {
    title,
    caption,
    applyUrl: assertPublicUrl(applyUrl),
    category,
    locationLabel: sanitizeString(raw.locationLabel, 120),
    workMode,
    payLabel: sanitizeString(raw.payLabel, 80),
    deadlineAt: normalizeDeadline(raw.deadlineAt),
    tags: sanitizeHashtags(raw.tags?.length ? raw.tags : extractHashtags(caption)),
    eligibility: sanitizeList(raw.eligibility),
    responsibilities: sanitizeList(raw.responsibilities),
    requirements: sanitizeList(raw.requirements),
    perks: sanitizeList(raw.perks),
    aboutCompany: sanitizeString(raw.aboutCompany, 800),
    allowComments: raw.allowComments !== false,
    media: sanitizeMedia(raw.media, title),
    attachments: sanitizeAttachments(raw.attachments),
    creatorUid: existingOpportunity?.creatorUid || user.uid,
    creatorName: sanitizeString(raw.creatorName, 80, defaultDisplayName(profile, user.email)),
    creatorHandle: sanitizeHandle(raw.creatorHandle, fallbackHandle),
    creatorPhotoURL: sanitizeOptionalUrl(raw.creatorPhotoURL) || sanitizeOptionalUrl(profile?.photoURL) || DEFAULT_AVATAR,
  };
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

    const decodedToken = await auth.verifyIdToken(idToken);
    const userEmail = normalizeEmail(decodedToken.email);
    const user = {
      uid: decodedToken.uid,
      email: userEmail,
    };

    const profileRef = db.collection("users").doc(user.uid);
    const profileSnap = await profileRef.get();
    if (!profileSnap.exists) {
      throw new HttpError(403, "User profile is missing.");
    }
    const profile = profileSnap.data() || {};
    const isAdmin = profile.role === "admin" || BOOTSTRAP_ADMIN_EMAILS.has(userEmail);

    const body = readJsonBody(request);
    const mode = body.mode === "update" ? "update" : "create";
    let existingOpportunity = null;
    let opportunityRef = null;

    if (mode === "update") {
      const opportunityId = sanitizeString(body.opportunityId, 120);
      if (!opportunityId) {
        throw new HttpError(400, "Opportunity ID is required for updates.");
      }
      opportunityRef = db.collection("opportunities").doc(opportunityId);
      const snap = await opportunityRef.get();
      if (!snap.exists) {
        throw new HttpError(404, "Opportunity not found.");
      }
      existingOpportunity = {
        id: snap.id,
        ...snap.data(),
      };
      if (!isAdmin && existingOpportunity.creatorUid !== user.uid) {
        throw new HttpError(403, "You cannot edit this opportunity.");
      }
    }

    const payload = sanitizeOpportunityPayload(body.payload, user, profile, existingOpportunity);
    const now = Timestamp.now();
    let outcome;

    if (isAdmin) {
      outcome = {
        status: "published",
        review: {
          source: "admin",
          decision: "admin_publish",
          summary: "Published directly by an admin.",
          confidence: "high",
          checkedAt: now,
          urlVerified: true,
          urlFinal: payload.applyUrl,
          urlHost: new URL(payload.applyUrl).hostname,
        },
        message: existingOpportunity
          ? "Opportunity updated and remains live."
          : "Opportunity published.",
      };
    } else {
      const inspection = await inspectApplyUrl(payload.applyUrl);
      const metadataFlags = collectMetadataFlags(payload);
      const aiReview = await reviewWithOpenAI(payload, inspection, metadataFlags);
      outcome = decideReviewOutcome(payload, inspection, aiReview, metadataFlags);
    }

    if (!opportunityRef) {
      opportunityRef = db.collection("opportunities").doc();
    }

    const documentPayload = compact({
      ...payload,
      deadlineAt: Timestamp.fromDate(new Date(payload.deadlineAt)),
      status: outcome.status,
      review: outcome.review,
      updatedAt: now,
      ...(mode === "create"
        ? {
          createdAt: now,
          viewsCount: 0,
          savesCount: 0,
          appliedCount: 0,
          commentsCount: 0,
          likesCount: 0,
        }
        : {}),
    });

    if (mode === "update") {
      await opportunityRef.set(documentPayload, { merge: true });
    } else {
      await opportunityRef.set(documentPayload);
    }

    if (!isAdmin && outcome.status === "published") {
      await createNotification(db, user.uid, {
        type: "moderation-approved",
        title: "Opportunity approved automatically",
        body: `${payload.title} passed automatic verification and is now live.`,
        opportunityId: opportunityRef.id,
      });
    }

    json(response, 200, {
      ok: true,
      opportunityId: opportunityRef.id,
      status: outcome.status,
      message: outcome.message,
      review: {
        decision: outcome.review?.decision || "",
        summary: outcome.review?.summary || "",
        flags: Array.isArray(outcome.review?.flags) ? outcome.review.flags : [],
        confidence: outcome.review?.confidence || "",
        urlVerified: Boolean(outcome.review?.urlVerified),
      },
    });
  } catch (error) {
    console.error("review-opportunity failed", error);
    const status = error instanceof HttpError ? error.status : 500;
    json(response, status, {
      error: error instanceof Error ? error.message : "Automatic moderation failed.",
      fallbackEligible: error instanceof HttpError && error.fallbackEligible === true,
    });
  }
}
