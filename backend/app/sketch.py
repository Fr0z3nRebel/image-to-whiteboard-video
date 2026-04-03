"""
Core whiteboard sketch animation logic.
Ported from kivy/sketchApi.py — pure NumPy/OpenCV, no Kivy dependency.
"""

import json
import math
import os
import time
from pathlib import Path
from typing import Callable, Optional

import av
import cv2
import numpy as np

BASE_DIR = Path(__file__).parent.parent
IMAGES_DIR = BASE_DIR / "data" / "images"
HAND_PATH = str(IMAGES_DIR / "drawing-hand.png")
HAND_MASK_PATH = str(IMAGES_DIR / "hand-mask.png")

_STANDARD_RES = np.array(
    [360, 480, 640, 720, 1080, 1280, 1440, 1920, 2160, 2560, 3840, 4320, 7680]
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def euc_dist(arr: np.ndarray, point: np.ndarray) -> np.ndarray:
    return np.sqrt(np.sum((arr - point) ** 2, axis=1))


def find_nearest_res(value: int) -> int:
    idx = int(np.abs(_STANDARD_RES - value).argmin())
    return int(_STANDARD_RES[idx])


def resize_with_padding(
    img: np.ndarray, target_width: int, target_height: int, color=(255, 255, 255)
) -> np.ndarray:
    h, w = img.shape[:2]
    scale = min(target_width / w, target_height / h)
    new_w, new_h = int(w * scale), int(h * scale)
    resized = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
    pad_w, pad_h = target_width - new_w, target_height - new_h
    top, bottom = pad_h // 2, pad_h - pad_h // 2
    left, right = pad_w // 2, pad_w - pad_w // 2
    return cv2.copyMakeBorder(resized, top, bottom, left, right, cv2.BORDER_CONSTANT, value=color)


def get_extreme_coordinates(mask: np.ndarray):
    indices = np.where(mask == 255)
    x, y = indices[1], indices[0]
    return (int(np.min(x)), int(np.min(y))), (int(np.max(x)), int(np.max(y)))


# ---------------------------------------------------------------------------
# Variables container
# ---------------------------------------------------------------------------

class SketchVariables:
    def __init__(
        self,
        frame_rate: int,
        resize_wd: int,
        resize_ht: int,
        split_len: int,
        object_skip_rate: int,
        bg_object_skip_rate: int,
        end_gray_img_duration_in_sec: int,
        draw_hand: bool = True,
    ):
        self.frame_rate = frame_rate
        self.resize_wd = resize_wd
        self.resize_ht = resize_ht
        self.split_len = split_len
        self.object_skip_rate = object_skip_rate
        self.bg_object_skip_rate = bg_object_skip_rate
        self.end_gray_img_duration_in_sec = end_gray_img_duration_in_sec
        self.draw_hand = draw_hand
        self.draw_color = False
        self.normalize_bg = False
        # populated at runtime
        self.img = None
        self.img_gray = None
        self.img_thresh = None
        self.img_ht = 0
        self.img_wd = 0
        self.drawn_frame = None
        self.video_object = None
        self.hand = None
        self.hand_mask = None
        self.hand_mask_inv = None
        self.hand_ht = 0
        self.hand_wd = 0


# ---------------------------------------------------------------------------
# Preprocessing
# ---------------------------------------------------------------------------

def preprocess_image(img: np.ndarray, variables: SketchVariables) -> SketchVariables:
    variables.img_ht, variables.img_wd = img.shape[0], img.shape[1]
    img = cv2.resize(img, (variables.resize_wd, variables.resize_ht))

    # Snap near-white (off-white / antique-white) pixels to pure white
    if variables.normalize_bg:
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        near_white = (hsv[:, :, 1] < 30) & (hsv[:, :, 2] > 200)
        img[near_white] = [255, 255, 255]

    img_gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(3, 3))
    clahe.apply(img_gray)
    img_thresh = cv2.adaptiveThreshold(
        img_gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 15, 10
    )
    variables.img_gray = img_gray
    variables.img_thresh = img_thresh
    variables.img = img
    return variables


def preprocess_hand_image(variables: SketchVariables) -> SketchVariables:
    hand = cv2.imread(HAND_PATH)
    hand_mask = cv2.imread(HAND_MASK_PATH, cv2.IMREAD_GRAYSCALE)
    tl, br = get_extreme_coordinates(hand_mask)
    hand = hand[tl[1]:br[1], tl[0]:br[0]]
    hand_mask = hand_mask[tl[1]:br[1], tl[0]:br[0]]
    hand_mask_inv = 255 - hand_mask
    hand_mask = hand_mask / 255.0
    hand_mask_inv = hand_mask_inv / 255.0
    hand[hand_mask == 0] = [0, 0, 0]
    variables.hand_ht, variables.hand_wd = hand.shape[0], hand.shape[1]
    variables.hand = hand
    variables.hand_mask = hand_mask
    variables.hand_mask_inv = hand_mask_inv
    return variables


# ---------------------------------------------------------------------------
# Drawing
# ---------------------------------------------------------------------------

def draw_hand_on_img(
    drawing: np.ndarray,
    hand: np.ndarray,
    dx: int,
    dy: int,
    hand_mask_inv: np.ndarray,
    hand_ht: int,
    hand_wd: int,
    img_ht: int,
    img_wd: int,
) -> np.ndarray:
    crop_ht = min(hand_ht, img_ht - dy)
    crop_wd = min(hand_wd, img_wd - dx)
    h_crop = hand[:crop_ht, :crop_wd]
    hmi_crop = hand_mask_inv[:crop_ht, :crop_wd]
    roi = drawing[dy:dy + crop_ht, dx:dx + crop_wd]
    for c in range(3):
        roi[:, :, c] = roi[:, :, c] * hmi_crop
    drawing[dy:dy + crop_ht, dx:dx + crop_wd] = roi + h_crop
    return drawing


def draw_masked_object(
    variables: SketchVariables,
    object_mask: Optional[np.ndarray] = None,
    skip_rate: int = 5,
    black_pixel_threshold: int = 10,
    progress_callback: Optional[Callable[[float], None]] = None,
):
    img_thresh_copy = variables.img_thresh.copy()
    object_ind = None
    if object_mask is not None:
        object_mask_black_ind = np.where(object_mask == 0)
        object_ind = np.where(object_mask == 255)
        img_thresh_copy[object_mask_black_ind] = 255

    n_v = int(math.ceil(variables.resize_ht / variables.split_len))
    n_h = int(math.ceil(variables.resize_wd / variables.split_len))
    grid = np.array(np.split(img_thresh_copy, n_h, axis=-1))
    grid = np.array(np.split(grid, n_v, axis=-2))

    # Color grid: split the BGR image the same way for draw_color mode
    if variables.draw_color:
        color_grid = np.array(np.split(variables.img, n_h, axis=1))
        color_grid = np.array(np.split(color_grid, n_v, axis=1))

    has_black = (grid < black_pixel_threshold).sum(axis=(-1, -2)) > 0
    cut_black_indices = np.array(np.where(has_black)).T

    if len(cut_black_indices) == 0:
        return

    selected_ind = 0
    step_div = max(len(cut_black_indices) / 40, 1)
    progress_step = 100 / step_div
    sk_progress = 0.0
    counter = 0

    while len(cut_black_indices) > 1:
        sel = cut_black_indices[selected_ind].copy()
        rv_s = sel[0] * variables.split_len
        rv_e = rv_s + variables.split_len
        rh_s = sel[1] * variables.split_len
        rh_e = rh_s + variables.split_len

        tile = grid[sel[0]][sel[1]]
        if variables.draw_color:
            temp = color_grid[sel[0]][sel[1]]
        else:
            temp = np.stack([tile, tile, tile], axis=-1)
        variables.drawn_frame[rv_s:rv_e, rh_s:rh_e] = temp

        if variables.draw_hand:
            dx = rh_s + variables.split_len // 2
            dy = rv_s + variables.split_len // 2
            frame_with_hand = draw_hand_on_img(
                variables.drawn_frame.copy(),
                variables.hand.copy(),
                dx, dy,
                variables.hand_mask_inv.copy(),
                variables.hand_ht, variables.hand_wd,
                variables.resize_ht, variables.resize_wd,
            )
        else:
            frame_with_hand = variables.drawn_frame.copy()

        cut_black_indices[selected_ind] = cut_black_indices[-1]
        cut_black_indices = cut_black_indices[:-1]

        euc = euc_dist(cut_black_indices, sel)
        selected_ind = int(np.argmin(euc))
        counter += 1

        if counter % skip_rate == 0:
            variables.video_object.write(frame_with_hand)

        if counter % 40 == 0:
            sk_progress = min(sk_progress + progress_step, 100)
            if progress_callback:
                progress_callback(sk_progress)

    if object_ind is not None:
        variables.drawn_frame[:, :, :][object_ind] = variables.img[object_ind]
    else:
        variables.drawn_frame[:, :, :] = variables.img


# ---------------------------------------------------------------------------
# ffmpeg re-encode via PyAV
# ---------------------------------------------------------------------------

def ffmpeg_convert(source: str, dest: str) -> bool:
    try:
        ic = av.open(source, mode="r")
        oc = av.open(dest, mode="w")
        in_s = ic.streams.video[0]
        out_s = oc.add_stream("h264", rate=in_s.average_rate)
        out_s.width = in_s.codec_context.width
        out_s.height = in_s.codec_context.height
        out_s.pix_fmt = "yuv420p"
        out_s.options = {"crf": "20"}
        for frame in ic.decode(video=0):
            for pkt in out_s.encode(frame):
                oc.mux(pkt)
        for pkt in out_s.encode(None):
            oc.mux(pkt)
        oc.close()
        ic.close()
        return True
    except Exception as e:
        print(f"ffmpeg_convert error: {e}")
        return False


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def generate_sketch_video(
    image_bytes: bytes,
    split_len: int = 10,
    frame_rate: int = 25,
    object_skip_rate: int = 8,
    bg_object_skip_rate: int = 14,
    main_img_duration: int = 2,
    end_color: bool = True,
    draw_hand: bool = True,
    max_1080p: bool = True,
    draw_color: bool = False,
    normalize_bg: bool = False,
    progress_callback: Optional[Callable[[float], None]] = None,
) -> bytes:
    """
    Convert raw image bytes → whiteboard sketch animation MP4 bytes.
    Raises on error.
    """
    import tempfile

    # Decode image
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img_bgr is None:
        raise ValueError("Could not decode image")

    img_ht, img_wd = img_bgr.shape[:2]

    # Optionally cap resolution
    if max_1080p and (img_ht > 1920 or img_wd > 1920):
        if img_wd >= img_ht:
            img_wd, img_ht = 1920, 1080
        else:
            img_wd, img_ht = 1080, 1920
        img_bgr = resize_with_padding(img_bgr, img_wd, img_ht)
    else:
        aspect = img_wd / img_ht
        img_ht = find_nearest_res(img_ht)
        img_wd = find_nearest_res(int(img_ht * aspect))

    variables = SketchVariables(
        frame_rate=frame_rate,
        resize_wd=img_wd,
        resize_ht=img_ht,
        split_len=split_len,
        object_skip_rate=object_skip_rate,
        bg_object_skip_rate=bg_object_skip_rate,
        end_gray_img_duration_in_sec=main_img_duration,
        draw_hand=draw_hand,
    )
    variables.draw_color = draw_color
    variables.normalize_bg = normalize_bg

    variables = preprocess_image(img_bgr, variables)
    variables = preprocess_hand_image(variables)

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as raw_f:
        raw_path = raw_f.name
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as h264_f:
        h264_path = h264_f.name

    try:
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        variables.video_object = cv2.VideoWriter(
            raw_path, fourcc, frame_rate, (img_wd, img_ht)
        )
        variables.drawn_frame = (
            np.zeros(variables.img.shape, np.uint8) + np.array([255, 255, 255], np.uint8)
        )

        # Track overall progress across two phases (object + bg)
        def make_progress(offset: float, scale: float):
            def cb(v: float):
                if progress_callback:
                    progress_callback(min(offset + v * scale, 99))
            return cb

        draw_masked_object(
            variables,
            skip_rate=object_skip_rate,
            progress_callback=make_progress(0, 1.0),
        )

        end_img = variables.img if end_color else cv2.cvtColor(variables.img_thresh, cv2.COLOR_GRAY2BGR)
        for _ in range(frame_rate * main_img_duration):
            variables.video_object.write(end_img)

        variables.video_object.release()

        ok = ffmpeg_convert(raw_path, h264_path)
        read_path = h264_path if ok else raw_path

        with open(read_path, "rb") as f:
            video_bytes = f.read()

        if progress_callback:
            progress_callback(100)

        return video_bytes
    finally:
        for p in (raw_path, h264_path):
            try:
                os.unlink(p)
            except OSError:
                pass
