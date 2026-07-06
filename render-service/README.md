# AInvest Render Service

Small HTTP service for n8n Cloud. It downloads the AInvest screen recording, HeyGen avatar video, and SRT captions, then runs ffmpeg and returns the final MP4 as the response body. It can also store uploaded SRT/MP4 files and serve them back with public `/files/...` URLs.

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
  "srt_content": "1\n00:00:00,000 --> 00:00:02,000\nCaption text\n"
}
```

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
