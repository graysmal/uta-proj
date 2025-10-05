// src/midiUtils.js
// Build sustain (CC64) windows per MIDI channel and extend notes to their "audible end".

/**
 * pedals: [{time: seconds, value: 0..127, channel: number}]
 * returns: Map<channel, Array<{start:number,end:number}>>
 */
export function buildPedalWindows(pedals) {
  const byCh = new Map()
  for (const p of pedals) {
    const ch = p.channel ?? 0
    if (!byCh.has(ch)) byCh.set(ch, [])
  }
  // make sure channels exist even if there are no pedal events
  if (byCh.size === 0) byCh.set(0, [])

  // group & sort by channel
  const grouped = {}
  for (const p of pedals) {
    const ch = p.channel ?? 0
    if (!grouped[ch]) grouped[ch] = []
    grouped[ch].push(p)
  }
  for (const ch in grouped) grouped[ch].sort((a,b)=>a.time-b.time)

  // build windows: CC64 >= 64 => pedal down
  for (const ch in grouped) {
    const arr = grouped[ch]
    let downAt = null
    for (const ev of arr) {
      const v = ev.value > 1 ? ev.value/127 : ev.value // normalize if needed
      if (v >= 0.5) {
        if (downAt == null) downAt = ev.time
      } else {
        if (downAt != null) {
          byCh.get(+ch).push({ start: downAt, end: ev.time })
          downAt = null
        }
      }
    }
    // trailing pedal down with no up -> keep an open window to +inf
    if (downAt != null) byCh.get(+ch).push({ start: downAt, end: Number.POSITIVE_INFINITY })
  }
  return byCh
}

/**
 * Extend notes to audibleEnd using sustain windows and cut when same pitch re-strikes.
 * notes: [{pitch,start,end,channel?...}]
 * returns new array with .audibleEnd on each note (>= end)
 */
export function extendNotesWithPedal(notes, pedalWindowsByCh) {
  // index next-on per (channel, pitch)
  const byChPitch = new Map()
  for (const n of notes) {
    const ch = n.channel ?? 0
    const key = ch + ":" + n.pitch
    if (!byChPitch.has(key)) byChPitch.set(key, [])
    byChPitch.get(key).push(n)
  }
  for (const arr of byChPitch.values()) arr.sort((a,b)=>a.start-b.start)

  function nextOnAfter(n) {
    const arr = byChPitch.get((n.channel ?? 0)+":"+n.pitch)
    if (!arr) return null
    const i = arr.findIndex(x => x === n)
    return (i >= 0 && i+1 < arr.length) ? arr[i+1] : null
  }

  function extendEnd(n) {
    const ch = n.channel ?? 0
    const wins = pedalWindowsByCh.get(ch) || []
    let extended = n.end

    // if note end occurs while pedal is DOWN, extend to pedal-up
    for (const w of wins) {
      if (n.end >= w.start && n.end < w.end) {
        extended = w.end
        break
      }
    }

    // if same pitch re-strikes before pedal-up, cut at that next start
    const nxt = nextOnAfter(n)
    if (nxt && nxt.start < extended) {
      extended = nxt.start
    }
    return extended
  }

  return notes.map(n => ({ ...n, audibleEnd: extendEnd(n) }))
}
