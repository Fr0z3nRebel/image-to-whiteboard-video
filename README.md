# Image to Sketch Animation — Web

Upload an image, generate a whiteboard-style drawing animation video, all in the browser.

Web port of [daslearning-org/image-to-animation-offline](https://github.com/daslearning-org/image-to-animation-offline).

## Stack

| Layer | Tech |
|---|---|
| Backend | FastAPI + OpenCV + PyAV |
| Frontend | React 19 + TypeScript + Vite |

## Quick start

### Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Frontend (dev)

```bash
cd frontend
npm install
npm run dev        # proxies /api → http://localhost:8000
```

### Production build

```bash
cd frontend && npm run build   # outputs to frontend/dist/
# FastAPI serves the dist/ folder at /
uvicorn app.main:app
```

## Configuration

All generation parameters are exposed in the Settings panel:

| Parameter | Default | Description |
|---|---|---|
| Split length | 10 | Grid size — smaller = finer detail, slower |
| Frame rate | 25 | Output video FPS |
| Object skip rate | 8 | Frames skipped per drawn stroke |
| Background skip rate | 14 | Skip rate for background region |
| End image duration | 2 s | How long the final image is held |
| End with colour | ✓ | Show colour or greyscale at the end |
| Show drawing hand | ✓ | Overlay the drawing hand graphic |
| Cap at 1080p | ✓ | Downscale images larger than 1080p |
