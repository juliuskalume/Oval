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
} from "./firebase.js";
import { DEMO_OPPORTUNITIES } from "./sample-data.js";

const ROLE_KEY = "oval.desiredRole";
const CREATOR_TYPE_KEY = "oval.desiredCreatorType";
const RETURN_TO_KEY = "oval.returnTo";
const DEFAULT_COVER =
  "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=1200&q=80";
const DEFAULT_AVATAR =
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80";

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

function getDesiredRole() {
  const stored = localStorage.getItem(ROLE_KEY);
  return stored === "creator" ? "creator" : "seeker";
}

function setDesiredRole(role) {
  localStorage.setItem(ROLE_KEY, role === "creator" ? "creator" : "seeker");
}

function getDesiredCreatorType() {
  const stored = localStorage.getItem(CREATOR_TYPE_KEY);
  return stored === "company" ? "company" : "individual";
}

function setDesiredCreatorType(value) {
  localStorage.setItem(CREATOR_TYPE_KEY, value === "company" ? "company" : "individual");
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

function arrayFromInput(value, separator = ",") {
  return String(value || "")
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
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

function serializeTags(items) {
  return Array.isArray(items) ? items.join(", ") : "";
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

function opportunityMedia(opportunity) {
  return opportunity?.media?.url || opportunity?.mediaUrl || DEFAULT_COVER;
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

function defaultBio(role, creatorType) {
  if (role === "creator" && creatorType === "company") {
    return "Sharing jobs, gigs, and scholarships with the Oval community.";
  }
  if (role === "creator") {
    return "Posting opportunities and looking for emerging talent.";
  }
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
    applyUrl: opportunity.applyUrl || "",
  };
}

async function ensureDemoData() {
  return DEMO_OPPORTUNITIES.map((item) => ({
    ...item,
    seeded: true,
  }));
}

async function ensureUserProfile(user, options = {}) {
  const desiredRole = options.desiredRole || getDesiredRole();
  const creatorType = desiredRole === "creator" ? options.creatorType || getDesiredCreatorType() : null;
  const profileRef = doc(db, "users", user.uid);
  const existing = await getDoc(profileRef);

  if (existing.exists()) {
    const data = existing.data();
    const updates = {};
    if (!data.displayName && user.displayName) {
      updates.displayName = user.displayName;
    }
    if (!data.photoURL && user.photoURL) {
      updates.photoURL = user.photoURL;
    }
    if (!data.email && user.email) {
      updates.email = user.email;
    }
    if (!data.username) {
      updates.username = uniqueUsername(data.displayName || user.displayName || user.email?.split("@")[0]);
    }
    if (!data.bio) {
      updates.bio = defaultBio(data.role, data.creatorType);
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
    email: user.email || "",
    photoURL: user.photoURL || DEFAULT_AVATAR,
    role: desiredRole === "creator" ? "creator" : "seeker",
    creatorType,
    bio: defaultBio(desiredRole, creatorType),
    followingCount: 0,
    followersCount: 0,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };
  await setDoc(profileRef, profile);
  return profile;
}

async function loadPublishedOpportunities() {
  try {
    const snapshot = await withTimeout(
      getDocs(query(collection(db, "opportunities"), orderBy("createdAt", "desc"))),
    );
    const items = snapshot.docs
      .map(normalizeOpportunity)
      .filter((item) => item.status !== "archived");
    if (items.length) {
      return items;
    }
  } catch (error) {
    console.warn("Falling back to bundled opportunities.", error);
  }
  return ensureDemoData();
}

async function loadOpportunity(opportunityId) {
  const requestedId = opportunityId || DEMO_OPPORTUNITIES[0].id;
  try {
    const snapshot = await withTimeout(getDoc(doc(db, "opportunities", requestedId)));
    if (snapshot.exists()) {
      return normalizeOpportunity(snapshot);
    }
  } catch (error) {
    console.warn("Falling back to bundled opportunity.", error);
  }
  return (await ensureDemoData()).find((item) => item.id === requestedId) || (await ensureDemoData())[0] || null;
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
  const fileName = `${Date.now()}-${slugify(file.name || "file") || "file"}`;
  const storageRef = ref(storage, `${folder}/${uid}/${fileName}`);
  await uploadBytes(storageRef, file);
  return {
    name: file.name,
    url: await getDownloadURL(storageRef),
    kind: file.type || "file",
  };
}

function redirectAfterAuth(profile) {
  const defaultPath =
    profile?.role === "admin"
      ? "admin-moderation.html"
      : profile?.role === "creator"
        ? "creator-dashboard.html"
        : "feed.html";
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

function fillRolePreview(root) {
  const role = getDesiredRole();
  const creatorType = getDesiredCreatorType();
  qsa("[data-role-preview]", root).forEach((node) => {
    node.textContent = role === "creator" ? `Creator${creatorType === "company" ? " (Company)" : " (Individual)"}` : "Seeker";
  });
}

function attachRolePicker(root) {
  const roleButtons = qsa("[data-role]", root);
  const creatorTypeButtons = qsa("[data-creator-type]", root);
  const creatorTypeRow = qs("[data-creator-type-row]", root);

  function paint() {
    const role = getDesiredRole();
    const creatorType = getDesiredCreatorType();
    roleButtons.forEach((button) => {
      const active = button.dataset.role === role;
      if (button.dataset.compact === "true") {
        button.className = active
          ? "px-4 py-2 rounded-full bg-white text-black text-sm font-semibold"
          : "px-4 py-2 rounded-full bg-white/10 text-white text-sm font-semibold border border-white/10";
      } else {
        button.className = active
          ? "rounded-3xl border border-white bg-white text-black p-5 text-left transition"
          : "rounded-3xl border border-white/10 bg-white/5 text-white p-5 text-left transition";
      }
    });
    creatorTypeButtons.forEach((button) => {
      const active = button.dataset.creatorType === creatorType;
      button.className = active
        ? "px-4 py-2 rounded-full bg-white text-black text-sm font-semibold"
        : "px-4 py-2 rounded-full bg-white/10 text-white text-sm font-semibold border border-white/10";
    });
    if (creatorTypeRow) {
      creatorTypeRow.classList.toggle("hidden", role !== "creator");
    }
    fillRolePreview(root);
  }

  roleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setDesiredRole(button.dataset.role);
      paint();
    });
  });

  creatorTypeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setDesiredCreatorType(button.dataset.creatorType);
      paint();
    });
  });

  paint();
}

async function initOnboarding(user, profile) {
  if (user && profile) {
    redirectAfterAuth(profile);
    return;
  }
  attachRolePicker(document);
  applySkipLinks(document);
  qsa("[data-auth-link]").forEach((link) => {
    link.addEventListener("click", () => {
      setPendingReturnTo("feed.html");
    });
  });
}

async function initEmailAuth(user, profile) {
  if (user && profile) {
    redirectAfterAuth(profile);
    return;
  }

  applySkipLinks(document);
  const form = qs("#emailAuthForm");
  const modeButtons = qsa("[data-auth-mode]");
  const createOnly = qsa("[data-create-only]");
  const roleSelect = qs("#accountRole");
  const creatorTypeWrap = qs("#creatorTypeWrap");
  const creatorTypeField = qs("#creatorType");
  const title = qs("#emailAuthTitle");
  const subtitle = qs("#emailAuthSubtitle");
  const submit = qs("#emailAuthSubmit");
  const status = qs("#emailAuthStatus");
  let mode = "signin";

  roleSelect.value = getDesiredRole();
  creatorTypeField.value = getDesiredCreatorType();

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
    creatorTypeWrap.classList.toggle("hidden", !(isCreate && roleSelect.value === "creator"));
    title.textContent = isCreate ? "Create your account" : "Sign in with email";
    subtitle.textContent = isCreate
      ? "Create a seeker or creator account with email and password."
      : "Access saved posts, applied opportunities, and posting tools.";
    submit.textContent = isCreate ? "Create account" : "Sign in";
    fillRolePreview(document);
  }

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      mode = button.dataset.authMode;
      paint();
    });
  });

  roleSelect.addEventListener("change", () => {
    setDesiredRole(roleSelect.value);
    paint();
  });

  creatorTypeField.addEventListener("change", () => {
    setDesiredCreatorType(creatorTypeField.value);
    paint();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus(status, "");
    submit.disabled = true;

    const formData = new FormData(form);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "").trim();
    const displayName = String(formData.get("displayName") || "").trim();
    const role = String(formData.get("role") || "seeker");
    const creatorType = String(formData.get("creatorType") || "individual");

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
        setDesiredRole(role);
        setDesiredCreatorType(creatorType);
        const nextProfile = await ensureUserProfile(credential.user, {
          displayName,
          desiredRole: role,
          creatorType,
        });
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

async function initGoogleAuth(user, profile) {
  if (user && profile) {
    redirectAfterAuth(profile);
    return;
  }
  attachRolePicker(document);
  applySkipLinks(document);
  const button = qs("#googleContinue");
  const status = qs("#googleStatus");

  button.addEventListener("click", async () => {
    button.disabled = true;
    setStatus(status, "");
    try {
      const role = getDesiredRole();
      const creatorType = getDesiredCreatorType();
      const credential = await signInWithPopup(auth, googleProvider);
      const nextProfile = await ensureUserProfile(credential.user, {
        desiredRole: role,
        creatorType,
      });
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
        <img src="${escapeHtml(opportunityMedia(opportunity))}" class="w-16 h-16 rounded-2xl object-cover" alt="${escapeHtml(opportunity.title)}">
        <div class="flex-1">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="font-semibold">${escapeHtml(opportunity.title)}</h3>
              <p class="text-sm text-white/60">${escapeHtml(opportunity.creatorName || "Oval Creator")}</p>
            </div>
            <span class="text-[10px] px-2 py-1 rounded-full bg-white text-black">${escapeHtml(opportunity.category)}</span>
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
        };
        states.set(opportunity.id, nextState);
        paintSaveActionButton(button, !current.saved);
        window.dispatchEvent(new CustomEvent("oval:state-changed", { detail: { opportunityId: opportunity.id, state: nextState } }));
        setStatus(statusTarget, current.saved ? "Removed from saved." : "Saved for later.", "success");
        return;
      }

      if (action === "remove-save") {
        const current = states.get(opportunity.id) || {};
        await updateSavedState(opportunity, false);
        states.set(opportunity.id, {
          ...current,
          ...opportunitySnapshot(opportunity),
          saved: false,
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
        };
        states.set(opportunity.id, nextState);
        paintAppliedActionButton(button, !current.applied);
        window.dispatchEvent(new CustomEvent("oval:state-changed", { detail: { opportunityId: opportunity.id, state: nextState } }));
        setStatus(
          statusTarget,
          current.applied ? "Removed from your applied list." : "Added to your applied list.",
          "success",
        );
      }
    } catch (error) {
      console.error(error);
      setStatus(statusTarget, error.message || "That action could not be completed.", "error");
    }
  });
}

async function initFeed(user) {
  const opportunities = await loadPublishedOpportunities();
  const states = await refreshStates(user);
  const slides = qs("#feedSlides");
  const status = qs("#feedStatus");

  if (!slides) {
    return;
  }

  slides.innerHTML = opportunities
    .map((opportunity) => {
      const state = states.get(opportunity.id) || {};
      return `
        <section class="relative min-h-screen snap-start" data-opportunity-id="${escapeHtml(opportunity.id)}">
          <div class="absolute inset-0">
            <img src="${escapeHtml(opportunityMedia(opportunity))}" class="w-full h-full object-cover" alt="${escapeHtml(opportunity.title)}">
            <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/45"></div>
          </div>
          <div class="relative min-h-screen px-4">
            <div class="absolute right-3 bottom-28 z-20 flex flex-col items-center gap-5">
              <div class="flex flex-col items-center">
                <img src="${escapeHtml(creatorAvatar(opportunity))}" class="w-12 h-12 rounded-full border-2 border-white object-cover" alt="${escapeHtml(opportunity.creatorName)}">
              </div>
              <div class="flex flex-col items-center">
                <span class="material-symbols-outlined text-[30px]">favorite</span>
                <span class="text-xs mt-1">${escapeHtml(formatCompact(opportunity.likesCount || 0))}</span>
              </div>
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
            </div>
            <div class="absolute left-0 right-0 bottom-24 z-20 px-4">
              <div class="max-w-[78%]">
                <div class="flex items-center gap-2 mb-3 flex-wrap">
                  <span class="chip text-[11px] px-2.5 py-1 rounded-full">${escapeHtml(opportunity.payLabel)}</span>
                  <span class="chip text-[11px] px-2.5 py-1 rounded-full">${escapeHtml(opportunity.workMode)}</span>
                  <span class="chip text-[11px] px-2.5 py-1 rounded-full">${escapeHtml(opportunity.category)}</span>
                </div>
                <p class="font-semibold text-sm">${escapeHtml(opportunity.creatorHandle || opportunity.creatorName)}</p>
                <p class="text-sm mt-2 leading-5">
                  ${escapeHtml(opportunity.caption)}
                  <span class="text-white/80">${escapeHtml((opportunity.tags || []).map((item) => `#${item}`).join(" "))}</span>
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
    })
    .join("");

  await bindOpportunityActionButtons(slides, opportunities, states, user, status);

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
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setStatus(status, "Link copied to clipboard.", "success");
      }
    } catch (error) {
      setStatus(status, "Share cancelled.", "info");
    }
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries
        .filter((entry) => entry.isIntersecting)
        .forEach((entry) => {
          const opportunityId = entry.target.dataset.opportunityId;
          if (opportunityId) {
            recordView(opportunityId);
          }
        });
    },
    { threshold: 0.65 },
  );

  qsa("#feedSlides > section").forEach((section) => {
    observer.observe(section);
  });
}

async function initDetails(user) {
  const status = qs("#detailsStatus");
  const opportunityId = new URLSearchParams(location.search).get("id") || DEMO_OPPORTUNITIES[0].id;
  const opportunity = await loadOpportunity(opportunityId);
  if (!opportunity) {
    setStatus(status, "Opportunity not found.", "error");
    return;
  }
  const states = await refreshStates(user);
  const state = states.get(opportunity.id) || {};

  recordView(opportunity.id);

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
    cover.src = opportunityMedia(opportunity);
    cover.alt = opportunity.title;
  }
  const creatorImage = qs("#detailsCreatorAvatar");
  if (creatorImage) {
    creatorImage.src = creatorAvatar(opportunity);
    creatorImage.alt = opportunity.creatorName;
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
    .map((value) => `<span class="chip px-3 py-2 rounded-full text-sm">${escapeHtml(value)}</span>`)
    .join("");

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

async function initSearch(user) {
  const opportunities = await loadPublishedOpportunities();
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
        ...(opportunity.tags || []),
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
  if (!user || !profile) {
    setPendingReturnTo("saved-posts.html");
    location.href = "sign-in-email.html?returnTo=saved-posts.html";
    return;
  }
  const states = await loadUserStates(user.uid);
  const opportunities = await loadPublishedOpportunities();
  const opportunityMap = new Map(opportunities.map((item) => [item.id, item]));
  const savedItems = Array.from(states.entries())
    .filter(([, item]) => item.saved)
    .map(([id, item]) => opportunityMap.get(id) || { id, ...item });

  const list = qs("#savedPostsList");
  const status = qs("#savedStatus");
  if (!savedItems.length) {
    list.innerHTML =
      '<div class="rounded-3xl bg-white/5 border border-white/10 p-6 text-sm text-white/60">You have not saved any opportunities yet.</div>';
    return;
  }

  list.innerHTML = savedItems
    .map((opportunity) => renderOpportunityListCard(opportunity, states.get(opportunity.id) || {}, {
      showActions: true,
      showSave: false,
      showApply: true,
      showApplied: true,
      showRemove: true,
    }))
    .join("");

  await bindOpportunityActionButtons(list, opportunities, states, user, status);
}

function profileTabButton(activeTab, tab) {
  return activeTab === tab
    ? "py-3 border-b-2 border-white font-semibold flex items-center justify-center gap-1"
    : "py-3 text-white/50 flex items-center justify-center gap-1";
}

async function initProfile(user, profile) {
  if (!user || !profile) {
    setPendingReturnTo("profile.html");
    location.href = "sign-in-email.html?returnTo=profile.html";
    return;
  }

  applyNavForRole(profile);

  setText("#profileHandle", `@${profile.username}`);
  setText("#profileName", profile.displayName);
  setText("#profileBio", profile.bio);
  const avatar = qs("#profileAvatar");
  if (avatar) {
    avatar.src = profile.photoURL || DEFAULT_AVATAR;
    avatar.alt = profile.displayName;
  }

  const opportunities = await loadPublishedOpportunities();
  const states = await loadUserStates(user.uid);
  const myPosts = opportunities.filter((item) => item.creatorUid === user.uid);
  const opportunityMap = new Map(opportunities.map((item) => [item.id, item]));

  const creatorButton = qs("#creatorDashboardLink");
  if (creatorButton) {
    creatorButton.classList.remove("hidden");
  }

  const content = qs("#profileTabContent");
  const status = qs("#profileStatus");
  let activeTab = new URLSearchParams(location.search).get("tab") || "posts";

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
    setText("#profilePostsCount", String(myPosts.length));
    setText("#profileSavedCount", String(savedItems().length));
    setText("#profileAppliedCount", String(appliedItems().length));
  }

  function renderPosts() {
    if (!myPosts.length) {
      content.innerHTML =
        '<div class="rounded-3xl bg-white/5 border border-white/10 p-6 text-sm text-white/60">You have not published any opportunities yet.</div>';
      return;
    }
    content.innerHTML = myPosts
      .map(
        (item) => `
          <div class="rounded-3xl bg-white/5 border border-white/10 p-4">
            <div class="flex items-start gap-3">
              <img src="${escapeHtml(opportunityMedia(item))}" class="w-16 h-16 rounded-2xl object-cover" alt="${escapeHtml(item.title)}">
              <div class="flex-1">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <h3 class="font-semibold">${escapeHtml(item.title)}</h3>
                    <p class="text-sm text-white/60">${escapeHtml(item.category)} | ${escapeHtml(item.locationLabel)}</p>
                  </div>
                  <span class="text-[10px] px-2 py-1 rounded-full bg-white text-black">${escapeHtml(item.payLabel)}</span>
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
        `,
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
    if (activeTab === "posts") {
      renderPosts();
    } else if (activeTab === "saved") {
      renderSaved();
    } else {
      renderApplied();
    }
  }

  qsa("[data-profile-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeTab = button.dataset.profileTab;
      renderTab();
    });
  });

  const signOutButton = qs("#profileSignOut");
  if (signOutButton) {
    signOutButton.addEventListener("click", async () => {
      await signOut(auth);
      location.href = "onboarding.html";
    });
  }

  refreshCounts();
  renderTab();
  await bindOpportunityActionButtons(content, opportunities, states, user, status);
  window.addEventListener("oval:state-changed", () => {
    refreshCounts();
    if (activeTab === "saved" || activeTab === "applied") {
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
  const existingAttachmentsWrap = qs("#existingAttachments");
  const existingAttachmentsState = [];
  const editId = new URLSearchParams(location.search).get("id");
  let editingOpportunity = null;

  if (editId) {
    editingOpportunity = await loadOpportunity(editId);
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
    setText("#createPostSubheading", "Update the opportunity details and publish the changes.");
    qs("#title").value = editingOpportunity.title || "";
    qs("#caption").value = editingOpportunity.caption || "";
    qs("#applyUrl").value = editingOpportunity.applyUrl || "";
    qs("#category").value = editingOpportunity.category || "Internship";
    qs("#locationLabel").value = editingOpportunity.locationLabel || "";
    qs("#workMode").value = editingOpportunity.workMode || "Remote";
    qs("#payLabel").value = editingOpportunity.payLabel || "";
    qs("#deadlineAt").value = toDate(editingOpportunity.deadlineAt)?.toISOString().slice(0, 10) || "";
    qs("#tags").value = serializeTags(editingOpportunity.tags);
    qs("#eligibility").value = serializeLines(editingOpportunity.eligibility);
    qs("#responsibilities").value = serializeLines(editingOpportunity.responsibilities);
    qs("#requirements").value = serializeLines(editingOpportunity.requirements);
    qs("#perks").value = serializeLines(editingOpportunity.perks);
    qs("#aboutCompany").value = editingOpportunity.aboutCompany || "";
    qs("#allowComments").checked = Boolean(editingOpportunity.allowComments);
    if (coverPreview) {
      coverPreview.src = opportunityMedia(editingOpportunity);
    }
    existingAttachmentsState.push(...(editingOpportunity.attachments || []));
    renderExistingAttachments();
  }

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
    coverPreview.src = URL.createObjectURL(file);
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
        throw new Error("Title, caption, and details URL are required.");
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
        tags: arrayFromInput(formData.get("tags")),
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
        creatorType: profile.creatorType || "individual",
        status: "published",
        updatedAt: Timestamp.now(),
      };

      if (editingOpportunity?.seeded) {
        payload.seeded = true;
      }

      if (editingOpportunity) {
        await updateDoc(doc(db, "opportunities", editingOpportunity.id), payload);
        setStatus(status, "Opportunity updated.", "success");
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
        setStatus(status, "Opportunity published.", "success");
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

  const opportunities = await loadPublishedOpportunities();
  const myPosts = opportunities.filter((item) => item.creatorUid === user.uid);
  const totalViews = myPosts.reduce((sum, item) => sum + Number(item.viewsCount || 0), 0);
  const totalApplications = myPosts.reduce((sum, item) => sum + Number(item.appliedCount || 0), 0);
  const totalSaves = myPosts.reduce((sum, item) => sum + Number(item.savesCount || 0), 0);

  setText("#dashboardViews", formatCompact(totalViews));
  setText("#dashboardApplications", formatCompact(totalApplications));
  setText("#dashboardSaves", formatCompact(totalSaves));

  const postsList = qs("#dashboardPosts");
  if (!myPosts.length) {
    postsList.innerHTML =
      '<div class="rounded-3xl bg-white/5 border border-white/10 p-6 text-sm text-white/60">You have not published any opportunities yet.</div>';
  } else {
    postsList.innerHTML = myPosts
      .map(
        (item) => `
          <div class="flex items-center gap-3">
            <img src="${escapeHtml(opportunityMedia(item))}" class="w-14 h-14 rounded-2xl object-cover" alt="${escapeHtml(item.title)}">
            <div class="flex-1">
              <p class="font-medium text-sm">${escapeHtml(item.title)}</p>
              <p class="text-white/50 text-xs">${escapeHtml(formatCompact(item.viewsCount || 0))} views | ${escapeHtml(formatCompact(item.savesCount || 0))} saves | ${escapeHtml(formatCompact(item.appliedCount || 0))} applied</p>
            </div>
            <a href="create-post.html?id=${encodeURIComponent(item.id)}" class="text-white/70"><span class="material-symbols-outlined">edit</span></a>
          </div>
        `,
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

async function initNotifications(user, profile) {
  if (!user || !profile) {
    setPendingReturnTo("notifications.html");
    location.href = "sign-in-email.html?returnTo=notifications.html";
    return;
  }
  const items = await loadUserNotifications(user.uid);
  const list = qs("#notificationsList");
  if (!list) {
    return;
  }
  if (!items.length) {
    list.innerHTML =
      '<div class="rounded-3xl bg-white/5 border border-white/10 p-6 text-sm text-white/60">No notifications yet.</div>';
    return;
  }
  list.innerHTML = items
    .map(
      (item) => `
        <div class="rounded-3xl bg-white/5 border border-white/10 p-4">
          <div class="flex gap-3">
            <div class="w-12 h-12 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center shrink-0">
              <span class="material-symbols-outlined">${item.type?.includes("application") ? "task_alt" : "notifications"}</span>
            </div>
            <div class="flex-1 min-w-0">
              <p class="font-semibold">${escapeHtml(item.title)}</p>
              <p class="text-sm text-white/70 mt-1">${escapeHtml(item.body)}</p>
              <div class="flex items-center gap-2 text-xs text-white/45 mt-3">
                <span class="material-symbols-outlined text-[14px]">schedule</span>
                <span>${escapeHtml(formatRelativeDate(item.createdAt))}</span>
              </div>
            </div>
          </div>
        </div>
      `,
    )
    .join("");
}

async function main() {
  const user = await withTimeout(authReady, 1500).catch(() => null);
  const profile = user ? await ensureUserProfile(user) : null;

  applyNavForRole(profile);

  if (page === "onboarding") {
    await initOnboarding(user, profile);
    return;
  }
  if (page === "sign-in-email") {
    await initEmailAuth(user, profile);
    return;
  }
  if (page === "sign-in-google") {
    await initGoogleAuth(user, profile);
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
  if (page === "notifications") {
    await initNotifications(user, profile);
  }
}

main().catch((error) => {
  console.error(error);
  renderFatalError(error);
});

window.addEventListener("error", (event) => {
  renderFatalError(event.error || event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  renderFatalError(event.reason);
});
