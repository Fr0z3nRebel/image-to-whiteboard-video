'use client'

import { useEffect, useRef, useState } from 'react'

export interface GenerationStat {
  durationMs: number
  timestamp: number
}

// Module-level store — resets on page refresh, no persistence needed.
const stats: GenerationStat[] = []

export function recordGenerationStat(durationMs: number) {
  stats.push({ durationMs, timestamp: Date.now() })
  window.dispatchEvent(new CustomEvent('rsg:stat'))
}

export default function DebugConsole() {
  const [open, setOpen] = useState(false)
  const [, forceUpdate] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = () => forceUpdate(n => n + 1)
    window.addEventListener('rsg:stat', handler)
    return () => window.removeEventListener('rsg:stat', handler)
  }, [])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  const count = stats.length
  const last = count > 0 ? stats[count - 1].durationMs : null
  const avg = count > 0 ? stats.reduce((s, r) => s + r.durationMs, 0) / count : null

  function fmt(ms: number) {
    if (ms < 1000) return `${ms.toFixed(0)} ms`
    return `${(ms / 1000).toFixed(2)} s`
  }

  return (
    <>
      <button className="debug-console-btn" onClick={() => setOpen(o => !o)} title="Debug console">
        ⌨ Console
      </button>

      {open && (
        <div className="debug-console-overlay">
          <div className="debug-console-modal" ref={dialogRef}>
            <div className="debug-console-header">
              <span>Debug Console</span>
              <button className="debug-console-close" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="debug-console-body">
              {count === 0 ? (
                <p className="debug-no-data">No generations yet this session.</p>
              ) : (
                <table className="debug-table">
                  <tbody>
                    <tr>
                      <td>Generations this session</td>
                      <td>{count}</td>
                    </tr>
                    <tr>
                      <td>Last generation time</td>
                      <td>{last !== null ? fmt(last) : '—'}</td>
                    </tr>
                    <tr>
                      <td>Average generation time</td>
                      <td>{avg !== null ? fmt(avg) : '—'}</td>
                    </tr>
                  </tbody>
                </table>
              )}
              {count > 0 && (
                <>
                  <p className="debug-history-label">History</p>
                  <div className="debug-history">
                    {[...stats].reverse().map((s, i) => (
                      <div key={i} className="debug-history-row">
                        <span className="debug-history-num">#{count - i}</span>
                        <span>{fmt(s.durationMs)}</span>
                        <span className="debug-history-time">{new Date(s.timestamp).toLocaleTimeString()}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
