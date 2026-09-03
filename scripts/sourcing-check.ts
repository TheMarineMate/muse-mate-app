// Rail-enforcement unit check for lib/sourcing.ts (spec Section 5).
// Run: npm run sourcing:check   (uses Node's built-in type stripping)

import {
  buildSourcedItemFields,
  composeSourcingNote,
  looksLikeSearchOrCategoryPage,
  validateAlternatives,
  validateListing,
  validateOptions,
} from '../lib/sourcing.ts'
import { computeBudgetRollup, describeBudgetForPrompt } from '../lib/budget.ts'
import {
  buildSourcingMessages,
  buildSystemPrompt,
  finishConflict,
  looksLikeSearchLimitNarration,
  normUrl,
  priceInPage,
  softenPresentedClaims,
  type SourcingStyleContext,
} from '../lib/sourcing-engine.ts'

let pass = 0
let fail = 0
function check(label: string, cond: boolean) {
  if (cond) {
    pass++
    console.log(`ok    ${label}`)
  } else {
    fail++
    console.error(`FAIL  ${label}`)
  }
}

const good = {
  title: '  Fishbone wall shelf  ',
  retailer: 'West Elm',
  price_usd: 129.99,
  url: 'https://www.westelm.com/products/fishbone-shelf',
  width_in: 30,
  depth_in: 6,
  height_in: 0,
}

const v = validateListing(good)
check('valid listing accepted', v !== null)
check('title trimmed', v?.title === 'Fishbone wall shelf')
check('price kept', v?.price === 129.99)
check('stated dims kept', v?.width_in === 30 && v?.depth_in === 6)
check('zero dimension -> null (never estimated)', v?.height_in === null)

check('missing url -> null', validateListing({ ...good, url: '' }) === null)
check('non-http url -> null', validateListing({ ...good, url: 'just some text' }) === null)
check('ftp url -> null', validateListing({ ...good, url: 'ftp://x/y' }) === null)
check('price 0 -> null', validateListing({ ...good, price_usd: 0 }) === null)
check('negative price -> null', validateListing({ ...good, price_usd: -5 }) === null)
check('non-numeric price -> null', validateListing({ ...good, price_usd: 'call us' }) === null)
check('empty title -> null', validateListing({ ...good, title: '   ' }) === null)

// live-test finding #2 — search / category pages are not listings
check(
  'amazon /s?k= search page -> null',
  validateListing({ ...good, url: 'https://www.amazon.com/s?k=walnut+console+table' }) === null
)
check(
  '?q= query param -> null',
  validateListing({ ...good, url: 'https://example.com/shop?q=console+table' }) === null
)
check(
  '/search path -> null',
  validateListing({ ...good, url: 'https://www.wayfair.com/furniture/search/console-table' }) === null
)
check(
  'ebay /sch/ search -> null',
  validateListing({ ...good, url: 'https://www.ebay.com/sch/i.html?_nkw=console' }) === null
)
check(
  'category browse page -> null',
  validateListing({ ...good, url: 'https://www.westelm.com/shop/furniture/browse/' }) === null
)
check(
  'wayfair /sb1/ category page -> null',
  validateListing({
    ...good,
    url: 'https://www.wayfair.com/furniture/sb1/king-size-beds-c46122-a115~128.html',
  }) === null
)
check(
  'wayfair /sb2/ curated list -> null',
  validateListing({
    ...good,
    url: 'https://www.wayfair.com/furniture/sb2/king-size-solid-wood-beds-c46122-a115~128-a153942~511441.html',
  }) === null
)
check(
  'wayfair /keyword.php -> null',
  validateListing({
    ...good,
    url: 'https://www.wayfair.com/keyword.php?keyword=wooden+king+size+bed+frames',
  }) === null
)
check(
  'bare -c<id>.html category suffix -> null',
  validateListing({ ...good, url: 'https://www.example.com/beds-c12345.html' }) === null
)
check(
  'wayfair /pdp/ product page still passes (no false positive)',
  validateListing({
    ...good,
    url: 'https://www.wayfair.com/furniture/pdp/mercury-row-eefad-solid-wood-king-bed-w001234567.html',
  }) !== null
)
check(
  'real product URL with tracking param still accepted (no false positive)',
  validateListing({
    ...good,
    url: 'https://www.westelm.com/products/mid-century-console-h1234/?pkey=cconsoles&ref=nav',
  }) !== null
)
check('looksLikeSearchOrCategoryPage: direct product path is fine', !looksLikeSearchOrCategoryPage('https://www.etsy.com/listing/123456789/fishbone-wood-shelf'))
check('looksLikeSearchOrCategoryPage: amazon dp path is fine', !looksLikeSearchOrCategoryPage('https://www.amazon.com/dp/B0ABCDEFG'))
check('numeric string price coerced', validateListing({ ...good, price_usd: '1299.00' })?.price === 1299)
check('null input -> null', validateListing(null) === null)

const alts = validateAlternatives([
  good,
  { ...good, url: 'bad' }, // dropped
  { ...good, title: 'Alt 2', url: 'https://a/2' },
  { ...good, price_usd: 0 }, // dropped
  { ...good, title: 'Alt 4', url: 'https://a/4' },
  { ...good, title: 'Alt 5', url: 'https://a/5' }, // over the cap of 3
])
check('alternatives cap at 3 valid entries', alts.length === 3)
check('alternatives drop invalid entries', alts.every((a) => /^https?:/.test(a.url)))

const note = composeSourcingNote(v!, alts)
check('note names the primary + retailer + price', note.includes('Fishbone wall shelf') && note.includes('West Elm') && note.includes('$130'))
check('note lists alternatives', note.includes('Alternatives:'))
check('note has no newlines / model prose', !note.includes('\n') && note.length <= 800)

// --- Phase 6a: budget context in the room-chat system prompt (spec 9.2) ------

const items = [
  { price_estimate: 400, status: 'needed' },
  { price_estimate: 300, status: 'sourced' },
  { price_estimate: 1200, status: 'ordered' },
  { price_estimate: 250, status: 'received' },
]
const rollup = computeBudgetRollup(items, 5000)
check('rollup: planned = needed + sourced', rollup.planned === 700)
check('rollup: committed = ordered', rollup.committed === 1200)
check('rollup: received', rollup.received === 250)
check('rollup: remaining = target - all', rollup.remaining === 5000 - 2150)

const desc = describeBudgetForPrompt(rollup)
check('describe: names target', !!desc && desc.includes('target $5,000'))
check('describe: names planned/committed/received', !!desc && desc.includes('planned $700') && desc.includes('committed $1,200') && desc.includes('received $250'))
check('describe: shows remaining', !!desc && desc.includes('$2,850 left'))

const over = describeBudgetForPrompt(computeBudgetRollup([{ price_estimate: 9000, status: 'ordered' }], 5000))
check('describe: flags over budget', !!over && over.includes('$4,000 over'))

check('describe: null when no target and no spend', describeBudgetForPrompt(computeBudgetRollup([], null)) === null)
check(
  'describe: still reports spend when no target set',
  describeBudgetForPrompt(computeBudgetRollup([{ price_estimate: 100, status: 'needed' }], null)) ===
    'no target set, planned $100, committed $0, received $0'
)

const promptWith = buildSystemPrompt('Living room', '168in x 144in', [], desc)
check('system prompt: includes the Project budget line when budget given', promptWith.includes('Project budget (USD): target $5,000'))
check('system prompt: tells the model to flag going over', /push the project over/i.test(promptWith))
const promptWithout = buildSystemPrompt('Living room', '168in x 144in', [], null)
check('system prompt: omits the budget section entirely when null', !promptWithout.includes('Project budget'))

// --- Phase 6d: style profile inherited into the room chat (spec 9.2) ---------

const style: SourcingStyleContext = {
  summary: 'Mood: warm, coastal, calm.\nMaterials & textures: white oak, linen, aged brass.\nAvoid: chrome, glossy black.',
  palette: [
    { hex: '#E8C9A0', label: 'Warm sand' },
    { hex: '#5C8A82', label: 'Dusty teal' },
  ],
  prefersUnique: true,
  dealSensitive: true,
  webRefs: [{ url: 'https://example.com/lookbook', caption: 'coastal calm' }],
  imageCount: 2,
}
const sp = buildSystemPrompt('Living room', '168in x 144in', [], desc, style)
check('style: prompt has a Project style profile section', sp.includes('Project style profile'))
check('style: carries the mood/materials/avoid text', sp.includes('Mood: warm, coastal, calm.') && sp.includes('Avoid: chrome, glossy black.'))
check('style: lists the palette with hexes', sp.includes('Warm sand #E8C9A0') && sp.includes('Dusty teal #5C8A82'))
check('style: lists web reference links', sp.includes('coastal calm — https://example.com/lookbook'))
check('style: notes attached reference photos', /2 reference photos for the project vibe are attached to the first message/i.test(sp))
check('style: prefers_unique -> favor makers, big-box as fallback', /Favor Etsy, independent makers[\s\S]*fallback, not the default/i.test(sp))
check('style: deal_sensitive -> check for a current sale or promo code', /check for a current sale or promo code/i.test(sp))
check('style: tells the model not to re-ask the vibe', /Don't ask the user to re-explain it/i.test(sp))

const spNoPrefs = buildSystemPrompt('Living room', null, [], null, {
  summary: 'Mood: minimal.',
  palette: [],
  prefersUnique: false,
  dealSensitive: false,
  webRefs: [],
  imageCount: 0,
})
check('style: prefers_unique false -> no "Favor Etsy" line', !/Favor Etsy/i.test(spNoPrefs))
check('style: deal_sensitive false -> no sale-check line', !/check for a current sale/i.test(spNoPrefs))
check('style: no photos -> no "attached to the first message" note', !/attached to the first message/i.test(spNoPrefs))
check('style: omitted entirely when no style arg', !buildSystemPrompt('Living room', null, [], null).includes('Project style profile'))

// buildSourcingMessages — style photos ride the first user turn
const mapped = buildSourcingMessages(
  [
    { role: 'user', content: 'something for the reading corner' },
    { role: 'assistant', content: 'what kind of chair?' },
    { role: 'user', content: 'an accent chair' },
  ],
  [{ media_type: 'image/jpeg', data: 'QUJD' }]
)
const first = mapped[0].content as { type: string; source?: { type: string; media_type: string }; text?: string; cache_control?: unknown }[]
check('messages: first user turn becomes a content array', Array.isArray(mapped[0].content))
check('messages: image block first, base64 jpeg', first[0].type === 'image' && first[0].source?.type === 'base64' && first[0].source?.media_type === 'image/jpeg')
check('messages: text block after image, with a cache breakpoint', first[1].type === 'text' && first[1].text === 'something for the reading corner' && !!first[1].cache_control)
check('messages: assistant + later user turns stay plain strings', mapped[1].content === 'what kind of chair?' && mapped[2].content === 'an accent chair')
check('messages: no images -> all plain strings', buildSourcingMessages([{ role: 'user', content: 'hi' }]).every((m) => typeof m.content === 'string'))

// --- search-cap degradation (prod bug: raw limit-narration leaked to user) ---

check(
  'limit-narration: catches "hit my search limit for this turn"',
  looksLikeSearchLimitNarration("I've hit my search limit for this turn.")
)
check(
  'limit-narration: catches "reply with \'go ahead\'"',
  looksLikeSearchLimitNarration("Reply with 'go ahead' and I'll keep looking.")
)
check(
  'limit-narration: catches "say go ahead"',
  looksLikeSearchLimitNarration('Say go ahead to continue searching.')
)
check(
  'limit-narration: catches "used up my searches"',
  looksLikeSearchLimitNarration('I used up my searches before finding a match.')
)
check(
  'limit-narration: catches "let me know if you want me to continue"',
  looksLikeSearchLimitNarration('Let me know if you want me to continue looking.')
)
check(
  'limit-narration: catches "tell me to keep going"',
  looksLikeSearchLimitNarration('Just tell me to keep going.')
)
check(
  'limit-narration: catches "hit search/fetch limits this turn" (broadened)',
  looksLikeSearchLimitNarration("I've hit search/fetch limits this turn.")
)
check(
  'limit-narration: catches "reached my search limit"',
  looksLikeSearchLimitNarration("I've reached my search limit and will present what I have.")
)
check(
  'limit-narration: catches "limits this turn"',
  looksLikeSearchLimitNarration('That is where the limits this turn leave things.')
)
check(
  'limit-narration: does NOT fire on "limited stock" / "weight limit"',
  !looksLikeSearchLimitNarration('The Noble House frame is $466, limited stock, 500 lb weight limit.')
)
check(
  'limit-narration: does NOT fire on a normal options reply',
  !looksLikeSearchLimitNarration(
    'Here are 3 options: 1. Oak console from West Elm, $499. 2. Walnut console from CB2, $599. Which should I log?'
  )
)
check(
  'limit-narration: does NOT fire on a normal clarifying question',
  !looksLikeSearchLimitNarration('Do you want leather or fabric, and roughly what width?')
)
check(
  'limit-narration: does NOT fire on "no strong match, want me to try another store"',
  !looksLikeSearchLimitNarration(
    "I didn't find a solid match at that price. Want me to try a different store?"
  )
)

const capPrompt = buildSystemPrompt('Living room', null, [])
check(
  'system prompt: tells the model to stop and present what it has when searches run out',
  /small, fixed number of searches per reply[\s\S]*Never mention search limits/i.test(capPrompt)
)
check(
  'system prompt: forbids asking the user to say keep going',
  /never ask the user to tell you to keep going/i.test(capPrompt)
)
check(
  'system prompt: query = tidy the user\'s stated need, do not add to it',
  /The query is the user's stated product need, tidied into search form[\s\S]*You are cleaning up chatty phrasing, NOT adding to it/i.test(
    capPrompt
  )
)
check(
  'system prompt: still asks for a specific query shape',
  /Still make it specific enough to return products, not categories[\s\S]*price ceiling/i.test(capPrompt)
)
check(
  'system prompt: style profile is for ranking, not query words',
  /Do not put the project style profile in the query[\s\S]*for ranking and choosing among the results[\s\S]*NOT "organic cotton warm white boutique hotel king sheets"/i.test(
    capPrompt
  )
)
check(
  'system prompt: take words literally, do not tighten the constraint',
  /Take the user's words literally; do not tighten their constraint[\s\S]*"All cotton" \/ "100% cotton" is fibre content, not "organic cotton"[\s\S]*"Under \$400" is not "around \$250"/i.test(
    capPrompt
  )
)
check(
  'system prompt: most retailers render client-side, do not count on the fetch',
  /Most large retailers[\s\S]*render prices client-side[\s\S]*Do not count on the fetch/i.test(capPrompt)
)
check(
  'system prompt: presented prices are "listed", never "confirmed"/"verified"',
  /Only submit_sourcing carries a verified price[\s\S]*the price is a listed figure, not a confirmed one[\s\S]*never "confirmed", "verified"/i.test(
    capPrompt
  )
)
check(
  'system prompt: an empty web_fetch means the page was NOT read',
  /web_fetch returns little or no page text[\s\S]*you have NOT read that page[\s\S]*Do not state a price/i.test(capPrompt)
)
check(
  'system prompt: no repeated queries, especially not back-to-back',
  /Never repeat a query you have already run this turn — especially not the same query twice in a row/i.test(capPrompt)
)
check(
  'system prompt: option title and URL must come from the same search result',
  /Each option's title and its URL must come from the SAME search result[\s\S]*URL slug says "white-stained-oak", the title is not "dark-brown"/i.test(
    capPrompt
  )
)
check(
  'system prompt: present options via the tool, keep the text to 1-2 sentences',
  /call present_sourcing_options with your 1-3 candidates[\s\S]*NOT in your text[\s\S]*one or two short sentences/i.test(
    capPrompt
  )
)
check(
  'system prompt: submit only a page you fetched with the price visible in its text',
  /a real single-product URL you web_fetch'd this turn, with its price visible in that page's text/i.test(
    capPrompt
  )
)

// --- validateOptions: real-URL cap for presented candidates -----------------
const rawOpts = [
  { title: 'Basi King Bed', retailer: 'Article', price_usd: 499, url: 'https://www.article.com/product/25632/basi-king-bed-frame-walnut' },
  { title: 'dup url', retailer: 'Article', price_usd: 499, url: 'https://www.article.com/product/25632/basi-king-bed-frame-walnut' },
  { title: 'search page', retailer: 'Amazon', price_usd: 313, url: 'https://www.amazon.com/s?k=walnut+king+bed' },
  { title: 'no price', retailer: 'Wayfair', price_usd: 0, url: 'https://www.wayfair.com/furniture/pdp/x-w001.html' },
  { title: 'Real 2', retailer: 'Target', price_usd: 799, url: 'https://www.target.com/p/king-bed/-/A-123' },
  { title: 'Real 3', retailer: 'IKEA', price_usd: 399, url: 'https://www.ikea.com/us/en/p/tarva-bed-frame-123/' },
  { title: 'Real 4 over cap', retailer: 'Walmart', price_usd: 289, url: 'https://www.walmart.com/ip/king-bed/456' },
]
const opts = validateOptions(rawOpts)
check('validateOptions: drops dup URL', opts.filter((o) => o.url.includes('25632')).length === 1)
check('validateOptions: drops a search-results URL', !opts.some((o) => o.url.includes('/s?k=')))
check('validateOptions: drops a zero-price entry', !opts.some((o) => o.price === 0))
check('validateOptions: caps at 3 (Section 20 volume cap)', opts.length === 3)
check('validateOptions: non-array -> []', validateOptions('nope').length === 0 && validateOptions(null).length === 0)

// --- priceVerified passthrough (drives the "Log this" confirm step) ----------
check('validateListing: priceVerified defaults false when absent', validateListing(good)?.priceVerified === false)
check('validateListing: priceVerified true when the engine marked it', validateListing({ ...good, priceVerified: true })?.priceVerified === true)
check('validateListing: priceVerified only honours a real boolean true', validateListing({ ...good, priceVerified: 'yes' })?.priceVerified === false)
const vOpts = validateOptions([
  { ...good, url: 'https://x.com/p/a', priceVerified: true },
  { ...good, url: 'https://x.com/p/b', priceVerified: false },
])
check('validateOptions: carries per-option priceVerified through', vOpts[0]?.priceVerified === true && vOpts[1]?.priceVerified === false)

// --- buildSourcedItemFields: the shared write patch + provenance ------------
const human = buildSourcedItemFields(v!, [], 'human_confirmed')
check('buildSourcedItemFields: status sourced + assistant via', human.status === 'sourced' && human.sourced_via === 'assistant')
check('buildSourcedItemFields: records human_confirmed provenance', human.price_confirmation === 'human_confirmed')
check('buildSourcedItemFields: carries price + link + stated dims', human.price_estimate === v!.price && human.link === v!.url && human.width === 30 && human.depth === 6)
check('buildSourcedItemFields: no height key when the listing had none (never 0)', !('height' in human))
check('buildSourcedItemFields: note names the human-confirm path', String(human.note).includes('confirmed by a project editor'))
const fetched = buildSourcedItemFields(v!, [], 'fetch_verified')
check('buildSourcedItemFields: records fetch_verified provenance', fetched.price_confirmation === 'fetch_verified')
check('buildSourcedItemFields: fetch_verified note wording', String(fetched.note).includes('verified on the retailer page'))

// --- price-provenance rail: a logged price must be on a fetched page ---------

const PAGE =
  'AMERLIFE King Size Solid Wood Bed Frame, Mid Century Modern. In stock and ready to ship. Price: $498.99. Free shipping over $35. Dimensions 80 x 84 x 44 inches. Add to Cart. Assembly required.'

check('priceInPage: exact cents match (498.99 on a page showing $498.99)', priceInPage(498.99, PAGE))
check('priceInPage: model rounded 498.99 -> 499 still verifies', priceInPage(499, PAGE))
check(
  'priceInPage: thousands separator tolerated',
  priceInPage(1799, 'Regular price for the walnut king platform bed frame is $1,799.00 today only, in stock now with white-glove delivery included.')
)
check(
  'priceInPage: bare integer with a dollar sign',
  priceInPage(313, 'The AMERLIFE mid-century king bed frame in walnut is now $313 with promo code SAVE20 at checkout; ships free and arrives in a week.')
)
check(
  'priceInPage: price not on the page -> false',
  !priceInPage(499, 'AMERLIFE King Bed frame, solid wood, walnut finish. In stock. Add to cart. Ships in 3 business days. No price is rendered in this fetched markup.')
)
check('priceInPage: empty / JS-shell page -> false', !priceInPage(499, '') && !priceInPage(499, '  \n  '))
check('priceInPage: too-short page -> false (blocked fetch)', !priceInPage(499, 'Loading… 499'))
check(
  'priceInPage: does not match a substring of a bigger number',
  !priceInPage(99, 'SKU 4990012 for this listing, product weight is 199 lb, and there is no price shown anywhere on this page at all right now.')
)
check('priceInPage: zero / NaN price -> false', !priceInPage(0, PAGE) && !priceInPage(NaN, PAGE))

check('normUrl: strips protocol/www/query/hash/trailing-slash', normUrl('HTTPS://www.Article.com/product/25632/basi/?ref=x#top') === 'article.com/product/25632/basi')
check('normUrl: two forms of the same URL collapse', normUrl('http://example.com/p/1') === normUrl('https://example.com/p/1/'))

// --- finishConflict: card title must not contradict the page it links -------
check(
  'finishConflict: "dark-brown veneer" title vs a white-stained-oak URL slug -> conflict',
  finishConflict(
    'ikea.com/us/en/p/malm-bed-frame-white-stained-oak-veneer-s59022590',
    'MALM Bed frame, dark-brown veneer/Lurõy, King'
  )
)
check(
  'finishConflict: consistent brown-walnut title + slug -> no conflict',
  !finishConflict(
    'ikea.com/us/en/p/radmansoe-bed-frame-brown-walnut-effect-luroey-s69598638',
    'RÅDMANSÖ bed frame, brown walnut effect/Luröy, King'
  )
)
check(
  'finishConflict: title finish word appears in the slug -> no conflict',
  !finishConflict('example.com/p/oak-console-h123', 'Mid-century oak console table')
)
check(
  'finishConflict: no finish word on one side -> never a conflict',
  !finishConflict('example.com/p/hemnes-bed-frame-s12345', 'HEMNES Bed frame, King') &&
    !finishConflict('example.com/p/walnut-king-bed', 'Solid wood platform bed, King')
)
check(
  'finishConflict: checks against the search-result title too',
  finishConflict('MALM Bed frame, white stained oak veneer, King - IKEA', 'MALM Bed frame, espresso, King')
)

// --- softenPresentedClaims: presented options are "listed", not "confirmed" --
check(
  'soften: strips a leading "Confirmed:" label',
  softenPresentedClaims('Confirmed: RÅDMANSÖ King is $379, walnut effect, with real dimensions.') ===
    'RÅDMANSÖ King is $379, walnut effect, with real dimensions.'
)
check(
  'soften: "I\'ve verified the price" -> "I found the price"',
  softenPresentedClaims("I've verified the price on the product page.") ===
    'I found the price on the product page.'
)
check(
  'soften: "confirmed that it is in stock" -> "found that it is in stock"',
  softenPresentedClaims('I confirmed that it is in stock at $409.') === 'I found that it is in stock at $409.'
)
check(
  'soften: bare "verified" adjective -> "listed"',
  softenPresentedClaims('This is a verified listing at $299.') === 'This is a listed listing at $299.'
)
check(
  'soften: a clean reply with no certainty words is unchanged',
  softenPresentedClaims('The TONSTAD King is listed at $469. Want the alternative too?') ===
    'The TONSTAD King is listed at $469. Want the alternative too?'
)
check(
  'soften: re-capitalises after stripping a lowercase-following label',
  softenPresentedClaims('Confirmed: this white organic cotton king sheet set is $189.95.') ===
    'This white organic cotton king sheet set is $189.95.'
)
check(
  'soften: does not touch "confirm" in "confirm the order" / "ask to confirm"',
  softenPresentedClaims('Say the word and I can confirm the order.') ===
    'Say the word and I can confirm the order.'
)

console.log(`\n${fail === 0 ? 'SOURCING + PROMPT CHECK PASSED' : 'SOURCING + PROMPT CHECK FAILED'} (${pass} passed, ${fail} failed)`)
process.exit(fail === 0 ? 0 : 1)
