'use client'

import { useRef, useState } from 'react'
import { generateSketchFrames, DEFAULT_SETTINGS, settingsFromDuration } from './sketch/processor'
import { SketchEncoder, stitchCachedClips, encodeFramesToMp4 } from './sketch/encoder'
import { recordGenerationStat } from './debug-console'
import type { SketchSettings } from './sketch/processor'
import type { ClipCache } from './sketch/encoder'

type Status = 'idle' | 'generating' | 'encoding' | 'done' | 'error'

interface ClipItem {
  id: string
  file: File
  previewUrl: string
  cache?: ClipCache  // compressed H.264 chunks — much smaller than raw ImageData[]
  blob?: Blob        // per-clip MP4, used for single-clip output or fast re-stitch
}

export default function Home() {
  const [clips, setClips] = useState<ClipItem[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState(0)
  const [currentClipIdx, setCurrentClipIdx] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'simple' | 'advanced'>('simple')
  const [simpleDuration, setSimpleDuration] = useState(6)
  const [settings, setSettings] = useState<SketchSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...settingsFromDuration(6),
  }))
  const dropRef = useRef<HTMLDivElement>(null)
  const dragIndex = useRef<number | null>(null)

  function addFiles(files: FileList | File[]) {
    const newClips: ClipItem[] = []
    for (const f of Array.from(files)) {
      if (f.type.startsWith('image/')) {
        newClips.push({ id: crypto.randomUUID(), file: f, previewUrl: URL.createObjectURL(f) })
      }
    }
    if (newClips.length === 0) return
    setClips(prev => {
      const next = [...prev, ...newClips]
      setActiveIndex(next.length - 1)
      return next
    })
    setVideoUrl(null)
    setError(null)
    setStatus('idle')
  }

  function removeClip(idx: number) {
    setClips(prev => {
      const next = prev.filter((_, i) => i !== idx)
      setActiveIndex(i => Math.min(i, Math.max(0, next.length - 1)))
      if (next.length > 0 && next.every(c => c.cache) && status !== 'generating' && status !== 'encoding') {
        encodeAll(next)
      }
      return next
    })
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) addFiles(e.target.files)
    e.target.value = ''
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
  }

  function onDragStart(idx: number) {
    dragIndex.current = idx
  }

  function onDragOver(idx: number, e: React.DragEvent) {
    e.preventDefault()
    if (dragIndex.current === null || dragIndex.current === idx) return
    const from = dragIndex.current
    dragIndex.current = idx
    setClips(prev => {
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(idx, 0, item)
      return next
    })
    setActiveIndex(idx)
  }

  function onDragEnd() {
    dragIndex.current = null
    if (clips.every(c => c.cache) && clips.length > 1 && status !== 'generating' && status !== 'encoding') {
      encodeAll(clips)
    }
  }

  async function encodeAll(clipsToEncode: ClipItem[]) {
    if (typeof VideoEncoder === 'undefined') {
      // Safari: can't stitch cached chunks without WebCodecs — skip, user can re-generate
      setStatus('idle')
      setVideoUrl(null)
      return
    }
    setStatus('encoding')
    setProgress(0)
    try {
      let blob: Blob
      if (clipsToEncode.length === 1 && clipsToEncode[0].blob) {
        blob = clipsToEncode[0].blob
      } else {
        blob = await stitchCachedClips(
          clipsToEncode.map(c => c.cache!),
          settings.frameRate,
          (pct) => setProgress(pct),
        )
      }
      setVideoUrl(URL.createObjectURL(blob))
      setStatus('done')
    } catch (e: unknown) {
      setStatus('error')
      setError(e instanceof Error ? e.message : 'Unknown error')
    }
  }

  async function generate() {
    if (clips.length === 0) return
    const genStart = performance.now()
    setStatus('generating')
    setProgress(0)
    setCurrentClipIdx(0)
    setError(null)
    setVideoUrl(null)

    // Safari / no-WebCodecs fallback: collect all frames and use MediaRecorder
    if (typeof VideoEncoder === 'undefined') {
      try {
        const allFrames: ImageData[] = []
        let imgW = 0, imgH = 0
        for (let i = 0; i < clips.length; i++) {
          setCurrentClipIdx(i)
          await generateSketchFrames(clips[i].file, settings, {
            onFrame: (frame) => {
              if (allFrames.length === 0) { imgW = frame.width; imgH = frame.height }
              allFrames.push(frame)
            },
            onProgress: (pct) => setProgress(Math.round((i / clips.length) * 100 + pct / clips.length)),
          })
        }
        setStatus('encoding'); setProgress(0)
        const blob = await encodeFramesToMp4(allFrames, settings.frameRate, imgW, imgH, (pct) => setProgress(pct))
        setVideoUrl(URL.createObjectURL(blob))
        setStatus('done')
        recordGenerationStat(performance.now() - genStart)
      } catch (e: unknown) {
        setStatus('error')
        setError(e instanceof Error ? e.message : 'Unknown error')
      }
      return
    }

    // WebCodecs path: stream frames directly into per-clip encoder — no ImageData[] buffering
    try {
      let current = [...clips]

      for (let i = 0; i < current.length; i++) {
        if (current[i].cache) continue  // already encoded — skip
        setCurrentClipIdx(i)
        let enc: SketchEncoder | null = null
        await generateSketchFrames(current[i].file, settings, {
          onFrame: (frame) => {
            // Lazily init encoder on first frame (dimensions only known here)
            if (!enc) enc = new SketchEncoder(frame.width, frame.height, settings.frameRate)
            enc.addFrame(frame)
            // frame is immediately encoded and can be GC'd — no accumulation
          },
          onProgress: (pct) => {
            setProgress(Math.round((i / current.length) * 100 + pct / current.length))
          },
        })
        if (enc != null) {
          // Cast required: TS 5.5+ doesn't narrow lets mutated inside closures
          const { blob, cache } = await (enc as unknown as SketchEncoder).finish()
          current[i] = { ...current[i], cache, blob }
        }
      }
      setClips(current)  // persist caches

      await encodeAll(current)
      recordGenerationStat(performance.now() - genStart)
    } catch (e: unknown) {
      setStatus('error')
      setError(e instanceof Error ? e.message : 'Unknown error')
    }
  }

  function setSetting<K extends keyof SketchSettings>(key: K, value: SketchSettings[K]) {
    // Clear cached chunks — stale after any settings change
    setClips(prev => prev.map(c => ({ ...c, cache: undefined, blob: undefined })))
    setVideoUrl(null)
    setStatus('idle')
    setSettings(s => ({ ...s, [key]: value }))
  }

  function switchMode(newMode: 'simple' | 'advanced') {
    setMode(newMode)
    setClips(prev => prev.map(c => ({ ...c, cache: undefined, blob: undefined })))
    setVideoUrl(null)
    setStatus('idle')
    if (newMode === 'simple') {
      setSettings(s => ({ ...s, ...settingsFromDuration(simpleDuration) }))
    } else {
      // Clear targetDurationSec so advanced mode uses objectSkipRate directly
      setSettings(s => ({ ...s, targetDurationSec: undefined }))
    }
  }

  function changeSimpleDuration(dur: number) {
    setSimpleDuration(dur)
    setClips(prev => prev.map(c => ({ ...c, cache: undefined, blob: undefined })))
    setVideoUrl(null)
    setStatus('idle')
    setSettings(s => ({ ...s, ...settingsFromDuration(dur) }))
  }

  const activeClip = clips[activeIndex]
  const isProcessing = status === 'generating' || status === 'encoding'
  const allRendered = clips.length > 0 && clips.every(c => c.cache)
  const pendingCount = clips.filter(c => !c.cache).length

  const generateLabel = (() => {
    if (status === 'generating') {
      return clips.length > 1
        ? `⏳ Scene ${currentClipIdx + 1}/${clips.length} · ${progress}%`
        : `⏳ Drawing… ${progress}%`
    }
    if (status === 'encoding') return `⏳ Stitching… ${progress}%`
    if (allRendered) return clips.length > 1 ? `▶ Re-stitch ${clips.length} Scenes` : '▶ Re-generate'
    if (pendingCount < clips.length) return `▶ Render ${pendingCount} New + Stitch All`
    if (clips.length > 1) return `▶ Generate ${clips.length} Scenes`
    return '▶ Generate Animation'
  })()

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
          <a href="https://buymeacoffee.com/john.adams" target="_blank" rel="noreferrer" className="btn-bmac">
            ☕ Buy Me a Coffee
          </a>
        </div>
      </header>

      <main className="main">
        <div className="page-title">
          <h1>Sketch Animation</h1>
          <p>Upload images, arrange their order, and generate a seamless animated story</p>
        </div>

        <div className="tool-card">
          {/* LEFT: controls */}
          <div className="tool-left">
            <h3 className="section-heading">Settings</h3>

            <div className="mode-pill">
              <button
                className={`mode-pill-btn${mode === 'simple' ? ' active' : ''}`}
                onClick={() => switchMode('simple')}
              >Simple</button>
              <button
                className={`mode-pill-btn${mode === 'advanced' ? ' active' : ''}`}
                onClick={() => switchMode('advanced')}
              >Advanced</button>
            </div>

            <div className="settings-list">
              {mode === 'simple' && (
                <label className="field">
                  <span>Duration per image (s)</span>
                  <small>Approximate length of each clip's animation</small>
                  <input type="number" min={3} max={120} step={1} value={simpleDuration}
                    onChange={e => changeSimpleDuration(Number(e.target.value))} />
                </label>
              )}

              {mode === 'advanced' && (
                <>
                  <label className="field">
                    <span>Split length</span>
                    <small>Grid size — smaller = finer detail, slower</small>
                    <input type="number" min={1} max={40} step={1} value={settings.splitLen}
                      onChange={e => setSetting('splitLen', Number(e.target.value))} />
                  </label>
                  <label className="field">
                    <span>Frame rate</span>
                    <small>Output video FPS</small>
                    <input type="number" min={10} max={60} step={5} value={settings.frameRate}
                      onChange={e => setSetting('frameRate', Number(e.target.value))} />
                  </label>
                  <label className="field">
                    <span>Object skip rate</span>
                    <small>Frames skipped per drawn stroke</small>
                    <input type="number" min={1} max={10000} value={settings.objectSkipRate}
                      onChange={e => setSetting('objectSkipRate', Number(e.target.value))} />
                  </label>
                  <label className="field">
                    <span>End image duration (s)</span>
                    <small>How long the final image is shown</small>
                    <input type="number" min={1} max={10} value={settings.mainImgDuration}
                      onChange={e => setSetting('mainImgDuration', Number(e.target.value))} />
                  </label>
                </>
              )}

              <div className="toggle-group">
                <label className="toggle">
                  <input type="checkbox" checked={settings.drawColor}
                    onChange={e => setSetting('drawColor', e.target.checked)} />
                  <span>Color the image</span>
                </label>
                {settings.drawColor && (
                  <label className="field" style={{ paddingLeft: '1.5rem' }}>
                    <span>Colour stroke size <span className="field-value">{settings.colorStrokeSize}×</span></span>
                    <input type="range" min={1} max={20} step={1} value={settings.colorStrokeSize}
                      className="hand-size-slider"
                      onChange={e => setSetting('colorStrokeSize', Number(e.target.value))} />
                  </label>
                )}
                <label className="toggle">
                  <input type="checkbox" checked={settings.endColor}
                    onChange={e => setSetting('endColor', e.target.checked)} />
                  <span>End with colour image</span>
                </label>
                {mode === 'advanced' && (
                  <>
                    <label className="toggle">
                      <input type="checkbox" checked={settings.normalizeBg}
                        onChange={e => setSetting('normalizeBg', e.target.checked)} />
                      <span>Normalise background to white</span>
                    </label>
                    <label className="toggle">
                      <input type="checkbox" checked={settings.max1080p}
                        onChange={e => setSetting('max1080p', e.target.checked)} />
                      <span>Cap at 1080p</span>
                    </label>
                  </>
                )}
                <label className="toggle">
                  <input type="checkbox" checked={settings.drawHand}
                    onChange={e => setSetting('drawHand', e.target.checked)} />
                  <span>Show drawing hand</span>
                </label>
              </div>

              {settings.drawHand && (
                <div className="hand-options-section">
                  <div className="field">
                    <span>Hand tone</span>
                    <div className="hand-tone-picker">
                      {(['light', 'mid', 'dark'] as const).map(tone => (
                        <button
                          key={tone}
                          className={`hand-tone-opt${settings.handTone === tone ? ' selected' : ''}`}
                          onClick={() => setSetting('handTone', tone)}
                          title={`${tone} tone`}
                        >
                          <img src={`/${tone}-tone-hand-marker.png`} alt={`${tone} tone`} />
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="field">
                    <span>Hand size <span className="field-value">{settings.handScale.toFixed(1)}×</span></span>
                    <input
                      type="range"
                      min={0.5}
                      max={3}
                      step={0.1}
                      value={settings.handScale}
                      className="hand-size-slider"
                      onChange={e => setSetting('handScale', Number(e.target.value))}
                    />
                  </div>
                </div>
              )}
            </div>

            <button
              className="btn-primary btn-generate"
              onClick={generate}
              disabled={clips.length === 0 || isProcessing}
            >
              {generateLabel}
            </button>
          </div>

          {/* RIGHT: drop zone / active preview / video */}
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
                className={`drop-zone${clips.length > 0 ? ' has-file' : ''}`}
                onDragOver={e => e.preventDefault()}
                onDrop={onDrop}
                onClick={() => document.getElementById('file-input')?.click()}
              >
                {activeClip ? (
                  <img src={activeClip.previewUrl} alt={`Scene ${activeIndex + 1}`} className="preview-img" />
                ) : (
                  <>
                    <svg className="drop-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M12 16V4m0 0L8 8m4-4 4 4" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round"/>
                    </svg>
                    <span>Drop images or click to select</span>
                    <span className="drop-hint">JPG · PNG · WEBP · multiple supported</span>
                  </>
                )}
                <input
                  id="file-input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
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

        {/* TIMELINE */}
        <div className="timeline">
          <div className="timeline-track">
            {clips.map((clip, idx) => (
              <div
                key={clip.id}
                className={[
                  'timeline-item',
                  idx === activeIndex ? 'active' : '',
                  isProcessing && idx === currentClipIdx ? 'processing' : '',
                  clip.cache ? 'rendered' : '',
                ].filter(Boolean).join(' ')}
                draggable
                onDragStart={() => onDragStart(idx)}
                onDragOver={(e) => onDragOver(idx, e)}
                onDragEnd={onDragEnd}
                onClick={() => setActiveIndex(idx)}
              >
                <span className="timeline-num">{idx + 1}</span>
                <img src={clip.previewUrl} alt={`Scene ${idx + 1}`} className="timeline-thumb" />
                <button
                  className="timeline-remove"
                  onClick={e => { e.stopPropagation(); removeClip(idx) }}
                  aria-label="Remove scene"
                >×</button>
              </div>
            ))}
            <button
              className="timeline-add"
              onClick={() => document.getElementById('file-input')?.click()}
              title="Add more images"
            >+</button>
          </div>
        </div>
      </main>
    </>
  )
}
