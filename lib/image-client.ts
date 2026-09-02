// Client-only image prep for style-reference uploads (Phase 6c). Downscale to a
// model-friendly size and re-encode to JPEG before upload — keeps the stored
// object small, strips EXIF (orientation is baked in by the canvas draw, and
// location metadata is dropped), and means every upload has a known media type.
//
// Only import this from a 'use client' component; it touches window/document.

/** Anthropic's recommended max edge for vision — larger buys nothing. */
const DEFAULT_MAX_EDGE = 1568
const DEFAULT_QUALITY = 0.85

export async function downscaleToJpeg(
  file: File,
  maxEdge = DEFAULT_MAX_EDGE,
  quality = DEFAULT_QUALITY
): Promise<Blob> {
  const dataUrl = await readAsDataUrl(file)
  const img = await loadImage(dataUrl)

  const longest = Math.max(img.naturalWidth, img.naturalHeight)
  const scale = longest > maxEdge ? maxEdge / longest : 1
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.drawImage(img, 0, 0, w, h)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Image encode failed'))),
      'image/jpeg',
      quality
    )
  })
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Not a readable image'))
    img.src = src
  })
}
