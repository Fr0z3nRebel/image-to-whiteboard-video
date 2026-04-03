/**
 * Encode an array of ImageData frames into an MP4 using WebCodecs + mp4-muxer.
 * Falls back to MediaRecorder (WebM) if WebCodecs is not available.
 */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'

export async function encodeFramesToMp4(
  frames: ImageData[],
  frameRate: number,
  width: number,
  height: number,
  onProgress?: (pct: number) => void,
): Promise<Blob> {
  if (typeof VideoEncoder === 'undefined') {
    return encodeViaMediaRecorder(frames, frameRate, width, height)
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height, frameRate },
    fastStart: 'in-memory',
  })

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { throw e },
  })

  encoder.configure({
    codec: 'avc1.4d0028', // H.264 High Profile level 4.0
    width,
    height,
    framerate: frameRate,
    bitrate: 4_000_000,
    latencyMode: 'quality',
  })

  const frameDuration = 1_000_000 / frameRate // microseconds

  for (let i = 0; i < frames.length; i++) {
    const frame = new VideoFrame(frames[i].data, {
      format: 'RGBA',
      codedWidth: width,
      codedHeight: height,
      timestamp: Math.round(i * frameDuration),
      duration: Math.round(frameDuration),
    })
    encoder.encode(frame, { keyFrame: i % (frameRate * 2) === 0 })
    frame.close()

    if (onProgress && i % 10 === 0) {
      onProgress(Math.round((i / frames.length) * 100))
    }
  }

  await encoder.flush()
  encoder.close()
  muxer.finalize()

  const { buffer } = muxer.target
  return new Blob([buffer], { type: 'video/mp4' })
}

/** Fallback: draw frames onto a canvas and record with MediaRecorder → WebM */
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
      mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm',
    })

    const chunks: BlobPart[] = []
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }))
    recorder.onerror = (e) => reject(e)

    recorder.start()

    let i = 0
    const mspf = 1000 / frameRate
    const interval = setInterval(() => {
      if (i >= frames.length) {
        clearInterval(interval)
        recorder.stop()
        return
      }
      ctx.putImageData(frames[i++], 0, 0)
    }, mspf)
  })
}
