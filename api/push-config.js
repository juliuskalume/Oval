export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.statusCode = 405;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ error: "Method not allowed." }));
    return;
  }

  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "public, max-age=300");
  response.end(JSON.stringify({
    vapidKey: process.env.OVAL_FIREBASE_VAPID_KEY || process.env.FIREBASE_VAPID_KEY || "",
    appBaseUrl: process.env.OVAL_APP_BASE_URL || "https://oval-nine.vercel.app",
  }));
}
