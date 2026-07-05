const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 8080);
const API_KEY = process.env.RENDER_API_KEY || "";
const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 1_000_000);
const MAX_DOWNLOAD_BYTES = Number(process.env.MAX_DOWNLOAD_BYTES || 750_000_000);

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": body.length,
  });
  res.end(body);
}

function requireAuth(req, res) {
  if (!API_KEY) return true;
  const provided = req.headers["x-render-key"] || "";
  if (provided === API_KEY) return true;
  sendJson(res, 401, { error: "Unauthorized" });
  return false;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${error.message}`));
      }
    });
    req.on("error", reject);
  });
}

function normalizeDownloadUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) throw new Error("Missing URL");
  const parsed = new URL(value);
  const driveMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/);
  if (parsed.hostname.includes("drive.google.com") && driveMatch) {
    return `https://drive.google.com/uc?export=download&id=${driveMatch[1]}`;
  }
  return value;
}

function downloadToFile(rawUrl, filePath, redirectCount = 0) {
  const url = normalizeDownloadUrl(rawUrl);
  const parsed = new URL(url);
  const client = parsed.protocol === "http:" ? http : https;
  return new Promise((resolve, reject) => {
    const request = client.get(parsed, (response) => {
      const location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && location) {
        response.resume();
        if (redirectCount >= 10) {
          reject(new Error(`Too many redirects for ${rawUrl}`));
          return;
        }
        const redirected = new URL(location, parsed).toString();
        downloadToFile(redirected, filePath, redirectCount + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Download failed ${response.statusCode} for ${rawUrl}`));
        return;
      }
      const output = fs.createWriteStream(filePath);
      let total = 0;
      response.on("data", (chunk) => {
        total += chunk.length;
        if (total > MAX_DOWNLOAD_BYTES) {
          request.destroy(new Error("Downloaded file exceeds MAX_DOWNLOAD_BYTES"));
          output.destroy();
        }
      });
      response.pipe(output);
      output.on("finish", () => output.close(resolve));
      output.on("error", reject);
    });
    request.on("error", reject);
    request.setTimeout(300_000, () => request.destroy(new Error(`Download timed out for ${rawUrl}`)));
  });
}

function runFfmpeg(workDir) {
  const args = [
    "-y",
    "-i",
    "screen_recording.mp4",
    "-i",
    "heygen_avatar.mp4",
    "-filter_complex",
    "[1:v]chromakey=0x00FF00:0.1:0.2,scale=360:640[avatar];[0:v][avatar]overlay=W-w-20:H-h-20[base];[base]subtitles=captions.srt:force_style='Fontsize=22,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,BorderStyle=3'[final]",
    "-map",
    "[final]",
    "-map",
    "1:a?",
    "-c:v",
    "libx264",
    "-crf",
    "20",
    "-preset",
    "veryfast",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "final_output.mp4",
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_BIN, args, { cwd: workDir });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 12_000) stderr = stderr.slice(-12_000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with ${code}: ${stderr}`));
    });
  });
}

async function handleRender(req, res) {
  if (!requireAuth(req, res)) return;
  let workDir;
  try {
    const body = await readJsonBody(req);
    const screenUrl = body.screen_recording_url;
    const avatarUrl = body.heygen_video_url;
    const srtContent = String(body.srt_content || "").trim();
    if (!screenUrl) throw new Error("screen_recording_url is required");
    if (!avatarUrl) throw new Error("heygen_video_url is required");
    if (!srtContent) throw new Error("srt_content is required");

    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "ainvest-render-"));
    await Promise.all([
      downloadToFile(screenUrl, path.join(workDir, "screen_recording.mp4")),
      downloadToFile(avatarUrl, path.join(workDir, "heygen_avatar.mp4")),
    ]);
    fs.writeFileSync(path.join(workDir, "captions.srt"), srtContent + "\n", "utf8");
    await runFfmpeg(workDir);

    const outputPath = path.join(workDir, "final_output.mp4");
    const stat = fs.statSync(outputPath);
    const fileName = `${String(body.idea_id || "ainvest-demo").replace(/[^A-Za-z0-9_-]/g, "_")}.mp4`;
    res.writeHead(200, {
      "content-type": "video/mp4",
      "content-length": stat.size,
      "content-disposition": `attachment; filename="${fileName}"`,
      "x-render-id": crypto.randomUUID(),
    });
    fs.createReadStream(outputPath).pipe(res);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  } finally {
    if (workDir) {
      setTimeout(() => fs.rm(workDir, { recursive: true, force: true }, () => {}), 30_000);
    }
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true, ffmpeg: FFMPEG_BIN });
    return;
  }
  if (req.method === "POST" && req.url === "/render") {
    handleRender(req, res);
    return;
  }
  sendJson(res, 404, { error: "Not found" });
});

server.requestTimeout = 900_000;
server.listen(PORT, () => {
  console.log(`AInvest render service listening on ${PORT}`);
});
