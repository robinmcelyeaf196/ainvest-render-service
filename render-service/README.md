# AInvest Render Service

Small HTTP service for n8n Cloud. It downloads the AInvest screen recording, HeyGen avatar video, and SRT captions, then runs ffmpeg and returns the final MP4 as the response body. It can also store uploaded SRT/MP4 files and serve them back with public `/files/...` URLs.

The default composition is designed for 16:9 product-first demos: the product screen recording or screenshots are shown at a normal contained size over a soft product-derived background, the keyed avatar is kept small in the lower-left corner, captions sit to the avatar's right, and burned-in captions use white text with a blue outline.

## Endpoints

- `GET /health`
- `POST /render`
- `POST /upload?kind=captions|final_video|asset&idea_id=...`
- `GET /files/<file-name>`

`POST /render` body:

```json
{
  "idea_id": "test_001",
  "screen_recording_url": "https://drive.google.com/file/d/.../view",
  "heygen_video_url": "https://files.heygen.ai/video/abc123.mp4",
  "srt_content": "1\n00:00:00,000 --> 00:00:02,000\nCaption text\n",
  "highlight_box": { "x": 0.56, "y": 0.42, "w": 0.22, "h": 0.07 }
}
```

`highlight_box` is optional. If omitted, the service applies a default blue highlight box at `{"x":0.56,"y":0.42,"w":0.22,"h":0.07}`. Values from 0 to 1 are treated as percentages of the 1280x720 render frame; larger values are treated as pixels.

For ordered screenshots instead of a screen recording, send the image URLs in display order:

```json
{
  "idea_id": "test_001",
  "screenshot_urls": [
    "https://example.com/step-1.png",
    "https://example.com/step-2.png",
    "https://example.com/step-3.png"
  ],
  "screenshot_duration_seconds": 3,
  "heygen_video_url": "https://files.heygen.ai/video/abc123.mp4",
  "srt_content": "1\n00:00:00,000 --> 00:00:02,000\nCaption text\n"
}
```

When `screen_recording_url` is used, the service probes the recording duration and renders to that length. When `screenshot_urls` is used, duration is `screenshot_urls.length * screenshot_duration_seconds`.

## n8n Google Sheet Fields

For the n8n Cloud workflow, `Sheet1` should include these optional columns when a job uses screenshots instead of one recording:

- `screenshot_urls`: public image URLs in display order. Use one URL per line, or a JSON array.
- `screenshot_duration_seconds`: seconds to show each screenshot. Defaults to `3`.
- `highlight_box`: optional JSON object such as `{"x":0.56,"y":0.42,"w":0.22,"h":0.07}`.

If `screen_recording_url` is filled, the workflow should use the recording. If `screenshot_urls` is filled and `screen_recording_url` is empty, the workflow should send `screenshot_urls` to `/render` in the same order shown in the sheet.

If `RENDER_API_KEY` is set, callers must send it as the `x-render-key` header.

`POST /upload` accepts the raw file body and returns JSON like:

```json
{
  "ok": true,
  "file_name": "final_video-test_001-uuid.mp4",
  "url": "https://your-service.example.com/files/final_video-test_001-uuid.mp4",
  "bytes": 1234567
}
```

Recommended headers:

- `x-render-key: <your secret>`
- `x-file-name: ainvest-demo-test_001.mp4`

## Run locally

```bash
docker build -t ainvest-render-service .
docker run --rm -p 8080:8080 -e RENDER_API_KEY=change-me ainvest-render-service
```

## Deploy

Deploy this folder as a Docker service on Render, Railway, Fly.io, or Google Cloud Run. Set:

```bash
RENDER_API_KEY=your-long-random-secret
PORT=8080
```

Then set n8n variables:

```bash
RENDER_API_URL=https://your-service.example.com/render
RENDER_API_KEY=your-long-random-secret
```

The workflow derives the upload endpoint from `RENDER_API_URL`, so if `RENDER_API_URL` is set to `https://your-service.example.com/render`, uploads will automatically go to `https://your-service.example.com/upload`.
