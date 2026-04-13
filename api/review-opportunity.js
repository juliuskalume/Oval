import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { Timestamp, getFirestore } from "firebase-admin/firestore";

const BOOTSTRAP_ADMIN_EMAILS = new Set([
  "juliuskalume906@gmail.com",
  "sentira.official@gmail.com",
]);

const DEFAULT_AVATAR =
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80";
const DEFAULT_COVER =
  "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=1200&q=80";

const ALLOWED_CATEGORIES = new Set(["Job", "Internship", "Gig", "Scholarship"]);
const ALLOWED_WORK_MODES = new Set(["Remote", "Hybrid", "On-site", "Remote-friendly", "Global"]);
const GROQ_API_BASE = "https://api.groq.com/openai/v1";
const DEFAULT_GROQ_MODEL = process.env.OVAL_GROQ_MODEL || process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const DEFAULT_GROQ_VISION_MODEL = process.env.OVAL_GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";
const MAX_ATTACHMENT_COUNT = 5;
const MAX_VISUAL_INPUTS_PER_REQUEST = 5;
const MAX_BASE64_IMAGE_URL_LENGTH = 4_500_000;

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

function isImageKind(kind) {
  return String(kind || "").toLowerCase().startsWith("image/");
}

function isVideoKind(kind) {
  return String(kind || "").toLowerCase().startsWith("video/");
}

function isDefaultCoverUrl(url) {
  return sanitizeOptionalUrl(url) === DEFAULT_COVER;
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
    .slice(0, MAX_ATTACHMENT_COUNT);
}

function sanitizeVisualModerationFrames(value) {
  const source = Array.isArray(value) ? value : [];
  return source
    .map((item, index) => {
      const frame = item && typeof item === "object" ? item : {};
      const imageUrl = String(frame.imageUrl || "").trim();
      if (!/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(imageUrl)) {
        return null;
      }
      if (imageUrl.length > MAX_BASE64_IMAGE_URL_LENGTH) {
        return null;
      }
      const sourceType = frame.sourceType === "attachment" ? "attachment" : "cover";
      const attachmentIndex = sourceType === "attachment" && Number.isInteger(frame.attachmentIndex)
        ? frame.attachmentIndex
        : undefined;
      return compact({
        sourceType,
        attachmentIndex,
        label: sanitizeString(frame.label || `Frame ${index + 1}`, 160),
        imageUrl,
      });
    })
    .filter(Boolean)
    .slice(0, MAX_ATTACHMENT_COUNT + 1);
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
  const timeout = setTimeout(() => controller.abort(), 20000);
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

function collectVisualReviewInputs(payload, clientFrames = []) {
  const visualInputs = [];
  const uncoveredVideos = [];
  const coverFrame = clientFrames.find((item) => item.sourceType === "cover");

  if (payload.media?.url && !isDefaultCoverUrl(payload.media.url)) {
    if (isImageKind(payload.media.kind)) {
      visualInputs.push({
        label: "Cover image",
        imageUrl: payload.media.url,
        sourceType: "cover",
      });
    } else if (isVideoKind(payload.media.kind)) {
      if (coverFrame?.imageUrl) {
        visualInputs.push({
          label: coverFrame.label || "Cover video frame",
          imageUrl: coverFrame.imageUrl,
          sourceType: "cover",
        });
      } else {
        uncoveredVideos.push("Cover video could not be safety-screened automatically.");
      }
    }
  }

  payload.attachments.forEach((attachment, index) => {
    if (!attachment?.url) {
      return;
    }
    if (isImageKind(attachment.kind)) {
      visualInputs.push({
        label: attachment.name || `Attachment ${index + 1}`,
        imageUrl: attachment.url,
        sourceType: "attachment",
        attachmentIndex: index,
      });
      return;
    }
    if (isVideoKind(attachment.kind)) {
      const frame = clientFrames.find((item) => item.sourceType === "attachment" && item.attachmentIndex === index);
      if (frame?.imageUrl) {
        visualInputs.push({
          label: frame.label || attachment.name || `Attachment ${index + 1}`,
          imageUrl: frame.imageUrl,
          sourceType: "attachment",
          attachmentIndex: index,
        });
      } else {
        uncoveredVideos.push(`${attachment.name || `Attachment ${index + 1}`} is a video and needs manual media review.`);
      }
    }
  });

  return {
    visualInputs,
    uncoveredVideos,
  };
}

async function reviewVisualSafetyBatch(apiKey, visualInputs) {
  const labeledList = visualInputs
    .map((item, index) => `${index + 1}. ${item.label}`)
    .join("\n");
  const content = [
    {
      type: "text",
      text: [
        "You are reviewing opportunity-post media for sexual or nude content.",
        "Classify whether any supplied image contains nudity, exposed genitals, visible nipples, pornographic material, explicit sexual activity, fetish-focused explicit content, or strongly sexualized adult imagery.",
        "If you are unsure, choose manual_review.",
        "Normal fully clothed people, faces, offices, products, landscapes, and non-sexual scenes are safe.",
        `Images in order:\n${labeledList}`,
        'Return JSON only with: {"decision":"safe|manual_review","confidence":"high|medium|low","summary":"short sentence","flaggedItems":[{"label":"string","reason":"string"}],"notes":["string"]}',
      ].join("\n\n"),
    },
    ...visualInputs.map((item) => ({
      type: "image_url",
      image_url: {
        url: item.imageUrl,
      },
    })),
  ];

  const response = await fetch(`${GROQ_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_GROQ_VISION_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a strict visual safety reviewer. If any image may contain nudity or sexual content, route it to manual_review. Respond with valid JSON only.",
        },
        {
          role: "user",
          content,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Groq returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const rawContent = data?.choices?.[0]?.message?.content;
  const parsed = typeof rawContent === "string" ? JSON.parse(rawContent) : {};
  return {
    model: sanitizeString(data?.model || DEFAULT_GROQ_VISION_MODEL, 120),
    decision: parsed?.decision === "safe" ? "safe" : "manual_review",
    confidence: ["high", "medium", "low"].includes(parsed?.confidence) ? parsed.confidence : "low",
    summary: sanitizeString(parsed?.summary || "", 240),
    flaggedItems: (Array.isArray(parsed?.flaggedItems) ? parsed.flaggedItems : [])
      .map((item) => ({
        label: sanitizeString(item?.label, 160),
        reason: sanitizeString(item?.reason, 200),
      }))
      .filter((item) => item.label || item.reason),
    notes: sanitizeList(parsed?.notes, { maxItems: 6, maxLength: 180 }),
  };
}

async function reviewVisualSafety(payload, clientFrames = []) {
  const { visualInputs, uncoveredVideos } = collectVisualReviewInputs(payload, clientFrames);
  const apiKey = process.env.GROQ_API_KEY;

  if (!visualInputs.length && !uncoveredVideos.length) {
    return {
      checked: false,
      safeToPublish: true,
      confidence: "high",
      summary: "",
      reasons: [],
      flags: [],
      flaggedItems: [],
      manualReviewRequired: false,
      model: "",
    };
  }

  if (!apiKey) {
    return {
      checked: Boolean(visualInputs.length),
      safeToPublish: false,
      confidence: "low",
      summary: "Visual safety review is not configured, so this submission was routed to admin review.",
      reasons: ["Groq API key is missing."],
      flags: uncoveredVideos,
      flaggedItems: [],
      manualReviewRequired: true,
      model: "",
    };
  }

  const batches = [];
  for (let index = 0; index < visualInputs.length; index += MAX_VISUAL_INPUTS_PER_REQUEST) {
    batches.push(visualInputs.slice(index, index + MAX_VISUAL_INPUTS_PER_REQUEST));
  }

  try {
    const results = [];
    for (const batch of batches) {
      results.push(await reviewVisualSafetyBatch(apiKey, batch));
    }

    const flaggedItems = results.flatMap((item) => item.flaggedItems || []);
    const notes = results.flatMap((item) => item.notes || []);
    const anyUnsafe = results.some((item) => item.decision !== "safe");
    const safeToPublish = !anyUnsafe && uncoveredVideos.length === 0;
    const confidence = results.some((item) => item.confidence === "low")
      ? "low"
      : results.some((item) => item.confidence === "medium")
        ? "medium"
        : "high";
    const summary = safeToPublish
      ? "Uploaded media passed automatic visual safety review."
      : flaggedItems.length
        ? "Uploaded media triggered visual safety review and needs manual approval."
        : uncoveredVideos.length
          ? "Some uploaded video content could not be safety-screened automatically."
          : "Uploaded media needs manual visual review.";

    return {
      checked: true,
      safeToPublish,
      confidence,
      summary: sanitizeString(summary, 240),
      reasons: sanitizeList(notes, { maxItems: 8, maxLength: 180 }),
      flags: sanitizeList([
        ...uncoveredVideos,
        ...flaggedItems.map((item) => `${item.label}: ${item.reason}`),
      ], { maxItems: 10, maxLength: 180 }),
      flaggedItems,
      manualReviewRequired: !safeToPublish,
      model: results.map((item) => item.model).filter(Boolean).join(", "),
    };
  } catch (error) {
    return {
      checked: Boolean(visualInputs.length),
      safeToPublish: false,
      confidence: "low",
      summary: "Visual safety review was unavailable, so this submission was routed to admin review.",
      reasons: [sanitizeString(error?.message || "Visual safety review failed.", 180)],
      flags: uncoveredVideos,
      flaggedItems: [],
      manualReviewRequired: true,
      model: DEFAULT_GROQ_VISION_MODEL,
    };
  }
}

function applyVisualSafetyGate(outcome, visualReview) {
  if (!visualReview || (!visualReview.checked && !visualReview.manualReviewRequired)) {
    return outcome;
  }

  const mergedReview = compact({
    ...outcome.review,
    mediaChecked: visualReview.checked,
    mediaSafe: visualReview.safeToPublish,
    mediaModel: visualReview.model || undefined,
    mediaSummary: visualReview.summary || undefined,
    mediaFlags: sanitizeList(visualReview.flags, { maxItems: 10, maxLength: 180 }),
    mediaReasons: sanitizeList(visualReview.reasons, { maxItems: 8, maxLength: 180 }),
    mediaFlaggedItems: Array.isArray(visualReview.flaggedItems) ? visualReview.flaggedItems : [],
  });

  if (visualReview.safeToPublish && !visualReview.manualReviewRequired) {
    return {
      ...outcome,
      review: mergedReview,
    };
  }

  return {
    status: "pending",
    review: compact({
      ...mergedReview,
      decision: "manual_review",
      summary: sanitizeString(visualReview.summary || outcome.review?.summary || "Uploaded media needs manual review.", 240),
      confidence: visualReview.confidence || outcome.review?.confidence || "low",
      reasons: sanitizeList([
        ...(Array.isArray(mergedReview.reasons) ? mergedReview.reasons : []),
        "Manual review was chosen because uploaded media could not be cleared automatically.",
      ], { maxItems: 10, maxLength: 180 }),
      flags: sanitizeList([
        ...(Array.isArray(mergedReview.flags) ? mergedReview.flags : []),
        ...(Array.isArray(visualReview.flags) ? visualReview.flags : []),
      ], { maxItems: 12, maxLength: 180 }),
    }),
    message: visualReview.flaggedItems?.length
      ? "Opportunity submitted for admin review because uploaded media triggered visual safety checks."
      : "Opportunity submitted for admin review because uploaded media needs manual verification.",
  };
}

async function reviewWithGroq(payload, inspection, metadataFlags) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return {
      source: "rules",
      model: "",
      decision: "manual_review",
      confidence: "low",
      summary: "AI reviewer is not configured, so this submission was routed to admin review.",
      reasons: ["Groq API key is missing."],
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
    const response = await fetch(`${GROQ_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_GROQ_MODEL,
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
      throw new Error(errorText || `Groq returned HTTP ${response.status}`);
    }

    const data = await response.json();
    const rawContent = data?.choices?.[0]?.message?.content;
    const parsed = typeof rawContent === "string" ? JSON.parse(rawContent) : null;
    const decision = parsed?.decision === "publish" ? "publish" : "manual_review";
    const confidence = ["high", "medium", "low"].includes(parsed?.confidence) ? parsed.confidence : "low";
    return {
      source: "ai",
      model: sanitizeString(data?.model || DEFAULT_GROQ_MODEL, 80),
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
      model: DEFAULT_GROQ_MODEL,
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
  const attachmentCount = Array.isArray(raw.attachments) ? raw.attachments.length : 0;
  if (attachmentCount > MAX_ATTACHMENT_COUNT) {
    throw new HttpError(400, `You can attach up to ${MAX_ATTACHMENT_COUNT} files per post.`);
  }

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
    const visualModerationFrames = sanitizeVisualModerationFrames(body.visualModerationFrames);
    const now = Timestamp.now();
    const visualReview = await reviewVisualSafety(payload, visualModerationFrames);
    let outcome;

    if (isAdmin) {
      outcome = applyVisualSafetyGate({
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
      }, visualReview);
    } else {
      const inspection = await inspectApplyUrl(payload.applyUrl);
      const metadataFlags = collectMetadataFlags(payload);
      const aiReview = await reviewWithGroq(payload, inspection, metadataFlags);
      outcome = applyVisualSafetyGate(
        decideReviewOutcome(payload, inspection, aiReview, metadataFlags),
        visualReview,
      );
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
