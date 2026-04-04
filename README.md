# Image to Whiteboard Video

Upload one or more images and get back an MP4 of a hand drawing each one in whiteboard style — no server required.

All processing runs in the browser via Canvas 2D and WebCodecs. The optional FastAPI backend exists for server-side fallback but is not needed for normal use.

## How it works

1. Drop one or more images onto the page
2. Adjust duration and quality (simple mode) or fine-tune individual parameters (advanced mode)
3. Hit **Generate** — frames are rendered client-side and encoded to H.264 with `mp4-muxer`
4. Each clip is cached as compressed chunks so you can reorder images and re-stitch without re-rendering
5. Download the final video

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 15, React 19, TypeScript |
| Video encoding | WebCodecs API + [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) |
| Image processing | Canvas 2D (client-side port of the OpenCV pipeline) |
| Backend (optional) | FastAPI, OpenCV, PyAV |

Requires a Chromium-based browser (Chrome ≥ 94, Edge ≥ 94) or Firefox ≥ 130 for WebCodecs support.

## Quick start

The `dev.sh` script starts both servers with one command:

```bash
./dev.sh
# Frontend: http://localhost:3000
# Backend:  http://localhost:8000
```

Or start them separately:

```bash
# Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev
```

### Production build

```bash
cd frontend && npm run build   # outputs to frontend/.next/
npm run start
```

## Settings

### Simple mode

| Setting | Description |
|---|---|
| Duration per image | Target length of each clip in seconds |
| Quality | Low / Medium / High — controls line detail (grid size) and render time |

### Advanced mode

| Parameter | Default | Description |
|---|---|---|
| Split length | 1 | Grid tile size — smaller = finer detail, slower |
| Frame rate | 30 fps | Output video frame rate |
| Object skip rate | 600 | Frames skipped per drawn stroke (lower = slower animation) |
| End image duration | 2 s | How long the final frame is held |
| End with colour | ✓ | Colour or greyscale final frame |
| Show drawing hand | ✓ | Overlay a hand graphic while drawing |
| Hand tone | mid marker | Light / mid / dark × marker or pencil style |
| Colour the image | ✓ | Render colour strokes during the draw phase |
| Normalise background | ✓ | Flatten uneven lighting before edge detection |
| Cap at 1080p | ✓ | Downscale images larger than 1080p |
