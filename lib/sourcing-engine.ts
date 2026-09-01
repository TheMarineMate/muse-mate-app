import type Anthropic from '@anthropic-ai/sdk'

// The AI orchestration for the sourcing feature — the system prompt, the tool
// set, and the pause_turn-aware loop. Kept separate from the route so it can be
// exercised directly (scripts/sourcing-live.mjs). The route owns auth, role
// checks, and the DB write; this owns "ask the model, get a structured result".

const MAX_CONTINUATIONS = 1

// Hard ceiling on the whole model+search operation. Above observed happy-path
// latency (~30-60s) with real headroom, and well under the route's 120s
// maxDuration — so a stuck search returns a clean message, never a 504 or an
// indefinite spinner. Overridable via env for tuning without a deploy.
const ENGINE_TIMEOUT_MS = Number(process.env.SOURCING_TIMEOUT_MS) || 90_000

export type Match = { kind?: string; item_id?: string; item_name?: string }
export type SubmittedResult = {
  outcome?: string
  match?: Match
  listing?: unknown
  alternatives?: unknown
}

export const SUBMIT_TOOL = {
  name: 'submit_sourcing',
  description:
    'Report the sourcing result. Call this exactly once, after you have finished researching with web_search.',
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

export function buildSystemPrompt(
  roomName: string,
  dims: string | null,
  items: { id: string; name: string; status: string }[]
): string {
  const itemLines =
    items.length > 0
      ? items.map((i) => `- ${i.id} — ${i.name} (${i.status})`).join('\n')
      : '- none yet'
  return [
    'You are a purchasing assistant for one room in a home-design project. Your only job is to find real, currently-purchasable listings for furniture and decor the user describes, then report them as structured data.',
    '',
    `Room: "${roomName}"${dims ? ` (${dims})` : ''}`,
    "Items already on this room's list (id — name (status)):",
    itemLines,
    '',
    'Rules:',
    '- Use web_search to find 2 to 4 listings that are for sale right now, each with a real USD price.',
    "- Good places to look: Etsy (especially for handmade, rustic, one-of-a-kind, or decorative pieces — check Etsy for any decor or handmade-style request), plus Wayfair, West Elm, CB2, Crate & Barrel, Article, Pottery Barn, IKEA, Target, Home Depot, Lowe's, and the maker's own store.",
    '- Every URL you cite MUST be a direct, single-product page. A search-results page, a category or "browse" or "shop all" page, or a page listing many products is NOT a listing — never cite one, not even as an alternative.',
    '- Open each candidate product page and read its content before citing it. If the page says discontinued, no longer available, out of stock, sold out, currently unavailable, or similar, exclude that listing entirely — do not cite it as the primary listing or as an alternative. Find an in-stock listing instead.',
    '- Choose the single best in-stock match as the primary listing; the rest are alternatives (at most 3).',
    '- Report outcome "sourced" ONLY if the primary listing is a real, in-stock, single-product page with a real price. If you cannot find one, report outcome "no_match" — that is a valid answer, not a failure. Do not invent prices or links.',
    '- Give width, depth, and height in inches for the primary listing ONLY if the listing states them. Use 0 for any dimension the listing does not give. Never estimate dimensions.',
    '- If the request clearly matches one of the existing items above, set match.kind = "existing" and match.item_id to that id. Otherwise set match.kind = "new", match.item_id = "", and match.item_name to a short name.',
    "- Do not comment on the user's taste, style, or design choices. Do not editorialize. Only find and report listings.",
    '- You have a budget of about 4 searches. Use them — try a couple of different retailers and phrasings before concluding nothing is available, especially for common furniture. But do not exceed ~4 searches: after that, STOP and call submit_sourcing exactly once. If you still have no solid in-stock single-product listing, call submit_sourcing with outcome "no_match". Never end your turn without calling submit_sourcing.',
  ].join('\n')
}

export type EngineOutcome =
  | { kind: 'result'; submitted: SubmittedResult }
  | { kind: 'no_result' }
  | { kind: 'timeout' }

/**
 * Runs the model with web_search + submit_sourcing, resuming on pause_turn.
 * Aborts the whole operation after ENGINE_TIMEOUT_MS and reports 'timeout'
 * rather than letting the request hang.
 */
export async function runSourcing(opts: {
  client: Anthropic
  model: string
  roomName: string
  dims: string | null
  items: { id: string; name: string; status: string }[]
  query: string
}): Promise<EngineOutcome> {
  const { client, model, roomName, dims, items, query } = opts
  const tools = [WEB_SEARCH_TOOL, SUBMIT_TOOL] as unknown as Anthropic.Messages.ToolUnion[]
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: query }]
  const system = buildSystemPrompt(roomName, dims, items)
  const debug = Boolean(process.env.SOURCING_DEBUG)

  // effort:"medium" balances thoroughness against latency on this
  // latency-sensitive route; streaming holds the HTTP connection open.
  const common = { model, max_tokens: 8192, system, output_config: { effort: 'medium' } } as const

  const controller = new AbortController()
  let aborted = false
  const timer = setTimeout(() => {
    aborted = true
    controller.abort()
  }, ENGINE_TIMEOUT_MS)
  const reqOpts = { signal: controller.signal }

  const logSearches = (content: unknown) => {
    if (!debug) return
    for (const block of content as Record<string, unknown>[]) {
      if (block.type === 'server_tool_use' && block.name === 'web_search') {
        console.error(
          `[sourcing:search] ${JSON.stringify((block.input as { query?: string })?.query)}`
        )
      }
    }
  }
  const findSubmit = (content: Anthropic.ContentBlock[]) =>
    content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submit_sourcing'
    )

  try {
    let stillSearching = false

    for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
      const response = await client.messages
        .stream({ ...common, messages, tools }, reqOpts)
        .finalMessage()

      logSearches(response.content)
      messages.push({
        role: 'assistant',
        content: response.content as unknown as Anthropic.ContentBlockParam[],
      })

      if (response.stop_reason === 'pause_turn') {
        // Resume the server-tool loop by resending (the API detects the trailing
        // server_tool_use — no extra user message).
        stillSearching = i === MAX_CONTINUATIONS
        continue
      }

      const toolUse = findSubmit(response.content)
      if (toolUse) return { kind: 'result', submitted: toolUse.input as SubmittedResult }
      stillSearching = false
      break
    }

    // Ran out of continuations mid-search. Appending a user message here would be
    // rejected (turn ends in an unresolved search), so give up -> no_result.
    if (stillSearching) return { kind: 'no_result' }

    // Turn ended cleanly but the model never reported. Force one structured
    // answer from what it already found — no web_search on this call.
    const forced = await client.messages
      .stream(
        {
          ...common,
          max_tokens: 4096,
          messages: [
            ...messages,
            {
              role: 'user',
              content:
                'Stop searching. Report what you have now with submit_sourcing. Use outcome "no_match" if you do not have a solid in-stock single-product listing.',
            },
          ],
          tools: [SUBMIT_TOOL] as unknown as Anthropic.Messages.ToolUnion[],
          tool_choice: { type: 'tool', name: 'submit_sourcing' },
        },
        reqOpts
      )
      .finalMessage()
    const forcedUse = findSubmit(forced.content)
    return forcedUse
      ? { kind: 'result', submitted: forcedUse.input as SubmittedResult }
      : { kind: 'no_result' }
  } catch (err) {
    if (aborted) return { kind: 'timeout' }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
