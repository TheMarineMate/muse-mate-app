import type Anthropic from '@anthropic-ai/sdk'
import type { ConversationMessage } from './sourcing'

// The AI orchestration for the sourcing feature: the system prompt, the tool
// set, and the loop that turns a conversation into one assistant turn — which
// is either a plain message or a structured submit_sourcing call. The route
// owns auth, role checks, and the DB write (and the hard validateListing rail);
// this owns "given the conversation, produce the next turn".

const MAX_CONTINUATIONS = 2

// Hard ceiling on one turn's model + tool work. Above observed search-turn
// latency (~30-60s) with headroom, well under the route's 120s maxDuration —
// a stuck turn returns a clean message, never a 504 or an indefinite spinner.
// Overridable via env for tuning without a deploy.
const ENGINE_TIMEOUT_MS = Number(process.env.SOURCING_TIMEOUT_MS) || 90_000

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
export const WEB_FETCH_TOOL = { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 }

export function buildSystemPrompt(
  roomName: string,
  dims: string | null,
  items: { id: string; name: string; status: string }[],
  budget?: string | null
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
    '',
    'Conversation:',
    '- If the request is a vibe or underspecified, do NOT search yet. Ask one focused clarifying question, or offer 2 or 3 concrete directions, and wait for a reply.',
    '- Search only once you have a specific product type plus a style, material, size, or a named retailer.',
    '- Keep replies short — a few sentences. No em dashes, no rule-of-three flourishes, no "I\'d be happy to", no restating the request back to the user.',
    '- Do not judge the user\'s taste. Suggesting directions is fine; editorializing is not.',
    '',
    'When you do search:',
    '- Use web_search to find in-stock listings with a real USD price. Good places: Etsy (for handmade, rustic, one-of-a-kind, or decor), plus Wayfair, West Elm, CB2, Crate & Barrel, Article, Pottery Barn, IKEA, Target, Home Depot, Lowe\'s, and the maker\'s own store.',
    '- Every URL you log MUST be a direct, single-product page. A search-results page, a category / "shop by" / "browse" / "shop all" page, or a page listing many products is NOT a listing.',
    '- If your searches only return a retailer\'s category, "shop by", keyword, or listing pages (common on Wayfair), use web_fetch to open one of those pages and pull an actual individual product\'s link and price out of it.',
    '- Read each candidate product page. If it shows discontinued, no longer available, out of stock, sold out, or currently unavailable, do not log it — find another.',
    '- A few strong options, not an exhaustive list: one primary plus at most 3 alternatives.',
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
  messages: ConversationMessage[]
}): Promise<TurnOutcome> {
  const { client, model, roomName, dims, items, budget } = opts
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
      text: buildSystemPrompt(roomName, dims, items, budget),
      cache_control: { type: 'ephemeral' as const },
    },
  ]
  const messages: Anthropic.MessageParam[] = opts.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }))
  const common = { model, max_tokens: 8192, system, output_config: { effort: 'medium' } } as const

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
  const assistantText = (content: Anthropic.ContentBlock[]) =>
    content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
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
      return { kind: 'message', text: assistantText(response.content) || FALLBACK_MESSAGE }
    }
    return { kind: 'timeout' }
  } catch (err) {
    if (aborted) return { kind: 'timeout' }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
