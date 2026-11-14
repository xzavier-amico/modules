// Local Node server for Spotify Mock.
//
//   npm start
//   PORT=8787 HOST=0.0.0.0 npm start
//
// It loads .dev.vars and .env from the service directory (without overriding
// variables already present in the environment), then reuses exactly the same
// handler as the Cloudflare Worker. Optional TLS_CERT / TLS_KEY turn it into an
// HTTPS server; otherwise put it behind a reverse proxy / tunnel for a public
// endpoint.

import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { handle, VERSION } from "./index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(name) {
  const file = path.join(ROOT, name);
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(".env");
loadEnvFile(".dev.vars");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const MAX_REQUEST_BYTES = Number(process.env.MAX_REQUEST_BYTES || 32 * 1024 * 1024);
const QUIET = /^(1|true|yes|on)$/i.test(process.env.QUIET || "");

function log(...args) {
  if (!QUIET) console.log(...args);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        const error = new Error("request body too large");
        error.status = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function requestHeaders(req) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) headers.set(name, value.join(", "));
    else headers.set(name, String(value));
  }
  return headers;
}

function requestAborted(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const message = String(error.message || "");
  return (
    code === "ECONNRESET" ||
    code === "ECONNABORTED" ||
    code === "ERR_STREAM_PREMATURE_CLOSE" ||
    code === "UND_ERR_SOCKET" ||
    error.name === "AbortError" ||
    /aborted|premature close|socket hang up|terminated|other side closed/i.test(message)
  );
}

async function serve(req, res) {
  const started = Date.now();
  let status = 500;
  let extra = "";
  try {
    const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || "http";
    const host = req.headers.host || `${HOST}:${PORT}`;
    const rawUrl = req.url || "/";
    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `${proto}://${host}${rawUrl}`;

    const method = (req.method || "GET").toUpperCase();
    const hasBody = method !== "GET" && method !== "HEAD";
    const body = hasBody ? await readBody(req) : undefined;

    const request = new Request(url, {
      method,
      headers: requestHeaders(req),
      body: body && body.length ? body : undefined,
      redirect: "manual",
    });

    const response = await handle(request, process.env);
    status = response.status;
    const patched = response.headers.get("x-spotify-mock") || "";
    const lyrics = response.headers.get("x-spotify-mock-lyrics") || "";
    const ads = response.headers.get("x-spotify-mock-ads") || "";
    const desktop = response.headers.get("x-spotify-mock-desktop");
    extra =
      (patched ? ` ${patched}` : "") +
      (desktop && /\/bootstrap|\/user-customization-service/.test(req.url || "")
        ? ` desktop=${desktop}`
        : "") +
      (lyrics ? ` lyrics=${lyrics}` : "") +
      (ads ? ` ads=${ads}` : "");

    const buffer = Buffer.from(await response.arrayBuffer());
    const headers = {};
    response.headers.forEach((value, name) => {
      headers[name] = value;
    });
    if (response.statusText) res.writeHead(response.status, response.statusText, headers);
    else res.writeHead(response.status, headers);
    if (method === "HEAD") res.end();
    else res.end(buffer);
  } catch (error) {
    // Spotify regularly cancels in-flight metadata / connect-state requests
    // (user skips a track, screen closes). That is a client abort, not a server
    // failure: answer with 499, do not try to write a response, and do not log
    // a stack trace. Upstream sockets that are reset / terminated mid-response
    // are treated the same way: a JSON 500 is worse than a dropped connection
    // for a client that expects protobuf.
    if (requestAborted(error)) {
      status = 499;
      if (!res.destroyed) res.destroy();
      return;
    }
    status = Number(error && error.status) || 500;
    if (!res.headersSent) {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          error: status === 413 ? "request body too large" : "internal error",
          service: "spotify-mock",
        }) + "\n",
      );
    } else {
      res.destroy();
    }
    if (status >= 500) console.error("spotify-mock: local request failed:", error);
  } finally {
    log(`${req.method} ${req.url} -> ${status} (${Date.now() - started}ms)${extra}`);
  }
}

const tlsCert = process.env.TLS_CERT;
const tlsKey = process.env.TLS_KEY;

if ((tlsCert && !tlsKey) || (!tlsCert && tlsKey)) {
  console.error("spotify-mock: set both TLS_CERT and TLS_KEY, or neither");
  process.exit(1);
}

const server =
  tlsCert && tlsKey
    ? https.createServer(
        {
          cert: fs.readFileSync(path.resolve(ROOT, tlsCert)),
          key: fs.readFileSync(path.resolve(ROOT, tlsKey)),
        },
        serve,
      )
    : http.createServer(serve);

server.on("error", (error) => {
  console.error("spotify-mock: server error:", error);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const scheme = tlsCert && tlsKey ? "https" : "http";
  console.log(`spotify-mock v${VERSION} listening on ${scheme}://${HOST}:${PORT}`);
  console.log(`  health: ${scheme}://${HOST}:${PORT}/health`);
  console.log(`  module mock_base: ${scheme}://<your-host>:${PORT}/music`);
  console.log(
    `  options: spoofPremium=${process.env.SPOOF_PREMIUM ?? "true"} blockAds=${process.env.BLOCK_ADS ?? "true"} unlockPlayback=${process.env.UNLOCK_PLAYBACK ?? "auto (mobile on, desktop off)"} desktop=${process.env.DESKTOP ?? "auto"} lyrics=${process.env.LYRICS_ENABLED ?? "true"} lyricsSource=${process.env.LYRICS_SOURCE ?? "lrclib"}`,
  );
  if (process.env.MOCK_PREFIX) console.log(`  path prefix: ${process.env.MOCK_PREFIX}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`\nspotify-mock: ${signal}, shutting down`);
    server.close(() => process.exit(0));
  });
}
