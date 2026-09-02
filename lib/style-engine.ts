import type Anthropic from '@anthropic-ai/sdk'
import type { PaletteEntry } from './types'
import type { UploadImageMime } from './style'

/** One conversation turn as the engine consumes it: the route has already
 *  resolved any Storage attachments to inline base64 image data (Phase 6c). */
export type StyleTurnImage = { media_type: UploadImageMime; data: string }
export type StyleTurnMessage =
  | { role: 'assistant'; content: string }
  | { role: 'user'; content: string; images?: StyleTurnImage[] }

// AI orchestration for the project style-intake conversation (spec Section 9.1):
// the system prompt, the tool set, and the loop that turns a conversation into
// one assistant turn — a plain message or a structured confirm_style_profile
// call. Sibling of lib/sourcing-engine.ts; the route owns auth, role checks,
// the rails in lib/style.ts, and the DB write.

// One continuation only — a second full round-trip plus tool time pushes heavy
// turns toward the function ceiling (mirrors the sourcing-engine fix).
const MAX_CONTINUATIONS = 1

// Hard ceiling on one turn's model + tool work. Kept well below the route's
// 120s maxDuration so the preamble + response still fit. Overridable via env.
const ENGINE_TIMEOUT_MS = Number(process.env.STYLE_TIMEOUT_MS) || 75_000

export type StyleTurnOutcome =
  | { kind: 'message'; text: string }
  | { kind: 'confirm'; input: unknown }
  | { kind: 'timeout' }

export const CONFIRM_TOOL = {
  name: 'confirm_style_profile',
  description:
    'Save the project\'s style profile. Call this when the user has approved a summary you laid out, OR when they give a direct instruction to save or confirm ("save it", "lock it in", "that works, save") — honor that instruction on the same turn even if the profile is still partial (empty arrays are fine for anything unsettled, e.g. palette or materials). Do not call it on your own initiative when the user has not asked to save. It replaces the summary/palette/preferences and adds any new web references; calling it again later with an expanded summary is how the profile grows — additive, never a reset.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['mood', 'materials', 'avoid', 'palette', 'prefers_unique', 'deal_sensitive', 'references'],
    properties: {
      mood: {
        type: 'string',
        description:
          'One to three sentences of mood/descriptors and what the space is for. Plain, specific, no em dashes.',
      },
      materials: {
        type: 'array',
        description: 'Short phrases — materials and textures to lean into (e.g. "white oak", "bouclé", "aged brass").',
        items: { type: 'string' },
      },
      avoid: {
        type: 'array',
        description: 'Short phrases — the explicit skip-list (e.g. "chrome", "glossy black", "heavy farmhouse").',
        items: { type: 'string' },
      },
      palette: {
        type: 'array',
        description: 'Direction swatches, not per-item colors. 3-6 entries is typical. Omit (empty array) if the palette is not settled yet.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['hex', 'label'],
          properties: {
            hex: { type: 'string', description: 'Hex like #A9835C.' },
            label: { type: 'string', description: 'Short name, e.g. "Warm putty".' },
          },
        },
      },
      prefers_unique: {
        type: 'boolean',
        description:
          'true if the user leans toward handmade / one-of-a-kind / specialty pieces over mass-market. Carry the existing value if it did not come up.',
      },
      deal_sensitive: {
        type: 'boolean',
        description:
          'true if the user wants active checking for current sales / promo codes. Carry the existing value if it did not come up.',
      },
      references: {
        type: 'array',
        description:
          'Real visual references you actually retrieved this conversation — never invented. Up to 6. Existing ones do not need re-listing.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'url', 'caption'],
          properties: {
            kind: { type: 'string', enum: ['web_image', 'web_link'] },
            url: { type: 'string', description: 'Direct URL to the image or the page.' },
            caption: { type: 'string', description: 'A few words on why it is relevant. Empty string if none.' },
          },
        },
      },
    },
  },
}

export const WEB_SEARCH_TOOL = { type: 'web_search_20260209', name: 'web_search', max_uses: 3 }
export const WEB_FETCH_TOOL = { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 2 }

export type StyleContext = {
  projectName: string
  address: string | null
  vibeNotes: string | null
  currentSummary: string | null
  currentPalette: PaletteEntry[]
  prefersUnique: boolean | null
  dealSensitive: boolean | null
}

export function buildStyleSystemPrompt(ctx: StyleContext): string {
  const pref = (v: boolean | null) => (v === null ? 'not set yet' : v ? 'yes' : 'no')
  const palette =
    ctx.currentPalette.length > 0
      ? ctx.currentPalette.map((p) => `${p.label} (${p.hex})`).join(', ')
      : 'none set yet'

  return [
    'You are helping the owner of a home-design project develop the vibe for the whole space — the shared direction that every room will be furnished against. This is a real conversation, not a form. Draw the vibe out: the mood, what the space is actually for, what is already there and loved, what to steer clear of.',
    '',
    `Project: "${ctx.projectName}"${ctx.address ? ` — ${ctx.address}` : ''}`,
    ctx.vibeNotes ? `Quick notes already on file: ${ctx.vibeNotes}` : null,
    '',
    'Style profile so far (this may be a revisit — build on it, do not restart):',
    `- Summary: ${ctx.currentSummary ? ctx.currentSummary.replace(/\n/g, ' / ') : 'not started'}`,
    `- Palette: ${palette}`,
    `- Leans toward unique / handmade pieces: ${pref(ctx.prefersUnique)}`,
    `- Wants active sale / promo-code checking: ${pref(ctx.dealSensitive)}`,
    '',
    'How to run the conversation:',
    '- Ask about mood and function first. One or two focused questions per turn, not a questionnaire dump.',
    '- Capture shopping preferences as they come up, the same as aesthetic ones: whether they lean toward one-of-a-kind / handmade / specialty pieces over big-box, and how deal-sensitive they are (always hunt for a current sale vs. fit matters more than price). These are standing preferences for the whole project.',
    '- When it would genuinely help, use web_search (and web_fetch to open a page) to pull real visual references — actual images or articles that exist. Never describe or link a reference you did not retrieve. A category page, a lookbook, or a blog post is fine here; it just has to be real.',
    '- Searches per reply are limited. If they run out, just carry on the conversation with what you have. Never mention search limits or quotas, and never ask the user to tell you to keep going.',
    '- The user may attach photos. Look at them as visual references for the vibe — the space as it is now, a piece they love, a mood shot. Read them for mood, palette, materials, light. They are never products to price or source.',
    '- Keep replies conversational and short. No em dashes, no rule-of-three lists, no "I would be happy to", no restating what they just said back to them.',
    '- Stay on the vibe. Do not price-shop specific products, do not claim to add anything to a room list or a budget, do not comment on their taste unprompted. Finding a specific product to buy is the room conversation\'s job, not this one.',
    '',
    'Converging and saving:',
    '- When enough is on the table, lay out a plain-language summary: mood/descriptors, materials and textures, an explicit avoid-list, the palette, the two shopping preferences, and any references worth keeping.',
    '- A direct instruction to save or confirm ("save it", "yes, save that", "lock it in", "that works, save") IS approval. Call confirm_style_profile on that same turn. Do this even when the profile is still light — pass empty arrays for whatever is not settled (palette, materials, avoid-list, references). Your reply can say you can flesh it out more later, but do not withhold the save or answer with another question first.',
    '- Otherwise, once you have laid out a summary, ask them to confirm or adjust, and call confirm_style_profile when they approve.',
    '- Always pass both shopping preferences (prefers_unique, deal_sensitive) as booleans — use what the user told you, or carry the existing value forward if it never came up.',
    '- If they want changes, revise and re-confirm. Do not call the tool on your own read of the room when the user has not asked to save.',
    "- If a search comes back thin, say so plainly and keep talking. Don't pad with invented references.",
  ]
    .filter((l) => l !== null)
    .join('\n')
}

const FALLBACK_MESSAGE = "Tell me about the space — what should it feel like to walk into?"

/** Map the conversation into Anthropic message params. A user turn carrying
 *  images becomes a multi-block content array (images first, then the text);
 *  everything else stays a plain string. Pure — unit-tested in style-check. */
export function buildTurnMessages(messages: StyleTurnMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) => {
    if (m.role === 'user' && m.images && m.images.length > 0) {
      return {
        role: 'user',
        content: [
          ...m.images.map((img) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: img.media_type, data: img.data },
          })),
          { type: 'text' as const, text: m.content },
        ],
      }
    }
    return { role: m.role, content: m.content }
  })
}

/**
 * Produce the next assistant turn for a style-intake conversation. Aborts after
 * ENGINE_TIMEOUT_MS and reports 'timeout' rather than hanging.
 */
export async function runStyleTurn(opts: {
  client: Anthropic
  model: string
  ctx: StyleContext
  messages: StyleTurnMessage[]
}): Promise<StyleTurnOutcome> {
  const { client, model, ctx } = opts
  const tools = [
    WEB_SEARCH_TOOL,
    WEB_FETCH_TOOL,
    CONFIRM_TOOL,
  ] as unknown as Anthropic.Messages.ToolUnion[]
  const debug = Boolean(process.env.STYLE_DEBUG)

  const system = [
    {
      type: 'text' as const,
      text: buildStyleSystemPrompt(ctx),
      cache_control: { type: 'ephemeral' as const },
    },
  ]
  const messages: Anthropic.MessageParam[] = buildTurnMessages(opts.messages)
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
      if (block.type === 'server_tool_use' && (block.name === 'web_search' || block.name === 'web_fetch')) {
        const inp = block.input as { query?: string; url?: string }
        console.error(`[style:${block.name}] ${JSON.stringify(inp?.query ?? inp?.url ?? inp)}`)
      }
    }
  }
  const findConfirm = (content: Anthropic.ContentBlock[]) =>
    content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'confirm_style_profile'
    )
  const assistantText = (content: Anthropic.ContentBlock[]) =>
    content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()

  try {
    for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
      const response = await client.messages.stream({ ...common, messages, tools }, reqOpts).finalMessage()

      logTools(response.content)

      if (response.stop_reason === 'pause_turn') {
        messages.push({
          role: 'assistant',
          content: response.content as unknown as Anthropic.ContentBlockParam[],
        })
        if (i === MAX_CONTINUATIONS) return { kind: 'timeout' }
        continue
      }

      const toolUse = findConfirm(response.content)
      if (toolUse) return { kind: 'confirm', input: toolUse.input }

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
