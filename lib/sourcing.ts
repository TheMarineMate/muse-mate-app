// Shared types + rail enforcement for the sourcing feature (spec Section 5,
// platform Section 21). The validation here is the "never mark Sourced from an
// unverified match" rail — it runs server-side regardless of what the model
// claims in its structured output.

export type Listing = {
  title: string
  retailer: string
  price: number
  url: string
  width_in: number | null
  depth_in: number | null
  height_in: number | null
}

export type SourcingRequestBody = {
  roomId: string
  query: string
  targetItemId?: string | null
}

export type SourcingApiResponse =
  | {
      outcome: 'sourced'
      message: string
      itemId: string
      itemName: string
      isNewItem: boolean
      chosen: Listing
      alternatives: Listing[]
    }
  | { outcome: 'no_match'; message: string; query: string }
  | { outcome: 'error'; message: string; code?: string }

const HTTP_URL = /^https?:\/\/[^\s]+$/i

function toDimension(value: unknown): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Returns a clean Listing only if it has a real price (> 0) and a real http(s)
 * URL and a non-empty title. Anything else returns null — the caller must then
 * treat the outcome as no_match and write nothing.
 */
export function validateListing(raw: unknown): Listing | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  const title = typeof r.title === 'string' ? r.title.trim() : ''
  if (!title) return null

  const url = typeof r.url === 'string' ? r.url.trim() : ''
  if (!HTTP_URL.test(url)) return null

  const price = Number(r.price_usd ?? r.price)
  if (!Number.isFinite(price) || price <= 0) return null

  return {
    title,
    retailer: typeof r.retailer === 'string' ? r.retailer.trim() : '',
    price,
    url,
    width_in: toDimension(r.width_in),
    depth_in: toDimension(r.depth_in),
    height_in: toDimension(r.height_in),
  }
}

/** Volume cap (spec Section 5) — at most 3 valid alternatives. */
export function validateAlternatives(raw: unknown): Listing[] {
  if (!Array.isArray(raw)) return []
  const out: Listing[] = []
  for (const entry of raw) {
    const v = validateListing(entry)
    if (v) out.push(v)
    if (out.length >= 3) break
  }
  return out
}

/** Factual note written to the item — composed from structured fields only, so
 *  no model prose reaches the database (Section 21 tone rails). */
export function composeSourcingNote(chosen: Listing, alternatives: Listing[]): string {
  const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
  let note = `Sourced by assistant: ${chosen.title}`
  if (chosen.retailer) note += ` — ${chosen.retailer}`
  note += `, ${money(chosen.price)}.`
  if (alternatives.length > 0) {
    note +=
      ' Alternatives: ' +
      alternatives.map((a) => `${a.title} (${money(a.price)})`).join(', ') +
      '.'
  }
  return note.slice(0, 800)
}
