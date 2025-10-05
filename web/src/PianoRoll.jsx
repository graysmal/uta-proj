import React, { useEffect, useRef } from "react"

/**
 * Onset-anchored falling notes:
 *  - Audio starts at note START (musical onset).
 *  - The rectangle's BOTTOM hits the keyboard line exactly at that same time.
 *  - Bar height is drawn to the audible end (pedal-aware if provided).
 *
 * Mapping (Transport time t in seconds):
 *   S = (start - musicOffset) / rate
 *   endForVisual = useSustainLength && n.audibleEnd ? n.audibleEnd : n.end
 *   H = (endForVisual - start) * (pps / rate)      // height (tempo-invariant)
 *   yBot(t) = yKeyboardTop - ((S + dropTime) - t) * pps
 *   yTop(t) = yBot(t) - H
 *
 * With this, when t == dropTime + S, yBot == yKeyboardTop (bottom-hit = onset).
 */
export default function PianoRoll({
  chart,
  rate = 1.0,
  pps = 140,
  keyW = 12,
  keyboardH = 100,
  dropTime = 2.0,
  musicOffset = 0,
  getTime,
  useSustainLength = true,
}) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext("2d")
    const W = canvas.width
    const H = canvas.height

    const FIRST = 21   // A0
    const LAST  = 108  // C8
    const COLS  = LAST - FIRST + 1
    const yKeyboardTop = H - keyboardH
    const EPS = 0.5
    const FLASH_EPS = 2

    const isBlack = (midi) => [1,3,6,8,10].includes(midi % 12)

    let raf = 0
    function draw() {
      const t = getTime ? getTime() : 0

      // Clear
      ctx.clearRect(0, 0, W, H)

      // Vertical grid
      ctx.globalAlpha = 0.12
      ctx.strokeStyle = "#777"
      for (let i = 0; i <= COLS; i++) {
        const x = i * keyW + 0.5
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
      }
      ctx.globalAlpha = 1

      const pressed = new Set()
      const flash = new Set()

      for (const n of chart.notes) {
        const start = n.start
        const endForVisual = useSustainLength && n.audibleEnd ? n.audibleEnd : n.end

        // Convert to engine time coordinates
        const S = (start - musicOffset) / rate
        const height = Math.max(2, (endForVisual - start) * (pps / rate))

        // Bottom anchored to onset (so audio onset == bottom-hit)
        const yBot = yKeyboardTop - ((S + dropTime) - t) * pps
        const yTop = yBot - height
        const x = (n.pitch - FIRST) * keyW

        // Cull offscreen
        if (yTop > H || yBot < 0) continue

        // Draw note
        ctx.globalAlpha = Math.max(0.25, (n.velocity ?? 100) / 127)
        ctx.fillStyle = n.hand === "L" ? "#4f46e5" : "#10b981"
        ctx.fillRect(x, yTop, keyW - 1, height)

        // Key highlight while the keyboard line lies within the rectangle
        if (yBot >= yKeyboardTop - EPS && yTop < yKeyboardTop - EPS) {
          pressed.add(n.pitch)
        }

        // Flash exactly when bottom edge hits the keyboard line (onset)
        if (Math.abs(yBot - yKeyboardTop) <= FLASH_EPS) {
          flash.add(n.pitch)
        }
      }
      ctx.globalAlpha = 1

      drawKeyboard(ctx, FIRST, LAST, keyW, yKeyboardTop, keyboardH, pressed, flash, isBlack)

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [chart, rate, pps, keyW, keyboardH, dropTime, musicOffset, getTime, useSustainLength])

  // Centered canvas with horizontal scroll if needed
  return (
    <div style={{ width: "100%", display: "flex", justifyContent: "center", overflowX: "auto" }}>
      <canvas
        ref={canvasRef}
        width={(108 - 21 + 1) * keyW}
        height={720}
        style={{ display: "block", margin: "20px auto", border: "1px solid #aaa", background: "#fff" }}
      />
    </div>
  )
}

function drawKeyboard(ctx, FIRST, LAST, keyW, yTop, Hk, pressed, flash, isBlack) {
  const cols = LAST - FIRST + 1

  // White key bed
  ctx.fillStyle = "#eaeaea"
  ctx.fillRect(0, yTop, cols * keyW, Hk)

  // White keys
  for (let p = FIRST; p <= LAST; p++) {
    if (isBlack(p)) continue
    const x = (p - FIRST) * keyW

    if (pressed.has(p)) {
      ctx.fillStyle = "#ffe082"
      ctx.fillRect(x, yTop, keyW - 1, Hk)
    }

    ctx.strokeStyle = "#bbb"
    ctx.strokeRect(x + 0.5, yTop + 0.5, keyW - 1, Hk - 1)

    if (flash.has(p)) {
      ctx.fillStyle = "#ff7043"
      ctx.fillRect(x, yTop - 5, keyW - 1, 4)
    }
  }

  // Black keys (draw on top)
  for (let p = FIRST; p <= LAST; p++) {
    if (!isBlack(p)) continue
    const x = (p - FIRST) * keyW + keyW * 0.2
    const w = keyW * 0.6
    const h = Hk * 0.62
    const y = yTop

    // base
    ctx.fillStyle = "#222"
    ctx.fillRect(x, y, w, h)

    if (pressed.has(p)) {
      ctx.save()
      ctx.globalAlpha = 0.85
      ctx.fillStyle = "#ffd54f"
      ctx.fillRect(x, y, w, h)
      ctx.restore()
      ctx.strokeStyle = "#000"
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
    }

    if (flash.has(p)) {
      ctx.fillStyle = "#ff8a65"
      ctx.fillRect(x, y - 5, w, 4)
    }
  }

  // Keyboard top line (impact line)
  ctx.strokeStyle = "#111"
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, yTop)
  ctx.lineTo(cols * keyW, yTop)
  ctx.stroke()
  ctx.lineWidth = 1
}
