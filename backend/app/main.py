import asyncio
import os
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="Image to Animation API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store generated videos temporarily (in-memory dict: job_id -> bytes)
_jobs: dict[str, dict] = {}

FRONTEND_DIST = Path(__file__).parent.parent.parent / "frontend" / "dist"


@app.post("/api/generate")
async def generate(
    image: UploadFile = File(...),
    split_len: int = Form(10),
    frame_rate: int = Form(25),
    object_skip_rate: int = Form(8),
    bg_object_skip_rate: int = Form(14),
    main_img_duration: int = Form(2),
    end_color: bool = Form(True),
    draw_hand: bool = Form(True),
    max_1080p: bool = Form(True),
    draw_color: bool = Form(False),
):
    """Accept an image upload and return a sketch animation video."""
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    image_bytes = await image.read()

    # Run the CPU-heavy work in a thread so we don't block the event loop
    from app.sketch import generate_sketch_video

    loop = asyncio.get_running_loop()
    try:
        video_bytes: bytes = await loop.run_in_executor(
            None,
            lambda: generate_sketch_video(
                image_bytes=image_bytes,
                split_len=split_len,
                frame_rate=frame_rate,
                object_skip_rate=object_skip_rate,
                bg_object_skip_rate=bg_object_skip_rate,
                main_img_duration=main_img_duration,
                end_color=end_color,
                draw_hand=draw_hand,
                max_1080p=max_1080p,
                draw_color=draw_color,
            ),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return StreamingResponse(
        iter([video_bytes]),
        media_type="video/mp4",
        headers={"Content-Disposition": 'attachment; filename="sketch.mp4"'},
    )


@app.get("/api/health")
def health():
    return {"status": "ok"}


# Serve React frontend in production (when dist/ exists)
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="static")
