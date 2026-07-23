/**
 * LoginBrowserModal — server-side headless browser login.
 *
 * Opens a Playwright Chromium session on the backend, streams screenshots
 * to this modal, and forwards the user's taps/typing back as browser events.
 * When login is detected the session cookies are saved server-side and the
 * user never sees or touches a raw cookie value.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Loader2, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react'
import {
  startAuthSession, pollScreenshot, sendInteraction,
  saveSession, closeSession,
} from '../api/auth'
import type { SessionState } from '../api/auth'

interface Props {
  open: boolean
  websiteId: number
  loginUrl: string
  websiteName: string
  onSuccess: () => void
  onClose: () => void
}

// Matches the Playwright viewport in browser_session.py
const VP = { width: 390, height: 844 }
const POLL_MS = 900

export default function LoginBrowserModal({
  open, websiteId, loginUrl, websiteName, onSuccess, onClose,
}: Props) {
  const [sessionId, setSessionId]   = useState<string | null>(null)
  const [frame, setFrame]           = useState<SessionState | null>(null)
  const [typeText, setTypeText]     = useState('')
  const [hideText, setHideText]     = useState(false)
  const [saving, setSaving]         = useState(false)
  const [saved, setSaved]           = useState(false)
  const [startErr, setStartErr]     = useState<string | null>(null)

  const imgRef    = useRef<HTMLImageElement>(null)
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const sidRef    = useRef<string | null>(null)
  const savingRef = useRef(false)          // avoid double-save in strict-mode
  const typeRef   = useRef<HTMLInputElement>(null)

  // ── Start session when modal opens ─────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    let dead = false

    setFrame(null); setSessionId(null); setStartErr(null)
    setSaving(false); setSaved(false); savingRef.current = false
    setTypeText('')

    startAuthSession(websiteId, loginUrl, websiteName)
      .then(r => {
        if (dead) return
        setSessionId(r.session_id)
        sidRef.current = r.session_id
      })
      .catch(e => { if (!dead) setStartErr(e instanceof Error ? e.message : String(e)) })

    return () => { dead = true }
  }, [open, websiteId, loginUrl, websiteName])

  // ── Poll for screenshots ───────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return
    let dead = false

    const tick = async () => {
      try {
        const f = await pollScreenshot(sessionId)
        if (dead) return
        setFrame(f)

        if (f.status === 'logged_in' && !savingRef.current) {
          savingRef.current = true
          setSaving(true)
          try {
            await saveSession(sessionId)
            if (!dead) { setSaved(true); setTimeout(onSuccess, 1800) }
          } catch (e) {
            if (!dead) {
              setStartErr(e instanceof Error ? e.message : 'Failed to save session')
              setSaving(false)
              savingRef.current = false
            }
          }
        }
      } catch { /* ignore transient poll errors */ }
    }

    pollTimer.current = setInterval(tick, POLL_MS)
    tick()
    return () => { dead = true; clearInterval(pollTimer.current!) }
  }, [sessionId, onSuccess])

  // ── Close / cleanup ────────────────────────────────────────────────────────
  const handleClose = useCallback(async () => {
    clearInterval(pollTimer.current!)
    if (sidRef.current && !savingRef.current) {
      closeSession(sidRef.current).catch(() => {})
    }
    onClose()
  }, [onClose])

  // ── Tap → browser click ───────────────────────────────────────────────────
  const onTap = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!sessionId || frame?.status !== 'ready') return
    const img = imgRef.current
    if (!img) return

    const rect = img.getBoundingClientRect()
    let cx: number, cy: number
    if ('touches' in e) {
      cx = e.touches[0].clientX; cy = e.touches[0].clientY
    } else {
      cx = (e as React.MouseEvent).clientX; cy = (e as React.MouseEvent).clientY
    }

    const x = ((cx - rect.left) / rect.width)  * VP.width
    const y = ((cy - rect.top)  / rect.height) * VP.height

    sendInteraction(sessionId, { action: 'click', x, y }).catch(() => {})
    // Focus the type input so the keyboard appears on mobile
    setTimeout(() => typeRef.current?.focus(), 100)
  }, [sessionId, frame?.status])

  // ── Send buffered text ─────────────────────────────────────────────────────
  const sendText = useCallback(() => {
    if (!sessionId || !typeText) return
    sendInteraction(sessionId, { action: 'type', text: typeText }).catch(() => {})
    setTypeText('')
  }, [sessionId, typeText])

  const pressKey = useCallback((key: string) => {
    if (!sessionId) return
    sendInteraction(sessionId, { action: 'key', key }).catch(() => {})
  }, [sessionId])

  const scroll = useCallback((dir: number) => {
    if (!sessionId) return
    sendInteraction(sessionId, { action: 'scroll', delta_y: dir * 250 }).catch(() => {})
  }, [sessionId])

  const retry = useCallback(async () => {
    clearInterval(pollTimer.current!)
    if (sidRef.current) closeSession(sidRef.current).catch(() => {})
    setFrame(null); setSessionId(null); setStartErr(null)
    setSaving(false); setSaved(false); savingRef.current = false; setTypeText('')
    try {
      const r = await startAuthSession(websiteId, loginUrl, websiteName)
      setSessionId(r.session_id); sidRef.current = r.session_id
    } catch (e) { setStartErr(e instanceof Error ? e.message : String(e)) }
  }, [websiteId, loginUrl, websiteName])

  if (!open) return null

  const isStarting = !frame || frame.status === 'starting'
  const isReady    = frame?.status === 'ready'
  const isLoggedIn = frame?.status === 'logged_in'
  const isErr      = !!startErr || frame?.status === 'error'
  const errMsg     = startErr || frame?.error_message

  const dotColor = isErr ? 'bg-red-400' :
                   saved || isLoggedIn ? 'bg-green-400' :
                   isStarting ? 'bg-yellow-400 animate-pulse' :
                   'bg-green-400 animate-pulse'

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80">
      <div className="bg-slate-900 w-full flex flex-col rounded-t-2xl sm:rounded-2xl sm:max-w-sm border border-slate-700 overflow-hidden"
           style={{ maxHeight: '95dvh' }}>

        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 shrink-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
          <span className="text-sm font-semibold text-slate-200 flex-1 truncate">
            Log in to {websiteName}
          </span>
          <button onClick={handleClose} className="p-1.5 text-slate-500 hover:text-slate-300 -mr-1">
            <X size={18} />
          </button>
        </div>

        {/* ── Status bar ── */}
        <div className="px-4 py-1.5 bg-slate-800/60 text-xs text-slate-400 shrink-0 min-h-[28px]">
          {isStarting && !isErr && 'Opening secure browser — this takes a few seconds…'}
          {isReady && !saving && 'Tap a field in the page, type below, then tap Send'}
          {(isLoggedIn && !saving) && 'Login detected — saving your session…'}
          {saving && !saved && 'Saving your session securely…'}
          {saved && '✓ Session saved — sync is ready!'}
          {isErr && (errMsg || 'Browser failed to start')}
        </div>

        {/* ── Viewport ── */}
        <div className="flex-1 overflow-hidden relative bg-black flex items-start justify-center min-h-0"
             style={{ aspectRatio: `${VP.width}/${VP.height}`, maxHeight: '55dvh' }}>

          {/* Loading */}
          {isStarting && !isErr && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-500">
              <Loader2 size={36} className="animate-spin" />
              <p className="text-sm">Starting browser…</p>
            </div>
          )}

          {/* Error */}
          {isErr && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <AlertCircle size={36} className="text-red-400" />
              <p className="text-sm text-red-300">{errMsg ?? 'Unknown error'}</p>
              <button onClick={retry} className="btn-secondary gap-2 text-sm">
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          )}

          {/* Success overlay */}
          {(saved || (isLoggedIn && saving)) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/90">
              <CheckCircle2 size={52} className="text-green-400" />
              <p className="text-base font-semibold text-green-300">
                {saved ? 'Logged in!' : 'Saving…'}
              </p>
              {saved && <p className="text-sm text-slate-400">Your session is ready for sync.</p>}
            </div>
          )}

          {/* Live screenshot */}
          {frame?.image && !saved && (
            <img
              ref={imgRef}
              src={`data:image/jpeg;base64,${frame.image}`}
              alt="Login page preview"
              className="w-full h-full object-contain object-top select-none"
              style={{ cursor: isReady ? 'pointer' : 'default', touchAction: 'none' }}
              draggable={false}
              onClick={onTap}
              onTouchStart={e => { e.preventDefault(); onTap(e) }}
            />
          )}
        </div>

        {/* ── Interaction controls ── */}
        {isReady && !saving && !saved && (
          <div className="border-t border-slate-800 px-3 pt-3 pb-4 space-y-2.5 shrink-0">

            {/* Type + Send */}
            <div className="flex gap-2">
              <input
                ref={typeRef}
                type={hideText ? 'password' : 'text'}
                className="input flex-1 text-sm"
                placeholder="Tap a field above, then type here…"
                value={typeText}
                onChange={e => setTypeText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); sendText() } }}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              <button
                onClick={sendText}
                disabled={!typeText}
                className="btn-primary text-sm px-3 disabled:opacity-40 shrink-0"
              >
                Send
              </button>
            </div>

            {/* Quick-action keys */}
            <div className="flex gap-1.5 flex-wrap">
              {[
                { label: '⇥ Tab',  key: 'Tab' },
                { label: '↵ Enter', key: 'Enter' },
                { label: '⌫ Del',  key: 'Backspace' },
              ].map(({ label, key }) => (
                <button key={key} onClick={() => pressKey(key)}
                  className="px-2.5 py-1 text-xs bg-slate-800 text-slate-400 rounded-lg hover:bg-slate-700 active:scale-95">
                  {label}
                </button>
              ))}
              <button
                onClick={() => setHideText(p => !p)}
                className={`px-2.5 py-1 text-xs rounded-lg hover:bg-slate-700 active:scale-95 ${hideText ? 'bg-brand-500/20 text-brand-400' : 'bg-slate-800 text-slate-400'}`}
              >
                {hideText ? '🔒 Hidden' : '👁 Visible'}
              </button>
              <button onClick={() => scroll(-1)}
                className="px-2.5 py-1 text-xs bg-slate-800 text-slate-400 rounded-lg hover:bg-slate-700 active:scale-95 ml-auto">
                ↑
              </button>
              <button onClick={() => scroll(1)}
                className="px-2.5 py-1 text-xs bg-slate-800 text-slate-400 rounded-lg hover:bg-slate-700 active:scale-95">
                ↓
              </button>
            </div>

          </div>
        )}
      </div>
    </div>
  )
}
