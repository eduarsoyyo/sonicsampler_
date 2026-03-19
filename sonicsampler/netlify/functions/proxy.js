// Proxies external audio URLs so the browser can load them without CORS errors.
// Only allows URLs from trusted Replicate delivery domains.
// Usage: GET /.netlify/functions/proxy?url=https://replicate.delivery/...

const https = require("https");
const http  = require("http");
const { URL } = require("url");

const ALLOWED_HOSTS = [
  "replicate.delivery",
  "pbxt.cdn.replicate.delivery",
  "storage.googleapis.com",
];

exports.handler = async (event) => {
  const targetUrl = (event.queryStringParameters || {}).url;

  if (!targetUrl) {
    return { statusCode: 400, body: "Missing ?url= parameter" };
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return { statusCode: 400, body: "Invalid URL" };
  }

  // Security: only allow known Replicate delivery domains
  const allowed = ALLOWED_HOSTS.some(h => parsed.hostname === h || parsed.hostname.endsWith("." + h));
  if (!allowed) {
    return { statusCode: 403, body: "URL not allowed. Only Replicate delivery URLs are accepted." };
  }

  const lib = parsed.protocol === "https:" ? https : http;

  return new Promise((resolve) => {
    const req = lib.get(targetUrl, { timeout: 30000 }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        resolve({
          statusCode: 200,
          headers: {
            "Content-Type":                res.headers["content-type"] || "audio/mpeg",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control":               "public, max-age=86400",
          },
          body:             buf.toString("base64"),
          isBase64Encoded:  true,
        });
      });
    });

    req.on("error", err => {
      resolve({ statusCode: 502, body: "Proxy fetch error: " + err.message });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({ statusCode: 504, body: "Proxy timeout" });
    });
  });
};
