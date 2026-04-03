'use client'

import { useRef, useState } from 'react'

type Status = 'idle' | 'generating' | 'done' | 'error'

interface Settings {
  splitLen: number
  frameRate: number
  objectSkipRate: number
  bgSkipRate: number
  mainImgDuration: number
  endColor: boolean
  drawHand: boolean
  max1080p: boolean
  drawColor: boolean
  normalizeBg: boolean
}

const DEFAULT_SETTINGS: Settings = {
  splitLen: 10,
  frameRate: 25,
  objectSkipRate: 8,
  bgSkipRate: 14,
  mainImgDuration: 2,
  endColor: true,
  drawHand: true,
  max1080p: true,
  drawColor: false,
  normalizeBg: false,
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
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
    setError(null)
    setVideoUrl(null)

    const form = new FormData()
    form.append('image', file)
    form.append('split_len', String(settings.splitLen))
    form.append('frame_rate', String(settings.frameRate))
    form.append('object_skip_rate', String(settings.objectSkipRate))
    form.append('bg_object_skip_rate', String(settings.bgSkipRate))
    form.append('main_img_duration', String(settings.mainImgDuration))
    form.append('end_color', String(settings.endColor))
    form.append('draw_hand', String(settings.drawHand))
    form.append('max_1080p', String(settings.max1080p))
    form.append('draw_color', String(settings.drawColor))
    form.append('normalize_bg', String(settings.normalizeBg))

    try {
      const resp = await fetch('/api/generate', { method: 'POST', body: form })
      if (!resp.ok) {
        const msg = await resp.text()
        throw new Error(msg || `Server error ${resp.status}`)
      }
      const blob = await resp.blob()
      setVideoUrl(URL.createObjectURL(blob))
      setStatus('done')
    } catch (e: unknown) {
      setStatus('error')
      setError(e instanceof Error ? e.message : 'Unknown error')
    }
  }

  function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
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
                <span>Background skip rate</span>
                <input type="number" min={1} max={30}
                  value={settings.bgSkipRate}
                  onChange={e => setSetting('bgSkipRate', Number(e.target.value))} />
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
              disabled={!file || status === 'generating'}
            >
              {status === 'generating' ? '⏳ Generating…' : '▶ Generate Animation'}
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
