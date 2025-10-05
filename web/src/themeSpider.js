// src/themeSpider.js
export const spiderTheme = {
  name: "spiderverse",
  // Neon palette inspired by the films
  cyan:   "#00E5FF",
  magenta:"#FF2D95",
  purple: "#7C00FF",
  red:    "#FF1D2E",
  yellow: "#FFD54F",
  ink:    "#0C0B10",
  paper:  "#0e0d13",
  // Background gradients
  bgGradStops: [
    {pos:0.0, color:"#0e0d13"},
    {pos:0.5, color:"#17142a"},
    {pos:1.0, color:"#251a44"},
  ],
  // Note colors per hand (kept readable)
  leftNoteFill:  "#7C00FF",  // left hand = purple
  rightNoteFill: "#00E5FF",  // right hand = neon cyan
  // Impact burst tints
  burstHot:  "#FF2D95",
  burstWarm: "#FF6E40",
  // Halftone
  halftoneAlpha: 0.10,
  // UI
  fontTitle: "'Bangers', system-ui",
  fontUI: "'Montserrat', system-ui",
}
