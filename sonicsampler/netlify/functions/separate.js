const https = require("https");

const TOKEN     = process.env.REPLICATE_API_TOKEN;
const MODEL_VER = "b2709dae8e6aa898680040c45e7a5e832c7c4c0f7e2e0b57c8eefa48b6c63a47";

function replicateReq(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: "api.replicate.com",
      path, method,
      headers: {
        "Authorization": `Token ${TOKEN}`,
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => { try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); } catch(e) { reject(e); } });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Proxy a stem URL so the browser can download it with a proper filename
// (Replicate URLs have CORS headers but no Content-Disposition)
function proxyDownload(url, filename) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    https.get(url, res => {
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        resolve({
          statusCode: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Access-Control-Allow-Origin": "*",
          },
          body: buf.toString("base64"),
          isBase64Encoded: true,
        });
      });
    }).on("error", reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

exports.handler = async (event) => {
  // ── Proxy download: GET /separate?dl=URL&name=filename ──
  if (event.httpMethod === "GET") {
    const p = event.queryStringParameters || {};
    // Poll mode
    if (p.poll) {
      try {
        const r = await replicateReq("GET", `/v1/predictions/${p.poll}`, null);
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: r.data.status, stems: r.data.output || null, error: r.data.error || null }),
        };
      } catch(e) { return { statusCode: 500, body: e.message }; }
    }
    // Download proxy
    if (p.dl && p.name) {
      try { return await proxyDownload(p.dl, p.name); }
      catch(e) { return { statusCode: 500, body: e.message }; }
    }
    return { statusCode: 400, body: "Bad request" };
  }

  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: "Bad JSON" }; }
  if (!body.audio_url) return { statusCode: 400, body: JSON.stringify({ error: "audio_url required" }) };
  if (!TOKEN)          return { statusCode: 500, body: JSON.stringify({ error: "REPLICATE_API_TOKEN not set" }) };

  try {
    const start = await replicateReq("POST", "/v1/predictions", {
      version: MODEL_VER,
      input: { audio: body.audio_url, model: "htdemucs", stem: "none", output_format: "mp3", clip_mode: "rescale", shifts: 1, overlap: 0.25 },
    });

    if (start.status !== 201) return { statusCode: 500, body: JSON.stringify({ error: "Replicate start failed", detail: start.data }) };

    const predId = start.data.id;

    for (let i = 0; i < 24; i++) {
      await sleep(3000);
      const poll = await replicateReq("GET", `/v1/predictions/${predId}`, null);
      const { status, output, error } = poll.data;
      if (status === "succeeded") {
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ok: true, stems: output, predId }),
        };
      }
      if (status === "failed" || status === "canceled") {
        return { statusCode: 500, body: JSON.stringify({ error: error || "Prediction failed" }) };
      }
    }

    return {
      statusCode: 202,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, pending: true, predId }),
    };
  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
