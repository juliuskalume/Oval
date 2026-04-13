const CACHE_VERSION = "v27";
const STATIC_CACHE = `oval-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `oval-runtime-${CACHE_VERSION}`;
const OFFLINE_URL = "./offline.html";

const APP_SHELL_FILES = [
  "./",
  "./index.html",
  "./offline.html",
  "./onboarding.html",
  "./sign-in-email.html",
  "./feed.html",
  "./details.html",
  "./search.html",
  "./profile.html",
  "./create-post.html",
  "./creator-dashboard.html",
  "./admin-moderation.html",
  "./comments.html",
  "./inbox.html",
  "./settings.html",
  "./terms.html",
  "./privacy.html",
  "./delete-account.html",
  "./edit-post.html",
  "./manifest.webmanifest",
  "./styles/theme.css",
  "./styles/material-symbols.css",
  "./scripts/app.js",
  "./scripts/firebase.js",
  "./scripts/sample-data.js",
  "./assets/fonts/material-symbols-outlined.woff2",
  "./assets/icons/instagram-like.png",
  "./assets/pwa/icon-any-192.png",
  "./assets/pwa/icon-any-512.png",
  "./assets/pwa/icon-maskable-192.png",
  "./assets/pwa/icon-maskable-512.png",
  "./assets/pwa/apple-touch-icon-v2.png"
];

const EXTERNAL_STATIC_FILES = [
  "https://cdn.tailwindcss.com",
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js"
];

async function cacheSameOriginAsset(cache, url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (response.ok) {
    await cache.put(url, response);
  }
}

async function cacheExternalAsset(cache, url) {
  try {
    const request = new Request(url, { mode: "no-cors", cache: "no-cache" });
    const response = await fetch(request);
    if (response) {
      await cache.put(url, response);
    }
  } catch (error) {}
}

function isStaticExternalAsset(url) {
  if (url.origin === "https://cdn.tailwindcss.com") {
    return true;
  }
  if (url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com") {
    return true;
  }
  return url.origin === "https://www.gstatic.com" && url.pathname.includes("/firebasejs/");
}

function isCacheableExternalMediaAsset(url) {
  const host = url.hostname.toLowerCase();
  return host === "images.unsplash.com"
    || host === "firebasestorage.googleapis.com"
    || host === "storage.googleapis.com"
    || host === "lh3.googleusercontent.com"
    || host.endsWith(".googleusercontent.com")
    || host.endsWith(".firebasestorage.app");
}

async function networkFirstNavigation(event) {
  const preload = await event.preloadResponse;
  if (preload) {
    return preload;
  }

  try {
    const response = await fetch(event.request);
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(event.request, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(event.request, { ignoreSearch: true });
    return cached || caches.match(OFFLINE_URL);
  }
}

async function staleWhileRevalidate(request, options = {}) {
  const ignoreSearch = options.ignoreSearch !== false;
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request, { ignoreSearch });
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === "opaque")) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || networkPromise || Response.error();
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await Promise.all(APP_SHELL_FILES.map((url) => cacheSameOriginAsset(cache, url)));
    await Promise.all(EXTERNAL_STATIC_FILES.map((url) => cacheExternalAsset(cache, url)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((name) => ![STATIC_CACHE, RUNTIME_CACHE].includes(name))
        .map((name) => caches.delete(name)),
    );
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(event));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (isStaticExternalAsset(url)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (isCacheableExternalMediaAsset(url)) {
    event.respondWith(staleWhileRevalidate(request, { ignoreSearch: false }));
  }
});
