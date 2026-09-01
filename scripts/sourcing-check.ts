// Rail-enforcement unit check for lib/sourcing.ts (spec Section 5).
// Run: npm run sourcing:check   (uses Node's built-in type stripping)

import {
  composeSourcingNote,
  validateAlternatives,
  validateListing,
} from '../lib/sourcing.ts'

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

console.log(`\n${fail === 0 ? 'SOURCING RAIL CHECK PASSED' : 'SOURCING RAIL CHECK FAILED'} (${pass} passed, ${fail} failed)`)
process.exit(fail === 0 ? 0 : 1)
