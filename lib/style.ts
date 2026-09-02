// Shared types + rail enforcement for the project style-intake feature
// (spec Section 9, platform Section 21). Sibling of lib/sourcing.ts.
//
// The conversation itself is a creative back-and-forth and can be as rich as it
// wants — these rails only govern what actually gets written when the user
// confirms a profile: grounded references (real URLs, never fabricated),
// bounded volume, sanitized text, and a fixed persisted shape. Nothing here can
// ever write a "sourced" item — that boundary lives entirely in the room-chat
// path (lib/sourcing.ts) and is untouched by this feature (rail 9.4).

import type { PaletteEntry } from './types'

/** `attachments` are Storage keys under the 'style-references' bucket, only
 *  meaningful on a user turn — the images that turn attached (Phase 6c). */
export type StyleChatMessage = {
  role: 'user' | 'assistant'
  content: string
  attachments?: string[]
}

export type StyleChatRequestBody = {
  projectId: string
  messages: StyleChatMessage[]
}

// --- Uploaded image constraints (Phase 6c) --------------------------------

export const UPLOAD_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
export type UploadImageMime = (typeof UPLOAD_IMAGE_MIME)[number]

/** Pre-downscale file-picker ceiling (the client re-encodes to a small JPEG). */
export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024
/** Anthropic's per-image base64 ceiling. */
export const MAX_IMAGE_B64_BYTES = 5 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_TURN = 4
/** Across the whole re-sent history, not per turn. */
export const MAX_ATTACHMENTS_TOTAL = 8

const EXT_TO_MIME: Record<string, UploadImageMime> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}

export function mediaTypeFromPath(path: string): UploadImageMime | null {
  const m = /\.([a-z0-9]+)$/i.exec(path.trim())
  return m ? (EXT_TO_MIME[m[1].toLowerCase()] ?? null) : null
}

/**
 * A Storage key must sit directly under the project's own folder —
 * "<projectId>/<file>.<ext>" — with a known image extension, no nesting, no
 * traversal. The bucket RLS already blocks cross-project access; this is the
 * belt-and-braces check before the route ever touches Storage.
 */
export function isValidStoragePath(path: unknown, projectId: string): path is string {
  if (typeof path !== 'string') return false
  const p = path.trim()
  if (!p || p.includes('..') || p.includes('\\')) return false
  const parts = p.split('/')
  if (parts.length !== 2 || parts[0] !== projectId) return false
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(parts[1])) return false
  return mediaTypeFromPath(p) !== null
}

/** New object key for an upload. The client always re-encodes to JPEG, so the
 *  extension follows the final blob's mime, not the original filename. */
export function storageKeyForUpload(projectId: string, mime: UploadImageMime): string {
  const ext =
    (Object.keys(EXT_TO_MIME) as (keyof typeof EXT_TO_MIME)[]).find(
      (k) => EXT_TO_MIME[k] === mime && k !== 'jpeg'
    ) ?? 'jpg'
  return `${projectId}/${crypto.randomUUID()}.${ext}`
}

/** A web reference the model proposes (uploads are Phase 6c, not here). */
export type StyleReferenceDraft = {
  kind: 'web_image' | 'web_link'
  url: string
  caption: string | null
}

/** The persisted profile shape, after rails. `style_summary` is a composed
 *  plain-text block (Mood / Materials / Avoid); palette + prefs live in their
 *  own project columns; references become style_references rows. */
export type ConfirmedStyleProfile = {
  style_summary: string
  palette: PaletteEntry[]
  prefers_unique: boolean | null
  deal_sensitive: boolean | null
  references: StyleReferenceDraft[]
}

/** One assistant turn. `message` = it talked (maybe after searching).
 *  `confirmed` = the user accepted a profile and it was written.
 *  `error` = request failed. */
export type StyleChatApiResponse =
  | { kind: 'message'; text: string }
  | { kind: 'confirmed'; text: string; profile: ConfirmedStyleProfile }
  | { kind: 'error'; text: string; code?: string }

// --- Rail constants ---------------------------------------------------------

export const MAX_REFERENCES = 6 // spec 9.1 — "a small set of reference images/links"
export const MAX_PALETTE = 8
export const MAX_LIST_ITEMS = 12
const MAX_LIST_ITEM_LEN = 80
const MAX_CAPTION_LEN = 200
const MAX_SUMMARY_LEN = 1500

const HTTP_URL = /^https?:\/\/[^\s]+$/i
const HEX = /^#[0-9A-Fa-f]{6}$/
// Control chars except tab (09) and newline (0A).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g

/** Strip control chars, collapse runs of blank lines, trim, hard-cap length. */
function sanitizeText(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(CONTROL_CHARS, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, maxLen)
}

/** Short-phrase list (materials, avoid-list): trim, drop empty, de-dupe
 *  case-insensitively, cap item length and count. */
export function sanitizeList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of raw) {
    const s = sanitizeText(entry, MAX_LIST_ITEM_LEN)
    if (!s) continue
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
    if (out.length >= MAX_LIST_ITEMS) break
  }
  return out
}

export function coerceBool(raw: unknown): boolean | null {
  if (raw === true || raw === false) return raw
  if (raw === 'true') return true
  if (raw === 'false') return false
  return null
}

/** Keep only well-formed { hex, label } entries; cap the count. */
export function validatePalette(raw: unknown): PaletteEntry[] {
  if (!Array.isArray(raw)) return []
  const out: PaletteEntry[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const r = entry as Record<string, unknown>
    const hex = typeof r.hex === 'string' ? r.hex.trim() : ''
    if (!HEX.test(hex)) continue
    const label = sanitizeText(r.label, 60) || hex.toUpperCase()
    out.push({ hex: hex.toUpperCase(), label })
    if (out.length >= MAX_PALETTE) break
  }
  return out
}

/**
 * Grounding rail (spec 9.4): a web reference must be a real, retrievable URL.
 * Deliberately lighter than sourcing's validateListing — a category page, a
 * gallery, or a blog post is a perfectly good inspiration link; it just has to
 * be a real http(s) URL the model actually retrieved, not an invented one.
 */
export function validateStyleReferences(raw: unknown): StyleReferenceDraft[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: StyleReferenceDraft[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const r = entry as Record<string, unknown>
    const kind = r.kind === 'web_image' || r.kind === 'web_link' ? r.kind : null
    if (!kind) continue
    const url = typeof r.url === 'string' ? r.url.trim() : ''
    if (!HTTP_URL.test(url) || seen.has(url)) continue
    seen.add(url)
    const caption = sanitizeText(r.caption, MAX_CAPTION_LEN)
    out.push({ kind, url, caption: caption || null })
    if (out.length >= MAX_REFERENCES) break
  }
  return out
}

/** Compose the persisted `style_summary` from structured fields only — the
 *  model's descriptor prose is the point of the feature, but it arrives as
 *  bounded fields, not free narration into the column. */
export function composeStyleSummary(input: {
  mood?: unknown
  materials?: unknown
  avoid?: unknown
}): string {
  const mood = sanitizeText(input.mood, 800)
  const materials = sanitizeList(input.materials)
  const avoid = sanitizeList(input.avoid)

  const lines: string[] = []
  if (mood) lines.push(`Mood: ${mood}`)
  if (materials.length) lines.push(`Materials & textures: ${materials.join(', ')}`)
  if (avoid.length) lines.push(`Avoid: ${avoid.join(', ')}`)
  return lines.join('\n').slice(0, MAX_SUMMARY_LEN)
}

/**
 * Turn a raw confirm_style_profile tool input into the validated, persisted
 * profile shape. Returns null only when there is nothing usable at all (no
 * summary text and no palette) — the caller then treats the turn as a plain
 * message rather than a write.
 */
export function buildConfirmedProfile(raw: unknown): ConfirmedStyleProfile | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  const style_summary = composeStyleSummary({
    mood: r.mood,
    materials: r.materials,
    avoid: r.avoid,
  })
  const palette = validatePalette(r.palette)
  if (!style_summary && palette.length === 0) return null

  return {
    style_summary,
    palette,
    prefers_unique: coerceBool(r.prefers_unique),
    deal_sensitive: coerceBool(r.deal_sensitive),
    references: validateStyleReferences(r.references),
  }
}

/** Human-readable confirmation line for the chat log (no model prose). */
export function describeConfirmation(profile: ConfirmedStyleProfile): string {
  const bits: string[] = []
  if (profile.palette.length) bits.push(`${profile.palette.length}-color palette`)
  if (profile.references.length)
    bits.push(`${profile.references.length} reference${profile.references.length === 1 ? '' : 's'}`)
  const tail = bits.length ? ` (${bits.join(', ')})` : ''
  return `Saved the style profile for this project${tail}. Every room conversation will start from it. Come back any time to build on it.`
}
