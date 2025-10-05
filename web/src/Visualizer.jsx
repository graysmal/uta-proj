import React, { useRef, useState } from "react"
import { Midi } from "@tonejs/midi"
import * as Tone from "tone"
import PianoRoll from "./PianoRoll"
import { buildPedalWindows, extendNotesWithPedal } from "./midiUtils"

export default function Visualizer() {
  const [chart, setChart] = useState(null)

  // Visual sizing
  const [basePps, setBasePps] = useState(140)   // base pixels/sec (scaled by rate)
  const [keyW, setKeyW] = useState(12)
  const [keyboardH, setKeyboardH] = useState(100)
  const [dropTime, setDropTime] = useState(2.0) // seconds of pre-roll

  // Tempo
  const [rate, setRate] = useState(1.0)         // 0.25×..2×

  // Playback state
  const [isReady, setIsReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)

  // Audio engine / schedule
  const synthRef = useRef(null)
  const partRef = useRef(null)

  // Musical offset (where we start in the MIDI, in musical seconds)
  const [musicOffset, setMusicOffset] = useState(0)

  // ---- Helpers ----
  async function ensureTone() {
    await Tone.start()
    const ctx = Tone.getContext()
    try {
      ctx.latencyHint = "interactive"
      ctx.lookAhead = 0
    } catch {}
    if (!synthRef.current) {
      synthRef.current = new Tone.PolySynth(Tone.Synth).toDestination()
    }
  }

  // Best-effort automatic output latency (seconds)
  function getAutoSyncSeconds() {
    const ctx = Tone.getContext()
    const raw = ctx.rawContext || ctx
    let effective = 0

    // Prefer getOutputTimestamp if available (Chrome/Edge)
    if (raw && typeof raw.getOutputTimestamp === "function") {
      try {
        const ts = raw.getOutputTimestamp()
        if (ts && typeof ts.contextTime === "number") {
          effective = Math.max(0, raw.currentTime - ts.contextTime)
        }
      } catch {}
    }

    // Fallbacks
    const base = typeof raw?.baseLatency === "number" ? raw.baseLatency : 0
    const out  = typeof raw?.outputLatency === "number" ? raw.outputLatency : 0
    const look = typeof ctx.lookAhead === "number" ? ctx.lookAhead : 0

    // schedule audio slightly earlier by this amount
    const combined = Math.max(effective, base + out + look)
    return -(combined || 0)
  }

  // Parse MIDI → chart (with sustain-aware audibleEnd)
  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const buf = await file.arrayBuffer()
    const midi = new Midi(buf)

    const notesRaw = midi.tracks.flatMap(tr =>
      tr.notes.map(n => ({
        pitch: n.midi,
        start: n.time,                     // musical seconds from 0
        end: n.time + n.duration,
        velocity: Math.round(n.velocity * 127),
        hand: n.midi < 60 ? "L" : "R",
        channel: tr.channel ?? 0,
      }))
    ).sort((a,b) => a.start - b.start)

    // CC64 sustain events (per track/channel)
    const pedals = midi.tracks.flatMap(tr => {
      const arr = tr.controlChanges?.[64] || []
      return arr.map(cc => ({
        time: cc.time,
        value: typeof cc.value === "number" ? cc.value : (cc.value ?? 0),
        channel: tr.channel ?? 0,
      }))
    })

    // Extend to audible end (pedal-down windows + re-strike cuts)
    const pedalWins = buildPedalWindows(pedals)
    const notes = extendNotesWithPedal(notesRaw, pedalWins)

    setChart({ bpm: Math.round(midi.header.tempos[0]?.bpm ?? 120), notes })
    setIsReady(true)
    setMusicOffset(0)
  }

  /**
   * Schedule notes relative to the Transport clock with tempo scaling.
   * We schedule from MUSICAL ONSET and let duration = audibleEnd - onset.
   *
   * Mapping (engine/Transport seconds):
   *   t_eng_onset = dropTime + (startMus - musicOffset)/rate + autoSyncSec
   *   dur_eng     = (audibleEnd - startMus) / rate
   */
  function scheduleNotes(currentOffset, currentRate, autoSyncSec) {
    if (partRef.current) { partRef.current.dispose(); partRef.current = null }
    if (!chart) return

    const synth = synthRef.current
    const events = []

    for (const n of chart.notes) {
      const audibleEnd = n.audibleEnd ?? n.end
      if (audibleEnd <= currentOffset) continue // nothing audible left

      const startMus = Math.max(n.start, currentOffset)
      const durMus   = Math.max(0.01, audibleEnd - startMus)

      let startEng   = dropTime + (startMus - currentOffset) / currentRate + (autoSyncSec || 0)
      const durEng   = durMus / currentRate
      if (startEng < 0) startEng = 0

      events.push([startEng, { pitch: n.pitch, durEng, vel: n.velocity }])
    }

    partRef.current = new Tone.Part((time, ev) => {
      synth.triggerAttackRelease(
        Tone.Frequency(ev.pitch, "midi"),
        ev.durEng,
        time,
        ev.vel / 127
      )
    }, events)

    partRef.current.start(0)
  }

  async function startFrom(offsetMusicalSeconds, newRate = rate) {
    if (!chart) return
    await ensureTone()
    setMusicOffset(offsetMusicalSeconds)

    const autoSyncSec = getAutoSyncSeconds() // may be 0 on some browsers/devices

    Tone.Transport.stop()
    Tone.Transport.seconds = 0

    scheduleNotes(offsetMusicalSeconds, newRate, autoSyncSec)
    setRate(newRate)

    Tone.Transport.start()
    setIsPlaying(true)
  }

  // ▶️ Play: resume if paused, otherwise start from beginning
  async function handlePlay() {
    if (!chart) return
    await ensureTone()
    if (Tone.Transport.state === "paused") {
      Tone.Transport.start()    // resume from paused position
      setIsPlaying(true)
      return
    }
    await startFrom(0, rate)    // fresh start
  }

  // ⏸ Pause: just pause Transport so visuals + audio freeze in place
  function handlePause() {
    Tone.Transport.pause()
    setIsPlaying(false)
  }

  // ⏹ Stop: reset to beginning
  function handleStop() {
    Tone.Transport.stop()
    Tone.Transport.seconds = 0
    setIsPlaying(false)
    setMusicOffset(0)
  }

  // Change speed while keeping the same MUSICAL position
  async function setPresetSpeed(newRate) {
    const clamped = Math.max(0.25, Math.min(2, Number(newRate.toFixed(2))))
    // If playing, reschedule and continue from the same musical spot
    if (isPlaying) {
      const tEng = Tone.Transport.seconds
      const tMus = Math.max(0, (tEng - dropTime) * rate + musicOffset)
      await startFrom(tMus, clamped)
      return
    }
    // If paused or stopped, just update the rate; playback will resume/start with new rate
    setRate(clamped)
  }
  function nudgeSpeed(delta) { setPresetSpeed(rate + delta) }

  // Visual speed follows audio speed (both driven by Transport)
  const pps = basePps * rate
  const getTime = () => Tone.Transport.seconds

  return (
    <div style={{ fontFamily: "sans-serif", margin: 16 }}>
      <h2 style={{ textAlign: "center" }}>MIDI Visualizer (Sustain-Aware)</h2>

      <div style={{display:"flex",gap:16,flexWrap:"wrap",alignItems:"center",justifyContent:"center",marginBottom:12}}>
        <label>
          <div style={{fontSize:12}}>Load MIDI</div>
          <input type="file" accept=".mid" onChange={handleFile} />
        </label>

        <label>
          <div style={{fontSize:12}}>Base Speed (pps): {basePps}</div>
          <input type="range" min="40" max="320" step="5"
            value={basePps} onChange={e=> setBasePps(+e.target.value)} />
        </label>

        <label>
          <div style={{fontSize:12}}>Note Width (px): {keyW}</div>
          <input type="range" min="6" max="20" step="1"
            value={keyW} onChange={e=> setKeyW(+e.target.value)} />
        </label>

        <label>
          <div style={{fontSize:12}}>Keyboard Height (px): {keyboardH}</div>
          <input type="range" min="60" max="160" step="5"
            value={keyboardH} onChange={e=> setKeyboardH(+e.target.value)} />
        </label>

        <label>
          <div style={{fontSize:12}}>Drop Time (s): {dropTime.toFixed(1)}</div>
          <input type="range" min="0" max="5" step="0.1"
            value={dropTime} onChange={e=> setDropTime(+e.target.value)} />
        </label>
      </div>

      {/* Transport + Speed */}
      <div style={{ display:"flex", gap:12, justifyContent:"center", alignItems:"center", marginBottom:10 }}>
        <button onClick={handlePlay} disabled={!isReady || isPlaying}>Play</button>
        <button onClick={handlePause} disabled={!isReady || !isPlaying}>Pause</button>
        <button onClick={handleStop} disabled={!isReady}>Stop</button>

        <div style={{ width: 1, height: 24, background:"#ddd", margin: "0 8px" }} />

        <button onClick={() => nudgeSpeed(-0.1)} disabled={!isReady}>– Slower</button>
        <div style={{ minWidth: 110, textAlign: "center" }}><b>Speed: {rate.toFixed(2)}×</b></div>
        <button onClick={() => nudgeSpeed(+0.1)} disabled={!isReady}>Faster +</button>

        <div style={{ marginLeft: 8, display: "flex", gap: 6 }}>
          <button onClick={() => setPresetSpeed(0.5)} disabled={!isReady}>0.5×</button>
          <button onClick={() => setPresetSpeed(1.0)} disabled={!isReady}>1×</button>
          <button onClick={() => setPresetSpeed(1.5)} disabled={!isReady}>1.5×</button>
          <button onClick={() => setPresetSpeed(2.0)} disabled={!isReady}>2×</button>
        </div>
      </div>

      {chart
        ? <PianoRoll
            chart={chart}
            rate={rate}
            pps={pps}
            keyW={keyW}
            keyboardH={keyboardH}
            dropTime={dropTime}
            musicOffset={musicOffset}
            getTime={getTime}
            useSustainLength={true}   // draw bars to audibleEnd
          />
        : <p style={{ textAlign: "center", opacity: 0.7 }}>
            Choose a <code>.mid</code> file to start.
          </p>}
    </div>
  )
}
