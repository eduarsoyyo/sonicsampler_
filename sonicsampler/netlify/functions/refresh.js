const https = require("https");
const qs    = require("querystring");

const CLIENT_ID    = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET= process.env.SPOTIFY_CLIENT_SECRET;

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
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: "Bad JSON" }; }
  if (!body.refresh_token) return { statusCode: 400, body: JSON.stringify({ error: "missing refresh_token" }) };
  try {
    const data = await spotifyPost({ grant_type: "refresh_token", refresh_token: body.refresh_token });
    if (data.error) return { statusCode: 401, body: JSON.stringify({ error: data.error }) };
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ access_token: data.access_token, expires_in: data.expires_in }) };
  } catch {
    return { statusCode: 500, body: JSON.stringify({ error: "server_error" }) };
  }
};
