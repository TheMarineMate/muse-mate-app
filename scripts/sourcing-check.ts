// Rail-enforcement unit check for lib/sourcing.ts (spec Section 5).
// Run: npm run sourcing:check   (uses Node's built-in type stripping)

import {
  composeSourcingNote,
  looksLikeSearchOrCategoryPage,
  validateAlternatives,
  validateListing,
} from '../lib/sourcing.ts'
import { computeBudgetRollup, describeBudgetForPrompt } from '../lib/budget.ts'
import { buildSystemPrompt } from '../lib/sourcing-engine.ts'

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

console.log(`\n${fail === 0 ? 'SOURCING + PROMPT CHECK PASSED' : 'SOURCING + PROMPT CHECK FAILED'} (${pass} passed, ${fail} failed)`)
process.exit(fail === 0 ? 0 : 1)
