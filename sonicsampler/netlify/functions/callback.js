const https = require("https");
const qs    = require("querystring");

const CLIENT_ID    = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET= process.env.SPOTIFY_CLIENT_SECRET;
const SITE_URL     = process.env.URL || "http://localhost:8888";
const REDIRECT_URI = `${SITE_URL}/.netlify/functions/callback`;

function spotifyPost(data) {
  return new Promise((resolve, reject) => {
    const body = qs.stringify(data);
    const req = https.request({
      hostname: "accounts.spotify.com",
      path: "/api/token",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
        "Authorization": "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
      },
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => { try { resolve(JSON.parse(raw)); } catch(e) { reject(e); } });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  const p = event.queryStringParameters || {};

  if (p.action === "login") {
    const scopes = [
      "streaming","user-read-email","user-read-private",
      "user-read-playback-state","user-modify-playback-state",
    ].join(" ");
    const url = "https://accounts.spotify.com/authorize?" + qs.stringify({
      client_id: CLIENT_ID, response_type: "code",
      redirect_uri: REDIRECT_URI, scope: scopes, show_dialog: false,
    });
    return { statusCode: 302, headers: { Location: url }, body: "" };
  }

  if (p.error) return { statusCode: 302, headers: { Location: `${SITE_URL}/?auth_error=${p.error}` }, body: "" };
  if (!p.code) return { statusCode: 302, headers: { Location: `${SITE_URL}/.netlify/functions/callback?action=login` }, body: "" };

  try {
    const tokens = await spotifyPost({ grant_type: "authorization_code", code: p.code, redirect_uri: REDIRECT_URI });
    if (tokens.error) return { statusCode: 302, headers: { Location: `${SITE_URL}/?auth_error=${tokens.error}` }, body: "" };
    const frag = qs.stringify({ access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_in: tokens.expires_in });
    return { statusCode: 302, headers: { Location: `${SITE_URL}/#${frag}` }, body: "" };
  } catch {
    return { statusCode: 302, headers: { Location: `${SITE_URL}/?auth_error=server_error` }, body: "" };
  }
};
