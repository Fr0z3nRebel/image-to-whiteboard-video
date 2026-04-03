import { useRef, useState } from 'react'
import './App.css'

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
}

export default function App() {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [showSettings, setShowSettings] = useState(false)
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
    <div className="app">
      <header>
        <h1>🖊️ Image to Sketch Animation</h1>
        <p>Upload an image and generate a whiteboard-style drawing animation</p>
      </header>

      <main>
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
              <span className="drop-icon">📂</span>
              <span>Drag &amp; drop an image here, or click to browse</span>
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

        <div className="controls">
          <button
            className="btn-primary"
            onClick={generate}
            disabled={!file || status === 'generating'}
          >
            {status === 'generating' ? '⏳ Generating…' : '▶ Generate Animation'}
          </button>
          <button className="btn-secondary" onClick={() => setShowSettings(s => !s)}>
            ⚙ Settings
          </button>
        </div>

        {showSettings && (
          <div className="settings-panel">
            <h3>Settings</h3>
            <div className="settings-grid">
              <label>
                Split length
                <small>Grid size — smaller = finer detail, slower</small>
                <input type="number" min={5} max={40} step={5}
                  value={settings.splitLen}
                  onChange={e => setSetting('splitLen', Number(e.target.value))} />
              </label>
              <label>
                Frame rate
                <small>Output video FPS</small>
                <input type="number" min={10} max={60} step={5}
                  value={settings.frameRate}
                  onChange={e => setSetting('frameRate', Number(e.target.value))} />
              </label>
              <label>
                Object skip rate
                <small>Frames skipped per drawn stroke</small>
                <input type="number" min={1} max={20}
                  value={settings.objectSkipRate}
                  onChange={e => setSetting('objectSkipRate', Number(e.target.value))} />
              </label>
              <label>
                Background skip rate
                <input type="number" min={1} max={30}
                  value={settings.bgSkipRate}
                  onChange={e => setSetting('bgSkipRate', Number(e.target.value))} />
              </label>
              <label>
                End image duration (s)
                <small>How long the final image is shown</small>
                <input type="number" min={1} max={10}
                  value={settings.mainImgDuration}
                  onChange={e => setSetting('mainImgDuration', Number(e.target.value))} />
              </label>
              <div className="toggle-row">
                <label>
                  <input type="checkbox" checked={settings.endColor}
                    onChange={e => setSetting('endColor', e.target.checked)} />
                  End with colour image
                </label>
                <label>
                  <input type="checkbox" checked={settings.drawHand}
                    onChange={e => setSetting('drawHand', e.target.checked)} />
                  Show drawing hand
                </label>
                <label>
                  <input type="checkbox" checked={settings.max1080p}
                    onChange={e => setSetting('max1080p', e.target.checked)} />
                  Cap at 1080p
                </label>
              </div>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="error-box">❌ {error}</div>
        )}

        {videoUrl && (
          <div className="result">
            <h3>Your animation is ready!</h3>
            <video src={videoUrl} controls autoPlay loop className="result-video" />
            <a href={videoUrl} download="sketch-animation.mp4" className="btn-download">
              ⬇ Download MP4
            </a>
          </div>
        )}
      </main>
    </div>
  )
}

