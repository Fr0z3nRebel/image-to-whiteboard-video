'use client'

import { useRef, useState } from 'react'
import { generateSketchFrames, DEFAULT_SETTINGS } from './sketch/processor'
import { encodeFramesToMp4 } from './sketch/encoder'
import type { SketchSettings } from './sketch/processor'

type Status = 'idle' | 'generating' | 'encoding' | 'done' | 'error'

export default function Home() {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<SketchSettings>(DEFAULT_SETTINGS)
  const dropRef = useRef<HTMLDivElement>(null)

  function handleFile(f: File) {
    setFile(f)
    setVideoUrl(null)
    setError(null)
    setStatus('idle')
    setPreview(URL.createObjectURL(f))
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f && f.type.startsWith('image/')) handleFile(f)
  }

  async function generate() {
    if (!file) return
    setStatus('generating')
    setProgress(0)
    setError(null)
    setVideoUrl(null)

    try {
      const frames: ImageData[] = []
      let imgW = 0, imgH = 0

      await generateSketchFrames(file, settings, {
        onFrame: (frame) => {
          if (frames.length === 0) { imgW = frame.width; imgH = frame.height }
          frames.push(frame)
        },
        onProgress: (pct) => setProgress(pct),
      })

      setStatus('encoding')
      setProgress(0)

      const blob = await encodeFramesToMp4(frames, settings.frameRate, imgW, imgH,
        (pct) => setProgress(pct))

      setVideoUrl(URL.createObjectURL(blob))
      setStatus('done')
    } catch (e: unknown) {
      setStatus('error')
      setError(e instanceof Error ? e.message : 'Unknown error')
    }
  }

  function setSetting<K extends keyof SketchSettings>(key: K, value: SketchSettings[K]) {
    setSettings(s => ({ ...s, [key]: value }))
  }

  return (
    <>
      <header className="site-header">
        <div className="site-header-inner">
        <div className="site-logo">
          <span className="logo-mark">RSG</span>
          <div>
            <div className="logo-title">Ready Sketch Go</div>
            <div className="logo-sub">by Lefty Studios</div>
          </div>
        </div>
        <a
          href="https://buymeacoffee.com/john.adams"
          target="_blank"
          rel="noreferrer"
          className="btn-bmac"
        >
          ☕ Buy Me a Coffee
        </a>
        </div>
      </header>

      <main className="main">
        <div className="page-title">
          <h1>Sketch Animation</h1>
          <p>Generate a whiteboard-style drawing animation from any image</p>
        </div>

        <div className="tool-card">
          {/* LEFT: controls */}
          <div className="tool-left">
            <h3 className="section-heading">Settings</h3>

            <div className="settings-list">
              <label className="field">
                <span>Split length</span>
                <small>Grid size — smaller = finer detail, slower</small>
                <input type="number" min={5} max={40} step={5}
                  value={settings.splitLen}
                  onChange={e => setSetting('splitLen', Number(e.target.value))} />
              </label>
              <label className="field">
                <span>Frame rate</span>
                <small>Output video FPS</small>
                <input type="number" min={10} max={60} step={5}
                  value={settings.frameRate}
                  onChange={e => setSetting('frameRate', Number(e.target.value))} />
              </label>
              <label className="field">
                <span>Object skip rate</span>
                <small>Frames skipped per drawn stroke</small>
                <input type="number" min={1} max={20}
                  value={settings.objectSkipRate}
                  onChange={e => setSetting('objectSkipRate', Number(e.target.value))} />
              </label>
              <label className="field">
                <span>End image duration (s)</span>
                <small>How long the final image is shown</small>
                <input type="number" min={1} max={10}
                  value={settings.mainImgDuration}
                  onChange={e => setSetting('mainImgDuration', Number(e.target.value))} />
              </label>

              <div className="toggle-group">
                <label className="toggle">
                  <input type="checkbox" checked={settings.drawColor}
                    onChange={e => setSetting('drawColor', e.target.checked)} />
                  <span>Draw with colour</span>
                </label>
                <label className="toggle">
                  <input type="checkbox" checked={settings.normalizeBg}
                    onChange={e => setSetting('normalizeBg', e.target.checked)} />
                  <span>Normalise background to white</span>
                </label>
                <label className="toggle">
                  <input type="checkbox" checked={settings.endColor}
                    onChange={e => setSetting('endColor', e.target.checked)} />
                  <span>End with colour image</span>
                </label>
                <label className="toggle">
                  <input type="checkbox" checked={settings.drawHand}
                    onChange={e => setSetting('drawHand', e.target.checked)} />
                  <span>Show drawing hand</span>
                </label>
                <label className="toggle">
                  <input type="checkbox" checked={settings.max1080p}
                    onChange={e => setSetting('max1080p', e.target.checked)} />
                  <span>Cap at 1080p</span>
                </label>
              </div>
            </div>

            <button
              className="btn-primary btn-generate"
              onClick={generate}
              disabled={!file || status === 'generating' || status === 'encoding'}
            >
              {status === 'generating' ? `⏳ Drawing… ${progress}%`
                : status === 'encoding' ? `⏳ Encoding… ${progress}%`
                : '▶ Generate Animation'}
            </button>
          </div>

          {/* RIGHT: drop zone / preview / video */}
          <div className="tool-right">
            {videoUrl ? (
              <div className="result-area">
                <video src={videoUrl} controls autoPlay loop className="result-video" />
                <a href={videoUrl} download="sketch-animation.mp4" className="btn-download">
                  ⬇ Download MP4
                </a>
              </div>
            ) : (
              <div
                ref={dropRef}
                className={`drop-zone${file ? ' has-file' : ''}`}
                onDragOver={e => e.preventDefault()}
                onDrop={onDrop}
                onClick={() => document.getElementById('file-input')?.click()}
              >
                {preview ? (
                  <img src={preview} alt="Selected" className="preview-img" />
                ) : (
                  <>
                    <svg className="drop-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M12 16V4m0 0L8 8m4-4 4 4" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round"/>
                    </svg>
                    <span>Drop an image or click to select</span>
                    <span className="drop-hint">JPG · PNG · WEBP</span>
                  </>
                )}
                <input
                  id="file-input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  style={{ display: 'none' }}
                  onChange={onFileChange}
                />
              </div>
            )}

            {status === 'error' && (
              <div className="error-box">❌ {error}</div>
            )}
          </div>
        </div>
      </main>
    </>
  )
}
