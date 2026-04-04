/**
 * Client-side video encoder using WebCodecs + mp4-muxer.
 *
 * SketchEncoder streams frames one at a time — no ImageData array buffering,
 * so memory stays constant regardless of clip length or resolution.
 *
 * stitchCachedClips re-decodes compressed H.264 chunks via VideoDecoder and
 * re-encodes with continuous timestamps, enabling reorder without re-rendering.
 */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'

/** Compressed per-clip cache. Stores encoded H.264 chunks for fast stitching. */
export interface ClipCache {
  chunks: { data: ArrayBuffer; type: 'key' | 'delta'; timestamp: number; duration: number }[]
  decoderConfig: VideoDecoderConfig
  w: number
  h: number
  frameCount: number
}

/**
 * Streaming H.264 encoder. Call addFrame() per frame — never buffers a frames array.
 * Each ImageData is encoded and freed immediately; peak RAM = one frame, not all frames.
 * Requires WebCodecs (Chrome ≥94, Edge ≥94, Firefox ≥130).
 */
export class SketchEncoder {
  private enc: VideoEncoder
  private mux: Muxer<ArrayBufferTarget>
  readonly w: number
  readonly h: number
  readonly fps: number
  private frameDur: number
  private frameIdx = 0
  private decoderConfig: VideoDecoderConfig | null = null
  private chunks: ClipCache['chunks'] = []

  constructor(width: number, height: number, frameRate: number) {
    this.w = width; this.h = height; this.fps = frameRate
    this.frameDur = 1_000_000 / frameRate
    this.mux = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width, height, frameRate },
      fastStart: 'in-memory',
    })
    this.enc = new VideoEncoder({
      output: (chunk, meta) => {
        this.mux.addVideoChunk(chunk, meta)
        if (meta?.decoderConfig) this.decoderConfig = meta.decoderConfig
        // Store compressed chunk data so clips can be stitched later without re-rendering
        const data = new ArrayBuffer(chunk.byteLength)
        chunk.copyTo(data)
        this.chunks.push({
          data,
          type: chunk.type,
          timestamp: chunk.timestamp,
          duration: chunk.duration ?? Math.round(this.frameDur),
        })
      },
      error: (e) => { throw e },
    })
    this.enc.configure({
      codec: 'avc1.4d0028',
      width,
      height,
      framerate: frameRate,
      bitrate: 4_000_000,
      latencyMode: 'quality',
    })
  }

  addFrame(frame: ImageData): void {
    const vf = new VideoFrame(frame.data, {
      format: 'RGBA',
      codedWidth: this.w,
      codedHeight: this.h,
      timestamp: Math.round(this.frameIdx * this.frameDur),
      duration: Math.round(this.frameDur),
    })
    this.enc.encode(vf, { keyFrame: this.frameIdx % (this.fps * 2) === 0 })
    vf.close()
    this.frameIdx++
  }

  async finish(): Promise<{ blob: Blob; cache: ClipCache }> {
    await this.enc.flush()
    this.enc.close()
    this.mux.finalize()
    const blob = new Blob([this.mux.target.buffer], { type: 'video/mp4' })
    const cache: ClipCache = {
      chunks: this.chunks,
      decoderConfig: this.decoderConfig!,
      w: this.w,
      h: this.h,
      frameCount: this.frameIdx,
    }
    return { blob, cache }
  }
}

/**
 * Stitch cached clips into a single MP4 using WebCodecs VideoDecoder → VideoEncoder.
 * Decodes each clip's compressed H.264 chunks and re-encodes with continuous timestamps.
 * Never holds more than one decoded frame in memory at a time.
 */
export async function stitchCachedClips(
  caches: ClipCache[],
  frameRate: number,
  onProgress?: (pct: number) => void,
): Promise<Blob> {
  if (caches.length === 0) throw new Error('No clips to stitch')
  if (typeof VideoDecoder === 'undefined') throw new Error('WebCodecs VideoDecoder not available')

  const { w, h } = caches[0]
  const frameDur = 1_000_000 / frameRate

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: w, height: h, frameRate },
    fastStart: 'in-memory',
  })
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { throw e },
  })
  encoder.configure({ codec: 'avc1.4d0028', width: w, height: h, framerate: frameRate, bitrate: 4_000_000, latencyMode: 'quality' })

  let globalFrameIdx = 0

  for (let ci = 0; ci < caches.length; ci++) {
    const cache = caches[ci]
    const frameBase = globalFrameIdx
    let framesDecoded = 0

    // Canvas for rescaling if this clip has different dimensions from the first
    let scaleCtx: CanvasRenderingContext2D | null = null
    if (cache.w !== w || cache.h !== h) {
      const sc = document.createElement('canvas')
      sc.width = w; sc.height = h
      scaleCtx = sc.getContext('2d', { willReadFrequently: true })!
    }

    await new Promise<void>((resolve, reject) => {
      const decoder = new VideoDecoder({
        output: (frame) => {
          const newTs = Math.round((frameBase + framesDecoded) * frameDur)
          let vf: VideoFrame
          if (scaleCtx) {
            scaleCtx.drawImage(frame, 0, 0, w, h)
            const id = scaleCtx.getImageData(0, 0, w, h)
            vf = new VideoFrame(id.data, { format: 'RGBA', codedWidth: w, codedHeight: h, timestamp: newTs, duration: Math.round(frameDur) })
          } else {
            vf = new VideoFrame(frame, { timestamp: newTs, duration: Math.round(frameDur) })
          }
          encoder.encode(vf, { keyFrame: (frameBase + framesDecoded) % (frameRate * 2) === 0 })
          vf.close()
          frame.close()
          framesDecoded++
        },
        error: reject,
      })
      decoder.configure(cache.decoderConfig)
      for (const c of cache.chunks) {
        decoder.decode(new EncodedVideoChunk({ type: c.type, timestamp: c.timestamp, duration: c.duration, data: c.data }))
      }
      decoder.flush()
        .then(() => { globalFrameIdx += framesDecoded; decoder.close(); resolve() })
        .catch(reject)
    })

    onProgress?.(Math.round(((ci + 1) / caches.length) * 100))
  }

  await encoder.flush()
  encoder.close()
  muxer.finalize()
  return new Blob([muxer.target.buffer], { type: 'video/mp4' })
}

/** Safari / no-WebCodecs fallback: draw all frames onto a canvas and record with MediaRecorder. */
export async function encodeFramesToMp4(
  frames: ImageData[],
  frameRate: number,
  width: number,
  height: number,
  onProgress?: (pct: number) => void,
): Promise<Blob> {
  onProgress?.(0)
  const blob = await encodeViaMediaRecorder(frames, frameRate, width, height)
  onProgress?.(100)
  return blob
}

function encodeViaMediaRecorder(
  frames: ImageData[],
  frameRate: number,
  width: number,
  height: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d')!
    const stream = canvas.captureStream(frameRate)
    const recorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm',
    })
    const chunks: BlobPart[] = []
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }))
    recorder.onerror = (e) => reject(e)
    recorder.start()
    let i = 0
    const mspf = 1000 / frameRate
    const interval = setInterval(() => {
      if (i >= frames.length) { clearInterval(interval); recorder.stop(); return }
      ctx.putImageData(frames[i++], 0, 0)
    }, mspf)
  })
}
