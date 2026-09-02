import type Anthropic from '@anthropic-ai/sdk'
import type { ConversationMessage } from './sourcing'
import type { PaletteEntry } from './types'
import type { UploadImageMime } from './style'

/** Project-level style context inherited by every room chat (spec 9.2). Built
 *  by the route from the confirmed style profile + style_references. */
export type SourcingStyleContext = {
  /** The composed Mood / Materials / Avoid block (projects.style_summary). */
  summary: string | null
  palette: PaletteEntry[]
  prefersUnique: boolean | null
  dealSensitive: boolean | null
  webRefs: { url: string; caption: string | null }[]
  /** How many uploaded reference photos are attached to the first user turn. */
  imageCount: number
}

export type SourcingImage = { media_type: UploadImageMime; data: string }

// The AI orchestration for the sourcing feature: the system prompt, the tool
// set, and the loop that turns a conversation into one assistant turn — which
// is either a plain message or a structured submit_sourcing call. The route
// owns auth, role checks, and the DB write (and the hard validateListing rail);
// this owns "given the conversation, produce the next turn".

// Tolerate two pause_turn cycles — the search -> category-page -> web_fetch ->
// drill-in pattern (common on Wayfair) genuinely needs them. The AbortController
// below is the real time bound; this is just a backstop against a pause loop.
// (The 504s that motivated cutting this were the model's own "reply go ahead"
// continuation turn, which the tone-rail fix already removed.)
const MAX_CONTINUATIONS = 2

// Hard ceiling on one turn's model + tool work. ~35s under the route's 120s
// maxDuration leaves room for the Supabase preamble + response serialization —
// a stuck turn returns a clean message, never a 504 or an indefinite spinner.
// Overridable via env for tuning without a deploy.
const ENGINE_TIMEOUT_MS = Number(process.env.SOURCING_TIMEOUT_MS) || 85_000

/**
 * The model, on running out of searches mid-turn, tends to narrate the limit
 * ("I've hit my search limit for this turn", "reply 'go ahead' to continue").
 * That prose is a Section 21 tone-rail violation and a dead end — the "continue"
 * turn is the heaviest possible and was 504-ing. If a turn's visible text looks
 * like this, we drop it and return a clean `exhausted` outcome instead.
 */
export function looksLikeSearchLimitNarration(text: string): boolean {
  return /\b(search|tool|fetch)\b[^.\n]{0,20}\b(limit|quota|cap|budget)s?\b|\bhit\b[^.\n]{0,25}\blimits?\b|\b(?:reached|at|maxed out)\b[^.\n]{0,20}\blimits?\b|\blimits?\s+(?:for )?(?:this|the)\s+(?:turn|pass|reply|round)\b|\b(used up|ran out of|out of|no more)\s+(?:my\s+)?(?:searches|fetches|lookups)\b|\bfor this turn\b|\breply (?:back )?(?:with )?["']?go ahead["']?|\bsay ["']?go ahead["']?|\btell me to (?:go on|continue|keep going)\b|\blet me know (?:if|when|and) .{0,40}\b(continue|go on|keep (?:going|looking|searching))\b/i.test(
    text
  )
}

/** True when a server tool (web_search / web_fetch) reported a usage-cap error
 *  in this response rather than results. */
function hitToolUsageCap(content: unknown): boolean {
  if (!Array.isArray(content)) return false
  return content.some((b) => {
    const block = b as { type?: string; content?: unknown }
    if (block?.type !== 'web_search_tool_result' && block?.type !== 'web_fetch_tool_result') {
      return false
    }
    const c = block.content as { error_code?: unknown } | undefined
    return (
      !!c &&
      !Array.isArray(c) &&
      typeof c === 'object' &&
      /max_uses|too_many|rate/i.test(String(c.error_code ?? ''))
    )
  })
}

export type Match = { kind?: string; item_id?: string; item_name?: string }
export type SubmittedResult = {
  outcome?: string
  match?: Match
  listing?: unknown
  alternatives?: unknown
}

export type TurnOutcome =
  | { kind: 'message'; text: string }
  | { kind: 'submit'; submitted: SubmittedResult }
  | { kind: 'timeout' }
  /** Ran out of searches this pass without landing anything solid. */
  | { kind: 'exhausted' }

export const SUBMIT_TOOL = {
  name: 'submit_sourcing',
  description:
    'Log a listing the user has chosen to the room checklist. Only call this after the user has picked an option (or told you to just log the best match) — not on your first search. The listing must be an in-stock, single-product page with a real price. At most once per turn.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['outcome', 'match', 'listing', 'alternatives'],
    properties: {
      outcome: {
        type: 'string',
        enum: ['sourced', 'no_match'],
        description:
          'Use "sourced" only if the primary listing is a real, in-stock, single-product page with a real price. Otherwise "no_match".',
      },
      match: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'item_id', 'item_name'],
        properties: {
          kind: { type: 'string', enum: ['existing', 'new'] },
          item_id: {
            type: 'string',
            description:
              'The id of the existing room item this maps to. Empty string if kind is "new".',
          },
          item_name: {
            type: 'string',
            description: 'A short name for the item. Used as-is when kind is "new".',
          },
        },
      },
      listing: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'retailer', 'price_usd', 'url', 'width_in', 'depth_in', 'height_in'],
        properties: {
          title: { type: 'string' },
          retailer: { type: 'string' },
          price_usd: { type: 'number', description: '0 if you have no real price.' },
          url: {
            type: 'string',
            description: 'Direct single-product page URL. Empty string if none.',
          },
          width_in: {
            type: 'number',
            description: 'Inches, only if the listing states it. Use 0 otherwise. Never estimate.',
          },
          depth_in: { type: 'number', description: 'Inches, from the listing only. 0 otherwise.' },
          height_in: { type: 'number', description: 'Inches, from the listing only. 0 otherwise.' },
        },
      },
      alternatives: {
        type: 'array',
        description: 'Up to 3 other real, in-stock, single-product listings.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'retailer', 'price_usd', 'url'],
          properties: {
            title: { type: 'string' },
            retailer: { type: 'string' },
            price_usd: { type: 'number' },
            url: { type: 'string' },
          },
        },
      },
    },
  },
}

export const WEB_SEARCH_TOOL = { type: 'web_search_20260209', name: 'web_search', max_uses: 4 }
export const WEB_FETCH_TOOL = { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 4 }

function styleLines(style: SourcingStyleContext): string[] {
  const out: string[] = ['', 'Project style profile (the shared direction for the whole project — spec 9.2):']
  if (style.summary) {
    for (const line of style.summary.split('\n')) if (line.trim()) out.push(`- ${line.trim()}`)
  }
  if (style.palette.length > 0) {
    out.push(`- Palette: ${style.palette.map((p) => `${p.label} ${p.hex}`).join(', ')}`)
  }
  if (style.webRefs.length > 0) {
    out.push('- Reference links on file:')
    for (const r of style.webRefs) out.push(`  · ${r.caption ? `${r.caption} — ` : ''}${r.url}`)
  }
  if (style.imageCount > 0) {
    out.push(
      `- ${style.imageCount} reference photo${style.imageCount === 1 ? '' : 's'} for the project vibe ${style.imageCount === 1 ? 'is' : 'are'} attached to the first message. Read ${style.imageCount === 1 ? 'it' : 'them'} for palette, materials, and mood.`
    )
  }
  if (style.prefersUnique === true) {
    out.push(
      '- The owner leans toward handmade and one-of-a-kind pieces. Favor Etsy, independent makers, small studios, and vintage/antique sources first. Treat big-box (Wayfair, Target, IKEA) as a fallback, not the default.'
    )
  }
  if (style.dealSensitive === true) {
    out.push(
      '- The owner is deal-sensitive. For every option you present, check for a current sale or promo code and include the sale price and the code when there is one.'
    )
  }
  out.push(
    "- This vibe is already known. Don't ask the user to re-explain it — build on it. They can still add room-specific notes on top."
  )
  return out
}

export function buildSystemPrompt(
  roomName: string,
  dims: string | null,
  items: { id: string; name: string; status: string }[],
  budget?: string | null,
  style?: SourcingStyleContext | null
): string {
  const itemLines =
    items.length > 0
      ? items.map((i) => `- ${i.id} — ${i.name} (${i.status})`).join('\n')
      : '- none yet'
  return [
    'You help someone furnish one room in a home-design project. You can hold a normal back-and-forth: talk through a vague idea, ask a question, suggest directions — and, when there is something specific to look for, search real retailers and log verified listings to their room.',
    '',
    `Room: "${roomName}"${dims ? ` (${dims})` : ''}`,
    "Items already on this room's list (id — name (status)):",
    itemLines,
    // Project budget (spec 9.2) — injected so suggestions can be weighed against
    // what's actually left. Planned = needed + sourced, committed = ordered.
    ...(budget
      ? [
          '',
          `Project budget (USD): ${budget}.`,
          'Keep suggestions realistic against what is left. If an option would push the project over, say so plainly rather than staying quiet.',
        ]
      : []),
    // Project style profile (spec 9.2) — mood, palette, preferences inherited
    // from the confirmed style profile so the vibe never needs re-explaining.
    ...(style ? styleLines(style) : []),
    '',
    'Conversation:',
    '- If the request is a vibe or underspecified, do NOT search yet. Ask one focused clarifying question, or offer 2 or 3 concrete directions, and wait for a reply.',
    '- Search only once you have a specific product type plus a style, material, size, or a named retailer.',
    '- Keep replies short — a few sentences. No em dashes, no rule-of-three flourishes, no "I\'d be happy to", no restating the request back to the user.',
    '- Do not judge the user\'s taste. Suggesting directions is fine; editorializing is not.',
    '',
    'When you do search:',
    '- Make the first query specific: product type + key attribute (wood, material, finish) + size + any price ceiling, e.g. "walnut king bed frame under $1000" — not "walnut bed". A precise query returns product pages directly; a vague one returns category pages you then have to drill into, which burns your search budget.',
    '- Use web_search to find in-stock listings with a real USD price. Retailers whose search results tend to be direct product pages: Etsy, IKEA, West Elm, Article, CB2, Crate & Barrel, Pottery Barn, Target, and the maker\'s own store. Wayfair, Home Depot, and Lowe\'s more often return category pages — reach for those second, and expect to web_fetch.',
    '- Never repeat a query you have already run. Each search must differ — a new retailer, different phrasing, or a loosened constraint. Two identical searches waste the budget.',
    '- The moment a search surfaces even one direct product-page URL, web_fetch THAT page to confirm price and stock. Do not keep searching when you already have a page worth opening. Product-page URLs contain /product/, /products/, /dp/, /listing/, /p/, or /pdp/ and usually end in an id. A /b/, /c/, /shop/, /browse/, /category/, or /market/ path is a listing page — never web_fetch one of those, and never web_fetch a search URL (?k= / ?q= / /s? / /sch/); neither resolves to a single product.',
    '- Every URL you log MUST be a direct, single-product page. A search-results page, a category / "shop by" / "browse" / "shop all" page, or a page listing many products is NOT a listing.',
    '- If a search only returns category, "shop by", keyword, or listing pages (common on Wayfair, Home Depot, Walmart), pick the ONE most promising listing page and web_fetch it to pull an individual product\'s /p/ or /pdp/ link and its price.',
    '- Read each candidate product page. If it shows discontinued, no longer available, out of stock, sold out, or currently unavailable, do not log it — find another.',
    '- A few strong options, not an exhaustive list: one primary plus at most 3 alternatives.',
    '- You have a small, fixed number of searches per reply. If you use them up before finding solid options, stop and present the best 1 or 2 you have. If nothing is usable, say so plainly and ask one focused question to narrow it — a material, a size range, or a store. Never mention search limits, quotas, or "this turn", and never ask the user to tell you to keep going. Just work with what you found.',
    '- If the exact spec has no in-stock match (e.g. solid walnut king under $1000 is genuinely scarce), present the closest real listings instead of nothing — a veneer or wood-finish version, or one a little over budget — and say plainly how each differs from the ask. A real near-match beats an empty result.',
    '- Give width, depth, height in inches for the primary ONLY if the page states them. Use 0 otherwise. Never estimate dimensions. Never invent a price or a link.',
    '',
    'Presenting and logging:',
    '- After you search, reply with 2 to 4 options — name, retailer, price, and link for each — and ask which one to log. Do NOT log anything yet.',
    '- Call submit_sourcing only after the user picks an option, OR when the user explicitly asked you to just find and log the best match without reviewing. Never log an item the user has not chosen.',
    '- When you do call submit_sourcing: it must be a verified listing (real price, real single-product URL, in stock). Set match.kind = "existing" + match.item_id if it clearly matches an item on the room list above; otherwise match.kind = "new" with a short match.item_name.',
    '- If the room already has an item matching what the user picked, use match.kind = "existing" so it updates that item instead of adding a duplicate.',
    '- If you searched and found nothing solid, say so and ask how to adjust. Do not log an unverified listing.',
  ].join('\n')
}

const FALLBACK_MESSAGE =
  'Tell me a bit more about what you have in mind and I can look for options.'

/** Map the text history into message params, prepending the project's style
 *  reference photos to the first user turn (spec 9.2). A cache breakpoint on
 *  that first turn keeps the images from re-encoding every turn of one
 *  conversation. Pure — unit-tested in sourcing-check. */
export function buildSourcingMessages(
  messages: ConversationMessage[],
  styleImages?: SourcingImage[]
): Anthropic.MessageParam[] {
  const imgs = styleImages ?? []
  return messages.map((m, i) => {
    if (i === 0 && m.role === 'user' && imgs.length > 0) {
      return {
        role: 'user',
        content: [
          ...imgs.map((img) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: img.media_type, data: img.data },
          })),
          { type: 'text' as const, text: m.content, cache_control: { type: 'ephemeral' as const } },
        ],
      }
    }
    return { role: m.role, content: m.content }
  })
}

/**
 * Produce the next assistant turn for a sourcing conversation. Aborts after
 * ENGINE_TIMEOUT_MS and reports 'timeout' rather than hanging.
 */
export async function runSourcingTurn(opts: {
  client: Anthropic
  model: string
  roomName: string
  dims: string | null
  items: { id: string; name: string; status: string }[]
  /** Project budget context for the system prompt (spec 9.2). */
  budget?: string | null
  /** Project style profile inherited by this room chat (spec 9.2). */
  style?: SourcingStyleContext | null
  /** Uploaded style-reference photos, prepended to the first user turn. */
  styleImages?: SourcingImage[]
  messages: ConversationMessage[]
}): Promise<TurnOutcome> {
  const { client, model, roomName, dims, items, budget, style, styleImages } = opts
  const tools = [
    WEB_SEARCH_TOOL,
    WEB_FETCH_TOOL,
    SUBMIT_TOOL,
  ] as unknown as Anthropic.Messages.ToolUnion[]
  const debug = Boolean(process.env.SOURCING_DEBUG)

  // Stable prefix (system + tools) first with a cache breakpoint; the volatile
  // conversation comes after.
  const system = [
    {
      type: 'text' as const,
      text: buildSystemPrompt(roomName, dims, items, budget, style),
      cache_control: { type: 'ephemeral' as const },
    },
  ]
  const messages: Anthropic.MessageParam[] = buildSourcingMessages(opts.messages, styleImages)
  // A sourcing reply is a short list of options or one clarifying question, but
  // give the model headroom for tool-call planning between searches; 4096 is
  // well under the old 8192 without risking a truncated multi-option reply.
  const common = { model, max_tokens: 4096, system, output_config: { effort: 'medium' } } as const

  const controller = new AbortController()
  let aborted = false
  const timer = setTimeout(() => {
    aborted = true
    controller.abort()
  }, ENGINE_TIMEOUT_MS)
  const reqOpts = { signal: controller.signal }

  const logTools = (content: unknown) => {
    if (!debug) return
    for (const block of content as Record<string, unknown>[]) {
      if (
        block.type === 'server_tool_use' &&
        (block.name === 'web_search' || block.name === 'web_fetch')
      ) {
        const inp = block.input as { query?: string; url?: string }
        console.error(`[sourcing:${block.name}] ${JSON.stringify(inp?.query ?? inp?.url ?? inp)}`)
      }
      if (block.type === 'web_search_tool_result') {
        const c = block.content
        if (Array.isArray(c)) {
          for (const r of c as { url?: string; title?: string }[]) {
            console.error(`[sourcing:result]   ${r.url ?? '(no url)'}  — ${r.title ?? ''}`)
          }
        } else {
          console.error(`[sourcing:result]   ERROR ${JSON.stringify(c)}`)
        }
      }
    }
  }
  const findSubmit = (content: Anthropic.ContentBlock[]) =>
    content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submit_sourcing'
    )

  // Only the prose AFTER the last tool interaction is the reply; anything before
  // it ("Let me open that to check the price…") is mid-turn intent narration.
  const trailingText = (content: Anthropic.ContentBlock[]): string => {
    let lastTool = -1
    content.forEach((b, idx) => {
      const t = (b as { type?: string }).type ?? ''
      if (t === 'tool_use' || t === 'server_tool_use' || t.endsWith('_tool_result')) lastTool = idx
    })
    const tail = lastTool >= 0 ? content.slice(lastTool + 1) : content
    const blocks = tail.filter((b): b is Anthropic.TextBlock => b.type === 'text')
    const src = blocks.length
      ? blocks
      : content.filter((b): b is Anthropic.TextBlock => b.type === 'text')
    return src.map((b) => b.text).join('\n')
  }

  // Drop any line that reads like search-limit narration; keep the substance.
  const stripLimitNarration = (text: string): string =>
    text
      .split('\n')
      .filter((line) => !line.trim() || !looksLikeSearchLimitNarration(line))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

  try {
    for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
      const response = await client.messages
        .stream({ ...common, messages, tools }, reqOpts)
        .finalMessage()

      logTools(response.content)

      if (response.stop_reason === 'pause_turn') {
        messages.push({
          role: 'assistant',
          content: response.content as unknown as Anthropic.ContentBlockParam[],
        })
        if (i === MAX_CONTINUATIONS) return { kind: 'timeout' } // still mid-search
        continue
      }

      const toolUse = findSubmit(response.content)
      if (toolUse) return { kind: 'submit', submitted: toolUse.input as SubmittedResult }

      // Plain reply — conversational turn (with or without a search this turn).
      const raw = trailingText(response.content)
      const text = stripLimitNarration(raw)
      const hasSubstance = text.length >= 60 || /\$\s?\d|https?:\/\//.test(text)

      // Ran out of searches / hit a tool cap with nothing real to show: hand
      // back a clean status. But if the model DID land priced options, keep
      // those — just with the "I hit my limit" line stripped out.
      if (!hasSubstance && (looksLikeSearchLimitNarration(raw) || hitToolUsageCap(response.content))) {
        return { kind: 'exhausted' }
      }

      return { kind: 'message', text: text || FALLBACK_MESSAGE }
    }
    return { kind: 'timeout' }
  } catch (err) {
    if (aborted) return { kind: 'timeout' }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
