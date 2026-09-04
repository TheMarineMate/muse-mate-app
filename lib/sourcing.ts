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
  /** true only when the engine confirmed this exact price on a page it fetched
   *  this turn (priceInPage). Almost always false for presented options, since
   *  retailer PDPs client-render the price. Drives whether "Log this" needs a
   *  human confirm step. */
  priceVerified: boolean
  /** true when the price is over the ceiling the user gave for this item (but
   *  within the 20% margin — anything further over is dropped before it gets
   *  here). The card shows an "over budget" label. */
  overBudget: boolean
}

/** How a sourced price was vouched for (persisted to items.price_confirmation). */
export type PriceConfirmation = 'fetch_verified' | 'human_confirmed'

export type ConversationMessage = { role: 'user' | 'assistant'; content: string }

export type SourcingRequestBody = {
  roomId: string
  messages: ConversationMessage[]
  targetItemId?: string | null
}

// One assistant turn. `message` = it talked (maybe after searching) and wrote
// nothing. `sourced` = it logged a verified listing. `no_match` = it searched
// and found nothing solid (or timed out). `error` = request failed.
export type SourcingApiResponse =
  | { kind: 'message'; text: string }
  | {
      kind: 'sourced'
      text: string
      itemId: string
      itemName: string
      isNewItem: boolean
      chosen: Listing
      alternatives: Listing[]
    }
  /** Candidate listings presented for the user to pick from (nothing logged). */
  | { kind: 'options'; text: string; options: Listing[] }
  | { kind: 'no_match'; text: string }
  | { kind: 'error'; text: string; code?: string }

const HTTP_URL = /^https?:\/\/[^\s]+$/i

// A search-results, category, or "browse" page is not a listing (live-test
// finding #2). These patterns are high-confidence search/category signals —
// deliberately conservative so real product URLs with tracking params still
// pass. The model is also told this in the system prompt; this is the backstop.
const SEARCH_PAGE_PATTERNS: RegExp[] = [
  /[?&](k|q|query|keyword|keywords|search|searchterm|field-keywords|srch)=/i,
  /\/s\?/i, // amazon /s?k=
  /\/s\/ref=/i, // amazon
  /\/sch\//i, // ebay search
  /\/b\/ref=/i, // amazon browse node
  /\/gp\/(search|bestsellers|browse|most-wished-for|new-releases)/i, // amazon
  /\/(search|browse|results)(\/|\?|#|$)/i,
  /\/sb\d\//i, // wayfair "shop by" category pages: /furniture/sb1/, /sb2/
  /\/keyword\.php/i, // wayfair keyword search
  /-c\d{3,}(-a[\d~-]+)*\.html($|\?|#)/i, // wayfair category suffix: ...-c46122-a115~128.html
]

export function looksLikeSearchOrCategoryPage(url: string): boolean {
  return SEARCH_PAGE_PATTERNS.some((re) => re.test(url))
}

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
  if (looksLikeSearchOrCategoryPage(url)) return null

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
    priceVerified: r.priceVerified === true,
    overBudget: r.overBudget === true,
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

/**
 * Presented options (not logged). Same real-URL / real-price checks as a
 * listing, capped at 3 (Section 20 volume cap), deduped by URL. These prices
 * are candidates the user is choosing from — the page-verified price rail
 * still runs when one is actually submitted.
 */
export function validateOptions(raw: unknown): Listing[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: Listing[] = []
  for (const entry of raw) {
    const v = validateListing(entry)
    if (!v || seen.has(v.url)) continue
    seen.add(v.url)
    out.push(v)
    if (out.length >= 3) break
  }
  return out
}

/** Factual note written to the item — composed from structured fields only, so
 *  no model prose reaches the database (Section 21 tone rails). */
export function composeSourcingNote(
  chosen: Listing,
  alternatives: Listing[],
  confirmation: PriceConfirmation = 'fetch_verified'
): string {
  const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
  let note = `Sourced by assistant: ${chosen.title}`
  if (chosen.retailer) note += ` — ${chosen.retailer}`
  note += `, ${money(chosen.price)}.`
  note +=
    confirmation === 'human_confirmed'
      ? ' Price confirmed by a project editor.'
      : ' Price verified on the retailer page.'
  if (alternatives.length > 0) {
    note +=
      ' Alternatives: ' +
      alternatives.map((a) => `${a.title} (${money(a.price)})`).join(', ') +
      '.'
  }
  return note.slice(0, 800)
}

/** The items-table patch for a sourced listing — shared by the model path
 *  (submit_sourcing, fetch_verified) and the human-confirm path
 *  (/api/sourcing/log, human_confirmed). Structured fields only. */
export function buildSourcedItemFields(
  chosen: Listing,
  alternatives: Listing[],
  confirmation: PriceConfirmation
): Record<string, unknown> {
  const dims: Record<string, number> = {}
  if (chosen.width_in != null) dims.width = chosen.width_in
  if (chosen.depth_in != null) dims.depth = chosen.depth_in
  if (chosen.height_in != null) dims.height = chosen.height_in
  return {
    price_estimate: chosen.price,
    link: chosen.url,
    note: composeSourcingNote(chosen, alternatives, confirmation),
    status: 'sourced',
    sourced_at: new Date().toISOString(),
    sourced_via: 'assistant',
    price_confirmation: confirmation,
    ...dims,
  }
}
