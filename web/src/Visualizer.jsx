import React, { useRef, useState, useEffect } from "react"
import { Midi } from "@tonejs/midi"
import * as Tone from "tone"
import PianoRoll from "./PianoRoll"
import { buildPedalWindows, extendNotesWithPedal } from "./midiUtils"
import { spiderTheme } from "./themeSpider"

export default function Visualizer({ midi }) {
  const [chart, setChart] = useState(null)

  // Visual sizing
  const [basePps, setBasePps] = useState(140)   // base pixels/sec (scaled by rate)
  const [keyW, setKeyW] = useState(20)
  const [keyboardH, setKeyboardH] = useState(150)
  const [dropTime, setDropTime] = useState(2.0) // seconds of pre-roll

  // Tempo
  const [rate, setRate] = useState(1.0)         // 0.25×..2×

  // Playback state
  const [isReady, setIsReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)

  // Theme
  const [spiderMode, setSpiderMode] = useState(true)
  const [spiderVariant, setSpiderVariant] = useState("red") // "neon" | "red"
  const [showWebs, setShowWebs] = useState(true)
  const [showSpiders, setShowSpiders] = useState(true)
  const [showHero, setShowHero] = useState(true)

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

    if (raw && typeof raw.getOutputTimestamp === "function") {
      try {
        const ts = raw.getOutputTimestamp()
        if (ts && typeof ts.contextTime === "number") {
          effective = Math.max(0, raw.currentTime - ts.contextTime)
        }
      } catch {}
    }

    const base = typeof raw?.baseLatency === "number" ? raw.baseLatency : 0
    const out  = typeof raw?.outputLatency === "number" ? raw.outputLatency : 0
    const look = typeof ctx.lookAhead === "number" ? ctx.lookAhead : 0

    const combined = Math.max(effective, base + out + look)
    return -(combined || 0)
  }

  // Parse MIDI → chart (with sustain-aware audibleEnd)
  async function handleFile(file) {
    if (!file) return;
    const buf = await file.arrayBuffer();
    const midiData = new Midi(buf);

    const notesRaw = midiData.tracks.flatMap(tr =>
        tr.notes.map(n => ({
          pitch: n.midi,
          start: n.time,
          end: n.time + n.duration,
          velocity: Math.round(n.velocity * 127),
          hand: n.midi < 60 ? "L" : "R",
          channel: tr.channel ?? 0,
        }))
    ).sort((a, b) => a.start - b.start);

    const pedals = midiData.tracks.flatMap(tr => {
      const arr = tr.controlChanges?.[64] || [];
      return arr.map(cc => ({
        time: cc.time,
        value: typeof cc.value === "number" ? cc.value : (cc.value ?? 0),
        channel: tr.channel ?? 0,
      }));
    });

    const pedalWins = buildPedalWindows(pedals);
    const notes = extendNotesWithPedal(notesRaw, pedalWins);

    setChart({ bpm: Math.round(midiData.header.tempos[0]?.bpm ?? 120), notes });
    setIsReady(true);
    setMusicOffset(0);
  }

  useEffect(() => {
    if (midi) {
      handleFile(midi);
    }
  }, [midi]);

  function scheduleNotes(currentOffset, currentRate, autoSyncSec) {
    if (partRef.current) { partRef.current.dispose(); partRef.current = null }
    if (!chart) return

    const synth = synthRef.current
    const events = []

    for (const n of chart.notes) {
      const audibleEnd = n.audibleEnd ?? n.end
      if (audibleEnd <= currentOffset) continue

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

    const autoSyncSec = getAutoSyncSeconds()

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
      Tone.Transport.start()
      setIsPlaying(true)
      return
    }
    await startFrom(0, rate)
  }

  function handlePause() {
    Tone.Transport.pause()
    setIsPlaying(false)
  }

  function handleStop() {
    Tone.Transport.stop()
    Tone.Transport.seconds = 0
    setIsPlaying(false)
    setMusicOffset(0)
  }

  // Change speed while keeping the same MUSICAL position
  async function setPresetSpeed(newRate) {
    const clamped = Math.max(0.25, Math.min(2, Number(newRate.toFixed(2))))
    if (isPlaying) {
      const tEng = Tone.Transport.seconds
      const tMus = Math.max(0, (tEng - dropTime) * rate + musicOffset)
      await startFrom(tMus, clamped)
      return
    }
    setRate(clamped)
  }
  function nudgeSpeed(delta) { setPresetSpeed(rate + delta) }

  const pps = basePps * rate
  const getTime = () => Tone.Transport.seconds

  const bgNeon = "linear-gradient(180deg,#0e0d13 0%, #17142a 50%, #251a44 100%)"
  const bgRed  = "linear-gradient(180deg,#12080b 0%, #2a0b17 50%, #3b0f1d 100%)"



  return (
    <div
      style={{
        fontFamily: "sans-serif",
        margin: 16,
        minHeight: "100vh",
        background: spiderMode ? (spiderVariant === "red" ? bgRed : bgNeon) : "transparent",
        color: spiderMode ? "#f7f7fb" : "inherit",
        transition: "background 300ms ease"
      }}
    >
      <h2
        style={{
          textAlign: "center",
          fontFamily: spiderMode ? spiderTheme.fontTitle : "sans-serif",
          letterSpacing: spiderMode ? "1px" : 0,
          marginTop: 8
        }}
      >
        {spiderMode ? "SPIDER-VERSE MIDI Visualizer" : "WEBSCORE"}
      </h2>

      <div style={{display:"flex",gap:16,flexWrap:"wrap",alignItems:"center",justifyContent:"center",marginBottom:12}}>
        <label>
          <div style={{fontSize:12}}>Load MIDI</div>
          <input type="file" accept=".mid" onChange={handleFile} />
        </label>

          <div hidden>
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
        <button onClick={() => setSpiderMode(s => !s)}>
          {spiderMode ? "Theme: Spider-Verse ON" : "Theme: OFF"}
        </button>
        <select
          value={spiderVariant}
          onChange={(e)=>setSpiderVariant(e.target.value)}
          disabled={!spiderMode}
          title="Spider theme variant"
        >
          <option value="neon">Neon</option>
          <option value="red">Red</option>
        </select>

        <label style={{display:"flex",alignItems:"center",gap:6,opacity: spiderMode?1:0.5}}>
          <input type="checkbox" checked={showWebs} onChange={e=>setShowWebs(e.target.checked)} disabled={!spiderMode}/>
          Webs
        </label>
        <label style={{display:"flex",alignItems:"center",gap:6,opacity: spiderMode?1:0.5}}>
          <input type="checkbox" checked={showSpiders} onChange={e=>setShowSpiders(e.target.checked)} disabled={!spiderMode}/>
          Spiders
        </label>
        <label style={{display:"flex",alignItems:"center",gap:6,opacity: spiderMode?1:0.5}}>
          <input type="checkbox" checked={showHero} onChange={e=>setShowHero(e.target.checked)} disabled={!spiderMode}/>
          Swinging Hero
        </label>
      </div>

      {/* Transport + Speed */}
      <div style={{ display:"flex", gap:12, justifyContent:"center", alignItems:"center", marginBottom:10 }}>
        <button onClick={handlePlay} disabled={!isReady || isPlaying}>Play</button>
        <button onClick={handlePause} disabled={!isReady || !isPlaying}>Pause</button>
        <button onClick={handleStop} disabled={!isReady}>Stop</button>

        <div style={{ width: 1, height: 24, background: spiderMode ? "#302a55" : "#ddd", margin: "0 8px" }} />

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
            useSustainLength={true}

            // THEME bits
            spiderMode={spiderMode}
            spiderTheme={spiderTheme}
            spiderVariant={spiderVariant}
            showWebs={showWebs}
            showSpiders={showSpiders}
            showHero={showHero}
          />
        : <p style={{ textAlign: "center", opacity: 0.7 }}>
            Choose a <code>.mid</code> file to start.
          </p>}
    </div>
  )
}
