// Rasterises the Muse Mate mark (design/muse-mate-brand-assets.html markSVG())
// into the PNGs the PWA + browser need. iOS home-screen and older Android don't
// reliably take SVG manifest icons, so these are real rasters via sharp/librsvg.
//
//   npm run gen:icons
//
// Outputs:
//   public/icons/icon-192.png          with-glow on cream, 192   (manifest "any")
//   public/icons/icon-512.png          with-glow on cream, 512   (manifest "any")
//   public/icons/icon-maskable-512.png with-glow on cream, 512, extra safe-zone padding (manifest "maskable")
//   app/apple-icon.png                 with-glow on cream, 180   (Next apple-touch-icon)
//   app/icon.png                       flat mark, transparent, 64 (Next favicon)

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

// Light-mode brand values (icons render on a light/cream field).
const NAVY = '#1B3A5C'
const TEAL = '#2E9E8F'
const ORANGE = '#D97A4E'
const GLOW = '#FFE9DC'
const CREAM = '#FBF9F5'

/** The mark's own 60x60 body — three fanned panels, optional up-glow. */
function markBody({ glow }) {
  const glowMarkup = glow
    ? `<defs><radialGradient id="g" cx="65%" cy="30%" r="55%">
         <stop offset="0%" stop-color="${GLOW}" stop-opacity="0.9"/>
         <stop offset="100%" stop-color="${GLOW}" stop-opacity="0"/>
       </radialGradient></defs>
       <circle cx="38" cy="24" r="24" fill="url(#g)"/>`
    : ''
  return `${glowMarkup}
    <rect x="9" y="30" width="18" height="12" rx="3" fill="${NAVY}" transform="rotate(-6 9 30)"/>
    <rect x="16" y="21" width="24" height="16" rx="4" fill="${TEAL}" transform="rotate(4 16 21)"/>
    <rect x="24" y="9" width="30" height="19" rx="4" fill="${ORANGE}" transform="rotate(-3 24 9)"/>`
}

/** Wrap the 60x60 body in a size x size canvas, at the given scale. The mark's
 *  visual mass sits low-left of the 60-box centre, so nudge it back toward the
 *  optical centre (fractions of `size`). */
function iconSvg({ size, glow, coverage, background, nudgeX = 0, nudgeY = 0 }) {
  const scale = (size * coverage) / 60
  const base = (size - 60 * scale) / 2
  const tx = base + nudgeX * size
  const ty = base + nudgeY * size
  const bg = background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${bg}
    <g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(4)})">
      ${markBody({ glow })}
    </g>
  </svg>`
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const GLOW_NUDGE = { nudgeX: 0.045, nudgeY: 0.05 }
const targets = [
  { rel: 'public/icons/icon-192.png', size: 192, glow: true, coverage: 0.7, background: CREAM, ...GLOW_NUDGE },
  { rel: 'public/icons/icon-512.png', size: 512, glow: true, coverage: 0.7, background: CREAM, ...GLOW_NUDGE },
  { rel: 'public/icons/icon-maskable-512.png', size: 512, glow: true, coverage: 0.58, background: CREAM, ...GLOW_NUDGE },
  { rel: 'app/apple-icon.png', size: 180, glow: true, coverage: 0.7, background: CREAM, ...GLOW_NUDGE },
  { rel: 'app/icon.png', size: 64, glow: false, coverage: 0.84, background: null, nudgeX: 0.03, nudgeY: 0.03 },
]

for (const t of targets) {
  const out = join(root, t.rel)
  mkdirSync(dirname(out), { recursive: true })
  const svg = iconSvg(t)
  await sharp(Buffer.from(svg), { density: 384 })
    .resize(t.size, t.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(out)
  console.log(`wrote ${t.rel}  (${t.size}x${t.size}${t.glow ? ', glow' : ', flat'})`)
}
