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
 *   H = (endForVisual - start) * (pps / rate)
 *   yBot(t) = yKeyboardTop - ((S + dropTime) - t) * pps
 *   yTop(t) = yBot(t) - H
 *
 * When t == dropTime + S, yBot == yKeyboardTop (bottom-hit = onset).
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

  // Labels
  showKeyLabels = true,
  labelMode = "all",      // "all" | "white" | "cOnly"
  preferFlats = false,

  // Theme / Decor
  spiderMode = false,
  spiderTheme,
  spiderVariant = "red",   // "neon" | "red"
  showWebs = true,
  showSpiders = true,
  showHero = true,
}) {
  const canvasRef = useRef(null)

  // Impact FX & press animation
  const burstsRef = useRef([])         // {id, t0, pitch, xCenter}
  const flashedRef = useRef(new Set()) // note indexes spawned
  const pressMapRef = useRef(new Map())
  const lastTRef = useRef(null)

  // Decorative actors
  const spidersRef = useRef([])        // array of crawler spiders
  const strandsRef = useRef([])        // crawlable web strands (quadratic Beziers)
  const actorsInitRef = useRef(false)

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
    const keyCenterX = (pitch) =>
      isBlack(pitch)
        ? (pitch - FIRST) * keyW + keyW * 0.2 + (keyW * 0.6) / 2
        : (pitch - FIRST) * keyW + keyW / 2

    let raf = 0
    function draw() {
      const t = getTime ? getTime() : 0
      const lastT = (lastTRef.current ?? t)
      const dt = Math.max(0, Math.min(0.05, t - lastT))
      lastTRef.current = t

      // (Re)build crawl strands once (or if size changed)
      if (spiderMode && showSpiders && (strandsRef.current.length === 0 ||
          strandsRef.current[0].y2 !== yKeyboardTop - 6 || strandsRef.current[0].W !== W)) {
        strandsRef.current = buildCrawlStrands(W, yKeyboardTop)
        spidersRef.current = []         // respawn on new layout
        actorsInitRef.current = false
      }

      // Clear
      ctx.clearRect(0, 0, W, H)

      // Decorative background (behind notes)
      if (spiderMode && showWebs) {
        drawSpiderWebs(ctx, W, yKeyboardTop, t, spiderVariant)
      }

      // Vertical grid
      ctx.globalAlpha = 0.08
      ctx.strokeStyle = spiderMode ? (spiderVariant === "red" ? "#b34a57" : "#7c6fd6") : "#666"
      for (let i = 0; i <= COLS; i++) {
        const x = i * keyW + 0.5
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
      }
      ctx.globalAlpha = 1

      // Halftone over playfield
      if (spiderMode) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(0, 0, W, yKeyboardTop - 2)
        ctx.clip()
        drawHalftone(ctx, W, yKeyboardTop - 2, spiderTheme?.halftoneAlpha ?? 0.10)
        ctx.restore()
      }

      const pressedSet = new Set()
      const flashSet = new Set()

      // Notes
      for (let i = 0; i < chart.notes.length; i++) {
        const n = chart.notes[i]
        const endForVisual = useSustainLength && n.audibleEnd ? n.audibleEnd : n.end
        const S = (n.start - musicOffset) / rate
        const height = Math.max(2, (endForVisual - n.start) * (pps / rate))

        const yBot = yKeyboardTop - ((S + dropTime) - t) * pps
        const yTop = yBot - height
        const x = (n.pitch - FIRST) * keyW

        if (yTop > H || yBot < 0) continue

        // Spider-Verse RGB split behind the note
        if (spiderMode) rgbSplitNote(ctx, x, yTop, keyW - 1, height)

        // Main note color
        ctx.globalAlpha = Math.max(0.25, (n.velocity ?? 100) / 127)
        if (spiderMode) {
          if (spiderVariant === "red") {
            ctx.fillStyle = n.hand === "L" ? "#FF1D2E" : "#2D7BFF" // red / blue
          } else {
            ctx.fillStyle = n.hand === "L"
              ? (spiderTheme?.leftNoteFill || "#7C00FF")   // purple
              : (spiderTheme?.rightNoteFill || "#00E5FF")  // neon cyan
          }
        } else {
          ctx.fillStyle = n.hand === "L" ? "#4f46e5" : "#10b981"
        }
        ctx.fillRect(x, yTop, keyW - 1, height)

        // Pressed window
        if (yBot >= yKeyboardTop - EPS && yTop < yKeyboardTop - EPS) {
          pressedSet.add(n.pitch)
        }

        // Onset flash
        if (Math.abs(yBot - yKeyboardTop) <= FLASH_EPS) {
          flashSet.add(n.pitch)
          const id = i
          if (!flashedRef.current.has(id)) {
            flashedRef.current.add(id)
            burstsRef.current.push({ id, t0: t, pitch: n.pitch, xCenter: keyCenterX(n.pitch) })
            if (burstsRef.current.length > 128) burstsRef.current.shift()
          }
        }
      }
      ctx.globalAlpha = 1

      // Smooth press intensity (0..1)
      const pressMap = pressMapRef.current
      const ATTACK = 28
      const RELEASE = 14
      for (let p = FIRST; p <= LAST; p++) {
        const target = pressedSet.has(p) ? 1 : 0
        const prev = pressMap.get(p) ?? 0
        const k = target > prev ? ATTACK : RELEASE
        const alpha = 1 - Math.exp(-k * dt)
        pressMap.set(p, prev + (target - prev) * alpha)
      }

      // Keyboard
      drawKeyboardGame(
        ctx, FIRST, LAST, keyW, yKeyboardTop, keyboardH,
        pressedSet, flashSet, pressMap, isBlack,
        { showKeyLabels, labelMode, preferFlats }
      )

      // Spiders (crawl along strands; clear logo silhouette)
      if (spiderMode && showSpiders && strandsRef.current.length) {
        if (!actorsInitRef.current || spidersRef.current.length === 0) {
          spawnCrawlers(spidersRef, strandsRef.current)
          actorsInitRef.current = true
        }
        updateAndDrawCrawlers(ctx, spidersRef.current, strandsRef.current, dt, spiderVariant)
      }

      // Swinging hero
      if (spiderMode && showHero) {
        drawSwingingHero(ctx, t, W, yKeyboardTop, spiderVariant)
      }

      // Impact FX (tinted)
      drawImpactFX(ctx, burstsRef.current, t, yKeyboardTop, keyboardH, spiderMode, spiderTheme, spiderVariant)

      // Cull bursts
      const LIFETIME = 0.42
      if (burstsRef.current.length) {
        burstsRef.current = burstsRef.current.filter(b => (t - b.t0) <= LIFETIME)
      }

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [
    chart, rate, pps, keyW, keyboardH, dropTime, musicOffset, getTime,
    useSustainLength, showKeyLabels, labelMode, preferFlats,
    spiderMode, spiderTheme, spiderVariant, showWebs, showSpiders, showHero
  ])

  // Centered canvas
  return (
    <div style={{ width: "100%", display: "flex", justifyContent: "center", overflowX: "auto" }}>
      <canvas
        ref={canvasRef}
        width={(108 - 21 + 1) * keyW}
        height={720}
        style={{
          display: "block",
          margin: "20px auto",
          marginTop: "0",
          border: spiderMode ? "1px solid #3a3270" : "1px solid #aaa",
          background: spiderMode ? (spiderVariant === "red" ? "#12080b" : "#0f0e17") : "#fff"
        }}
      />
    </div>
  )
}

/* ================= Spider scene helpers ================= */

function rgbSplitNote(ctx, x, y, w, h, offset = 1) {
  ctx.save()
  ctx.globalCompositeOperation = "lighter"
  ctx.fillStyle = "rgba(0,229,255,0.30)" // cyan
  ctx.fillRect(x - offset, y, w, h)
  ctx.fillStyle = "rgba(255,45,149,0.30)" // magenta
  ctx.fillRect(x + offset, y, w, h)
  ctx.restore()
}

function drawHalftone(ctx, W, H, alpha = 0.1) {
  const step = 10
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = "#000"
  for (let yy = 0; yy < H; yy += step) {
    for (let xx = (yy % (2*step) ? step/2 : 0); xx < W; xx += step) {
      ctx.beginPath()
      ctx.arc(xx, yy, 1, 0, Math.PI*2)
      ctx.fill()
    }
  }
  ctx.restore()
}

function drawSpiderWebs(ctx, W, Hplay, t, variant="red") {
  ctx.save()
  ctx.globalAlpha = variant === "red" ? 0.18 : 0.15
  const colRay = variant === "red" ? "#ff3d4a" : "#7C00FF"
  const colRing = variant === "red" ? "#ff8aa0" : "#00E5FF"

  const anchors = [
    { x: W * 0.08, y: 10, phase: 0.0 },
    { x: W * 0.92, y: 8,  phase: 1.6 },
    { x: W * 0.50, y: 16, phase: 3.1 },
  ]

  for (const a of anchors) {
    const baseR = Math.min(W, Hplay) * 0.95
    const rWobble = 1 + 0.02 * Math.sin(t * 0.9 + a.phase)
    const R = baseR * rWobble

    // Rays
    ctx.strokeStyle = colRay
    ctx.lineWidth = 1
    const rays = 9
    for (let i = 0; i < rays; i++) {
      const ang = (i / rays) * Math.PI * 2
      const x2 = a.x + Math.cos(ang) * R
      const y2 = a.y + Math.sin(ang) * R
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(a.x + (x2 - a.x), Math.min(y2, Hplay))
      ctx.stroke()
    }

    // Rings
    ctx.strokeStyle = colRing
    const rings = 6
    for (let r = 1; r <= rings; r++) {
      const rad = (R * r) / rings
      ctx.beginPath()
      const k = 0.015 * rad * Math.sin(t * 1.3 + r)
      ctx.ellipse(a.x, a.y, rad, rad + k, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  ctx.restore()
}

/* =================== Crawlable strands + spiders =================== */

/**
 * Build a few long, curved strands (quadratic Beziers) spanning top -> near keyboard.
 * Spiders will crawl along these (no floating).
 */
function buildCrawlStrands(W, yKeyboardTop) {
  const anchorsX = [0.08, 0.22, 0.38, 0.62, 0.78, 0.92].map(f => W * f)
  const y1 = 8
  const y2 = yKeyboardTop - 6
  const strands = []
  for (let i = 0; i < anchorsX.length; i++) {
    const x1 = anchorsX[i]
    const x2 = (i % 2 ? anchorsX[i] - W*0.18 : anchorsX[i] + W*0.18)
    const sag = Math.max(40, (y2 - y1) * 0.22)
    const mx = (x1 + x2) / 2 + (i % 2 ? -20 : 20)
    const my = (y1 + y2) / 2 + sag
    const approxLen = bezierApproxLength({x:x1,y:y1},{x:mx,y:my},{x:x2,y:y2})
    strands.push({ W, x1, y1, mx, my, x2, y2, len: approxLen })
  }
  return strands
}

function bezierPoint(t, p0, p1, p2) {
  const u = 1 - t
  const x = u*u*p0.x + 2*u*t*p1.x + t*t*p2.x
  const y = u*u*p0.y + 2*u*t*p1.y + t*t*p2.y
  return { x, y }
}
function bezierTangent(t, p0, p1, p2) {
  const x = 2*(1-t)*(p1.x - p0.x) + 2*t*(p2.x - p1.x)
  const y = 2*(1-t)*(p1.y - p0.y) + 2*t*(p2.y - p1.y)
  return { x, y }
}
function bezierApproxLength(p0, p1, p2, samples=24) {
  let len = 0
  let prev = p0
  for (let i = 1; i <= samples; i++) {
    const t = i / samples
    const cur = bezierPoint(t, p0, p1, p2)
    len += Math.hypot(cur.x - prev.x, cur.y - prev.y)
    prev = cur
  }
  return len
}

/** Spawn crawlers on random strands with alternating directions and gait phase. */
function spawnCrawlers(spidersRef, strands) {
  const count = Math.min(10, 2 + Math.floor(strands.length * 2))
  const arr = []
  for (let i = 0; i < count; i++) {
    const sIdx = i % strands.length
    const dir = i % 2 === 0 ? 1 : -1
    arr.push({
      strand: sIdx,
      u: Math.random(),                // 0..1 along strand
      dir,
      // pixels per second along curve
      speedPx: 60 + Math.random() * 50,
      // body scale in px (overall size)
      scale: 10 + Math.random() * 4,
      // gait phase
      phase: Math.random() * Math.PI * 2,
    })
  }
  spidersRef.current = arr
}

/** Update param u according to strand length; draw logo spider oriented to tangent. */
function updateAndDrawCrawlers(ctx, crawlers, strands, dt, variant="red") {
  ctx.save()
  for (const c of crawlers) {
    const s = strands[c.strand % strands.length]
    const du = (c.speedPx * dt) / Math.max(1, s.len)
    c.u += du * c.dir
    if (c.u > 1) { c.u = 1; c.dir *= -1 }
    if (c.u < 0) { c.u = 0; c.dir *= -1 }

    const p0 = {x:s.x1, y:s.y1}, p1 = {x:s.mx, y:s.my}, p2 = {x:s.x2, y:s.y2}
    const pos = bezierPoint(c.u, p0, p1, p2)
    const tan = bezierTangent(c.u, p0, p1, p2)
    const angle = Math.atan2(tan.y, tan.x) + Math.PI/2   // align body perpendicular to strand like real spiders

    // tiny “stick” highlight on the strand contact
    ctx.strokeStyle = variant === "red" ? "rgba(255,255,255,0.5)" : "rgba(0,229,255,0.6)"
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(pos.x - 3, pos.y)
    ctx.lineTo(pos.x + 3, pos.y)
    ctx.stroke()

    drawSpiderLogo(ctx, pos.x, pos.y, c.scale, angle, variant, c.phase)
    c.phase += dt * 8 // gait speed
  }
  ctx.restore()
}

/**
 * Stylized spider LOGO silhouette with angular legs,
 * readable at small sizes. Gait animates via slight leg offsets.
 */
function drawSpiderLogo(ctx, x, y, size=12, angle=0, variant="red", phase=0) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)

  const bodyFill = "#0e0e0e"
  const legStroke = "#0e0e0e"
  const rim = "rgba(255,255,255,0.6)"
  const accent = (variant === "red") ? "#ff1d2e" : "#00E5FF"

  // Abdomen (tear shape)
  const aW = size * 0.75
  const aH = size * 1.2
  ctx.beginPath()
  ctx.moveTo(0,  aH * 0.55)
  ctx.bezierCurveTo(aW*0.75, aH*0.35,  aW*0.75,-aH*0.15,  0, -aH*0.55)
  ctx.bezierCurveTo(-aW*0.75,-aH*0.15, -aW*0.75, aH*0.35, 0,  aH*0.55)
  ctx.closePath()
  ctx.fillStyle = bodyFill
  ctx.fill()
  ctx.strokeStyle = rim
  ctx.lineWidth = 1
  ctx.stroke()

  // Thorax (small oval touching abdomen top)
  ctx.beginPath()
  ctx.ellipse(0, -aH*0.65, aW*0.35, aW*0.28, 0, 0, Math.PI*2)
  ctx.fill()
  ctx.stroke()

  // Hourglass accent (tiny)
  ctx.fillStyle = accent
  ctx.globalAlpha = 0.9
  const hgW = size * 0.3, hgH = size * 0.35
  ctx.beginPath()
  ctx.moveTo(0, -hgH*0.6)
  ctx.lineTo(-hgW*0.5, 0)
  ctx.lineTo(hgW*0.5, 0)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(0, hgH*0.6)
  ctx.lineTo(-hgW*0.5, 0)
  ctx.lineTo(hgW*0.5, 0)
  ctx.closePath()
  ctx.fill()
  ctx.globalAlpha = 1

  // Angular legs (two segments each side), animated with small gait wiggle
  ctx.strokeStyle = legStroke
  ctx.lineWidth = Math.max(1, size * 0.12)
  ctx.lineCap = "round"
  const L1 = size * 0.9
  const L2 = size * 1.0
  const spread = size * 0.55
  const baseY = -aH*0.15

  // definition: [shoulderX, shoulderY, a1, a2] (radians)
  const baseAngles = [
    [-spread*0.60, baseY,  -2.1, -2.55], // upper pair left
    [-spread*0.45, baseY+2, -1.6, -2.15],
    [-spread*0.30, baseY+4, -1.2, -1.85],
    [-spread*0.15, baseY+5, -0.8, -1.55],
    [ spread*0.60, baseY,   2.1,  2.55], // right side mirrored
    [ spread*0.45, baseY+2, 1.6,  2.15],
    [ spread*0.30, baseY+4, 1.2,  1.85],
    [ spread*0.15, baseY+5, 0.8,  1.55],
  ]

  for (let i = 0; i < 8; i++) {
    const [sx, sy, a1, a2] = baseAngles[i]
    // gait wiggle (alternating legs)
    const wig = (i % 2 === 0 ? 1 : -1) * 0.18 * Math.sin(phase + i * 0.6)
    const k1 = a1 + wig
    const k2 = a2 + wig * 0.6

    const x1 = sx + Math.cos(k1) * L1
    const y1 = sy + Math.sin(k1) * L1
    const x2 = x1 + Math.cos(k2) * L2
    const y2 = y1 + Math.sin(k2) * L2

    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.lineTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }

  ctx.restore()
}

/* ================= Swinging hero (unchanged from prior improved version) ================= */

function drawSwingingHero(ctx, t, W, Hplay, variant="red") {
  const pivotX = W * 0.12
  const pivotY = 8
  const ropeL  = Math.min(Hplay - 60, Hplay * 0.7)

  // Pendulum angle + small flip pulses
  const base = -1.1 + 0.75 * Math.sin(t * 0.85)
  const flip = 0.25 * Math.sin(t * 2.2) * smoothPulse(Math.sin(t * 0.3), 0.35)
  const ang  = base + flip

  // End point
  const hx = pivotX + ropeL * Math.sin(ang)
  const hy = pivotY + ropeL * Math.cos(ang)

  // Web rope (curved with slight sag + webbing)
  drawWebRope(ctx, pivotX, pivotY, hx, hy, variant)

  // Speed proxy to drive pose
  const speed = 0.75 * 0.85 * Math.cos(t * 0.85) + 0.25 * 2.2 * Math.cos(t * 2.2) * smoothPulse(Math.sin(t * 0.3), 0.35)

  // Draw hero body
  ctx.save()
  ctx.translate(hx, hy)
  ctx.rotate(ang + Math.PI)
  drawHeroFigure(ctx, variant, speed, 1.0)
  ctx.restore()
}

function drawWebRope(ctx, x1, y1, x2, y2, variant="red") {
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.hypot(dx, dy)
  const sag = Math.min(22, Math.max(12, len * 0.035))
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2 + sag

  ctx.save()
  // base strand
  ctx.strokeStyle = variant === "red" ? "rgba(255,90,90,0.95)" : "rgba(124,0,255,0.9)"
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.quadraticCurveTo(mx, my, x2, y2)
  ctx.stroke()

  // cross webbing
  ctx.strokeStyle = "rgba(255,255,255,0.7)"
  ctx.lineWidth = 1
  const segments = 10
  for (let i = 1; i < segments; i++) {
    const t = i / segments
    const bx = (1-t)*(1-t)*x1 + 2*(1-t)*t*mx + t*t*x2
    const by = (1-t)*(1-t)*y1 + 2*(1-t)*t*my + t*t*y2
    const tx = 2*(1-t)*(mx - x1) + 2*t*(x2 - mx)
    const ty = 2*(1-t)*(my - y1) + 2*t*(y2 - my)
    const nlen = Math.hypot(tx, ty) || 1
    const nx = -ty / nlen, ny = tx / nlen
    const w = 5
    ctx.beginPath()
    ctx.moveTo(bx - nx*w, by - ny*w)
    ctx.lineTo(bx + nx*w, by + ny*w)
    ctx.stroke()
  }
  ctx.restore()
}

function drawHeroFigure(ctx, variant="red", speed=0, scale=1) {
  const mainA = variant === "red" ? "#ff1d2e" : "#00E5FF"
  const mainB = variant === "red" ? "#2d7bff" : "#FF2D95"
  const line  = "rgba(0,0,0,0.85)"
  const white = "#ffffff"

  const HEAD = 9 * scale
  const TORSO_W = 16 * scale
  const TORSO_H = 24 * scale
  const LIMB = 16 * scale

  const legSwing = clamp(-1, 1, speed * 1.4)
  const armSwing = clamp(-1, 1, speed * 1.1)
  const tuck     = 0.15 + 0.2 * Math.abs(speed)

  // Torso
  roundedRect(ctx, -TORSO_W/2, -TORSO_H, TORSO_W, TORSO_H, 5, mainA, line)
  ctx.save()
  ctx.beginPath()
  ctx.rect(-TORSO_W/2, -TORSO_H/2, TORSO_W, TORSO_H/2 + 2)
  ctx.clip()
  roundedRect(ctx, -TORSO_W/2, -TORSO_H, TORSO_W, TORSO_H, 5, mainB, null)
  ctx.restore()

  // Head + eyes
  ctx.beginPath()
  ctx.fillStyle = mainA
  ctx.strokeStyle = line
  ctx.lineWidth = 2
  ctx.arc(0, -TORSO_H - HEAD + 4, HEAD, 0, Math.PI * 2)
  ctx.fill(); ctx.stroke()
  drawEye(ctx, -HEAD*0.45, -TORSO_H - HEAD + 4, HEAD*0.75, 0.32, white, line)
  drawEye(ctx,  HEAD*0.45, -TORSO_H - HEAD + 4, HEAD*0.75, 0.32, white, line)

  // Arms
  const armLen = LIMB * (1.0 + 0.12 * Math.abs(armSwing))
  drawLimb(ctx, -TORSO_W*0.45, -TORSO_H*0.75, -armLen*0.6,  armLen*0.2, -armLen,  armLen*0.35, mainB, line)
  drawLimb(ctx,  TORSO_W*0.45, -TORSO_H*0.70,  armLen*0.6,  armLen*0.1,  armLen,  armLen*0.25, mainB, line)

  // Legs
  const legK = LIMB * (1.0 + 0.15 * Math.abs(legSwing))
  drawLimb(ctx, -TORSO_W*0.3,  0, -legK*0.2,  legK*(0.6+tuck), -legK*0.1,  legK*(1.1+tuck), mainB, line)
  drawLimb(ctx,  TORSO_W*0.3,  0,  legK*0.2,  legK*(0.3+tuck),  legK*0.1,  legK*(0.9+tuck), mainB, line)

  // emblem
  ctx.fillStyle = white
  ctx.beginPath()
  ctx.ellipse(0, -TORSO_H*0.45, 3.2*scale, 2.2*scale, 0, 0, Math.PI*2)
  ctx.fill()

  // subtle web lines on torso top
  ctx.save()
  ctx.strokeStyle = "rgba(255,255,255,0.35)"
  ctx.lineWidth = 0.8
  for (let y = -TORSO_H + 2; y < -TORSO_H/2 - 1; y += 5) {
    ctx.beginPath()
    ctx.moveTo(-TORSO_W/2 - 0.5, y)
    ctx.lineTo(TORSO_W/2 + 0.5, y)
    ctx.stroke()
  }
  ctx.restore()
}

function drawEye(ctx, cx, cy, w, tilt=0.3, fill="#fff", stroke="rgba(0,0,0,0.85)") {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(tilt * (cx < 0 ? 1 : -1))
  ctx.fillStyle = fill
  ctx.strokeStyle = stroke
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.ellipse(0, 0, w*0.38, w*0.22, 0, 0, Math.PI*2)
  ctx.fill(); ctx.stroke()
  ctx.restore()
}

function drawLimb(ctx, x0, y0, cx1, cy1, cx2, cy2, fill="#2d7bff", stroke="rgba(0,0,0,0.85)") {
  ctx.save()
  ctx.strokeStyle = stroke
  ctx.lineWidth = 4
  ctx.lineCap = "round"
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.bezierCurveTo(x0 + cx1, y0 + cy1, x0 + cx2, y0 + cy2, x0 + cx2, y0 + cy2)
  ctx.stroke()

  // small boot/glove hint
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.arc(x0 + cx2, y0 + cy2, 3.5, 0, Math.PI*2)
  ctx.fill()
  ctx.restore()
}

function roundedRect(ctx, x, y, w, h, r, fill="#ff1d2e", stroke="rgba(0,0,0,0.85)") {
  const rr = Math.min(r, w/2, h/2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  ctx.lineTo(x + rr, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr)
  ctx.lineTo(x, y + rr)
  ctx.quadraticCurveTo(x, y, x + rr, y)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke() }
}

function smoothPulse(x, width=0.3) {
  const d = Math.max(0, 1 - (Math.abs(x) / Math.max(1e-6, width)))
  return d*d*(3 - 2*d)
}

/* ================= Keyboard (clean 3D + bright press) ================= */

function drawKeyboardGame(
  ctx, FIRST, LAST, keyW, yTop, Hk, pressedSet, flashSet, pressMap, isBlack,
  opts
) {
  const { showKeyLabels, labelMode, preferFlats } = opts || {}
  const cols = LAST - FIRST + 1

  // Bright bed
  const bedGrad = ctx.createLinearGradient(0, yTop, 0, yTop + Hk)
  bedGrad.addColorStop(0.0, "#fafafa")
  bedGrad.addColorStop(1.0, "#f0f0f0")
  ctx.fillStyle = bedGrad
  ctx.fillRect(0, yTop, cols * keyW, Hk)

  // WHITE KEYS
  for (let p = FIRST; p <= LAST; p++) {
    if (isBlack(p)) continue
    const x = (p - FIRST) * keyW
    const press = pressMap.get(p) ?? 0
    drawWhiteKeyGame(ctx, x, yTop, keyW - 1, Hk, press)

    if (press > 0.02) {
      ctx.save()
      ctx.globalAlpha = 0.30 * press
      ctx.fillStyle = "#ffd54f"
      ctx.fillRect(x + 0.5, yTop + 0.5, keyW - 2, Hk - 1)
      ctx.globalAlpha = 0.55 * press
      ctx.strokeStyle = "rgba(255, 193, 7, 0.85)"
      ctx.lineWidth = 1.5
      ctx.strokeRect(x + 1, yTop + 1, keyW - 3, Hk - 2)
      ctx.restore()
    }

    if (flashSet.has(p)) {
      ctx.fillStyle = "#ff8a00"
      ctx.fillRect(x, yTop - 5, keyW - 1, 4)
    }
  }

  // BLACK KEYS drop hint (soft)
  for (let p = FIRST; p <= LAST; p++) {
    if (!isBlack(p)) continue
    const x = (p - FIRST) * keyW + keyW * 0.2
    const w = keyW * 0.6
    const g = ctx.createLinearGradient(0, yTop, 0, yTop + Math.max(3, Hk * 0.08))
    g.addColorStop(0, "rgba(0,0,0,0.22)")
    g.addColorStop(1, "rgba(0,0,0,0)")
    ctx.fillStyle = g
    ctx.fillRect(x - 1, yTop + 2, w + 2, Math.max(3, Hk * 0.08))
  }

  // BLACK KEYS
  for (let p = FIRST; p <= LAST; p++) {
    if (!isBlack(p)) continue
    const press = pressMap.get(p) ?? 0
    const x = (p - FIRST) * keyW + keyW * 0.2
    const w = keyW * 0.6
    const h = Hk * 0.62
    drawBlackKeyGame(ctx, x, yTop, w, h, press)

    if (press > 0.02) {
      ctx.save()
      ctx.globalCompositeOperation = "screen"
      ctx.globalAlpha = 0.55 * press
      ctx.fillStyle = "#ffd54f"
      ctx.fillRect(x + 1, yTop + 1, w - 2, h - 2)
      ctx.globalCompositeOperation = "lighter"
      ctx.globalAlpha = 0.6 * press
      ctx.strokeStyle = "rgba(255, 213, 79, 0.9)"
      ctx.lineWidth = 1.25
      ctx.strokeRect(x + 1, yTop + 1, w - 2, h - 2)
      ctx.restore()
    }

    if (flashSet.has(p)) {
      ctx.fillStyle = "#ff8a65"
      ctx.fillRect(x, yTop - 5, w, 4)
    }
  }

  // Keyboard top line
  ctx.strokeStyle = "#111"
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, yTop)
  ctx.lineTo(cols * keyW, yTop)
  ctx.stroke()
  ctx.lineWidth = 1

  if (showKeyLabels) {
    drawKeyLabels(ctx, FIRST, LAST, keyW, yTop, Hk, isBlack, { labelMode, preferFlats })
  }
}

function drawWhiteKeyGame(ctx, x, y, w, h, press=0) {
  const g = ctx.createLinearGradient(0, y, 0, y + h)
  g.addColorStop(0.0, "#ffffff")
  g.addColorStop(0.45, "#f7f7f7")
  g.addColorStop(1.0, "#ececec")
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)

  const topHL = ctx.createLinearGradient(0, y, 0, y + 2)
  topHL.addColorStop(0, "rgba(255,255,255,0.95)")
  topHL.addColorStop(1, "rgba(255,255,255,0.35)")
  ctx.fillStyle = topHL
  ctx.fillRect(x + 0.5, y + 0.5, w - 1, 1.5)

  ctx.strokeStyle = "rgba(0,0,0,0.16)"
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)

  if (press > 0.05) {
    const sh = Math.min(8, h * 0.1) * press
    const sg = ctx.createLinearGradient(0, y, 0, y + sh)
    sg.addColorStop(0, "rgba(0,0,0,0.18)")
    sg.addColorStop(1, "rgba(0,0,0,0)")
    ctx.fillStyle = sg
    ctx.fillRect(x + 1, y + 1, w - 2, sh)
  }
}

function drawBlackKeyGame(ctx, x, y, w, h, press=0) {
  const g = ctx.createLinearGradient(0, y, 0, y + h)
  g.addColorStop(0, "#3b3b3b")
  g.addColorStop(0.55, "#262626")
  g.addColorStop(1, "#191919")
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)

  const glossH = Math.max(2, h * 0.18)
  const gg = ctx.createLinearGradient(0, y, 0, y + glossH)
  gg.addColorStop(0, "rgba(255,255,255,0.22)")
  gg.addColorStop(1, "rgba(255,255,255,0.03)")
  ctx.fillStyle = gg
  ctx.fillRect(x + 1, y + 1, w - 2, glossH)

  ctx.strokeStyle = "rgba(0,0,0,0.6)"
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)

  const lip = ctx.createLinearGradient(0, y + h - 1.5, 0, y + h)
  lip.addColorStop(0, "rgba(255,255,255,0.12)")
  lip.addColorStop(1, "rgba(255,255,255,0.05)")
  ctx.fillStyle = lip
  ctx.fillRect(x + 1, y + h - 1.5, w - 2, 1.5)
}

/* ================= Impact FX (tinted for theme/variant) ================= */

function drawImpactFX(ctx, bursts, t, yKeyboardTop, keyboardH, spiderMode=false, thm={}, variant="red") {
  if (!bursts || bursts.length === 0) return
  ctx.save()
  ctx.globalCompositeOperation = "lighter"

  for (const b of bursts) {
    const age = t - b.t0
    if (age < 0) continue
    const L = 0.42
    const u = Math.min(1, age / L)

    const r0 = 4
    const r1 = 2.6 * Math.max(8, keyboardH * 0.12)
    const r = r0 + (r1 - r0) * easeOutCubic(u)
    const ringAlpha = 0.75 * (1 - u)
    drawGlowRing(ctx, b.xCenter, yKeyboardTop, r, ringAlpha, spiderMode, thm, variant)

    const splashDepth = keyboardH * 0.35
    const splashLen = splashDepth * clamp01(1 - u * 1.2)
    const splashAlpha = 0.65 * clamp01(1 - u * 1.2)
    if (splashLen > 2) {
      const w = Math.max(6, r * 0.45)
      drawVerticalSplash(ctx, b.xCenter, yKeyboardTop, w, splashLen, splashAlpha, spiderMode, thm, variant)
    }

    if (u < 0.35) {
      const raysAlpha = 0.9 * (1 - u / 0.35)
      drawRays(ctx, b.xCenter, yKeyboardTop, raysAlpha, spiderMode, thm, variant)
    }
  }

  ctx.restore()
}

function drawGlowRing(ctx, x, y, radius, alpha=0.7, spiderMode=false, thm={}, variant="red") {
  ctx.save()
  const inner = spiderMode ? (variant === "red" ? "#ff2d2e" : (thm?.burstHot || "#FF2D95")) : "#FFD688"
  const mid   = spiderMode ? (variant === "red" ? "#ff6b6b" : (thm?.purple   || "#7C00FF")) : "#FFC07A"
  const edge  = spiderMode ? (variant === "red" ? "#2D7BFF" : (thm?.cyan     || "#00E5FF")) : "#FF8250"
  const g = ctx.createRadialGradient(x, y, Math.max(1, radius * 0.25), x, y, radius)
  g.addColorStop(0.0, `rgba(255,255,255,${0.85*alpha})`)
  g.addColorStop(0.35, hexA(mid, 0.75*alpha))
  g.addColorStop(0.7,  hexA(edge, 0.40*alpha))
  g.addColorStop(1.0,  hexA(edge, 0))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawVerticalSplash(ctx, x, yTop, width, length, alpha=0.6, spiderMode=false, thm={}, variant="red") {
  ctx.save()
  const half = width / 2
  const yBot = yTop + length
  const top = spiderMode ? (variant === "red" ? "#ff2d2e" : (thm?.burstHot || "#FF2D95")) : "#FFFFFF"
  const mid = spiderMode ? (variant === "red" ? "#2D7BFF" : (thm?.cyan     || "#00E5FF")) : "#FFC878"
  const g = ctx.createLinearGradient(x, yTop, x, yBot)
  g.addColorStop(0.0, hexA(top, 0.95*alpha))
  g.addColorStop(0.3, hexA(mid, 0.7*alpha))
  g.addColorStop(1.0, hexA(mid, 0))
  ctx.fillStyle = g
  ctx.fillRect(x - half, yTop, width, length)
  ctx.restore()
}

function drawRays(ctx, x, y, alpha=0.8, spiderMode=false, thm={}, variant="red") {
  ctx.save()
  const count = 6
  const len = 26
  const base = spiderMode ? (variant === "red" ? "#2D7BFF" : (thm?.cyan || "#00E5FF")) : "#FFDCA0"
  ctx.strokeStyle = hexA(base, alpha)
  ctx.lineWidth = 2
  for (let i = 0; i < count; i++) {
    const a = (-Math.PI/2) + ((i - (count-1)/2) * Math.PI / 16)
    const x2 = x + Math.cos(a) * len
    const y2 = y + Math.sin(a) * len
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }
  ctx.restore()
}

function hexA(hex, a=1){
  const h = hex.startsWith("#") ? hex.slice(1) : hex
  const r = parseInt(h.substring(0,2),16) || 255
  const g = parseInt(h.substring(2,4),16) || 255
  const b = parseInt(h.substring(4,6),16) || 255
  return `rgba(${r},${g},${b},${a})`
}

/* ================= Easing / utils ================= */

function easeOutCubic(u){ return 1 - Math.pow(1 - clamp01(u), 3) }
function clamp01(x){ return Math.max(0, Math.min(1, x)) }
function clamp(min, max, v){ return Math.max(min, Math.min(max, v)) }

/* ================= Labels ================= */

function midiToName(midi, { preferFlats = false, withOctave = true } = {}) {
  const namesSharps = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]
  const namesFlats  = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"]
  const pc = midi % 12
  const name = (preferFlats ? namesFlats : namesSharps)[pc]
  if (!withOctave) return name
  const oct = Math.floor(midi / 12) - 1
  return `${name}${oct}`
}

function drawKeyLabels(ctx, FIRST, LAST, keyW, yTop, Hk, isBlack, { labelMode = "all", preferFlats = false } = {}) {
  const showOctaveWhite = keyW >= 10
  const showOctaveBlack = keyW >= 16
  const fontWhite = Math.max(9, Math.min(12, Math.floor(keyW * 0.95)))
  const fontBlack = Math.max(9, Math.min(12, Math.floor(keyW * 0.95)))

  ctx.save()
  ctx.textAlign = "center"
  ctx.shadowColor = "rgba(0,0,0,0.15)"
  ctx.shadowBlur = 0

  if (labelMode !== "cOnly") {
    ctx.font = `${fontWhite}px system-ui`
    for (let p = FIRST; p <= LAST; p++) {
      if (isBlack(p)) continue
      if (labelMode === "white" || labelMode === "all") {
        const x = (p - FIRST) * keyW + keyW / 2
        const y = yTop + Hk - 6
        ctx.fillStyle = "#111"
        const text = midiToName(p, { preferFlats, withOctave: showOctaveWhite })
        ctx.fillText(text, x, y)
      }
    }
  }

  if (labelMode === "all" || labelMode === "cOnly") {
    ctx.font = `${fontBlack}px system-ui`
    const pillPadX = 4, pillPadY = 2, pillRadius = 6
    const yAbove = yTop - 8

    for (let p = FIRST; p <= LAST; p++) {
      const pc = p % 12
      const black = isBlack(p)
      if (labelMode === "cOnly" && pc !== 0) continue
      if (!black && labelMode === "all") continue

      let xCenter = black
        ? (p - FIRST) * keyW + keyW * 0.2 + (keyW * 0.6) / 2
        : (p - FIRST) * keyW + keyW / 2

      if (keyW < 12 && black) {
        if (pc === 1) xCenter -= 1.5
        if (pc === 3) xCenter += 1.5
        if (pc === 8) xCenter -= 1.0
        if (pc === 10) xCenter += 1.0
      }

      const text = midiToName(p, { preferFlats, withOctave: black ? showOctaveBlack : showOctaveWhite })
      const metrics = ctx.measureText(text)
      const textW = metrics.width
      const textH = fontBlack
      const w = textW + pillPadX * 2
      const h = textH + pillPadY * 2
      const x = xCenter - w / 2
      const y = yAbove - h

      roundRect(ctx, x, y, w, h, pillRadius, "#fff", "#222", 0.9)
      ctx.fillStyle = "#111"
      ctx.fillText(text, xCenter, y + h - pillPadY - 1)
    }
  }

  ctx.restore()
}

function roundRect(ctx, x, y, w, h, r, fill = "#fff", stroke = "#222", alpha = 1) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  if (stroke) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = 1
    ctx.stroke()
  }
  ctx.restore()
}
