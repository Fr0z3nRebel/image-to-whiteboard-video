/**
 * Client-side sketch animation processor.
 * Ports the Python/OpenCV backend logic to pure TypeScript using Canvas 2D.
 */

export interface SketchSettings {
  splitLen: number
  frameRate: number
  objectSkipRate: number
  mainImgDuration: number
  endColor: boolean
  drawHand: boolean
  handTone: 'light' | 'mid' | 'dark' | 'light-pencil' | 'mid-pencil' | 'dark-pencil'
  handScale: number
  max1080p: boolean
  drawColor: boolean
  normalizeBg: boolean
  colorStrokeSize: number
  /** When set, objectSkipRate is ignored and computed from actual tile count to hit this duration. */
  targetDurationSec?: number
}

export type SimpleQuality = 'low' | 'medium' | 'high'

export const DEFAULT_SETTINGS: SketchSettings = {
  splitLen: 1,
  frameRate: 30,
  objectSkipRate: 600,
  mainImgDuration: 2,
  endColor: true,
  drawHand: true,
  handTone: 'mid',
  handScale: 1.0,
  max1080p: true,
  drawColor: true,
  normalizeBg: true,
  colorStrokeSize: 4,
}

function splitLenFromQuality(quality: SimpleQuality): number {
  switch (quality) {
    case 'low':
      return 3
    case 'medium':
      return 2
    case 'high':
    default:
      return 1
  }
}

/**
 * Return settings for simple mode. The processor will compute objectSkipRate
 * at runtime from the actual tile count so the clip hits targetDurationSec.
 */
export function settingsFromDuration(
  durationSec: number,
  quality: SimpleQuality = 'high',
): Pick<SketchSettings, 'splitLen' | 'frameRate' | 'objectSkipRate' | 'mainImgDuration' | 'colorStrokeSize' | 'targetDurationSec'> {
  const frameRate = 30
  const mainImgDuration = Math.max(1, Math.min(Math.round(durationSec * 0.15), 5))
  return {
    frameRate,
    mainImgDuration,
    splitLen: splitLenFromQuality(quality),
    objectSkipRate: 600,
    colorStrokeSize: 4,
    targetDurationSec: durationSec,
  }
}

// Standard resolutions the backend snaps to
const STANDARD_RES = [360, 480, 640, 720, 1080, 1280, 1440, 1920, 2160, 2560, 3840, 4320, 7680]

function findNearestRes(value: number): number {
  let best = STANDARD_RES[0]
  let bestDiff = Math.abs(value - best)
  for (const r of STANDARD_RES) {
    const d = Math.abs(value - r)
    if (d < bestDiff) { bestDiff = d; best = r }
  }
  return best
}

/** Load an image URL into an ImageData at specific dimensions */
async function loadImageData(url: string, w: number, h: number): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = w; c.height = h
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)
      resolve(ctx.getImageData(0, 0, w, h))
    }
    img.onerror = reject
    img.src = url
  })
}

/** Convert an ImageData to grayscale (returns Float32Array of [0,255]) */
function toGrayscale(data: ImageData): Float32Array {
  const gray = new Float32Array(data.width * data.height)
  const d = data.data
  for (let i = 0; i < gray.length; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]
    gray[i] = 0.114 * r + 0.587 * g + 0.299 * b
  }
  return gray
}

/**
 * Approximate adaptive threshold (Gaussian mean, blockSize=15, C=10).
 * Returns Uint8Array where 255 = above threshold (background), 0 = below (ink).
 */
function adaptiveThreshold(gray: Float32Array, w: number, h: number): Uint8Array {
  const radius = 7 // half of blockSize=15
  const C = 10
  const thresh = new Uint8Array(w * h)
  // Box-blur approximation of Gaussian mean
  const blurred = boxBlur(gray, w, h, radius)
  for (let i = 0; i < thresh.length; i++) {
    thresh[i] = gray[i] < blurred[i] - C ? 0 : 255
  }
  return thresh
}

/** Fast box blur using prefix sums */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const out = new Float32Array(w * h)
  // Horizontal pass
  const tmp = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    let sum = 0, count = 0
    for (let x = 0; x < Math.min(r, w); x++) { sum += src[y * w + x]; count++ }
    for (let x = 0; x < w; x++) {
      if (x + r < w) { sum += src[y * w + x + r]; count++ }
      if (x - r - 1 >= 0) { sum -= src[y * w + x - r - 1]; count-- }
      tmp[y * w + x] = sum / count
    }
  }
  // Vertical pass
  for (let x = 0; x < w; x++) {
    let sum = 0, count = 0
    for (let y = 0; y < Math.min(r, h); y++) { sum += tmp[y * w + x]; count++ }
    for (let y = 0; y < h; y++) {
      if (y + r < h) { sum += tmp[(y + r) * w + x]; count++ }
      if (y - r - 1 >= 0) { sum -= tmp[(y - r - 1) * w + x]; count-- }
      out[y * w + x] = sum / count
    }
  }
  return out
}

/** Snap near-white pixels (low saturation, high brightness) to pure white */
function normalizeBackground(data: ImageData): void {
  const d = data.data
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2]
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    const s = max === 0 ? 0 : (max - min) / max * 255 // saturation 0-255
    if (s < 30 && max > 200) {
      d[i] = d[i + 1] = d[i + 2] = 255
    }
  }
}

/** Euclidean distance from one [row,col] point to many */
function euclideanDistances(points: Int32Array, nPoints: number, row: number, col: number): Float32Array {
  const dists = new Float32Array(nPoints)
  for (let i = 0; i < nPoints; i++) {
    const dr = points[i * 2] - row
    const dc = points[i * 2 + 1] - col
    dists[i] = Math.sqrt(dr * dr + dc * dc)
  }
  return dists
}

function argMin(arr: Float32Array, len: number): number {
  let best = 0
  for (let i = 1; i < len; i++) { if (arr[i] < arr[best]) best = i }
  return best
}

export interface ProcessorCallbacks {
  onFrame: (frame: ImageData) => void
  onProgress: (pct: number) => void
}

/**
 * Run the full sketch animation, calling onFrame for each video frame
 * and onProgress with 0–100 during generation.
 */
export async function generateSketchFrames(
  sourceFile: File,
  settings: SketchSettings,
  callbacks: ProcessorCallbacks,
): Promise<void> {
  const { onFrame, onProgress } = callbacks

  // --- Load source image ---
  const url = URL.createObjectURL(sourceFile)
  const srcImg = await new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = rej
    img.src = url
  })

  let imgW = srcImg.naturalWidth
  let imgH = srcImg.naturalHeight

  // --- Resize to nearest standard resolution ---
  if (settings.max1080p && (imgW > 1920 || imgH > 1920)) {
    if (imgW >= imgH) { imgW = 1920; imgH = 1080 }
    else { imgW = 1080; imgH = 1920 }
  } else {
    const aspect = imgW / imgH
    imgH = findNearestRes(imgH)
    imgW = findNearestRes(Math.round(imgH * aspect))
  }
  // Ensure even dims for video encoding
  imgW = imgW % 2 === 0 ? imgW : imgW - 1
  imgH = imgH % 2 === 0 ? imgH : imgH - 1

  // Draw source image into working canvas
  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = imgW; srcCanvas.height = imgH
  const srcCtx = srcCanvas.getContext('2d')!
  srcCtx.drawImage(srcImg, 0, 0, imgW, imgH)
  URL.revokeObjectURL(url)

  const srcData = srcCtx.getImageData(0, 0, imgW, imgH)

  // --- Normalize background ---
  if (settings.normalizeBg) normalizeBackground(srcData)
  srcCtx.putImageData(srcData, 0, 0)

  // --- Adaptive threshold ---
  const gray = toGrayscale(srcData)
  const thresh = adaptiveThreshold(gray, imgW, imgH)

  // --- Load hand image if needed ---
  let handData: ImageData | null = null
  let handMaskData: ImageData | null = null
  if (settings.drawHand) {
    const toneMap: Record<string, string> = {
      light: '/light-tone-hand-marker.png',
      mid: '/mid-tone-hand-marker.png',
      dark: '/dark-tone-hand-marker.png',
      'light-pencil': '/light-tone-hand-pencil.png',
      'mid-pencil': '/mid-tone-hand-pencil.png',
      'dark-pencil': '/dark-tone-hand-pencil.png',
    }
    const handUrl = toneMap[settings.handTone] ?? '/mid-tone-hand-marker.png'
    const maskUrl = settings.handTone.includes('pencil') ? '/hand-pencil-mask.png' : '/hand-marker-mask.png'

    // Sample mask at reference size to compute the hand bounding box
    const refSize = 200
    const tmpMask = await loadImageData(maskUrl, refSize, refSize)
    let minX = refSize, minY = refSize, maxX = 0, maxY = 0
    const md = tmpMask.data
    for (let y = 0; y < refSize; y++) for (let x = 0; x < refSize; x++) {
      if (md[(y * refSize + x) * 4] > 128) {
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
      }
    }
    const hw = Math.max(1, Math.round((maxX - minX) * settings.handScale))
    const hh = Math.max(1, Math.round((maxY - minY) * settings.handScale))
    handData = await loadImageData(handUrl, hw, hh)
    handMaskData = await loadImageData(maskUrl, hw, hh)
  }

  // --- Build tile grid ---
  const splitLen = settings.splitLen
  const nV = Math.ceil(imgH / splitLen)
  const nH = Math.ceil(imgW / splitLen)

  // Find tiles with dark pixels
  const darkTiles: number[] = [] // interleaved [row, col, row, col, ...]
  for (let tv = 0; tv < nV; tv++) {
    for (let th = 0; th < nH; th++) {
      let hasDark = false
      const y0 = tv * splitLen, x0 = th * splitLen
      const y1 = Math.min(y0 + splitLen, imgH)
      const x1 = Math.min(x0 + splitLen, imgW)
      outer: for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (thresh[y * imgW + x] < 10) { hasDark = true; break outer }
        }
      }
      if (hasDark) { darkTiles.push(tv); darkTiles.push(th) }
    }
  }

  // Convert to typed array for fast nearest-neighbour search
  let nTiles = darkTiles.length / 2
  const pts = new Int32Array(darkTiles) // [r0,c0,r1,c1,...]

  const total = darkTiles.length / 2

  // Colour phase uses 4× larger tiles for a bolder, faster colouring-in feel.
  const colorSplitLen = splitLen * settings.colorStrokeSize
  const cNV = Math.ceil(imgH / colorSplitLen)
  const cNH = Math.ceil(imgW / colorSplitLen)

  // Build the colour tile list upfront: all tiles where the source has at least
  // one non-near-white pixel. Stored as interleaved [row, col, ...].
  // We do this before computing skip rates so totalColorTiles is accurate.
  let colorTileList: number[] = []
  if (settings.drawColor) {
    const srcPixels = srcCtx.getImageData(0, 0, imgW, imgH).data
    for (let tv = 0; tv < cNV; tv++) {
      for (let th = 0; th < cNH; th++) {
        const x0 = th * colorSplitLen, y0 = tv * colorSplitLen
        const x1 = Math.min(x0 + colorSplitLen, imgW)
        const y1 = Math.min(y0 + colorSplitLen, imgH)
        let hasColor = false
        outer2: for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * imgW + x) * 4
            const r = srcPixels[i], g = srcPixels[i + 1], b = srcPixels[i + 2]
            if (r < 230 || g < 230 || b < 230) { hasColor = true; break outer2 }
          }
        }
        if (hasColor) { colorTileList.push(tv); colorTileList.push(th) }
      }
    }
  }
  const totalColorTiles = colorTileList.length / 2
  const phases = settings.drawColor ? 2 : 1
  let effectiveSkipRate = settings.objectSkipRate
  let colorSkipRate = settings.objectSkipRate
  if (settings.targetDurationSec !== undefined) {
    const drawingDuration = Math.max(0.5, settings.targetDurationSec - settings.mainImgDuration)
    const framesPerPhase = Math.max(1, Math.round((drawingDuration / phases) * settings.frameRate))
    effectiveSkipRate = Math.max(1, Math.ceil(nTiles / framesPerPhase))
    colorSkipRate = Math.max(1, Math.ceil(totalColorTiles / framesPerPhase))
  } else if (settings.drawColor) {
    // Advanced: produce the same number of animated frames for both phases
    const lineFrames = Math.max(1, Math.ceil(total / effectiveSkipRate))
    colorSkipRate = Math.max(1, Math.ceil(totalColorTiles / lineFrames))
  }

  // --- Drawing canvas (starts white) ---
  const drawCanvas = document.createElement('canvas')
  drawCanvas.width = imgW; drawCanvas.height = imgH
  const drawCtx = drawCanvas.getContext('2d')!
  drawCtx.fillStyle = 'white'
  drawCtx.fillRect(0, 0, imgW, imgH)

  // Yield to the browser event loop so it stays responsive during long renders.
  const yieldToEventLoop = () => new Promise<void>(resolve => setTimeout(resolve, 0))

  // Helper: draw the threshold (black lines) tile at (row, col)
  function drawLineTile(row: number, col: number) {
    const x0 = col * splitLen, y0 = row * splitLen
    const tileW = Math.min(splitLen, imgW - x0)
    const tileH = Math.min(splitLen, imgH - y0)
    const tileData = drawCtx.getImageData(x0, y0, tileW, tileH)
    const td = tileData.data
    for (let ty = 0; ty < tileH; ty++) {
      for (let tx = 0; tx < tileW; tx++) {
        const v = thresh[(y0 + ty) * imgW + (x0 + tx)]
        const i = (ty * tileW + tx) * 4
        td[i] = td[i + 1] = td[i + 2] = v
        td[i + 3] = 255
      }
    }
    drawCtx.putImageData(tileData, x0, y0)
  }

  // --- Phase 1: draw black lines (always) ---
  {
    let curNTiles = nTiles
    const curPts = pts
    let selIdx = 0
    let counter = 0

    while (curNTiles > 1) {
      const row = curPts[selIdx * 2]
      const col = curPts[selIdx * 2 + 1]

      drawLineTile(row, col)

      // Remove current tile (swap with last)
      curPts[selIdx * 2] = curPts[(curNTiles - 1) * 2]
      curPts[selIdx * 2 + 1] = curPts[(curNTiles - 1) * 2 + 1]
      curNTiles--

      // Find nearest remaining tile
      const dists = euclideanDistances(curPts, curNTiles, row, col)
      selIdx = argMin(dists, curNTiles)
      counter++

      if (counter % effectiveSkipRate === 0) {
        let frame: ImageData
        if (settings.drawHand && handData && handMaskData) {
          const hx = col * splitLen + Math.floor(Math.min(splitLen, imgW - col * splitLen) / 2)
          const hy = row * splitLen + Math.floor(Math.min(splitLen, imgH - row * splitLen) / 2)
          frame = compositeHand(drawCtx, imgW, imgH, hx, hy, handData, handMaskData)
        } else {
          frame = drawCtx.getImageData(0, 0, imgW, imgH)
        }
        onFrame(frame)
        await yieldToEventLoop()
      }

      if (counter % 100 === 0) {
        onProgress(Math.min(Math.round((counter / total) * (settings.drawColor ? 47 : 95)), settings.drawColor ? 47 : 95))
      }
    }
  }

  // --- Phase 2: colour fill — nearest-neighbour over non-white tiles ---
  // Visits only tiles that have actual colour (not near-white), in nearest-
  // neighbour order starting from the top-left, giving the same organic feel
  // as the line phase.
  if (settings.drawColor && colorTileList.length > 0) {
    let cNTiles = colorTileList.length / 2
    const cPts = new Int32Array(colorTileList)
    let cSelIdx = 0
    let counter = 0
    // Start nearest-neighbour from tile (0,0) as a neutral anchor
    let lastRow = 0, lastCol = 0

    while (cNTiles > 0) {
      const row = cPts[cSelIdx * 2]
      const col = cPts[cSelIdx * 2 + 1]
      lastRow = row; lastCol = col

      const x0 = col * colorSplitLen, y0 = row * colorSplitLen
      const tileW = Math.min(colorSplitLen, imgW - x0)
      const tileH = Math.min(colorSplitLen, imgH - y0)
      drawCtx.drawImage(srcCanvas, x0, y0, tileW, tileH, x0, y0, tileW, tileH)

      // Remove current tile (swap with last)
      cPts[cSelIdx * 2] = cPts[(cNTiles - 1) * 2]
      cPts[cSelIdx * 2 + 1] = cPts[(cNTiles - 1) * 2 + 1]
      cNTiles--
      counter++

      // Find nearest remaining colour tile
      if (cNTiles > 0) {
        const dists = euclideanDistances(cPts, cNTiles, lastRow, lastCol)
        cSelIdx = argMin(dists, cNTiles)
      }

      if (counter % colorSkipRate === 0) {
        let frame: ImageData
        if (settings.drawHand && handData && handMaskData) {
          const hx = x0 + Math.floor(tileW / 2)
          const hy = y0 + Math.floor(tileH / 2)
          frame = compositeHand(drawCtx, imgW, imgH, hx, hy, handData, handMaskData)
        } else {
          frame = drawCtx.getImageData(0, 0, imgW, imgH)
        }
        onFrame(frame)
        await yieldToEventLoop()
      }

      if (counter % 500 === 0) {
        onProgress(Math.min(48 + Math.round((counter / totalColorTiles) * 47), 95))
      }
    }
  }

  // --- Final frame(s): end image ---
  const endCanvas = document.createElement('canvas')
  endCanvas.width = imgW; endCanvas.height = imgH
  const endCtx = endCanvas.getContext('2d')!

  if (settings.endColor) {
    endCtx.drawImage(srcCanvas, 0, 0)
  } else {
    // Draw the threshold as grayscale
    const endData = endCtx.createImageData(imgW, imgH)
    const ed = endData.data
    for (let i = 0; i < imgW * imgH; i++) {
      ed[i * 4] = ed[i * 4 + 1] = ed[i * 4 + 2] = thresh[i]
      ed[i * 4 + 3] = 255
    }
    endCtx.putImageData(endData, 0, 0)
  }

  const endFrame = endCtx.getImageData(0, 0, imgW, imgH)
  const endFrameCount = settings.frameRate * settings.mainImgDuration
  for (let i = 0; i < endFrameCount; i++) onFrame(endFrame)

  onProgress(100)
}

/** Composite the drawing-hand image at (hx, hy) over the current draw canvas */
function compositeHand(
  drawCtx: CanvasRenderingContext2D,
  imgW: number, imgH: number,
  hx: number, hy: number,
  handData: ImageData,
  handMaskData: ImageData,
): ImageData {
  const frame = drawCtx.getImageData(0, 0, imgW, imgH)
  const hW = handData.width, hH = handData.height
  const fd = frame.data, hd = handData.data, md = handMaskData.data

  for (let ty = 0; ty < hH; ty++) {
    for (let tx = 0; tx < hW; tx++) {
      const fx = hx + tx, fy = hy + ty
      if (fx >= imgW || fy >= imgH) continue
      const fi = (fy * imgW + fx) * 4
      const hi = (ty * hW + tx) * 4
      const mask = md[hi] / 255 // 0 = transparent, 1 = hand
      const inv = 1 - mask
      fd[fi]     = fd[fi]     * inv + hd[hi]     * mask
      fd[fi + 1] = fd[fi + 1] * inv + hd[hi + 1] * mask
      fd[fi + 2] = fd[fi + 2] * inv + hd[hi + 2] * mask
    }
  }
  return frame
}
