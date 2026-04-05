import {
  Timestamp,
  addDoc,
  auth,
  collection,
  createUserWithEmailAndPassword,
  db,
  doc,
  getDoc,
  getDocs,
  googleProvider,
  onAuthStateChanged,
  orderBy,
  query,
  ref,
  runTransaction,
  setDoc,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  storage,
  updateDoc,
  updateProfile,
  uploadBytes,
  getDownloadURL,
  where,
} from "./firebase.js";
import { DEMO_COMMENTS, DEMO_OPPORTUNITIES } from "./sample-data.js";

const RETURN_TO_KEY = "oval.returnTo";
const BOOTSTRAP_ADMIN_EMAILS = new Set([
  "juliuskalume906@gmail.com",
  "sentira.official@gmail.com",
]);
const MAX_CAPTION_LENGTH = 150;
const MAX_COMMENT_LENGTH = 280;
const FEED_CAPTION_LENGTH = 100;
const FEED_BATCH_SIZE = 4;
const FEED_VIDEO_SOUND_KEY = "oval.feedVideoSoundEnabled";
const SETTINGS_PREFS_KEY = "oval.settings.preferences";
const APP_LOADER_MIN_MS = 420;
const PWA_THEME_COLOR = "#020617";
const DEFAULT_COVER =
  "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=1200&q=80";
const DEFAULT_AVATAR =
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80";
const DEFAULT_SETTINGS_PREFS = {
  matchingOpportunities: true,
  applicationUpdates: true,
  commentsMentions: true,
  productUpdates: false,
};

const page = document.body.dataset.page || "";

const authReady = new Promise((resolve) => {
  let settled = false;
  onAuthStateChanged(auth, (user) => {
    if (!settled) {
      settled = true;
      resolve(user);
    }
  });
});

function qs(selector, root = document) {
  return root.querySelector(selector);
}

function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

function ensureMetaTag(selector, attributes, content) {
  let node = document.head.querySelector(selector);
  if (!node) {
    node = document.createElement("meta");
    Object.entries(attributes).forEach(([key, value]) => {
      node.setAttribute(key, value);
    });
    document.head.appendChild(node);
  }
  node.setAttribute("content", content);
  return node;
}

function ensureLinkTag(selector, attributes) {
  let node = document.head.querySelector(selector);
  if (!node) {
    node = document.createElement("link");
    document.head.appendChild(node);
  }
  Object.entries(attributes).forEach(([key, value]) => {
    node.setAttribute(key, value);
  });
  return node;
}

function ensurePwaShellMeta() {
  const viewport = document.head.querySelector('meta[name="viewport"]');
  if (viewport) {
    const current = viewport.getAttribute("content") || "";
    if (!current.includes("viewport-fit=cover")) {
      viewport.setAttribute("content", `${current.replace(/\s+$/g, "")}, viewport-fit=cover`);
    }
  } else {
    ensureMetaTag('meta[name="viewport"]', { name: "viewport" }, "width=device-width, initial-scale=1.0, viewport-fit=cover");
  }

  if (!document.documentElement.lang) {
    document.documentElement.lang = "en";
  }

  ensureMetaTag('meta[name="theme-color"]', { name: "theme-color" }, PWA_THEME_COLOR);
  ensureMetaTag('meta[name="description"]', { name: "description" }, "A mobile-first opportunity discovery app for finding, saving, tracking, and publishing opportunities.");
  ensureMetaTag('meta[name="application-name"]', { name: "application-name" }, "Oval");
  ensureMetaTag('meta[name="apple-mobile-web-app-capable"]', { name: "apple-mobile-web-app-capable" }, "yes");
  ensureMetaTag('meta[name="apple-mobile-web-app-status-bar-style"]', { name: "apple-mobile-web-app-status-bar-style" }, "black-translucent");
  ensureMetaTag('meta[name="apple-mobile-web-app-title"]', { name: "apple-mobile-web-app-title" }, "Oval");
  ensureMetaTag('meta[name="mobile-web-app-capable"]', { name: "mobile-web-app-capable" }, "yes");
  ensureMetaTag('meta[name="msapplication-TileColor"]', { name: "msapplication-TileColor" }, PWA_THEME_COLOR);
  ensureMetaTag('meta[name="format-detection"]', { name: "format-detection" }, "telephone=no");

  ensureLinkTag('link[rel="manifest"]', { rel: "manifest", href: "manifest.webmanifest" });
  ensureLinkTag('link[rel="icon"]', { rel: "icon", type: "image/png", sizes: "192x192", href: "assets/pwa/icon-any-192.png" });
  ensureLinkTag('link[rel="apple-touch-icon"]', { rel: "apple-touch-icon", sizes: "180x180", href: "assets/pwa/apple-touch-icon-v2.png" });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  const isSecureContextLike = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (!isSecureContextLike) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js", { scope: "./" }).catch((error) => {
      console.warn("Service worker registration failed.", error);
    });
  }, { once: true });
}

let appLoaderShownAt = 0;

function ensureAppLoader() {
  let loader = document.getElementById("appLoader");
  if (!loader) {
    loader = document.createElement("div");
    loader.id = "appLoader";
    loader.className = "app-loader";
    loader.setAttribute("aria-live", "polite");
    loader.setAttribute("aria-label", "Loading Oval");
    loader.innerHTML = `
      <div class="app-loader__shell" role="status">
        <div class="app-loader__halo"></div>
        <div class="app-loader__ring"></div>
        <div class="app-loader__ring app-loader__ring--inner"></div>
        <div class="app-loader__core">
          <span class="app-loader__wordmark">OVAL</span>
        </div>
      </div>
    `;
    document.body.appendChild(loader);
  }
  return loader;
}

function showAppLoader() {
  const loader = ensureAppLoader();
  appLoaderShownAt = performance.now();
  document.body.classList.add("app-loading");
  loader.classList.remove("app-loader--hidden");
  return loader;
}

async function hideAppLoader() {
  const loader = ensureAppLoader();
  const elapsed = performance.now() - appLoaderShownAt;
  const remaining = Math.max(0, APP_LOADER_MIN_MS - elapsed);
  if (remaining) {
    await new Promise((resolve) => window.setTimeout(resolve, remaining));
  }
  loader.classList.add("app-loader--hidden");
  document.body.classList.remove("app-loading");
}

function shouldShowLoaderForLink(link, event) {
  if (!link || event.defaultPrevented || event.button !== 0) {
    return false;
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }
  if (link.target && link.target !== "_self") {
    return false;
  }
  if (link.hasAttribute("download")) {
    return false;
  }
  const rawHref = link.getAttribute("href");
  if (!rawHref || rawHref.startsWith("#") || /^javascript:/i.test(rawHref)) {
    return false;
  }
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin) {
    return false;
  }
  if (url.pathname === location.pathname && url.search === location.search && url.hash) {
    return false;
  }
  return true;
}

function wireLoadingTransitions() {
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!shouldShowLoaderForLink(link, event)) {
      return;
    }
    showAppLoader();
  }, true);

  window.addEventListener("beforeunload", () => {
    showAppLoader();
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueUsername(source) {
  const base = slugify(source).slice(0, 18) || "oval-user";
  return `${base}${Math.floor(Math.random() * 900 + 100)}`;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isBootstrapAdminEmail(email) {
  return BOOTSTRAP_ADMIN_EMAILS.has(normalizeEmail(email));
}

function toRelativePath() {
  return `${location.pathname.split("/").pop() || "feed.html"}${location.search || ""}`;
}

function setPendingReturnTo(path = toRelativePath()) {
  sessionStorage.setItem(RETURN_TO_KEY, path);
}

function getPendingReturnTo(defaultPath) {
  const search = new URLSearchParams(location.search);
  const requested = search.get("returnTo") || sessionStorage.getItem(RETURN_TO_KEY);
  if (!requested) {
    return defaultPath;
  }
  if (/^https?:/i.test(requested) || requested.startsWith("//")) {
    return defaultPath;
  }
  return requested;
}

function clearPendingReturnTo() {
  sessionStorage.removeItem(RETURN_TO_KEY);
}

function getFeedVideoMutedPreference() {
  try {
    const stored = localStorage.getItem(FEED_VIDEO_SOUND_KEY);
    return stored === null ? false : stored !== "1";
  } catch (error) {
    return false;
  }
}

function setFeedVideoMutedPreference(muted) {
  try {
    localStorage.setItem(FEED_VIDEO_SOUND_KEY, muted ? "0" : "1");
  } catch (error) {}
}

function getSettingsPreferences() {
  try {
    const stored = localStorage.getItem(SETTINGS_PREFS_KEY);
    if (!stored) {
      return {
        ...DEFAULT_SETTINGS_PREFS,
      };
    }
    const parsed = JSON.parse(stored);
    return {
      ...DEFAULT_SETTINGS_PREFS,
      ...(parsed && typeof parsed === "object" ? parsed : {}),
    };
  } catch (error) {
    return {
      ...DEFAULT_SETTINGS_PREFS,
    };
  }
}

function setSettingsPreferences(preferences) {
  try {
    localStorage.setItem(SETTINGS_PREFS_KEY, JSON.stringify(preferences));
  } catch (error) {}
}

function toDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value.toDate === "function") {
    return value.toDate();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value) {
  const date = toDate(value);
  if (!date) {
    return "No deadline";
  }
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatRelativeDate(value) {
  const date = toDate(value);
  if (!date) {
    return "";
  }
  const diffMs = date.getTime() - Date.now();
  const diffHours = Math.round(diffMs / 3600000);
  const diffDays = Math.round(diffMs / 86400000);
  if (Math.abs(diffHours) < 24) {
    return diffHours >= 0 ? `in ${diffHours}h` : `${Math.abs(diffHours)}h ago`;
  }
  return diffDays >= 0 ? `in ${diffDays}d` : `${Math.abs(diffDays)}d ago`;
}

function formatCompact(value) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

function linesFromInput(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function serializeLines(items) {
  return Array.isArray(items) ? items.join("\n") : "";
}

function extractHashtags(value) {
  const matches = String(value || "").match(/#[a-z0-9][a-z0-9_-]*/gi) || [];
  return [...new Set(matches.map((item) => item.slice(1).toLowerCase()))];
}

function truncateText(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.toString();
  } catch (error) {
    return "";
  }
}

function toneClasses(tone) {
  if (tone === "error") {
    return "bg-red-500/15 text-red-200 border border-red-500/30";
  }
  if (tone === "success") {
    return "bg-emerald-500/15 text-emerald-200 border border-emerald-500/30";
  }
  return "bg-white/10 text-white/80 border border-white/10";
}

function setStatus(target, message = "", tone = "info") {
  if (!target) {
    return;
  }
  if (!message) {
    target.className = "hidden";
    target.textContent = "";
    return;
  }
  target.textContent = message;
  target.className = `rounded-2xl px-4 py-3 text-sm ${toneClasses(tone)}`;
}

function renderFatalError(error) {
  const existing = document.getElementById("fatalAppError");
  const message = error?.message || String(error || "Unknown error");
  if (existing) {
    existing.textContent = message;
    return;
  }
  const banner = document.createElement("div");
  banner.id = "fatalAppError";
  banner.className = "fixed left-4 right-4 top-20 z-[100] rounded-2xl border border-red-500/30 bg-red-500/15 px-4 py-3 text-sm text-red-100";
  banner.textContent = message;
  document.body.appendChild(banner);
}

const confirmModalState = {
  resolve: null,
  onKeydown: null,
};

function ensureConfirmModal() {
  let modal = document.getElementById("appConfirmModal");
  if (modal) {
    return modal;
  }
  modal = document.createElement("div");
  modal.id = "appConfirmModal";
  modal.className = "hidden fixed inset-0 z-[10000] items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4";
  modal.innerHTML = `
    <div class="w-full max-w-sm rounded-3xl border border-white/10 bg-[#0b1220] shadow-2xl shadow-black/40">
      <div class="p-5">
        <div class="w-12 h-12 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center">
          <span class="material-symbols-outlined" id="appConfirmModalIcon">logout</span>
        </div>
        <h2 id="appConfirmModalTitle" class="mt-4 text-lg font-semibold">Confirm action</h2>
        <p id="appConfirmModalMessage" class="mt-2 text-sm text-white/60">Are you sure you want to continue?</p>
      </div>
      <div class="px-5 pb-5 flex gap-3">
        <button type="button" data-confirm-cancel class="flex-1 h-12 rounded-2xl bg-white/10 border border-white/10 font-semibold text-white">Cancel</button>
        <button type="button" data-confirm-accept class="flex-1 h-12 rounded-2xl bg-red-500 text-white font-semibold">Continue</button>
      </div>
    </div>
  `;
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest("[data-confirm-cancel]")) {
      closeConfirmModal(false);
      return;
    }
    if (event.target.closest("[data-confirm-accept]")) {
      closeConfirmModal(true);
    }
  });
  document.body.appendChild(modal);
  return modal;
}

function closeConfirmModal(confirmed = false) {
  const modal = document.getElementById("appConfirmModal");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
  document.body.style.removeProperty("overflow");
  if (confirmModalState.onKeydown) {
    document.removeEventListener("keydown", confirmModalState.onKeydown);
    confirmModalState.onKeydown = null;
  }
  const resolve = confirmModalState.resolve;
  confirmModalState.resolve = null;
  if (resolve) {
    resolve(confirmed);
  }
}

function confirmAction(options = {}) {
  const {
    title = "Confirm action",
    message = "Are you sure you want to continue?",
    confirmLabel = "Continue",
    cancelLabel = "Cancel",
    icon = "logout",
    tone = "danger",
  } = options;
  const modal = ensureConfirmModal();
  if (confirmModalState.resolve) {
    closeConfirmModal(false);
  }

  setText("#appConfirmModalTitle", title);
  setText("#appConfirmModalMessage", message);
  setText("#appConfirmModalIcon", icon);

  const cancelButton = qs("[data-confirm-cancel]", modal);
  const confirmButton = qs("[data-confirm-accept]", modal);
  if (cancelButton) {
    cancelButton.textContent = cancelLabel;
  }
  if (confirmButton) {
    confirmButton.textContent = confirmLabel;
    confirmButton.className = tone === "danger"
      ? "flex-1 h-12 rounded-2xl bg-red-500 text-white font-semibold"
      : "flex-1 h-12 rounded-2xl theme-primary font-semibold";
  }

  modal.classList.remove("hidden");
  modal.classList.add("flex");
  document.body.style.overflow = "hidden";

  return new Promise((resolve) => {
    confirmModalState.resolve = resolve;
    confirmModalState.onKeydown = (event) => {
      if (event.key === "Escape") {
        closeConfirmModal(false);
      }
    };
    document.addEventListener("keydown", confirmModalState.onKeydown);
  });
}

function confirmSignOut() {
  return confirmAction({
    title: "Log out?",
    message: "You will need to sign in again to manage your profile, inbox, and posts.",
    confirmLabel: "Log out",
    cancelLabel: "Stay signed in",
    icon: "logout",
    tone: "danger",
  });
}

function setText(selector, value) {
  const node = typeof selector === "string" ? qs(selector) : selector;
  if (node) {
    node.textContent = value || "";
  }
}

function withTimeout(promise, ms = 2500) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error("Request timed out")), ms);
    }),
  ]);
}

function detailsUrl(opportunityId) {
  return `details.html?id=${encodeURIComponent(opportunityId)}`;
}

function commentsUrl(opportunityId) {
  return `comments.html?id=${encodeURIComponent(opportunityId)}`;
}

function profileUrl(uid) {
  return uid ? `profile.html?uid=${encodeURIComponent(uid)}` : "profile.html";
}

function profileDisplayName(profile) {
  return profile?.displayName || "Oval User";
}

function profileHandleText(profile) {
  return profile?.username ? `@${profile.username}` : "";
}

function opportunityMedia(opportunity) {
  return opportunity?.media?.url || opportunity?.mediaUrl || DEFAULT_COVER;
}

function opportunityMediaKind(opportunity) {
  return opportunity?.media?.kind || opportunity?.mediaKind || "image/jpeg";
}

function isVideoKind(kind) {
  return String(kind || "").toLowerCase().startsWith("video/");
}

function mediaElementMarkup({ url, kind, alt = "", className = "", autoplay = false, muted = false, loop = false, controls = false }) {
  const safeUrl = escapeHtml(url || DEFAULT_COVER);
  const safeClassName = escapeHtml(className);
  const safeAlt = escapeHtml(alt);
  if (isVideoKind(kind)) {
    const attributes = [
      autoplay ? "autoplay" : "",
      muted ? "muted" : "",
      loop ? "loop" : "",
      controls ? "controls" : "",
      "playsinline",
      'preload="metadata"',
    ]
      .filter(Boolean)
      .join(" ");
    return `<video src="${safeUrl}" class="${safeClassName}" ${attributes} aria-label="${safeAlt}"></video>`;
  }
  return `<img src="${safeUrl}" class="${safeClassName}" alt="${safeAlt}">`;
}

function renderOpportunityMedia(opportunity, className, options = {}) {
  return mediaElementMarkup({
    url: opportunityMedia(opportunity),
    kind: opportunityMediaKind(opportunity),
    alt: opportunity?.title || "Opportunity media",
    className,
    ...options,
  });
}

function fileExtension(file) {
  const name = String(file?.name || "");
  const extensionMatch = name.match(/(\.[a-z0-9]+)$/i);
  if (extensionMatch) {
    return extensionMatch[1].toLowerCase();
  }
  const type = String(file?.type || "").toLowerCase();
  if (type === "image/jpeg") {
    return ".jpg";
  }
  if (type === "image/png") {
    return ".png";
  }
  if (type === "image/webp") {
    return ".webp";
  }
  if (type === "image/gif") {
    return ".gif";
  }
  if (type === "video/mp4") {
    return ".mp4";
  }
  if (type === "video/webm") {
    return ".webm";
  }
  if (type === "video/quicktime") {
    return ".mov";
  }
  return "";
}

function creatorAvatar(opportunity) {
  return opportunity?.creatorPhotoURL || opportunity?.creatorAvatarUrl || DEFAULT_AVATAR;
}

function normalizeOpportunity(docSnapshot) {
  const data = docSnapshot.data();
  return {
    id: docSnapshot.id,
    ...data,
  };
}

function sortByCreatedAtDesc(items) {
  return [...items].sort((left, right) => {
    const leftValue = toDate(left.createdAt)?.getTime() || 0;
    const rightValue = toDate(right.createdAt)?.getTime() || 0;
    return rightValue - leftValue;
  });
}

function defaultBio() {
  return "Open to new opportunities on Oval.";
}

function opportunitySnapshot(opportunity) {
  return {
    opportunityId: opportunity.id,
    title: opportunity.title,
    category: opportunity.category,
    creatorName: opportunity.creatorName,
    creatorHandle: opportunity.creatorHandle,
    locationLabel: opportunity.locationLabel,
    payLabel: opportunity.payLabel,
    mediaUrl: opportunityMedia(opportunity),
    mediaKind: opportunityMediaKind(opportunity),
    applyUrl: opportunity.applyUrl || "",
  };
}

async function ensureDemoData() {
  return DEMO_OPPORTUNITIES.map((item) => ({
    ...item,
    seeded: true,
  }));
}

function statusMeta(status) {
  if (status === "pending") {
    return {
      label: "Pending review",
      classes: "bg-amber-500/15 text-amber-200 border border-amber-500/30",
    };
  }
  if (status === "archived") {
    return {
      label: "Archived",
      classes: "bg-red-500/15 text-red-200 border border-red-500/30",
    };
  }
  return {
    label: "Live",
    classes: "bg-emerald-500/15 text-emerald-200 border border-emerald-500/30",
  };
}

async function ensureUserProfile(user, options = {}) {
  const profileRef = doc(db, "users", user.uid);
  const existing = await getDoc(profileRef);
  const email = normalizeEmail(user.email || options.email);
  const shouldBeAdmin = isBootstrapAdminEmail(email);

  if (existing.exists()) {
    const data = existing.data();
    const updates = {};
    if (!data.displayName && user.displayName) {
      updates.displayName = user.displayName;
    }
    if (!data.photoURL && user.photoURL) {
      updates.photoURL = user.photoURL;
    }
    if (email && data.email !== email) {
      updates.email = email;
    }
    if (!data.username) {
      updates.username = uniqueUsername(data.displayName || user.displayName || user.email?.split("@")[0]);
    }
    if (!data.bio) {
      updates.bio = defaultBio();
    }
    if (shouldBeAdmin && data.role !== "admin") {
      updates.role = "admin";
    } else if (!data.role) {
      updates.role = "member";
    }
    if (Object.keys(updates).length) {
      updates.updatedAt = Timestamp.now();
      await updateDoc(profileRef, updates);
      return {
        ...data,
        ...updates,
      };
    }
    return data;
  }

  const displayName =
    options.displayName || user.displayName || user.email?.split("@")[0] || "Oval User";
  const profile = {
    displayName,
    username: uniqueUsername(displayName),
    email,
    photoURL: user.photoURL || DEFAULT_AVATAR,
    role: shouldBeAdmin ? "admin" : options.role || "member",
    bio: defaultBio(),
    followingCount: 0,
    followersCount: 0,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };
  await setDoc(profileRef, profile);
  return profile;
}

async function loadPublicOpportunities() {
  try {
    const snapshot = await withTimeout(
      getDocs(query(collection(db, "opportunities"), where("status", "==", "published"))),
    );
    return sortByCreatedAtDesc(snapshot.docs.map(normalizeOpportunity));
  } catch (error) {
    console.warn("Falling back to bundled opportunities.", error);
    return (await ensureDemoData()).filter((item) => item.status === "published");
  }
}

async function loadUserOpportunities(uid) {
  if (!uid) {
    return [];
  }
  try {
    const snapshot = await withTimeout(
      getDocs(query(collection(db, "opportunities"), where("creatorUid", "==", uid))),
    );
    return sortByCreatedAtDesc(snapshot.docs
      .map(normalizeOpportunity)
      .filter((item) => item.status !== "archived"));
  } catch (error) {
    console.warn("User opportunity load timed out.", error);
    return [];
  }
}

async function loadAllOpportunities() {
  try {
    const snapshot = await withTimeout(
      getDocs(query(collection(db, "opportunities"), orderBy("createdAt", "desc"))),
    );
    return snapshot.docs.map(normalizeOpportunity);
  } catch (error) {
    console.warn("Admin opportunity load timed out.", error);
    return [];
  }
}

async function loadAdminUsers() {
  try {
    const snapshot = await withTimeout(
      getDocs(query(collection(db, "users"), where("role", "==", "admin"))),
    );
    return sortByCreatedAtDesc(snapshot.docs.map(normalizeOpportunity));
  } catch (error) {
    console.warn("Admin user load timed out.", error);
    return [];
  }
}

async function findUserByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return null;
  }
  try {
    const snapshot = await withTimeout(
      getDocs(query(collection(db, "users"), where("email", "==", normalized))),
    );
    return snapshot.docs[0] ? normalizeOpportunity(snapshot.docs[0]) : null;
  } catch (error) {
    console.warn("User email lookup failed.", error);
    return null;
  }
}

async function loadUserProfileByUid(uid) {
  if (!uid) {
    return null;
  }
  try {
    const snapshot = await withTimeout(getDoc(doc(db, "users", uid)));
    if (!snapshot.exists()) {
      return null;
    }
    return {
      id: snapshot.id,
      ...snapshot.data(),
    };
  } catch (error) {
    console.warn("Profile load timed out.", error);
    return null;
  }
}

async function loadFollowCollection(uid, collectionName) {
  if (!uid) {
    return [];
  }
  try {
    const snapshot = await withTimeout(getDocs(collection(db, "users", uid, collectionName)));
    return snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    }));
  } catch (error) {
    console.warn(`${collectionName} load timed out.`, error);
    return [];
  }
}

async function loadFollowCounts(uid) {
  const [followers, following] = await Promise.all([
    loadFollowCollection(uid, "followers"),
    loadFollowCollection(uid, "following"),
  ]);
  return {
    followersCount: followers.length,
    followingCount: following.length,
  };
}

async function loadFollowingIds(uid) {
  const items = await loadFollowCollection(uid, "following");
  return new Set(items.map((item) => item.id));
}

async function isFollowingUser(uid, targetUid) {
  if (!uid || !targetUid || uid === targetUid) {
    return false;
  }
  try {
    const snapshot = await withTimeout(getDoc(doc(db, "users", uid, "following", targetUid)));
    return snapshot.exists();
  } catch (error) {
    console.warn("Follow state load timed out.", error);
    return false;
  }
}

async function setFollowState(user, currentProfile, targetProfile, shouldFollow) {
  if (!user?.uid || !targetProfile?.id || user.uid === targetProfile.id) {
    throw new Error("You can only follow other users.");
  }

  const followingRef = doc(db, "users", user.uid, "following", targetProfile.id);
  const followerRef = doc(db, "users", targetProfile.id, "followers", user.uid);
  const now = Timestamp.now();
  let changed = false;

  await runTransaction(db, async (transaction) => {
    const currentFollow = await transaction.get(followingRef);
    if (shouldFollow) {
      if (currentFollow.exists()) {
        return;
      }
      transaction.set(followingRef, {
        uid: targetProfile.id,
        displayName: profileDisplayName(targetProfile),
        username: targetProfile.username || "",
        photoURL: targetProfile.photoURL || DEFAULT_AVATAR,
        createdAt: now,
      });
      transaction.set(followerRef, {
        uid: user.uid,
        displayName: profileDisplayName(currentProfile),
        username: currentProfile.username || "",
        photoURL: currentProfile.photoURL || DEFAULT_AVATAR,
        createdAt: now,
      });
      changed = true;
      return;
    }
    if (!currentFollow.exists()) {
      return;
    }
    transaction.delete(followingRef);
    transaction.delete(followerRef);
    changed = true;
  });

  if (changed && shouldFollow) {
    await createNotification(targetProfile.id, {
      type: "follow",
      title: "New follower",
      body: `${profileDisplayName(currentProfile)} started following you.`,
      profileUid: user.uid,
    }).catch((error) => {
      console.warn("Follow notification failed.", error);
    });
  }

  return changed;
}

async function loadOpportunity(opportunityId, options = {}) {
  const requestedId = opportunityId || DEMO_OPPORTUNITIES[0].id;
  const fallbackDemo = (await ensureDemoData()).find((item) => item.id === requestedId);
  try {
    const snapshot = await withTimeout(getDoc(doc(db, "opportunities", requestedId)));
    if (snapshot.exists()) {
      return normalizeOpportunity(snapshot);
    }
  } catch (error) {
    console.warn("Opportunity load failed.", error);
  }
  if (fallbackDemo) {
    return fallbackDemo;
  }
  if (options.fallbackToFirstDemo !== false) {
    return (await ensureDemoData())[0] || null;
  }
  return null;
}

function normalizeComment(docSnapshot) {
  const data = docSnapshot.data();
  return {
    id: docSnapshot.id,
    ...data,
    parentId: data.parentId || null,
  };
}

function demoCommentsForOpportunity(opportunityId) {
  return (DEMO_COMMENTS[opportunityId] || []).map((item) => ({
    ...item,
    seeded: true,
    parentId: item.parentId || null,
  }));
}

async function loadOpportunityComments(opportunityId) {
  if (!opportunityId) {
    return [];
  }
  try {
    const snapshot = await withTimeout(
      getDocs(query(collection(db, "opportunities", opportunityId, "comments"), orderBy("createdAt", "asc"))),
    );
    const items = snapshot.docs.map(normalizeComment);
    return items.length || !opportunityId.startsWith("demo-")
      ? items
      : demoCommentsForOpportunity(opportunityId);
  } catch (error) {
    console.warn("Comment load failed.", error);
    return demoCommentsForOpportunity(opportunityId);
  }
}

async function loadUserStates(uid) {
  let statesSnapshot;
  try {
    statesSnapshot = await withTimeout(getDocs(collection(db, "users", uid, "states")));
  } catch (error) {
    console.warn("State load timed out.", error);
    return new Map();
  }
  const states = new Map();
  statesSnapshot.forEach((item) => {
    states.set(item.id, item.data());
  });
  return states;
}

async function loadUserNotifications(uid) {
  let notificationsSnapshot;
  try {
    notificationsSnapshot = await withTimeout(
      getDocs(query(collection(db, "users", uid, "notifications"), orderBy("createdAt", "desc"))),
    );
  } catch (error) {
    console.warn("Notification load timed out.", error);
    return [];
  }
  return notificationsSnapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  }));
}

async function loadUnreadNotifications(uid) {
  if (!uid) {
    return [];
  }
  try {
    const snapshot = await withTimeout(
      getDocs(query(collection(db, "users", uid, "notifications"), where("read", "==", false))),
    );
    return snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    }));
  } catch (error) {
    console.warn("Unread notification load timed out.", error);
    return [];
  }
}

async function markNotificationsRead(uid, notificationIds = []) {
  if (!uid || !notificationIds.length) {
    return;
  }
  await Promise.all(
    notificationIds.map((notificationId) => updateDoc(
      doc(db, "users", uid, "notifications", notificationId),
      {
        read: true,
      },
    )),
  );
}

function paintInboxNavIndicator(hasUnread) {
  qsa("[data-nav-inbox]").forEach((link) => {
    link.classList.add("relative");
    let dot = qs("[data-inbox-dot]", link);
    if (!dot) {
      dot = document.createElement("span");
      dot.dataset.inboxDot = "true";
      dot.className = "hidden absolute top-1 right-3 w-2.5 h-2.5 rounded-full bg-emerald-400 border border-slate-950 shadow-[0_0_10px_rgba(16,185,129,0.65)]";
      link.appendChild(dot);
    }
    dot.classList.toggle("hidden", !hasUnread);
  });
}

async function refreshInboxNavIndicator(user, options = {}) {
  if (!user?.uid) {
    paintInboxNavIndicator(false);
    return false;
  }
  const unreadItems = Array.isArray(options.unreadItems)
    ? options.unreadItems
    : await loadUnreadNotifications(user.uid);
  const hasUnread = unreadItems.some((item) => item.read === false);
  paintInboxNavIndicator(hasUnread);
  return hasUnread;
}

async function createNotification(uid, payload) {
  if (!uid) {
    return;
  }
  await addDoc(collection(db, "users", uid, "notifications"), {
    ...payload,
    read: false,
    createdAt: Timestamp.now(),
  });
}

function notificationDestination(item) {
  if (!item) {
    return "";
  }
  if (item.type === "follow" && item.profileUid) {
    return profileUrl(item.profileUid);
  }
  if (item.type === "admin-granted") {
    return "admin-moderation.html";
  }
  if ((item.type === "comment" || item.type === "comment-reply") && item.opportunityId) {
    return commentsUrl(item.opportunityId);
  }
  if (item.opportunityId) {
    return detailsUrl(item.opportunityId);
  }
  if (item.profileUid) {
    return profileUrl(item.profileUid);
  }
  return "";
}

function notificationIcon(item) {
  if (item?.type === "follow") {
    return "person_add";
  }
  if (item?.type?.includes("application")) {
    return "task_alt";
  }
  if (item?.type === "comment" || item?.type === "comment-reply") {
    return "chat_bubble";
  }
  if (item?.type === "admin-granted") {
    return "shield_person";
  }
  if (item?.type === "moderation-approved") {
    return "verified";
  }
  if (item?.type === "moderation-archived") {
    return "inventory_2";
  }
  return "notifications";
}

function isOpportunityPoster(opportunity, comment) {
  if (!opportunity || !comment) {
    return false;
  }
  if (opportunity.creatorUid && comment.authorUid) {
    return opportunity.creatorUid === comment.authorUid;
  }
  return Boolean(
    opportunity.creatorHandle
    && comment.authorHandle
    && opportunity.creatorHandle === comment.authorHandle,
  );
}

function commentIsDeleted(comment) {
  return Boolean(comment?.deletedAt);
}

function commentWasEdited(comment) {
  if (!comment || commentIsDeleted(comment)) {
    return false;
  }
  const created = toDate(comment.createdAt)?.getTime() || 0;
  const updated = toDate(comment.updatedAt)?.getTime() || 0;
  return updated > created + 1000;
}

function canManageComment(comment, user, profile, opportunity) {
  if (!comment || !user || !profile || opportunity?.seeded) {
    return false;
  }
  return profile.role === "admin" || comment.authorUid === user.uid;
}

function expandReplyLineage(commentId, comments, expandedReplyIds) {
  let currentId = commentId;
  while (currentId) {
    expandedReplyIds.add(currentId);
    const current = comments.find((item) => item.id === currentId);
    currentId = current?.parentId || null;
  }
}

function commentDescendantIds(commentId, comments) {
  const childrenByParent = new Map();
  comments.forEach((comment) => {
    if (!comment.parentId) {
      return;
    }
    if (!childrenByParent.has(comment.parentId)) {
      childrenByParent.set(comment.parentId, []);
    }
    childrenByParent.get(comment.parentId).push(comment.id);
  });

  const descendants = [];
  const stack = [...(childrenByParent.get(commentId) || [])];
  while (stack.length) {
    const nextId = stack.pop();
    descendants.push(nextId);
    stack.push(...(childrenByParent.get(nextId) || []));
  }
  return descendants;
}

async function createOpportunityComment(opportunity, user, profile, body, parentId = null) {
  if (!opportunity || !opportunity.id || opportunity.seeded) {
    throw new Error("Comments are not available for demo content.");
  }
  if (opportunity.allowComments === false) {
    throw new Error("Comments are turned off for this opportunity.");
  }
  const trimmedBody = String(body || "").trim();
  if (!trimmedBody) {
    throw new Error("Write a comment first.");
  }
  if (trimmedBody.length > MAX_COMMENT_LENGTH) {
    throw new Error(`Comments can be up to ${MAX_COMMENT_LENGTH} characters.`);
  }

  const opportunityRef = doc(db, "opportunities", opportunity.id);
  const commentsRef = collection(db, "opportunities", opportunity.id, "comments");
  const commentRef = doc(commentsRef);
  const now = Timestamp.now();
  const nextComment = {
    id: commentRef.id,
    authorUid: user.uid,
    authorName: profile.displayName || "Oval User",
    authorHandle: `@${profile.username || uniqueUsername(profile.displayName || user.email?.split("@")[0])}`,
    authorPhotoURL: profile.photoURL || DEFAULT_AVATAR,
    body: trimmedBody,
    parentId: parentId || null,
    createdAt: now,
    updatedAt: now,
  };
  let replyTarget = null;

  await runTransaction(db, async (transaction) => {
    const opportunitySnapshotRef = await transaction.get(opportunityRef);
    if (!opportunitySnapshotRef.exists()) {
      throw new Error("This opportunity is no longer available.");
    }

    const currentOpportunity = opportunitySnapshotRef.data();
    if (currentOpportunity.status !== "published") {
      throw new Error("Comments are not open on this post.");
    }
    if (currentOpportunity.allowComments === false) {
      throw new Error("Comments are turned off for this opportunity.");
    }

    if (parentId) {
      const parentRef = doc(db, "opportunities", opportunity.id, "comments", parentId);
      const parentSnapshot = await transaction.get(parentRef);
      if (!parentSnapshot.exists()) {
        throw new Error("The comment you replied to no longer exists.");
      }
      replyTarget = {
        id: parentSnapshot.id,
        ...parentSnapshot.data(),
      };
    }

    transaction.set(commentRef, {
      authorUid: nextComment.authorUid,
      authorName: nextComment.authorName,
      authorHandle: nextComment.authorHandle,
      authorPhotoURL: nextComment.authorPhotoURL,
      body: nextComment.body,
      parentId: nextComment.parentId,
      createdAt: now,
      updatedAt: now,
    });
    transaction.update(opportunityRef, {
      commentsCount: Math.max(Number(currentOpportunity.commentsCount || 0) + 1, 1),
      updatedAt: now,
    });
  });

  if (opportunity.creatorUid && opportunity.creatorUid !== user.uid) {
    await createNotification(opportunity.creatorUid, {
      type: "comment",
      title: "New comment on your post",
      body: `${profile.displayName || "Someone"} commented on ${opportunity.title}.`,
      opportunityId: opportunity.id,
    }).catch((error) => {
      console.warn("Creator comment notification failed.", error);
    });
  }

  if (
    replyTarget?.authorUid
    && replyTarget.authorUid !== user.uid
    && replyTarget.authorUid !== opportunity.creatorUid
  ) {
    await createNotification(replyTarget.authorUid, {
      type: "comment-reply",
      title: "New reply to your comment",
      body: `${profile.displayName || "Someone"} replied on ${opportunity.title}.`,
      opportunityId: opportunity.id,
    }).catch((error) => {
      console.warn("Reply notification failed.", error);
    });
  }

  return nextComment;
}

async function updateOpportunityComment(opportunity, comment, body) {
  if (!opportunity || !opportunity.id || opportunity.seeded) {
    throw new Error("Comments are not available for demo content.");
  }
  if (!comment || !comment.id) {
    throw new Error("Comment not found.");
  }
  if (commentIsDeleted(comment)) {
    throw new Error("Deleted comments cannot be edited.");
  }
  const trimmedBody = String(body || "").trim();
  if (!trimmedBody) {
    throw new Error("Write a comment first.");
  }
  if (trimmedBody.length > MAX_COMMENT_LENGTH) {
    throw new Error(`Comments can be up to ${MAX_COMMENT_LENGTH} characters.`);
  }

  const updatedAt = Timestamp.now();
  await updateDoc(doc(db, "opportunities", opportunity.id, "comments", comment.id), {
    body: trimmedBody,
    updatedAt,
  });
  return {
    ...comment,
    body: trimmedBody,
    updatedAt,
  };
}

async function deleteOpportunityComment(opportunity, comment, comments) {
  if (!opportunity || !opportunity.id || opportunity.seeded) {
    throw new Error("Comments are not available for demo content.");
  }
  if (!comment || !comment.id) {
    throw new Error("Comment not found.");
  }
  if (commentIsDeleted(comment)) {
    throw new Error("This comment has already been deleted.");
  }

  const descendants = commentDescendantIds(comment.id, comments);
  const commentRef = doc(db, "opportunities", opportunity.id, "comments", comment.id);

  if (descendants.length) {
    const deletedAt = Timestamp.now();
    await updateDoc(commentRef, {
      body: "",
      deletedAt,
      updatedAt: deletedAt,
    });
    return {
      mode: "soft",
      updatedComment: {
        ...comment,
        body: "",
        deletedAt,
        updatedAt: deletedAt,
      },
    };
  }

  const opportunityRef = doc(db, "opportunities", opportunity.id);
  await runTransaction(db, async (transaction) => {
    const opportunitySnapshotRef = await transaction.get(opportunityRef);
    const commentSnapshotRef = await transaction.get(commentRef);
    if (!opportunitySnapshotRef.exists() || !commentSnapshotRef.exists()) {
      throw new Error("That comment is no longer available.");
    }
    const nextCount = Math.max(Number(opportunitySnapshotRef.data()?.commentsCount || 0) - 1, 0);
    transaction.delete(commentRef);
    transaction.update(opportunityRef, {
      commentsCount: nextCount,
      updatedAt: Timestamp.now(),
    });
  });

  return {
    mode: "hard",
    removedIds: [comment.id],
  };
}

async function requireUserForAction() {
  const user = auth.currentUser || (await withTimeout(authReady, 1500).catch(() => null));
  if (user) {
    return user;
  }
  setPendingReturnTo();
  location.href = `sign-in-email.html?returnTo=${encodeURIComponent(toRelativePath())}`;
  throw new Error("Authentication required");
}

async function uploadFile(file, folder, uid) {
  const fileName = `${Date.now()}-${slugify(String(file.name || "file").replace(/\.[^.]+$/, "")) || "file"}${fileExtension(file)}`;
  const storageRef = ref(storage, `${folder}/${uid}/${fileName}`);
  try {
    await uploadBytes(
      storageRef,
      file,
      file.type ? { contentType: file.type } : undefined,
    );
    return {
      name: file.name || fileName,
      url: await getDownloadURL(storageRef),
      kind: file.type || "file",
    };
  } catch (error) {
    if (error?.code === "storage/unauthorized") {
      throw new Error("Media upload is blocked by Firebase Storage rules. Deploy storage.rules and make sure the user is signed in.");
    }
    throw new Error(error?.message || "Media upload failed.");
  }
}

function redirectAfterAuth(profile) {
  const defaultPath = profile?.role === "admin" ? "admin-moderation.html" : "feed.html";
  const target = getPendingReturnTo(defaultPath);
  clearPendingReturnTo();
  location.href = target;
}

function applySkipLinks(root = document) {
  const allowedPublicPages = new Set(["feed.html", "details.html", "search.html"]);
  const requestedTarget = getPendingReturnTo("feed.html");
  const pageName = requestedTarget.split("?")[0].split("/").pop() || "feed.html";
  const target = allowedPublicPages.has(pageName) ? requestedTarget : "feed.html";

  qsa("[data-skip-link]", root).forEach((link) => {
    link.setAttribute("href", target);
    link.addEventListener("click", () => {
      clearPendingReturnTo();
    });
  });
}

async function initOnboarding(user, profile) {
  if (user && profile) {
    redirectAfterAuth(profile);
    return;
  }
  applySkipLinks(document);
  qsa("[data-auth-link]").forEach((link) => {
    link.addEventListener("click", () => {
      setPendingReturnTo(getPendingReturnTo("feed.html"));
    });
  });
  bindGoogleAuth();
}

async function initEmailAuth(user, profile) {
  if (user && profile) {
    redirectAfterAuth(profile);
    return;
  }

  applySkipLinks(document);
  qsa("[data-google-onboarding-link]").forEach((link) => {
    const target = getPendingReturnTo("feed.html");
    link.href = `onboarding.html?returnTo=${encodeURIComponent(target)}`;
    link.addEventListener("click", () => {
      setPendingReturnTo(target);
    });
  });
  const form = qs("#emailAuthForm");
  const modeButtons = qsa("[data-auth-mode]");
  const createOnly = qsa("[data-create-only]");
  const title = qs("#emailAuthTitle");
  const subtitle = qs("#emailAuthSubtitle");
  const submit = qs("#emailAuthSubmit");
  const status = qs("#emailAuthStatus");
  let mode = "signin";

  function paint() {
    const isCreate = mode === "create";
    modeButtons.forEach((button) => {
      button.className = button.dataset.authMode === mode
        ? "px-4 py-2 rounded-full bg-white text-black text-sm font-semibold"
        : "px-4 py-2 rounded-full bg-white/10 text-white text-sm font-semibold border border-white/10";
    });
    createOnly.forEach((field) => {
      field.classList.toggle("hidden", !isCreate);
    });
    title.textContent = isCreate ? "Create your account" : "Sign in with email";
    subtitle.textContent = isCreate
      ? "Create your Oval account with email and password."
      : "Access saved posts, applied opportunities, and posting tools.";
    submit.textContent = isCreate ? "Create account" : "Sign in";
  }

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      mode = button.dataset.authMode;
      paint();
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus(status, "");
    submit.disabled = true;

    const formData = new FormData(form);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "").trim();
    const displayName = String(formData.get("displayName") || "").trim();

    try {
      if (mode === "create") {
        if (!displayName) {
          throw new Error("Display name is required.");
        }
        if (password.length < 6) {
          throw new Error("Password must be at least 6 characters.");
        }
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(credential.user, { displayName });
        const nextProfile = await ensureUserProfile(credential.user, { displayName });
        redirectAfterAuth(nextProfile);
        return;
      }

      const credential = await signInWithEmailAndPassword(auth, email, password);
      const nextProfile = await ensureUserProfile(credential.user);
      redirectAfterAuth(nextProfile);
    } catch (error) {
      console.error(error);
      setStatus(status, error.message || "Authentication failed.", "error");
    } finally {
      submit.disabled = false;
    }
  });

  paint();
}

function bindGoogleAuth() {
  const button = qs("#googleContinue");
  const status = qs("#googleStatus");
  if (!button || button.dataset.authBound === "1") {
    return;
  }
  button.dataset.authBound = "1";

  button.addEventListener("click", async () => {
    button.disabled = true;
    setStatus(status, "");
    try {
      const credential = await signInWithPopup(auth, googleProvider);
      const nextProfile = await ensureUserProfile(credential.user);
      redirectAfterAuth(nextProfile);
    } catch (error) {
      console.error(error);
      setStatus(status, error.message || "Google sign-in failed.", "error");
    } finally {
      button.disabled = false;
    }
  });
}

function applyNavForRole(profile) {
  qsa("[data-create-nav]").forEach((node) => {
    node.href = "create-post.html";
  });
}

async function refreshStates(user) {
  if (!user) {
    return new Map();
  }
  return loadUserStates(user.uid);
}

async function updateSavedState(opportunity, desiredSaved) {
  const user = await requireUserForAction();
  const stateRef = doc(db, "users", user.uid, "states", opportunity.id);
  const opportunityRef = doc(db, "opportunities", opportunity.id);

  await runTransaction(db, async (transaction) => {
    const stateSnapshot = await transaction.get(stateRef);
    const opportunitySnapshotRef = await transaction.get(opportunityRef);
    const current = stateSnapshot.exists() ? stateSnapshot.data() : {};
    const currentSaved = Boolean(current.saved);
    if (currentSaved === desiredSaved) {
      return;
    }
    transaction.set(
      stateRef,
      {
        ...opportunitySnapshot(opportunity),
        saved: desiredSaved,
        applied: Boolean(current.applied),
        liked: Boolean(current.liked),
        createdAt: current.createdAt || Timestamp.now(),
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
    if (opportunitySnapshotRef.exists()) {
      const nextSaves = Math.max((opportunitySnapshotRef.data()?.savesCount || 0) + (desiredSaved ? 1 : -1), 0);
      transaction.update(opportunityRef, {
        savesCount: nextSaves,
        updatedAt: Timestamp.now(),
      });
    }
  });
}

async function updateAppliedState(opportunity, desiredApplied) {
  const user = await requireUserForAction();
  const stateRef = doc(db, "users", user.uid, "states", opportunity.id);
  const opportunityRef = doc(db, "opportunities", opportunity.id);

  await runTransaction(db, async (transaction) => {
    const stateSnapshot = await transaction.get(stateRef);
    const opportunitySnapshotRef = await transaction.get(opportunityRef);
    const current = stateSnapshot.exists() ? stateSnapshot.data() : {};
    const currentApplied = Boolean(current.applied);
    if (currentApplied === desiredApplied) {
      return;
    }
    transaction.set(
      stateRef,
      {
        ...opportunitySnapshot(opportunity),
        saved: Boolean(current.saved),
        applied: desiredApplied,
        liked: Boolean(current.liked),
        appliedAt: desiredApplied ? Timestamp.now() : null,
        createdAt: current.createdAt || Timestamp.now(),
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
    if (opportunitySnapshotRef.exists()) {
      const nextApplied = Math.max((opportunitySnapshotRef.data()?.appliedCount || 0) + (desiredApplied ? 1 : -1), 0);
      transaction.update(opportunityRef, {
        appliedCount: nextApplied,
        updatedAt: Timestamp.now(),
      });
    }
  });

  if (desiredApplied) {
    await createNotification(user.uid, {
      type: "application",
      title: "Application marked as submitted",
      body: `You marked ${opportunity.title} as applied.`,
      opportunityId: opportunity.id,
    });
  }
}

async function updateLikedState(opportunity, desiredLiked) {
  const user = await requireUserForAction();
  const stateRef = doc(db, "users", user.uid, "states", opportunity.id);
  const opportunityRef = doc(db, "opportunities", opportunity.id);

  await runTransaction(db, async (transaction) => {
    const stateSnapshot = await transaction.get(stateRef);
    const opportunitySnapshotRef = await transaction.get(opportunityRef);
    const current = stateSnapshot.exists() ? stateSnapshot.data() : {};
    const currentLiked = Boolean(current.liked);
    if (currentLiked === desiredLiked) {
      return;
    }
    transaction.set(
      stateRef,
      {
        ...opportunitySnapshot(opportunity),
        saved: Boolean(current.saved),
        applied: Boolean(current.applied),
        liked: desiredLiked,
        createdAt: current.createdAt || Timestamp.now(),
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
    if (opportunitySnapshotRef.exists()) {
      const nextLikes = Math.max((opportunitySnapshotRef.data()?.likesCount || 0) + (desiredLiked ? 1 : -1), 0);
      transaction.update(opportunityRef, {
        likesCount: nextLikes,
        updatedAt: Timestamp.now(),
      });
    }
  });
}

async function recordView(opportunityId) {
  const storageKey = `oval.viewed.${opportunityId}`;
  if (sessionStorage.getItem(storageKey)) {
    return;
  }
  sessionStorage.setItem(storageKey, "1");
  try {
    await runTransaction(db, async (transaction) => {
      const opportunityRef = doc(db, "opportunities", opportunityId);
      const opportunitySnapshotRef = await transaction.get(opportunityRef);
      if (!opportunitySnapshotRef.exists()) {
        return;
      }
      const nextViews = (opportunitySnapshotRef.data()?.viewsCount || 0) + 1;
      transaction.update(opportunityRef, {
        viewsCount: nextViews,
      });
    });
  } catch (error) {
    console.error("View tracking failed", error);
  }
}

function renderOpportunityListCard(opportunity, state = {}, options = {}) {
  const opportunityStatus = statusMeta(opportunity.status);
  const creatorHref = opportunity.creatorUid ? profileUrl(opportunity.creatorUid) : "";
  const creatorLabel = escapeHtml(opportunity.creatorHandle || opportunity.creatorName || "Oval Creator");
  const actions = options.showActions
    ? `
      <div class="mt-4 flex flex-wrap gap-2">
        ${options.showDetails !== false ? `<a href="${detailsUrl(opportunity.id)}" class="px-4 py-2 rounded-xl bg-white text-black text-sm font-semibold">Details</a>` : ""}
        ${options.showApply ? `<button type="button" class="px-4 py-2 rounded-xl bg-white text-black text-sm font-semibold" data-action="apply" data-id="${escapeHtml(opportunity.id)}">Visit Website</button>` : ""}
        ${options.showApplied ? `<button type="button" class="px-4 py-2 rounded-xl bg-white/10 text-white text-sm font-semibold border border-white/10" data-action="toggle-applied" data-id="${escapeHtml(opportunity.id)}">${state.applied ? "Applied" : "Mark Applied"}</button>` : ""}
        ${options.showSave ? `<button type="button" class="px-4 py-2 rounded-xl bg-white/10 text-white text-sm font-semibold border border-white/10" data-action="toggle-save" data-id="${escapeHtml(opportunity.id)}">${state.saved ? "Saved" : "Save"}</button>` : ""}
        ${options.showRemove ? `<button type="button" class="px-4 py-2 rounded-xl bg-white/10 text-white text-sm font-semibold border border-white/10" data-action="remove-save" data-id="${escapeHtml(opportunity.id)}">Remove</button>` : ""}
      </div>
    `
    : "";

  return `
    <div class="rounded-3xl bg-white/5 border border-white/10 p-4">
      <div class="flex items-start gap-3">
        ${renderOpportunityMedia(opportunity, "w-16 h-16 rounded-2xl object-cover", { muted: true, loop: true, autoplay: true })}
        <div class="flex-1">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="font-semibold">${escapeHtml(opportunity.title)}</h3>
              ${creatorHref
    ? `<a href="${creatorHref}" class="text-sm text-white/60 hover:text-white transition">${creatorLabel}</a>`
    : `<p class="text-sm text-white/60">${creatorLabel}</p>`}
            </div>
            <div class="flex flex-col items-end gap-2">
              <span class="text-[10px] px-2 py-1 rounded-full bg-white text-black">${escapeHtml(opportunity.category)}</span>
              ${options.showStatus ? `<span class="text-[10px] px-2 py-1 rounded-full ${opportunityStatus.classes}">${escapeHtml(opportunityStatus.label)}</span>` : ""}
            </div>
          </div>
          <div class="flex flex-wrap gap-2 mt-3 text-[11px]">
            <span class="chip px-2.5 py-1 rounded-full">${escapeHtml(opportunity.locationLabel || "Remote")}</span>
            <span class="chip px-2.5 py-1 rounded-full">${escapeHtml(opportunity.payLabel || "Compensation listed")}</span>
            <span class="chip px-2.5 py-1 rounded-full">${escapeHtml(opportunity.workMode || "Flexible")}</span>
          </div>
          ${actions}
        </div>
      </div>
    </div>
  `;
}

function formatCommentCount(count) {
  const normalized = Math.max(0, Number(count || 0));
  return `${formatCompact(normalized)} ${normalized === 1 ? "comment" : "comments"}`;
}

function renderMultilineText(value) {
  return escapeHtml(String(value || "")).replace(/\r?\n/g, "<br>");
}

function renderCommentThread(comment, repliesByParent, opportunity, user, profile, canReply, expandedReplyIds, depth = 0) {
  const replies = repliesByParent.get(comment.id) || [];
  const deleted = commentIsDeleted(comment);
  const edited = commentWasEdited(comment);
  const expanded = expandedReplyIds.has(comment.id);
  const canManage = canManageComment(comment, user, profile, opportunity) && !deleted;
  const compactThread = depth >= 1;
  const deepThread = depth >= 3;
  const threadClass = "comment-thread";
  const rowClass = compactThread
    ? `comment-thread__row comment-thread__row--reply${deepThread ? " comment-thread__row--compact" : ""}`
    : "comment-thread__row";
  const avatarClass = compactThread
    ? `comment-thread__avatar comment-thread__avatar--reply${deepThread ? " comment-thread__avatar--compact" : ""}`
    : "comment-thread__avatar";
  const metaClass = compactThread
    ? `comment-thread__meta${deepThread ? " comment-thread__meta--compact" : ""}`
    : "comment-thread__meta";
  const actionsClass = compactThread
    ? `comment-thread__actions mt-3 flex items-center flex-wrap text-xs text-white/50${deepThread ? " comment-thread__actions--compact" : ""}`
    : "comment-thread__actions mt-3 flex items-center flex-wrap text-xs text-white/50";
  const repliesClass = compactThread
    ? `comment-thread__replies${deepThread ? " comment-thread__replies--compact" : ""}`
    : "comment-thread__replies";
  const authorHref = comment.authorUid ? profileUrl(comment.authorUid) : "";
  const authorHandle = escapeHtml(comment.authorHandle || `@${slugify(comment.authorName || "oval-user")}`);
  const badges = [];
  if (isOpportunityPoster(opportunity, comment)) {
    badges.push('<span class="text-[10px] px-2 py-1 rounded-full bg-white text-black">Poster</span>');
  }
  if (user?.uid && comment.authorUid === user.uid) {
    badges.push('<span class="text-[10px] px-2 py-1 rounded-full bg-white/10 border border-white/10 text-white/75">You</span>');
  }

  return `
    <article class="${threadClass}">
      <div class="flex ${rowClass}">
        ${authorHref
    ? `<a href="${authorHref}" class="shrink-0"><img src="${escapeHtml(comment.authorPhotoURL || DEFAULT_AVATAR)}" class="${avatarClass} rounded-full object-cover shrink-0" alt="${escapeHtml(comment.authorName || "Comment author")}"></a>`
    : `<img src="${escapeHtml(comment.authorPhotoURL || DEFAULT_AVATAR)}" class="${avatarClass} rounded-full object-cover shrink-0" alt="${escapeHtml(comment.authorName || "Comment author")}">`}
        <div class="comment-thread__content flex-1 min-w-0">
          <div class="${metaClass}">
            ${authorHref
    ? `<a href="${authorHref}" class="comment-thread__name text-sm font-semibold text-white/90 hover:text-white transition">${authorHandle}</a>`
    : `<p class="comment-thread__name text-sm font-semibold text-white/90">${authorHandle}</p>`}
            ${badges.join("")}
            <span class="comment-thread__timestamp text-xs text-white/40">${escapeHtml(formatRelativeDate(comment.createdAt) || "just now")}</span>
            ${edited ? '<span class="text-[11px] text-white/35 whitespace-nowrap">edited</span>' : ""}
          </div>
          <p class="comment-thread__body text-sm ${deleted ? "italic text-white/40" : "text-white/80"} mt-2 leading-6 break-words">${deleted ? "Comment deleted." : renderMultilineText(comment.body)}</p>
          ${(replies.length || canReply || canManage) ? `
            <div class="${actionsClass}">
              ${replies.length ? `
                <button type="button" class="inline-flex items-center gap-1 hover:text-white transition" data-toggle-replies="${escapeHtml(comment.id)}">
                  <span class="material-symbols-outlined text-[14px] leading-none">${expanded ? "expand_more" : "chevron_right"}</span>
                  <span>${expanded ? "Hide" : "Show"} ${escapeHtml(String(replies.length))} ${replies.length === 1 ? "reply" : "replies"}</span>
                </button>
              ` : ""}
              ${canReply && !deleted ? `
                <button type="button" class="hover:text-white transition" data-reply-id="${escapeHtml(comment.id)}" data-reply-name="${authorHandle}">Reply</button>
              ` : ""}
              ${canManage ? `
                <button type="button" class="hover:text-white transition" data-edit-comment="${escapeHtml(comment.id)}">Edit</button>
                <button type="button" class="hover:text-red-200 transition" data-delete-comment="${escapeHtml(comment.id)}">Delete</button>
              ` : ""}
            </div>
          ` : ""}
        </div>
      </div>
      ${replies.length && expanded ? `
        <div class="${repliesClass}">
          ${replies.map((reply) => renderCommentThread(reply, repliesByParent, opportunity, user, profile, canReply, expandedReplyIds, depth + 1)).join("")}
        </div>
      ` : ""}
    </article>
  `;
}

function paintSaveActionButton(button, saved) {
  if (button.closest("#feedSlides")) {
    button.innerHTML = `
      <span class="material-symbols-outlined text-[30px]">${saved ? "bookmark" : "bookmark_add"}</span>
      <span class="text-xs mt-1">${saved ? "Saved" : "Save"}</span>
    `;
    return;
  }
  button.textContent = saved ? "Saved" : "Save";
}

function paintAppliedActionButton(button, applied) {
  button.textContent = applied ? "Applied" : "Mark Applied";
}

function paintLikeActionButton(button, liked, likesCount) {
  if (!button) {
    return;
  }
  button.innerHTML = `
    <span class="material-symbols-outlined text-[30px]">${liked ? "favorite" : "favorite_border"}</span>
    <span class="text-xs mt-1">${escapeHtml(formatCompact(likesCount || 0))}</span>
  `;
}

function paintVideoAudioButton(button, muted) {
  if (!button) {
    return;
  }
  const icon = qs("[data-audio-icon]", button);
  const label = qs("[data-audio-label]", button);
  if (icon) {
    icon.textContent = muted ? "volume_off" : "volume_up";
  }
  if (label) {
    label.textContent = muted ? "Sound" : "Mute";
  }
}

function opportunityActionButtons(container, action, opportunityId) {
  return qsa(`[data-action="${action}"]`, container)
    .filter((node) => node.dataset.id === opportunityId);
}

function syncFeedVideoAudioButton(section, muted) {
  paintVideoAudioButton(qs("[data-video-audio-button]", section), muted);
}

function muteOtherFeedVideos(container, activeVideo) {
  qsa("video", container).forEach((video) => {
    if (video === activeVideo) {
      return;
    }
    video.muted = true;
  });
}

function renderFeedSlide(opportunity, state = {}) {
  const showAudioToggle = isVideoKind(opportunityMediaKind(opportunity));
  const muted = getFeedVideoMutedPreference();
  const creatorHref = opportunity.creatorUid ? profileUrl(opportunity.creatorUid) : "";
  const creatorName = escapeHtml(opportunity.creatorName || "Oval Creator");
  const creatorLabel = escapeHtml(opportunity.creatorHandle || opportunity.creatorName || "Oval Creator");
  return `
    <section class="relative min-h-screen snap-start" data-opportunity-id="${escapeHtml(opportunity.id)}">
      <div class="absolute inset-0 pointer-events-none">
        ${renderOpportunityMedia(opportunity, "w-full h-full object-cover", { muted, loop: true, autoplay: true })}
        <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/45"></div>
      </div>
      <div class="relative min-h-screen px-4">
        <div class="absolute right-3 z-[32] flex flex-col items-center gap-5 pointer-events-auto safe-feed-rail">
          ${creatorHref
    ? `<a href="${creatorHref}" class="flex flex-col items-center">
            <img src="${escapeHtml(creatorAvatar(opportunity))}" class="w-12 h-12 rounded-full border-2 border-white object-cover" alt="${creatorName}">
          </a>`
    : `<div class="flex flex-col items-center">
            <img src="${escapeHtml(creatorAvatar(opportunity))}" class="w-12 h-12 rounded-full border-2 border-white object-cover" alt="${creatorName}">
          </div>`}
          <button type="button" class="flex flex-col items-center" data-action="toggle-like" data-id="${escapeHtml(opportunity.id)}">
            <span class="material-symbols-outlined text-[30px]">${state.liked ? "favorite" : "favorite_border"}</span>
            <span class="text-xs mt-1">${escapeHtml(formatCompact(opportunity.likesCount || 0))}</span>
          </button>
          <a href="${commentsUrl(opportunity.id)}" class="flex flex-col items-center">
            <span class="material-symbols-outlined text-[30px]">chat_bubble</span>
            <span class="text-xs mt-1">${escapeHtml(formatCompact(opportunity.commentsCount || 0))}</span>
          </a>
          <button type="button" class="flex flex-col items-center" data-share-id="${escapeHtml(opportunity.id)}">
            <span class="material-symbols-outlined text-[30px]">send</span>
            <span class="text-xs mt-1">Share</span>
          </button>
          <button type="button" class="flex flex-col items-center" data-action="toggle-save" data-id="${escapeHtml(opportunity.id)}">
            <span class="material-symbols-outlined text-[30px]">${state.saved ? "bookmark" : "bookmark_add"}</span>
            <span class="text-xs mt-1">${state.saved ? "Saved" : "Save"}</span>
          </button>
          ${showAudioToggle ? `
            <button type="button" class="flex flex-col items-center" data-action="toggle-video-audio" data-id="${escapeHtml(opportunity.id)}" data-video-audio-button>
              <span class="material-symbols-outlined text-[30px]" data-audio-icon>${muted ? "volume_off" : "volume_up"}</span>
              <span class="text-xs mt-1" data-audio-label>${muted ? "Sound" : "Mute"}</span>
            </button>
          ` : ""}
        </div>
        <div class="absolute left-0 right-0 z-20 px-4 pointer-events-none safe-feed-content">
          <div class="max-w-[78%] pointer-events-auto">
            <div class="flex items-center gap-2 mb-3 flex-wrap">
              <span class="chip text-[11px] px-2.5 py-1 rounded-full">${escapeHtml(opportunity.payLabel)}</span>
              <span class="chip text-[11px] px-2.5 py-1 rounded-full">${escapeHtml(opportunity.workMode)}</span>
              <span class="chip text-[11px] px-2.5 py-1 rounded-full">${escapeHtml(opportunity.category)}</span>
            </div>
            ${creatorHref
    ? `<a href="${creatorHref}" class="font-semibold text-sm hover:text-white transition">${creatorLabel}</a>`
    : `<p class="font-semibold text-sm">${creatorLabel}</p>`}
            <p class="text-sm mt-2 leading-5">
              ${escapeHtml(truncateText(opportunity.caption, FEED_CAPTION_LENGTH))}
            </p>
            <div class="mt-3 flex items-center gap-2 text-xs text-white/80">
              <span class="material-symbols-outlined text-[16px]">location_on</span>
              <span>${escapeHtml(opportunity.locationLabel)}</span>
            </div>
            <div class="mt-4 flex gap-3">
              <a href="${detailsUrl(opportunity.id)}" class="px-4 py-2 rounded-xl bg-white text-black text-sm font-semibold">View Details</a>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "readonly");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(input);
  if (!copied) {
    throw new Error("Copy not supported");
  }
}

async function bindOpportunityActionButtons(container, opportunities, states, user, statusTarget) {
  container.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) {
      return;
    }
    const opportunity = opportunities.find((item) => item.id === button.dataset.id);
    if (!opportunity) {
      return;
    }

    const action = button.dataset.action;
    try {
      if (action === "apply") {
        if (opportunity.applyUrl) {
          window.open(opportunity.applyUrl, "_blank", "noopener,noreferrer");
          setStatus(statusTarget, "Website opened. Mark it as applied when you finish.", "success");
        }
        return;
      }

      if (action === "toggle-save") {
        const current = states.get(opportunity.id) || {};
        await updateSavedState(opportunity, !current.saved);
        const nextState = {
          ...current,
          ...opportunitySnapshot(opportunity),
          saved: !current.saved,
          liked: Boolean(current.liked),
        };
        states.set(opportunity.id, nextState);
        const targetButtons = button.closest("#feedSlides")
          ? opportunityActionButtons(container, "toggle-save", opportunity.id)
          : [button];
        targetButtons.forEach((targetButton) => {
          paintSaveActionButton(targetButton, !current.saved);
        });
        window.dispatchEvent(new CustomEvent("oval:state-changed", { detail: { opportunityId: opportunity.id, state: nextState } }));
        setStatus(statusTarget, current.saved ? "Removed from saved." : "Saved for later.", "success");
        return;
      }

      if (action === "toggle-like") {
        const current = states.get(opportunity.id) || {};
        const nextLiked = !current.liked;
        await updateLikedState(opportunity, nextLiked);
        opportunity.likesCount = Math.max(Number(opportunity.likesCount || 0) + (nextLiked ? 1 : -1), 0);
        const nextState = {
          ...current,
          ...opportunitySnapshot(opportunity),
          liked: nextLiked,
          saved: Boolean(current.saved),
          applied: Boolean(current.applied),
        };
        states.set(opportunity.id, nextState);
        const likeButtons = button.closest("#feedSlides")
          ? opportunityActionButtons(container, "toggle-like", opportunity.id)
          : [button];
        likeButtons.forEach((likeButton) => {
          paintLikeActionButton(likeButton, nextLiked, opportunity.likesCount);
        });
        setStatus(statusTarget, nextLiked ? "Added to likes." : "Removed from likes.", "success");
        return;
      }

      if (action === "remove-save") {
        const current = states.get(opportunity.id) || {};
        await updateSavedState(opportunity, false);
        states.set(opportunity.id, {
          ...current,
          ...opportunitySnapshot(opportunity),
          saved: false,
          liked: Boolean(current.liked),
        });
        window.dispatchEvent(new CustomEvent("oval:state-changed", { detail: { opportunityId: opportunity.id, state: states.get(opportunity.id) } }));
        button.closest(".rounded-3xl")?.remove();
        setStatus(statusTarget, "Removed from saved posts.", "success");
        return;
      }

      if (action === "toggle-applied") {
        const current = states.get(opportunity.id) || {};
        await updateAppliedState(opportunity, !current.applied);
        const nextState = {
          ...current,
          ...opportunitySnapshot(opportunity),
          applied: !current.applied,
          liked: Boolean(current.liked),
        };
        states.set(opportunity.id, nextState);
        paintAppliedActionButton(button, !current.applied);
        window.dispatchEvent(new CustomEvent("oval:state-changed", { detail: { opportunityId: opportunity.id, state: nextState } }));
        setStatus(
          statusTarget,
          current.applied ? "Removed from your applied list." : "Added to your applied list.",
          "success",
        );
        return;
      }

      if (action === "toggle-video-audio") {
        const section = button.closest("[data-opportunity-id]");
        const video = qs("video", section);
        if (!video) {
          return;
        }
        const nextMuted = !getFeedVideoMutedPreference();
        setFeedVideoMutedPreference(nextMuted);
        if (!nextMuted) {
          muteOtherFeedVideos(container, video);
        }
        qsa("[data-video-audio-button]", container).forEach((audioButton) => {
          paintVideoAudioButton(audioButton, nextMuted);
        });
        if (nextMuted) {
          qsa("video", container).forEach((feedVideo) => {
            feedVideo.muted = true;
          });
          return;
        }
        video.muted = false;
        video.play().catch(() => {
          video.muted = true;
          paintVideoAudioButton(button, true);
          setStatus(statusTarget, "Your browser blocked autoplay with sound. Tap Sound again after interacting with the page.", "info");
        });
      }
    } catch (error) {
      console.error(error);
      setStatus(statusTarget, error.message || "That action could not be completed.", "error");
    }
  });
}

async function initFeed(user) {
  const opportunities = await loadPublicOpportunities();
  const states = await refreshStates(user);
  const slides = qs("#feedSlides");
  const status = qs("#feedStatus");
  const modeButtons = qsa("[data-feed-mode]");
  let followingIds = user ? await loadFollowingIds(user.uid) : new Set();
  let activeMode = "for-you";
  let activeOpportunities = opportunities;

  if (!slides) {
    return;
  }

  let renderedCount = 0;

  function feedModeClass(mode) {
    return mode === activeMode
      ? "text-white border-b-2 border-white pb-1"
      : "text-white/60";
  }

  function paintModeButtons() {
    modeButtons.forEach((button) => {
      button.className = feedModeClass(button.dataset.feedMode);
    });
  }

  function selectedOpportunities() {
    if (activeMode !== "following") {
      return opportunities;
    }
    if (!user?.uid) {
      return [];
    }
    return opportunities.filter((item) => item.creatorUid && followingIds.has(item.creatorUid));
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const video = qs("video", entry.target);
        if (entry.isIntersecting) {
          const opportunityId = entry.target.dataset.opportunityId;
          if (opportunityId) {
            recordView(opportunityId);
          }
          if (video) {
            const muted = getFeedVideoMutedPreference();
            if (!muted) {
              muteOtherFeedVideos(slides, video);
            }
            video.muted = muted;
            syncFeedVideoAudioButton(entry.target, muted);
            video.play().catch(() => {
              if (!muted) {
                video.muted = true;
                syncFeedVideoAudioButton(entry.target, true);
              }
            });
          }
          const sections = Array.from(slides.children);
          const sectionIndex = sections.indexOf(entry.target);
          if (sectionIndex === sections.length - 1) {
            appendFeedBatch();
          }
          return;
        }
        if (video) {
          video.muted = true;
          video.pause();
        }
      });
    },
    { root: slides, threshold: 0.65 },
  );

  function appendFeedBatch() {
    if (!activeOpportunities.length) {
      return false;
    }
    const batch = Array.from({ length: FEED_BATCH_SIZE }, (_, index) => {
      const sourceIndex = (renderedCount + index) % activeOpportunities.length;
      return activeOpportunities[sourceIndex];
    });
    if (!batch.length) {
      return false;
    }
    const newMarkup = batch
      .map((opportunity) => renderFeedSlide(opportunity, states.get(opportunity.id) || {}))
      .join("");
    slides.insertAdjacentHTML("beforeend", newMarkup);
    Array.from(slides.children)
      .slice(-batch.length)
      .forEach((section) => observer.observe(section));
    renderedCount += batch.length;
    return true;
  }

  function ensureFeedBuffer() {
    let safety = 0;
    while (slides.scrollHeight - slides.clientHeight <= slides.clientHeight * 0.5 && safety < 3) {
      if (!appendFeedBatch()) {
        break;
      }
      safety += 1;
    }
  }

  function maybeAppendMore() {
    const remainingDistance = slides.scrollHeight - slides.scrollTop - slides.clientHeight;
    if (remainingDistance <= slides.clientHeight * 1.5) {
      appendFeedBatch();
    }
  }

  function renderFeedEmpty(message) {
    slides.innerHTML = `
      <section class="min-h-screen flex items-center justify-center px-6">
        <div class="rounded-3xl bg-white/5 border border-white/10 p-6 text-center max-w-sm">
          <h2 class="text-lg font-semibold">Nothing here yet</h2>
          <p class="text-sm text-white/60 mt-3">${escapeHtml(message)}</p>
        </div>
      </section>
    `;
  }

  function rebuildFeed() {
    Array.from(slides.children).forEach((section) => observer.unobserve(section));
    slides.innerHTML = "";
    renderedCount = 0;
    activeOpportunities = selectedOpportunities();
    paintModeButtons();
    setStatus(status, "");

    if (!opportunities.length) {
      renderFeedEmpty("New submissions will appear here after admin approval.");
      return;
    }
    if (!activeOpportunities.length) {
      renderFeedEmpty(
        activeMode === "following"
          ? user?.uid
            ? "Follow some creators to build your following feed."
            : "Sign in to see posts from accounts you follow."
          : "No live posts yet.",
      );
      return;
    }

    appendFeedBatch();
    ensureFeedBuffer();
  }

  await bindOpportunityActionButtons(slides, opportunities, states, user, status);

  modeButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const nextMode = button.dataset.feedMode || "for-you";
      if (nextMode === activeMode) {
        return;
      }
      if (nextMode === "following" && !user?.uid) {
        setStatus(status, "Sign in to see posts from accounts you follow.", "info");
        return;
      }
      if (nextMode === "following") {
        followingIds = await loadFollowingIds(user.uid);
      }
      activeMode = nextMode;
      rebuildFeed();
    });
  });

  slides.addEventListener("click", async (event) => {
    const shareButton = event.target.closest("[data-share-id]");
    if (!shareButton) {
      return;
    }
    const id = shareButton.dataset.shareId;
    const url = new URL(detailsUrl(id), location.href).href;
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Oval opportunity",
          url,
        });
      } else {
        await copyText(url);
        setStatus(status, "Link copied to clipboard.", "success");
      }
    } catch (error) {
      setStatus(
        status,
        error?.message === "Copy not supported"
          ? "Sharing is not supported on this device."
          : "Share cancelled.",
        "info",
      );
    }
  });
  slides.addEventListener("scroll", maybeAppendMore, { passive: true });
  paintModeButtons();
  rebuildFeed();
}

async function initDetails(user, profile) {
  const status = qs("#detailsStatus");
  const opportunityId = new URLSearchParams(location.search).get("id") || DEMO_OPPORTUNITIES[0].id;
  const opportunity = await loadOpportunity(opportunityId, { fallbackToFirstDemo: opportunityId.startsWith("demo-") });
  if (!opportunity) {
    const shell = qs(".phone");
    if (shell) {
      shell.innerHTML = `
        <div class="min-h-screen flex flex-col items-center justify-center px-6 text-center">
          <div class="rounded-3xl bg-white/5 border border-white/10 p-6 max-w-sm">
            <h1 class="text-xl font-semibold">Opportunity unavailable</h1>
            <p class="text-sm text-white/60 mt-3">This post is still pending review or is no longer available publicly.</p>
            <a href="feed.html" class="inline-flex mt-5 px-4 py-3 rounded-2xl bg-white text-black font-semibold">Back to feed</a>
          </div>
        </div>
      `;
    }
    return;
  }
  const states = await refreshStates(user);
  const state = states.get(opportunity.id) || {};

  if (opportunity.status === "published" || !opportunity.status) {
    recordView(opportunity.id);
  }

  setText("#detailsTitle", opportunity.title);
  setText("#detailsCreatorName", opportunity.creatorHandle || opportunity.creatorName);
  setText("#detailsLocation", opportunity.locationLabel);
  setText("#detailsWorkMode", opportunity.workMode);
  setText("#detailsCompensation", opportunity.payLabel);
  setText("#detailsDeadline", formatDate(opportunity.deadlineAt));
  setText("#detailsCaption", opportunity.caption);
  setText("#detailsAboutCompany", opportunity.aboutCompany);

  const cover = qs("#detailsCover");
  if (cover) {
    const isVideo = isVideoKind(opportunityMediaKind(opportunity));
    cover.innerHTML = renderOpportunityMedia(opportunity, "w-full h-full object-cover", {
      muted: false,
      loop: !isVideo,
      autoplay: false,
      controls: isVideo,
    });
  }
  const creatorImage = qs("#detailsCreatorAvatar");
  if (creatorImage) {
    creatorImage.src = creatorAvatar(opportunity);
    creatorImage.alt = opportunity.creatorName;
  }
  const creatorLink = qs("#detailsCreatorLink");
  if (creatorLink) {
    if (opportunity.creatorUid) {
      creatorLink.href = profileUrl(opportunity.creatorUid);
      creatorLink.classList.add("hover:text-white");
    } else {
      creatorLink.removeAttribute("href");
      creatorLink.classList.remove("hover:text-white");
    }
  }

  const chipRow = qs("#detailsChips");
  chipRow.innerHTML = [opportunity.payLabel, opportunity.workMode, opportunity.category]
    .map((value) => `<span class="chip text-[11px] px-2.5 py-1 rounded-full">${escapeHtml(value)}</span>`)
    .join("");

  const eligibility = qs("#detailsEligibility");
  eligibility.innerHTML = (opportunity.eligibility || [])
    .map(
      (value) => `
        <div class="glass rounded-2xl p-4 flex gap-3">
          <span class="material-symbols-outlined mt-0.5">bolt</span>
          <p class="text-sm text-white/80">${escapeHtml(value)}</p>
        </div>
      `,
    )
    .join("");

  const responsibilities = qs("#detailsResponsibilities");
  responsibilities.innerHTML = (opportunity.responsibilities || [])
    .map(
      (value) => `
        <div class="glass rounded-2xl p-4 flex gap-3">
          <span class="material-symbols-outlined mt-0.5">check_circle</span>
          <p class="text-sm text-white/80">${escapeHtml(value)}</p>
        </div>
      `,
    )
    .join("");

  const requirements = qs("#detailsRequirements");
  requirements.innerHTML = (opportunity.requirements || [])
    .map((value) => `<span class="chip px-3 py-2 rounded-full text-sm">${escapeHtml(value)}</span>`)
    .join("");

  const perks = qs("#detailsPerks");
  perks.innerHTML = (opportunity.perks || [])
    .map(
      (value) => `
        <div class="glass rounded-2xl p-4 flex items-center gap-3">
          <span class="material-symbols-outlined">workspace_premium</span>
          <span class="text-sm text-white/80">${escapeHtml(value)}</span>
        </div>
      `,
    )
    .join("");

  const attachments = qs("#detailsAttachments");
  attachments.innerHTML = (opportunity.attachments || [])
    .map(
      (item) => `
        <a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer" class="glass rounded-2xl p-4 flex items-center justify-between gap-3">
          <div>
            <p class="font-medium text-sm">${escapeHtml(item.name)}</p>
            <p class="text-xs text-white/50 mt-1">${escapeHtml(item.kind || "Attachment")}</p>
          </div>
          <span class="material-symbols-outlined">open_in_new</span>
        </a>
      `,
    )
    .join("");
  qs("#detailsAttachmentsWrap")?.classList.toggle("hidden", !opportunity.attachments?.length);

  const tags = qs("#detailsTags");
  tags.innerHTML = (opportunity.tags || [])
    .map((value) => `<span class="chip px-3 py-2 rounded-full text-sm">${escapeHtml(`#${value}`)}</span>`)
    .join("");
  tags.parentElement?.classList.toggle("hidden", !(opportunity.tags || []).length);

  const saveButtons = qsa("[data-details-save]");
  const appliedButton = qs("#markAppliedButton");
  const applyButton = qs("#applyNowButton");

  function paintButtons(savedState) {
    saveButtons.forEach((button) => {
      button.innerHTML = `<span class="material-symbols-outlined">${savedState.saved ? "bookmark" : "bookmark_add"}</span>`;
    });
    if (appliedButton) {
      appliedButton.textContent = savedState.applied ? "Applied" : "Mark Applied";
      appliedButton.className = savedState.applied
        ? "mt-3 w-full h-12 rounded-2xl bg-emerald-500/20 text-emerald-100 border border-emerald-400/30 font-semibold"
        : "mt-3 w-full h-12 rounded-2xl bg-white/10 text-white border border-white/10 font-semibold";
    }
  }

  paintButtons(state);

  qsa("[data-details-save]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const current = states.get(opportunity.id) || {};
        await updateSavedState(opportunity, !current.saved);
        const next = { ...current, saved: !current.saved, applied: Boolean(current.applied) };
        states.set(opportunity.id, next);
        paintButtons(next);
        setStatus(status, current.saved ? "Removed from saved." : "Saved for later.", "success");
      } catch (error) {
        console.error(error);
        setStatus(status, error.message || "Save failed.", "error");
      }
    });
  });

  if (applyButton) {
    applyButton.addEventListener("click", () => {
      if (opportunity.applyUrl) {
        window.open(opportunity.applyUrl, "_blank", "noopener,noreferrer");
        setStatus(status, "Website opened. When you finish, tap Mark Applied.", "success");
      }
    });
  }

  if (appliedButton) {
    appliedButton.addEventListener("click", async () => {
      try {
        const current = states.get(opportunity.id) || {};
        await updateAppliedState(opportunity, !current.applied);
        const next = { ...current, saved: Boolean(current.saved), applied: !current.applied };
        states.set(opportunity.id, next);
        paintButtons(next);
        setStatus(
          status,
          current.applied ? "Removed from your applied list." : "Added to your applied list.",
          "success",
        );
      } catch (error) {
        console.error(error);
        setStatus(status, error.message || "Applied state failed.", "error");
      }
    });
  }
}

async function initComments(user, profile) {
  const opportunityId = new URLSearchParams(location.search).get("id") || DEMO_OPPORTUNITIES[0].id;
  const opportunity = await loadOpportunity(opportunityId, { fallbackToFirstDemo: opportunityId.startsWith("demo-") });
  const shell = qs(".phone");

  if (!opportunity) {
    if (shell) {
      shell.innerHTML = `
        <div class="min-h-screen flex flex-col items-center justify-center px-6 text-center">
          <div class="rounded-3xl bg-white/5 border border-white/10 p-6 max-w-sm">
            <h1 class="text-xl font-semibold">Comments unavailable</h1>
            <p class="text-sm text-white/60 mt-3">This post is still pending review or is no longer available publicly.</p>
            <a href="feed.html" class="inline-flex mt-5 px-4 py-3 rounded-2xl bg-white text-black font-semibold">Back to feed</a>
          </div>
        </div>
      `;
    }
    return;
  }

  const backLink = qs("#commentsBackLink");
  const heading = qs("#commentsHeading");
  const subheading = qs("#commentsSubheading");
  const summary = qs("#commentsOpportunityCard");
  const status = qs("#commentsStatus");
  const list = qs("#commentsList");
  const gate = qs("#commentsComposerGate");
  const form = qs("#commentForm");
  const replyBanner = qs("#commentReplyBanner");
  const textarea = qs("#commentBody");
  const count = qs("#commentCount");
  const hint = qs("#commentHint");
  const avatar = qs("#commentAuthorAvatar");
  const submit = qs("#commentSubmit");
  let comments = await loadOpportunityComments(opportunity.id);
  let replyTarget = null;
  let editTarget = null;
  const expandedReplyIds = new Set();

  if (backLink) {
    const fallbackHref = detailsUrl(opportunity.id);
    try {
      const referrer = document.referrer ? new URL(document.referrer) : null;
      const sameOrigin = referrer && referrer.origin === location.origin;
      const referrerPage = referrer?.pathname.split("/").pop() || "";
      backLink.href = sameOrigin
        && !["comments.html", "sign-in-email.html", "onboarding.html", "index.html"].includes(referrerPage)
        ? `${referrerPage || "feed.html"}${referrer.search || ""}${referrer.hash || ""}`
        : fallbackHref;
    } catch (error) {
      backLink.href = fallbackHref;
    }
  }

  function commentTotal() {
    return Math.max(Number(opportunity.commentsCount || 0), comments.length);
  }

  function syncComposerCount() {
    if (!textarea || !count) {
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
    count.textContent = `${textarea.value.length}/${MAX_COMMENT_LENGTH}`;
  }

  function paintHeading() {
    setText(heading, formatCommentCount(commentTotal()));
    if (!subheading) {
      return;
    }
    if (opportunity.seeded) {
      subheading.textContent = `${opportunity.title} - sample conversation`;
      return;
    }
    if (opportunity.allowComments === false) {
      subheading.textContent = `${opportunity.title} - comments are turned off`;
      return;
    }
    subheading.textContent = opportunity.title;
  }

  function paintSummary() {
    if (!summary) {
      return;
    }
    summary.classList.remove("hidden");
    summary.innerHTML = `
      <a href="${detailsUrl(opportunity.id)}" class="block">
        <div class="flex gap-3">
          ${renderOpportunityMedia(opportunity, "w-16 h-16 rounded-2xl object-cover", { muted: true, loop: true, autoplay: true })}
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="font-semibold">${escapeHtml(opportunity.title)}</p>
                <p class="text-sm text-white/60 mt-1">${escapeHtml(opportunity.creatorName || "Oval Creator")}</p>
              </div>
              <span class="text-[10px] px-2 py-1 rounded-full bg-white text-black">${escapeHtml(opportunity.category || "Post")}</span>
            </div>
            <div class="mt-3 flex flex-wrap gap-2 text-[11px]">
              <span class="chip px-2.5 py-1 rounded-full">${escapeHtml(opportunity.locationLabel || "Remote")}</span>
              <span class="chip px-2.5 py-1 rounded-full">${escapeHtml(opportunity.payLabel || "Compensation listed")}</span>
              ${opportunity.allowComments === false ? '<span class="chip px-2.5 py-1 rounded-full">Comments off</span>' : `<span class="chip px-2.5 py-1 rounded-full">${escapeHtml(formatCommentCount(commentTotal()))}</span>`}
            </div>
          </div>
        </div>
      </a>
    `;
  }

  function paintComposerBanner() {
    if (!replyBanner) {
      return;
    }
    if (!replyTarget && !editTarget) {
      replyBanner.className = "hidden";
      replyBanner.innerHTML = "";
      return;
    }
    replyBanner.className = "rounded-2xl bg-white/10 border border-white/10 px-4 py-3 text-sm flex items-center justify-between gap-3";
    replyBanner.innerHTML = editTarget
      ? `
        <div>
          <p class="text-[10px] uppercase tracking-[0.18em] text-white/45">Editing comment</p>
          <p class="font-medium mt-1">You are updating your comment</p>
        </div>
        <button type="button" class="text-sm text-white/70" data-clear-composer-context>Cancel</button>
      `
      : `
        <div>
          <p class="text-[10px] uppercase tracking-[0.18em] text-white/45">Replying to</p>
          <p class="font-medium mt-1">${escapeHtml(replyTarget.name)}</p>
        </div>
        <button type="button" class="text-sm text-white/70" data-clear-composer-context>Cancel</button>
      `;
  }

  function paintComposer() {
    const returnTo = encodeURIComponent(toRelativePath());
    if (avatar) {
      avatar.src = profile?.photoURL || DEFAULT_AVATAR;
      avatar.alt = profile?.displayName || "Your profile";
    }

    if (!user || !profile) {
      gate.className = "rounded-2xl bg-white/10 border border-white/10 px-4 py-4 text-sm";
      gate.innerHTML = `
        <p class="text-white/75">Sign in to add a comment or reply.</p>
        <a href="sign-in-email.html?returnTo=${returnTo}" class="inline-flex mt-3 px-4 py-2 rounded-xl bg-white text-black font-semibold">Sign in to comment</a>
      `;
      form.classList.add("hidden");
      return;
    }

    if (opportunity.seeded) {
      gate.className = "rounded-2xl bg-white/10 border border-white/10 px-4 py-4 text-sm text-white/70";
      gate.textContent = "Demo comments are read-only while you are viewing bundled sample content.";
      form.classList.add("hidden");
      return;
    }

    if (opportunity.allowComments === false) {
      gate.className = "rounded-2xl bg-white/10 border border-white/10 px-4 py-4 text-sm text-white/70";
      gate.textContent = "Comments are turned off for this opportunity.";
      form.classList.add("hidden");
      return;
    }

    gate.className = "hidden";
    gate.innerHTML = "";
    form.classList.remove("hidden");
    textarea.placeholder = editTarget
      ? "Update your comment"
      : "Ask a question or share something helpful.";
    if (submit) {
      submit.textContent = editTarget ? "Save" : "Send";
    }
    if (hint) {
      hint.textContent = editTarget
        ? `Editing a comment in ${opportunity.title}`
        : replyTarget
          ? `Replying inside ${opportunity.title}`
          : "Ask a question or leave something helpful.";
    }
    paintComposerBanner();
    syncComposerCount();
  }

  function renderComments() {
    const repliesByParent = new Map();
    comments.forEach((comment) => {
      const key = comment.parentId || "__root__";
      if (!repliesByParent.has(key)) {
        repliesByParent.set(key, []);
      }
      repliesByParent.get(key).push(comment);
    });

    const rootComments = repliesByParent.get("__root__") || [];
    const canReply = opportunity.allowComments !== false && !opportunity.seeded;

    if (!rootComments.length) {
      list.innerHTML = `
        <div class="rounded-3xl bg-white/5 border border-white/10 p-6 text-sm text-white/60">
          ${opportunity.allowComments === false
            ? "Comments are turned off for this opportunity."
            : "No comments yet. Start the conversation when you are ready."}
        </div>
      `;
    } else {
      list.innerHTML = rootComments
        .map((comment) => renderCommentThread(comment, repliesByParent, opportunity, user, profile, canReply, expandedReplyIds))
        .join("");
    }

    paintHeading();
    paintSummary();
  }

  list?.addEventListener("click", (event) => {
    const toggleRepliesButton = event.target.closest("[data-toggle-replies]");
    if (toggleRepliesButton) {
      const commentId = toggleRepliesButton.dataset.toggleReplies;
      if (expandedReplyIds.has(commentId)) {
        expandedReplyIds.delete(commentId);
      } else {
        expandReplyLineage(commentId, comments, expandedReplyIds);
      }
      renderComments();
      return;
    }

    const replyButton = event.target.closest("[data-reply-id]");
    if (replyButton && opportunity.allowComments !== false && !opportunity.seeded) {
      if (!user || !profile) {
        setPendingReturnTo(toRelativePath());
        location.href = `sign-in-email.html?returnTo=${encodeURIComponent(toRelativePath())}`;
        return;
      }
      expandReplyLineage(replyButton.dataset.replyId, comments, expandedReplyIds);
      replyTarget = {
        id: replyButton.dataset.replyId,
        name: replyButton.dataset.replyName || "this comment",
      };
      editTarget = null;
      paintComposerBanner();
      paintComposer();
      renderComments();
      textarea?.focus();
      return;
    }

    const editButton = event.target.closest("[data-edit-comment]");
    if (editButton) {
      if (!user || !profile) {
        setPendingReturnTo(toRelativePath());
        location.href = `sign-in-email.html?returnTo=${encodeURIComponent(toRelativePath())}`;
        return;
      }
      const targetComment = comments.find((item) => item.id === editButton.dataset.editComment);
      if (!targetComment || !canManageComment(targetComment, user, profile, opportunity) || commentIsDeleted(targetComment)) {
        return;
      }
      expandReplyLineage(targetComment.parentId || targetComment.id, comments, expandedReplyIds);
      editTarget = targetComment;
      replyTarget = null;
      textarea.value = targetComment.body || "";
      paintComposerBanner();
      paintComposer();
      renderComments();
      syncComposerCount();
      textarea?.focus();
      textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
      return;
    }

    const deleteButton = event.target.closest("[data-delete-comment]");
    if (!deleteButton) {
      return;
    }
    if (!user || !profile) {
      setPendingReturnTo(toRelativePath());
      location.href = `sign-in-email.html?returnTo=${encodeURIComponent(toRelativePath())}`;
      return;
    }
    const targetComment = comments.find((item) => item.id === deleteButton.dataset.deleteComment);
    if (!targetComment || !canManageComment(targetComment, user, profile, opportunity) || commentIsDeleted(targetComment)) {
      return;
    }
    const hasReplies = commentDescendantIds(targetComment.id, comments).length > 0;
    const confirmed = window.confirm(
      hasReplies
        ? "Delete this comment? The comment text will be removed but replies will stay visible."
        : "Delete this comment?",
    );
    if (!confirmed) {
      return;
    }
    setStatus(status, "");
    deleteOpportunityComment(opportunity, targetComment, comments)
      .then((result) => {
        if (result.mode === "soft") {
          comments = comments.map((item) => (item.id === result.updatedComment.id ? result.updatedComment : item));
          setStatus(status, "Comment deleted. Replies are still visible.", "success");
        } else {
          const removedIds = new Set(result.removedIds || []);
          comments = comments.filter((item) => !removedIds.has(item.id));
          opportunity.commentsCount = Math.max(Number(opportunity.commentsCount || 0) - removedIds.size, comments.length);
          setStatus(status, "Comment deleted.", "success");
        }
        if (replyTarget?.id === targetComment.id) {
          replyTarget = null;
        }
        if (editTarget?.id === targetComment.id) {
          editTarget = null;
          textarea.value = "";
        }
        renderComments();
        paintComposer();
        syncComposerCount();
      })
      .catch((error) => {
        console.error(error);
        setStatus(status, error.message || "Delete failed.", "error");
      });
  });

  replyBanner?.addEventListener("click", (event) => {
    if (!event.target.closest("[data-clear-composer-context]")) {
      return;
    }
    replyTarget = null;
    editTarget = null;
    textarea.value = "";
    paintComposerBanner();
    paintComposer();
    syncComposerCount();
    textarea?.focus();
  });

  textarea?.addEventListener("input", syncComposerCount);

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!textarea || !submit) {
      return;
    }
    submit.disabled = true;
    setStatus(status, "");
    try {
      if (editTarget) {
        const updatedComment = await updateOpportunityComment(opportunity, editTarget, textarea.value);
        comments = comments.map((item) => (item.id === updatedComment.id ? updatedComment : item));
        textarea.value = "";
        editTarget = null;
        replyTarget = null;
        renderComments();
        paintComposer();
        syncComposerCount();
        setStatus(status, "Comment updated.", "success");
      } else {
        const nextComment = await createOpportunityComment(
          opportunity,
          user,
          profile,
          textarea.value,
          replyTarget?.id || null,
        );
        comments = [...comments, nextComment];
        opportunity.commentsCount = Math.max(Number(opportunity.commentsCount || 0) + 1, comments.length);
        if (nextComment.parentId) {
          expandReplyLineage(nextComment.parentId, comments, expandedReplyIds);
        }
        textarea.value = "";
        replyTarget = null;
        renderComments();
        paintComposer();
        syncComposerCount();
        setStatus(status, nextComment.parentId ? "Reply posted." : "Comment posted.", "success");
      }
    } catch (error) {
      console.error(error);
      setStatus(status, error.message || "Comment failed.", "error");
    } finally {
      submit.disabled = false;
    }
  });

  renderComments();
  paintComposer();
  syncComposerCount();
}

async function initSearch(user) {
  const opportunities = await loadPublicOpportunities();
  const states = await refreshStates(user);
  const list = qs("#searchResults");
  const searchInput = qs("#searchInput");
  const filterButtons = qsa("[data-filter]");
  const status = qs("#searchStatus");
  let activeFilter = "All";

  function filteredItems() {
    const queryText = String(searchInput.value || "").trim().toLowerCase();
    return opportunities.filter((opportunity) => {
      const matchesFilter =
        activeFilter === "All" ||
        opportunity.category.toLowerCase() === activeFilter.toLowerCase() ||
        opportunity.workMode.toLowerCase().includes(activeFilter.toLowerCase());
      const haystack = [
        opportunity.title,
        opportunity.caption,
        opportunity.creatorName,
        opportunity.locationLabel,
        ...(opportunity.tags || []).flatMap((item) => [item, `#${item}`]),
      ]
        .join(" ")
        .toLowerCase();
      const matchesQuery = !queryText || haystack.includes(queryText);
      return matchesFilter && matchesQuery;
    });
  }

  function render() {
    const items = filteredItems();
    list.innerHTML = items
      .map((opportunity) => renderOpportunityListCard(opportunity, states.get(opportunity.id) || {}, {
        showActions: true,
        showSave: true,
        showDetails: true,
      }))
      .join("");
    if (!items.length) {
      list.innerHTML =
        '<div class="rounded-3xl bg-white/5 border border-white/10 p-6 text-sm text-white/60">No opportunities match the current filters.</div>';
    }
  }

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter;
      filterButtons.forEach((chip) => {
        chip.className =
          chip.dataset.filter === activeFilter
            ? "chip active-chip px-4 py-2 rounded-full whitespace-nowrap"
            : "chip px-4 py-2 rounded-full whitespace-nowrap";
      });
      render();
    });
  });

  searchInput.addEventListener("input", render);
  await bindOpportunityActionButtons(list, opportunities, states, user, status);
  render();
}

async function initSaved(user, profile) {
  const savedTabPath = "profile.html?tab=saved";
  if (!user || !profile) {
    setPendingReturnTo(savedTabPath);
    location.href = `sign-in-email.html?returnTo=${encodeURIComponent(savedTabPath)}`;
    return;
  }
  if (location.pathname.endsWith("saved-posts.html") || page === "saved") {
    location.replace(savedTabPath);
  }
}

function profileTabButton(activeTab, tab) {
  return activeTab === tab
    ? "py-3 border-b-2 border-white font-semibold flex items-center justify-center gap-1"
    : "py-3 text-white/50 flex items-center justify-center gap-1";
}

async function initProfile(user, profile) {
  const requestedPath = toRelativePath();
  if (!user || !profile) {
    setPendingReturnTo(requestedPath);
    location.href = `sign-in-email.html?returnTo=${encodeURIComponent(requestedPath)}`;
    return;
  }

  applyNavForRole(profile);

  const params = new URLSearchParams(location.search);
  const requestedUid = params.get("uid");
  const ownProfile = {
    id: user.uid,
    ...profile,
  };
  const isOwnProfile = !requestedUid || requestedUid === user.uid;
  const viewedProfile = isOwnProfile ? ownProfile : await loadUserProfileByUid(requestedUid);
  const content = qs("#profileTabContent");
  const status = qs("#profileStatus");
  const signOutButton = qs("#profileSignOut");
  const signOutIcon = qs(".material-symbols-outlined", signOutButton);
  const settingsLink = qs("#profileSettingsLink");
  const creatorButton = qs("#creatorDashboardLink");
  const followButton = qs("#profileFollowButton");
  const tabs = qs("#profileTabs");
  const savedTab = qs("#profileSavedTab");
  const appliedTab = qs("#profileAppliedTab");

  if (!viewedProfile) {
    setText("#profileHandle", "@unknown");
    setText("#profileName", "Profile unavailable");
    setText("#profileBio", "This user profile could not be found.");
    setText("#profilePostsCount", "0");
    setText("#profileFollowersCount", "0");
    setText("#profileFollowingCount", "0");
    const avatarFallback = qs("#profileAvatar");
    if (avatarFallback) {
      avatarFallback.src = DEFAULT_AVATAR;
      avatarFallback.alt = "Profile unavailable";
    }
    settingsLink?.classList.add("hidden");
    creatorButton?.classList.add("hidden");
    followButton?.classList.add("hidden");
    tabs.className = "grid grid-cols-1 mt-6 border-b border-white/10 text-center text-sm";
    savedTab?.classList.add("hidden");
    appliedTab?.classList.add("hidden");
    if (signOutButton) {
      signOutButton.onclick = () => {
        location.href = "feed.html";
      };
    }
    if (signOutIcon) {
      signOutIcon.textContent = "arrow_back";
    }
    content.innerHTML =
      '<div class="rounded-3xl bg-white/5 border border-white/10 p-6 text-sm text-white/60">This profile is unavailable.</div>';
    return;
  }

  const viewingOwnProfile = viewedProfile.id === user.uid;
  const viewedPublicOpportunities = viewingOwnProfile
    ? await loadUserOpportunities(user.uid)
    : (await loadPublicOpportunities()).filter((item) => item.creatorUid === viewedProfile.id);
  const publicOpportunities = viewingOwnProfile
    ? await loadPublicOpportunities()
    : viewedPublicOpportunities;
  const states = await loadUserStates(user.uid);
  const opportunityMap = new Map([...publicOpportunities, ...viewedPublicOpportunities].map((item) => [item.id, item]));
  let followCounts = await loadFollowCounts(viewedProfile.id);
  let isFollowing = !viewingOwnProfile && await isFollowingUser(user.uid, viewedProfile.id);

  setText("#profileHandle", profileHandleText(viewedProfile) || profileDisplayName(viewedProfile));
  setText("#profileName", profileDisplayName(viewedProfile));
  setText("#profileBio", viewedProfile.bio || defaultBio());
  const avatar = qs("#profileAvatar");
  if (avatar) {
    avatar.src = viewedProfile.photoURL || DEFAULT_AVATAR;
    avatar.alt = profileDisplayName(viewedProfile);
  }

  if (signOutButton) {
    signOutButton.onclick = viewingOwnProfile
      ? async () => {
        const confirmed = await confirmSignOut();
        if (!confirmed) {
          return;
        }
        try {
          await signOut(auth);
          location.href = "onboarding.html";
        } catch (error) {
          console.error(error);
          setStatus(status, error.message || "Logout failed.", "error");
        }
      }
      : () => {
        if (window.history.length > 1) {
          window.history.back();
        } else {
          location.href = "feed.html";
        }
      };
  }
  if (signOutIcon) {
    signOutIcon.textContent = viewingOwnProfile ? "logout" : "arrow_back";
  }
  settingsLink?.classList.toggle("hidden", !viewingOwnProfile);
  creatorButton?.classList.toggle("hidden", !viewingOwnProfile);
  followButton?.classList.toggle("hidden", viewingOwnProfile);
  tabs.className = viewingOwnProfile
    ? "grid grid-cols-3 mt-6 border-b border-white/10 text-center text-sm"
    : "grid grid-cols-1 mt-6 border-b border-white/10 text-center text-sm";
  savedTab?.classList.toggle("hidden", !viewingOwnProfile);
  appliedTab?.classList.toggle("hidden", !viewingOwnProfile);
  let activeTab = viewingOwnProfile ? (params.get("tab") || "posts") : "posts";

  function savedItems() {
    return Array.from(states.entries())
      .filter(([, item]) => item.saved)
      .map(([id, item]) => opportunityMap.get(id) || { id, ...item });
  }

  function appliedItems() {
    return Array.from(states.entries())
      .filter(([, item]) => item.applied)
      .map(([id, item]) => opportunityMap.get(id) || { id, ...item });
  }

  function refreshCounts() {
    setText("#profilePostsCount", String(viewedPublicOpportunities.length));
    setText("#profileFollowersCount", String(followCounts.followersCount));
    setText("#profileFollowingCount", String(followCounts.followingCount));
  }

  function paintFollowButton() {
    if (!followButton || viewingOwnProfile) {
      return;
    }
    followButton.textContent = isFollowing ? "Unfollow" : "Follow";
    followButton.className = isFollowing
      ? "flex-1 bg-white/10 text-white border border-white/10 font-semibold rounded-xl py-3"
      : "flex-1 bg-white text-black font-semibold rounded-xl py-3";
  }

  function renderPosts() {
    if (!viewedPublicOpportunities.length) {
      content.innerHTML =
        `<div class="rounded-3xl bg-white/5 border border-white/10 p-6 text-sm text-white/60">${viewingOwnProfile ? "You have not posted any opportunities yet." : "This user has not published any posts yet."}</div>`;
      return;
    }
    if (!viewingOwnProfile) {
      content.innerHTML = viewedPublicOpportunities
        .map((item) => renderOpportunityListCard(item, states.get(item.id) || {}, {
          showActions: true,
          showApply: true,
          showApplied: true,
          showSave: true,
          showDetails: true,
        }))
        .join("");
      return;
    }
    content.innerHTML = viewedPublicOpportunities
      .map(
        (item) => {
          const itemStatus = statusMeta(item.status);
          return `
          <div class="rounded-3xl bg-white/5 border border-white/10 p-4">
            <div class="flex items-start gap-3">
              ${renderOpportunityMedia(item, "w-16 h-16 rounded-2xl object-cover", { muted: true, loop: true, autoplay: true })}
              <div class="flex-1">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <h3 class="font-semibold">${escapeHtml(item.title)}</h3>
                    <p class="text-sm text-white/60">${escapeHtml(item.category)} | ${escapeHtml(item.locationLabel)}</p>
                  </div>
                  <div class="flex flex-col items-end gap-2">
                    <span class="text-[10px] px-2 py-1 rounded-full bg-white text-black">${escapeHtml(item.payLabel)}</span>
                    <span class="text-[10px] px-2 py-1 rounded-full ${itemStatus.classes}">${escapeHtml(itemStatus.label)}</span>
                  </div>
                </div>
                <div class="flex flex-wrap gap-2 mt-3 text-[11px]">
                  <span class="chip px-2.5 py-1 rounded-full">${escapeHtml(formatCompact(item.viewsCount || 0))} views</span>
                  <span class="chip px-2.5 py-1 rounded-full">${escapeHtml(formatCompact(item.savesCount || 0))} saves</span>
                  <span class="chip px-2.5 py-1 rounded-full">${escapeHtml(formatCompact(item.appliedCount || 0))} applied</span>
                </div>
                <div class="mt-4 flex gap-2">
                  <a href="${detailsUrl(item.id)}" class="px-4 py-2 rounded-xl bg-white text-black text-sm font-semibold">Details</a>
                  <a href="create-post.html?id=${encodeURIComponent(item.id)}" class="px-4 py-2 rounded-xl bg-white/10 text-white text-sm font-semibold border border-white/10">Edit</a>
                </div>
              </div>
            </div>
          </div>
        `;
        },
      )
      .join("");
  }

  function renderSaved() {
    if (!savedItems().length) {
      content.innerHTML =
        '<div class="rounded-3xl bg-white/5 border border-white/10 p-6 text-sm text-white/60">No saved opportunities yet.</div>';
      return;
    }
    content.innerHTML = savedItems()
      .map((item) => renderOpportunityListCard(item, states.get(item.id) || {}, {
        showActions: true,
        showApply: true,
        showApplied: true,
        showRemove: true,
      }))
      .join("");
  }

  function renderApplied() {
    if (!appliedItems().length) {
      content.innerHTML =
        '<div class="rounded-3xl bg-white/5 border border-white/10 p-6 text-sm text-white/60">No applied opportunities yet.</div>';
      return;
    }
    content.innerHTML = appliedItems()
      .map((item) => renderOpportunityListCard(item, states.get(item.id) || {}, {
        showActions: true,
        showApply: true,
        showApplied: true,
      }))
      .join("");
  }

  function renderTab() {
    qsa("[data-profile-tab]").forEach((button) => {
      button.className = profileTabButton(activeTab, button.dataset.profileTab);
    });
    if (!viewingOwnProfile || activeTab === "posts") {
      renderPosts();
    } else if (activeTab === "saved") {
      renderSaved();
    } else {
      renderApplied();
    }
  }

  qsa("[data-profile-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!viewingOwnProfile && button.dataset.profileTab !== "posts") {
        return;
      }
      activeTab = button.dataset.profileTab;
      renderTab();
    });
  });

  if (followButton && !viewingOwnProfile) {
    paintFollowButton();
    followButton.onclick = async () => {
      followButton.disabled = true;
      setStatus(status, "");
      const nextFollowState = !isFollowing;
      try {
        await setFollowState(user, ownProfile, viewedProfile, nextFollowState);
        isFollowing = nextFollowState;
        followCounts = await loadFollowCounts(viewedProfile.id);
        paintFollowButton();
        refreshCounts();
        setStatus(
          status,
          nextFollowState
            ? `You are now following ${profileDisplayName(viewedProfile)}.`
            : `You unfollowed ${profileDisplayName(viewedProfile)}.`,
          "success",
        );
      } catch (error) {
        console.error(error);
        setStatus(status, error.message || "Follow action failed.", "error");
      } finally {
        followButton.disabled = false;
      }
    };
  }

  refreshCounts();
  paintFollowButton();
  renderTab();
  await bindOpportunityActionButtons(content, publicOpportunities, states, user, status);
  window.addEventListener("oval:state-changed", () => {
    if (viewingOwnProfile && (activeTab === "saved" || activeTab === "applied")) {
      renderTab();
    }
  });
}

async function initCreatePost(user, profile) {
  if (!user || !profile) {
    setPendingReturnTo("create-post.html");
    location.href = "sign-in-email.html?returnTo=create-post.html";
    return;
  }

  const form = qs("#createPostForm");
  const status = qs("#createPostStatus");
  const submit = qs("#publishOpportunityButton");
  const coverPreview = qs("#coverPreview");
  const captionInput = qs("#caption");
  const captionCount = qs("#captionCount");
  const existingAttachmentsWrap = qs("#existingAttachments");
  const existingAttachmentsState = [];
  const editId = new URLSearchParams(location.search).get("id");
  let editingOpportunity = null;
  let coverPreviewObjectUrl = "";

  function syncCaptionCount() {
    if (!captionCount) {
      return;
    }
    const currentLength = String(captionInput?.value || "").length;
    captionCount.textContent = `${currentLength}/${MAX_CAPTION_LENGTH}`;
  }

  if (submit) {
    submit.textContent = profile.role === "admin" ? "Publish opportunity" : "Submit for review";
  }

  function paintCoverPreview(url, kind, title = "Cover preview") {
    if (!coverPreview) {
      return;
    }
    coverPreview.innerHTML = mediaElementMarkup({
      url,
      kind,
      alt: title,
      className: "w-full h-full object-cover",
      muted: true,
      loop: true,
      autoplay: true,
      controls: isVideoKind(kind),
    });
  }

  if (editId) {
    editingOpportunity = await loadOpportunity(editId, { fallbackToFirstDemo: editId.startsWith("demo-") });
    if (!editingOpportunity) {
      setStatus(status, "Opportunity not found.", "error");
      return;
    }
    if (editingOpportunity.seeded && profile.role !== "admin") {
      const gate = qs("#createPostGate");
      gate?.classList.remove("hidden");
      gate.textContent = "Demo opportunities cannot be edited from this account.";
      form.classList.add("hidden");
      return;
    }
    if (editingOpportunity.creatorUid && editingOpportunity.creatorUid !== user.uid && profile.role !== "admin") {
      setStatus(status, "You cannot edit this opportunity.", "error");
      return;
    }
    setText("#createPostHeading", "Edit post");
    setText("#createPostSubheading", "Update the opportunity details and save the changes.");
    if (submit) {
      submit.textContent = "Save changes";
    }
    qs("#title").value = editingOpportunity.title || "";
    qs("#caption").value = editingOpportunity.caption || "";
    qs("#applyUrl").value = editingOpportunity.applyUrl || "";
    qs("#category").value = editingOpportunity.category || "Internship";
    qs("#locationLabel").value = editingOpportunity.locationLabel || "";
    qs("#workMode").value = editingOpportunity.workMode || "Remote";
    qs("#payLabel").value = editingOpportunity.payLabel || "";
    qs("#deadlineAt").value = toDate(editingOpportunity.deadlineAt)?.toISOString().slice(0, 10) || "";
    qs("#eligibility").value = serializeLines(editingOpportunity.eligibility);
    qs("#responsibilities").value = serializeLines(editingOpportunity.responsibilities);
    qs("#requirements").value = serializeLines(editingOpportunity.requirements);
    qs("#perks").value = serializeLines(editingOpportunity.perks);
    qs("#aboutCompany").value = editingOpportunity.aboutCompany || "";
    qs("#allowComments").checked = Boolean(editingOpportunity.allowComments);
    paintCoverPreview(opportunityMedia(editingOpportunity), opportunityMediaKind(editingOpportunity), editingOpportunity.title);
    existingAttachmentsState.push(...(editingOpportunity.attachments || []));
    renderExistingAttachments();
  }

  if (!editingOpportunity) {
    paintCoverPreview(DEFAULT_COVER, "image/jpeg");
  }

  captionInput?.addEventListener("input", syncCaptionCount);
  syncCaptionCount();

  function renderExistingAttachments() {
    existingAttachmentsWrap.innerHTML = existingAttachmentsState
      .map(
        (item, index) => `
          <div class="rounded-2xl border border-white/10 bg-white/5 p-3 flex items-center justify-between gap-3">
            <div>
              <p class="text-sm font-medium">${escapeHtml(item.name)}</p>
              <p class="text-xs text-white/50 mt-1">${escapeHtml(item.kind || "Attachment")}</p>
            </div>
            <button type="button" class="text-sm text-white/70" data-remove-existing="${index}">Remove</button>
          </div>
        `,
      )
      .join("");
    existingAttachmentsWrap.classList.toggle("hidden", !existingAttachmentsState.length);
  }

  existingAttachmentsWrap.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-existing]");
    if (!button) {
      return;
    }
    existingAttachmentsState.splice(Number(button.dataset.removeExisting), 1);
    renderExistingAttachments();
  });

  qs("#coverMedia").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file || !coverPreview) {
      return;
    }
    if (coverPreviewObjectUrl) {
      URL.revokeObjectURL(coverPreviewObjectUrl);
    }
    coverPreviewObjectUrl = URL.createObjectURL(file);
    paintCoverPreview(coverPreviewObjectUrl, file.type, file.name || "Cover preview");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    setStatus(status, "");

    try {
      const formData = new FormData(form);
      const title = String(formData.get("title") || "").trim();
      const caption = String(formData.get("caption") || "").trim();
      const applyUrl = safeUrl(String(formData.get("applyUrl") || "").trim());
      if (!title || !caption || !applyUrl) {
        throw new Error("Title, description, and details URL are required.");
      }
      if (caption.length > MAX_CAPTION_LENGTH) {
        throw new Error(`Descriptions can be up to ${MAX_CAPTION_LENGTH} characters.`);
      }

      const coverFile = qs("#coverMedia").files?.[0];
      const attachmentFiles = Array.from(qs("#attachments").files || []);
      let media = editingOpportunity?.media || { url: DEFAULT_COVER, alt: title };
      if (coverFile) {
        media = await uploadFile(coverFile, "opportunity-media", user.uid);
        media.alt = title;
      }

      const uploadedAttachments = await Promise.all(
        attachmentFiles.map((file) => uploadFile(file, "opportunity-attachments", user.uid)),
      );
      const nextStatus = editingOpportunity?.status || (profile.role === "admin" ? "published" : "pending");

      const payload = {
        title,
        caption,
        applyUrl,
        category: String(formData.get("category") || "Internship"),
        locationLabel: String(formData.get("locationLabel") || "").trim(),
        workMode: String(formData.get("workMode") || "Remote"),
        payLabel: String(formData.get("payLabel") || "").trim(),
        deadlineAt: (() => {
          const deadlineValue = String(formData.get("deadlineAt") || "").trim();
          const fallback = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
          return Timestamp.fromDate(deadlineValue ? new Date(deadlineValue) : fallback);
        })(),
        tags: extractHashtags(caption),
        eligibility: linesFromInput(formData.get("eligibility")),
        responsibilities: linesFromInput(formData.get("responsibilities")),
        requirements: linesFromInput(formData.get("requirements")),
        perks: linesFromInput(formData.get("perks")),
        aboutCompany: String(formData.get("aboutCompany") || "").trim(),
        allowComments: Boolean(formData.get("allowComments")),
        media,
        attachments: [...existingAttachmentsState, ...uploadedAttachments],
        creatorUid: user.uid,
        creatorName: profile.displayName,
        creatorHandle: `@${profile.username}`,
        creatorPhotoURL: profile.photoURL || DEFAULT_AVATAR,
        status: nextStatus,
        updatedAt: Timestamp.now(),
      };

      if (editingOpportunity?.seeded) {
        payload.seeded = true;
      }

      if (editingOpportunity) {
        await updateDoc(doc(db, "opportunities", editingOpportunity.id), payload);
        setStatus(
          status,
          nextStatus === "pending"
            ? "Opportunity updated and remains in review."
            : "Opportunity updated.",
          "success",
        );
      } else {
        await addDoc(collection(db, "opportunities"), {
          ...payload,
          createdAt: Timestamp.now(),
          viewsCount: 0,
          savesCount: 0,
          appliedCount: 0,
          commentsCount: 0,
          likesCount: 0,
        });
        form.reset();
        existingAttachmentsState.length = 0;
        renderExistingAttachments();
        syncCaptionCount();
        if (coverPreviewObjectUrl) {
          URL.revokeObjectURL(coverPreviewObjectUrl);
          coverPreviewObjectUrl = "";
        }
        paintCoverPreview(DEFAULT_COVER, "image/jpeg");
        setStatus(
          status,
          nextStatus === "pending"
            ? "Opportunity submitted for review. It will appear publicly after admin approval."
            : "Opportunity published.",
          "success",
        );
      }
    } catch (error) {
      console.error(error);
      setStatus(status, error.message || "Publishing failed.", "error");
    } finally {
      submit.disabled = false;
    }
  });
}

async function initCreatorDashboard(user, profile) {
  if (!user || !profile) {
    setPendingReturnTo("creator-dashboard.html");
    location.href = "sign-in-email.html?returnTo=creator-dashboard.html";
    return;
  }

  const myPosts = await loadUserOpportunities(user.uid);
  const totalViews = myPosts.reduce((sum, item) => sum + Number(item.viewsCount || 0), 0);
  const totalApplications = myPosts.reduce((sum, item) => sum + Number(item.appliedCount || 0), 0);
  const totalSaves = myPosts.reduce((sum, item) => sum + Number(item.savesCount || 0), 0);

  setText("#dashboardViews", formatCompact(totalViews));
  setText("#dashboardApplications", formatCompact(totalApplications));
  setText("#dashboardSaves", formatCompact(totalSaves));

  const postsList = qs("#dashboardPosts");
  if (!myPosts.length) {
    postsList.innerHTML =
      '<div class="rounded-3xl bg-white/5 border border-white/10 p-6 text-sm text-white/60">You have not posted any opportunities yet.</div>';
  } else {
    postsList.innerHTML = myPosts
      .map(
        (item) => {
          const itemStatus = statusMeta(item.status);
          return `
          <div class="flex items-center gap-3">
            ${renderOpportunityMedia(item, "w-14 h-14 rounded-2xl object-cover", { muted: true, loop: true, autoplay: true })}
            <div class="flex-1">
              <p class="font-medium text-sm">${escapeHtml(item.title)}</p>
              <div class="mt-1 flex flex-wrap items-center gap-2">
                <p class="text-white/50 text-xs">${escapeHtml(formatCompact(item.viewsCount || 0))} views | ${escapeHtml(formatCompact(item.savesCount || 0))} saves | ${escapeHtml(formatCompact(item.appliedCount || 0))} applied</p>
                <span class="text-[10px] px-2 py-1 rounded-full ${itemStatus.classes}">${escapeHtml(itemStatus.label)}</span>
              </div>
            </div>
            <a href="create-post.html?id=${encodeURIComponent(item.id)}" class="text-white/70"><span class="material-symbols-outlined">edit</span></a>
          </div>
        `;
        },
      )
      .join("");
  }

  const viewsFill = qs("#funnelViewsFill");
  const savesFill = qs("#funnelSavesFill");
  const appliedFill = qs("#funnelAppliedFill");
  const divisor = Math.max(myPosts.length, 1);
  viewsFill.style.width = `${Math.min(100, Math.round(totalViews / divisor / 150))}%`;
  savesFill.style.width = `${Math.min(100, Math.round(totalSaves / divisor / 15))}%`;
  appliedFill.style.width = `${Math.min(100, Math.round(totalApplications / divisor / 8))}%`;
  setText("#funnelViewsValue", formatCompact(totalViews));
  setText("#funnelSavesValue", formatCompact(totalSaves));
  setText("#funnelAppliedValue", formatCompact(totalApplications));
}

async function initAdminModeration(user, profile) {
  if (!user || !profile) {
    setPendingReturnTo("admin-moderation.html");
    location.href = "sign-in-email.html?returnTo=admin-moderation.html";
    return;
  }
  if (profile.role !== "admin") {
    location.href = "feed.html";
    return;
  }

  const list = qs("#moderationQueue");
  const status = qs("#moderationStatus");
  const adminForm = qs("#adminGrantForm");
  const adminEmailInput = qs("#adminEmailInput");
  const adminGrantStatus = qs("#adminGrantStatus");
  const adminList = qs("#adminList");
  let opportunities = [];
  let admins = [];

  async function refresh() {
    opportunities = await loadAllOpportunities();
    admins = await loadAdminUsers();
    const pendingItems = opportunities.filter((item) => item.status === "pending");
    const publishedItems = opportunities.filter((item) => item.status === "published");
    const archivedItems = opportunities.filter((item) => item.status === "archived");

    setText("#moderationPendingCount", String(pendingItems.length));
    setText("#moderationPublishedCount", String(publishedItems.length));
    setText("#moderationArchivedCount", String(archivedItems.length));
    setText("#moderationAdminCount", String(admins.length));

    if (adminList) {
      adminList.innerHTML = admins.length
        ? admins
          .map((item) => `
            <div class="flex items-center justify-between gap-3 rounded-2xl bg-white/5 border border-white/10 px-4 py-3">
              <div class="min-w-0">
                <p class="text-sm font-medium truncate">${escapeHtml(item.displayName || item.email || "Admin")}</p>
                <p class="text-xs text-white/50 truncate mt-1">${escapeHtml(item.email || "")}</p>
              </div>
              <span class="text-[10px] px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-200 border border-emerald-500/30">Admin</span>
            </div>
          `)
          .join("")
        : '<div class="rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-white/60">No admins found.</div>';
    }

    if (!list) {
      return;
    }

    if (!pendingItems.length) {
      list.innerHTML =
        '<div class="rounded-3xl bg-white/5 border border-white/10 p-6 text-sm text-white/60">No posts are waiting for approval.</div>';
      return;
    }

    list.innerHTML = pendingItems
      .map((item) => `
        <div class="rounded-3xl bg-white/5 border border-white/10 p-4">
          <div class="flex flex-col md:flex-row gap-4">
            ${renderOpportunityMedia(item, "w-full md:w-56 h-40 rounded-2xl object-cover", { muted: true, loop: true, autoplay: true })}
            <div class="flex-1">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <h3 class="font-semibold">${escapeHtml(item.title)}</h3>
                  <p class="text-sm text-white/60 mt-1">${escapeHtml(item.creatorName || "Oval User")} • ${escapeHtml(item.category)} • ${escapeHtml(item.locationLabel || "Remote")}</p>
                  <p class="text-sm text-white/70 mt-3 max-h-[4.5rem] overflow-hidden">${escapeHtml(item.caption || "")}</p>
                </div>
                <span class="px-3 py-1 rounded-full bg-amber-500/20 text-amber-200 text-xs border border-amber-500/30">Pending</span>
              </div>
              <div class="mt-4 flex flex-wrap gap-2 text-xs">
                <span class="chip px-2.5 py-1 rounded-full">${escapeHtml(item.payLabel || "Compensation listed")}</span>
                <span class="chip px-2.5 py-1 rounded-full">${escapeHtml(item.workMode || "Flexible")}</span>
                <span class="chip px-2.5 py-1 rounded-full">Submitted ${escapeHtml(formatRelativeDate(item.createdAt) || "recently")}</span>
              </div>
              <div class="mt-5 flex flex-wrap gap-2">
                <a href="${detailsUrl(item.id)}" class="px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-white font-semibold">Preview</a>
                <button type="button" data-moderation-action="approve" data-id="${escapeHtml(item.id)}" class="px-4 py-2 rounded-xl bg-white text-black font-semibold">Approve</button>
                <button type="button" data-moderation-action="archive" data-id="${escapeHtml(item.id)}" class="px-4 py-2 rounded-xl bg-red-500 text-white font-semibold">Archive</button>
              </div>
            </div>
          </div>
        </div>
      `)
      .join("");
  }

  adminForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = normalizeEmail(adminEmailInput?.value);
    if (!email) {
      setStatus(adminGrantStatus, "Enter an email address first.", "error");
      return;
    }

    if (admins.some((item) => normalizeEmail(item.email) === email)) {
      setStatus(adminGrantStatus, "That user already has admin access.", "info");
      return;
    }

    const submitButton = qs('button[type="submit"]', adminForm);
    if (submitButton) {
      submitButton.disabled = true;
    }
    setStatus(adminGrantStatus, "");

    try {
      const targetUser = await findUserByEmail(email);
      if (!targetUser) {
        throw new Error("That email has no Oval account yet. Have them sign in once first.");
      }

      await updateDoc(doc(db, "users", targetUser.id), {
        role: "admin",
        updatedAt: Timestamp.now(),
      });
      await createNotification(targetUser.id, {
        type: "admin-granted",
        title: "Admin access granted",
        body: "You can now review pending posts in Oval.",
      });
      adminForm.reset();
      setStatus(adminGrantStatus, "Admin access granted.", "success");
      await refresh();
    } catch (error) {
      console.error(error);
      setStatus(adminGrantStatus, error.message || "Admin grant failed.", "error");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  });

  list?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-moderation-action]");
    if (!button) {
      return;
    }
    const item = opportunities.find((entry) => entry.id === button.dataset.id);
    if (!item) {
      return;
    }

    button.disabled = true;
    const nextStatus = button.dataset.moderationAction === "approve" ? "published" : "archived";

    try {
      await updateDoc(doc(db, "opportunities", item.id), {
        status: nextStatus,
        updatedAt: Timestamp.now(),
      });
      await createNotification(item.creatorUid, {
        type: nextStatus === "published" ? "moderation-approved" : "moderation-archived",
        title: nextStatus === "published" ? "Opportunity approved" : "Opportunity not approved",
        body:
          nextStatus === "published"
            ? `${item.title} is now live on Oval.`
            : `${item.title} was archived during moderation.`,
        opportunityId: item.id,
      });
      setStatus(
        status,
        nextStatus === "published"
          ? "Opportunity approved and published."
          : "Opportunity archived.",
        "success",
      );
      await refresh();
    } catch (error) {
      console.error(error);
      setStatus(status, error.message || "Moderation action failed.", "error");
      button.disabled = false;
    }
  });

  await refresh();
}

async function initInbox(user, profile) {
  if (!user || !profile) {
    setPendingReturnTo("inbox.html");
    location.href = "sign-in-email.html?returnTo=inbox.html";
    return;
  }
  const items = await loadUserNotifications(user.uid);
  const unreadItems = items.filter((item) => item.read === false);
  const list = qs("#notificationsList");
  if (!list) {
    return;
  }
  if (unreadItems.length) {
    try {
      await markNotificationsRead(user.uid, unreadItems.map((item) => item.id));
      unreadItems.forEach((item) => {
        item.read = true;
      });
    } catch (error) {
      console.warn("Failed to mark inbox items as read.", error);
    }
  }
  await refreshInboxNavIndicator(user, {
    unreadItems: items.filter((item) => item.read === false),
  });
  if (!items.length) {
    list.innerHTML =
      '<div class="rounded-3xl bg-white/5 border border-white/10 p-6 text-sm text-white/60">No updates yet.</div>';
    return;
  }
  list.innerHTML = items
    .map((item) => {
      const href = notificationDestination(item);
      const wrapperTag = href ? "a" : "div";
      const wrapperHref = href ? ` href="${escapeHtml(href)}"` : "";
      const wrapperClass = href
        ? "rounded-3xl bg-white/5 border border-white/10 p-4 block hover:border-white/20 hover:bg-white/[0.07] transition"
        : "rounded-3xl bg-white/5 border border-white/10 p-4";
      return `
        <${wrapperTag}${wrapperHref} class="${wrapperClass}">
          <div class="flex gap-3">
            <div class="w-12 h-12 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center shrink-0">
              <span class="material-symbols-outlined">${notificationIcon(item)}</span>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-start justify-between gap-3">
                <p class="font-semibold">${escapeHtml(item.title)}</p>
                ${href ? '<span class="material-symbols-outlined text-white/35 shrink-0">chevron_right</span>' : ""}
              </div>
              <p class="text-sm text-white/70 mt-1">${escapeHtml(item.body)}</p>
              <div class="flex items-center gap-2 text-xs text-white/45 mt-3">
                <span class="material-symbols-outlined text-[14px]">schedule</span>
                <span>${escapeHtml(formatRelativeDate(item.createdAt))}</span>
              </div>
            </div>
          </div>
        </${wrapperTag}>
      `;
    })
    .join("");
}

function paintSettingsToggle(button, enabled) {
  if (!button) {
    return;
  }
  button.setAttribute("aria-pressed", enabled ? "true" : "false");
  button.className = enabled
    ? "w-12 h-7 rounded-full bg-white relative shrink-0 transition"
    : "w-12 h-7 rounded-full bg-white/15 relative shrink-0 transition";
  button.innerHTML = enabled
    ? '<span class="absolute right-1 top-1 w-5 h-5 rounded-full bg-black transition"></span>'
    : '<span class="absolute left-1 top-1 w-5 h-5 rounded-full bg-white/50 transition"></span>';
}

async function initSettings(user, profile) {
  const returnTo = "settings.html";
  if (!user || !profile) {
    setPendingReturnTo(returnTo);
    location.href = `sign-in-email.html?returnTo=${encodeURIComponent(returnTo)}`;
    return;
  }

  const status = qs("#settingsStatus");
  const avatar = qs("#settingsAvatar");
  const name = qs("#settingsName");
  const handle = qs("#settingsHandle");
  const email = qs("#settingsEmail");
  const form = qs("#settingsProfileForm");
  const displayNameInput = qs("#settingsDisplayName");
  const bioInput = qs("#settingsBio");
  const profileLink = qs("#settingsProfileLink");
  const dashboardLink = qs("#settingsDashboardLink");
  const moderationLink = qs("#settingsModerationLink");
  const signOutButton = qs("#settingsSignOut");
  const notificationPrefs = getSettingsPreferences();
  const toggleButtons = qsa("[data-pref-key]");
  const soundToggle = qs("[data-app-pref='feedSound']");

  if (avatar) {
    avatar.src = profile.photoURL || DEFAULT_AVATAR;
    avatar.alt = profileDisplayName(profile);
  }
  setText(name, profileDisplayName(profile));
  setText(handle, profileHandleText(profile) || "@oval");
  setText(email, profile.email || user.email || "");
  if (displayNameInput) {
    displayNameInput.value = profile.displayName || "";
  }
  if (bioInput) {
    bioInput.value = profile.bio || defaultBio();
  }
  if (profileLink) {
    profileLink.href = profileUrl(user.uid);
  }
  dashboardLink?.classList.remove("hidden");
  moderationLink?.classList.toggle("hidden", profile.role !== "admin");

  toggleButtons.forEach((button) => {
    const key = button.dataset.prefKey;
    paintSettingsToggle(button, Boolean(notificationPrefs[key]));
    button.addEventListener("click", () => {
      notificationPrefs[key] = !notificationPrefs[key];
      setSettingsPreferences(notificationPrefs);
      paintSettingsToggle(button, notificationPrefs[key]);
      setStatus(status, "Settings updated.", "success");
    });
  });

  if (soundToggle) {
    const paintSoundToggle = () => {
      const soundOn = !getFeedVideoMutedPreference();
      paintSettingsToggle(soundToggle, soundOn);
      const label = qs("[data-app-pref-label='feedSound']");
      if (label) {
        label.textContent = soundOn ? "On by default" : "Muted by default";
      }
    };
    paintSoundToggle();
    soundToggle.addEventListener("click", () => {
      const nextMuted = !getFeedVideoMutedPreference();
      setFeedVideoMutedPreference(nextMuted);
      paintSoundToggle();
      setStatus(status, "App preference updated.", "success");
    });
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nextDisplayName = String(displayNameInput?.value || "").trim();
    const nextBio = String(bioInput?.value || "").trim();
    if (!nextDisplayName) {
      setStatus(status, "Display name is required.", "error");
      return;
    }

    const payload = {
      displayName: nextDisplayName,
      bio: nextBio || defaultBio(),
      updatedAt: Timestamp.now(),
    };

    const submitButton = qs('button[type="submit"]', form);
    if (submitButton) {
      submitButton.disabled = true;
    }
    setStatus(status, "");

    try {
      await updateDoc(doc(db, "users", user.uid), payload);
      if ((auth.currentUser?.displayName || "") !== nextDisplayName) {
        await updateProfile(auth.currentUser, {
          displayName: nextDisplayName,
        });
      }
      setText(name, nextDisplayName);
      setStatus(status, "Account settings saved.", "success");
    } catch (error) {
      console.error(error);
      setStatus(status, error.message || "Settings update failed.", "error");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  });

  signOutButton?.addEventListener("click", async () => {
    const confirmed = await confirmSignOut();
    if (!confirmed) {
      return;
    }
    try {
      await signOut(auth);
      location.href = "onboarding.html";
    } catch (error) {
      console.error(error);
      setStatus(status, error.message || "Logout failed.", "error");
    }
  });
}

async function main() {
  const user = await withTimeout(authReady, 1500).catch(() => null);
  const profile = user ? await ensureUserProfile(user) : null;

  applyNavForRole(profile);
  if (page !== "inbox" && page !== "notifications") {
    await refreshInboxNavIndicator(user);
  }

  if (page === "onboarding") {
    await initOnboarding(user, profile);
    return;
  }
  if (page === "sign-in-email") {
    await initEmailAuth(user, profile);
    return;
  }
  if (page === "feed") {
    await initFeed(user, profile);
    return;
  }
  if (page === "details") {
    await initDetails(user, profile);
    return;
  }
  if (page === "comments") {
    await initComments(user, profile);
    return;
  }
  if (page === "search") {
    await initSearch(user, profile);
    return;
  }
  if (page === "saved") {
    await initSaved(user, profile);
    return;
  }
  if (page === "profile") {
    await initProfile(user, profile);
    return;
  }
  if (page === "create-post") {
    await initCreatePost(user, profile);
    return;
  }
  if (page === "creator-dashboard") {
    await initCreatorDashboard(user, profile);
    return;
  }
  if (page === "admin-moderation") {
    await initAdminModeration(user, profile);
    return;
  }
  if (page === "inbox" || page === "notifications") {
    await initInbox(user, profile);
    return;
  }
  if (page === "settings") {
    await initSettings(user, profile);
  }
}

ensurePwaShellMeta();
showAppLoader();
wireLoadingTransitions();
registerServiceWorker();

main()
  .catch((error) => {
    console.error(error);
    renderFatalError(error);
  })
  .finally(() => {
    hideAppLoader().catch(() => {});
  });

window.addEventListener("error", (event) => {
  hideAppLoader().catch(() => {});
  renderFatalError(event.error || event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  hideAppLoader().catch(() => {});
  renderFatalError(event.reason);
});
