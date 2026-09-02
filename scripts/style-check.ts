// Rail-enforcement unit check for lib/style.ts (spec Section 9.4).
// Run: npm run style:check   (uses Node's built-in type stripping)

import {
  buildConfirmedProfile,
  composeStyleSummary,
  coerceBool,
  describeConfirmation,
  isValidStoragePath,
  mediaTypeFromPath,
  sanitizeList,
  storageKeyForUpload,
  validatePalette,
  validateStyleReferences,
  MAX_REFERENCES,
} from '../lib/style.ts'
import { buildStyleSystemPrompt, buildTurnMessages, CONFIRM_TOOL } from '../lib/style-engine.ts'

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

// --- coerceBool ------------------------------------------------------------
check('coerceBool true/false pass through', coerceBool(true) === true && coerceBool(false) === false)
check('coerceBool string forms', coerceBool('true') === true && coerceBool('false') === false)
check('coerceBool anything else -> null', coerceBool(1) === null && coerceBool(undefined) === null && coerceBool('yes') === null)

// --- sanitizeList -------------------------------------------------------
check('sanitizeList trims, drops empties', JSON.stringify(sanitizeList([' oak ', '', '  '])) === JSON.stringify(['oak']))
check('sanitizeList de-dupes case-insensitively', JSON.stringify(sanitizeList(['Linen', 'linen', 'LINEN'])) === JSON.stringify(['Linen']))
check('sanitizeList caps at 12 items', sanitizeList(Array.from({ length: 40 }, (_, i) => `m${i}`)).length === 12)
check('sanitizeList strips control chars', sanitizeList(['oakwood'])[0] === 'oakwood')
check('sanitizeList non-array -> []', sanitizeList('oak').length === 0)

// --- validatePalette --------------------------------------------------
const pal = validatePalette([
  { hex: '#a9835c', label: '  Warm putty ' },
  { hex: 'not-a-hex', label: 'skip' },
  { hex: '#123ABC', label: '' },
])
check('validatePalette keeps valid hex, upper-cases', pal[0].hex === '#A9835C' && pal[0].label === 'Warm putty')
check('validatePalette drops invalid hex', pal.length === 2)
check('validatePalette falls back label to hex', pal[1].label === '#123ABC')
check('validatePalette caps at 8', validatePalette(Array.from({ length: 20 }, () => ({ hex: '#000000', label: 'x' }))).length === 8)

// --- validateStyleReferences (grounding rail 9.4) --------------------
const refs = validateStyleReferences([
  { kind: 'web_link', url: 'https://example.com/lookbook', caption: '  coastal calm  ' },
  { kind: 'web_image', url: 'https://cdn.example.com/a.jpg', caption: '' },
  { kind: 'web_link', url: 'not a url', caption: 'bad' }, // dropped
  { kind: 'pinterest_board', url: 'https://example.com/x', caption: 'bad kind' }, // dropped
  { kind: 'web_link', url: 'https://example.com/lookbook', caption: 'dup' }, // dropped (dup url)
])
check('validateStyleReferences keeps real http(s) urls', refs.length === 2)
check('validateStyleReferences trims caption, empty -> null', refs[0].caption === 'coastal calm' && refs[1].caption === null)
check('validateStyleReferences drops non-url', !refs.some((r) => r.url === 'not a url'))
check('validateStyleReferences drops unknown kind', !refs.some((r) => (r as { kind: string }).kind === 'pinterest_board'))
check('validateStyleReferences de-dupes by url', refs.filter((r) => r.url === 'https://example.com/lookbook').length === 1)
check(
  `validateStyleReferences caps at ${MAX_REFERENCES}`,
  validateStyleReferences(Array.from({ length: 20 }, (_, i) => ({ kind: 'web_link', url: `https://e.com/${i}`, caption: '' }))).length === MAX_REFERENCES
)

// --- composeStyleSummary --------------------------------------------
const summary = composeStyleSummary({
  mood: 'Warm, unfussy, a little coastal.',
  materials: ['white oak', 'linen', 'white oak'],
  avoid: ['chrome', 'glossy black'],
})
check('composeStyleSummary has a Mood line', summary.includes('Mood: Warm, unfussy, a little coastal.'))
check('composeStyleSummary has a Materials line, de-duped', summary.includes('Materials & textures: white oak, linen') && !summary.includes('white oak, linen, white oak'))
check('composeStyleSummary has an Avoid line', summary.includes('Avoid: chrome, glossy black'))
check('composeStyleSummary omits empty sections', composeStyleSummary({ mood: 'Just a mood.' }) === 'Mood: Just a mood.')
check('composeStyleSummary empty input -> empty string', composeStyleSummary({}) === '')

// --- buildConfirmedProfile ----------------------------------------
const profile = buildConfirmedProfile({
  mood: 'Bright and calm.',
  materials: ['rattan'],
  avoid: ['heavy farmhouse'],
  palette: [{ hex: '#A9835C', label: 'Putty' }],
  prefers_unique: true,
  deal_sensitive: false,
  references: [{ kind: 'web_link', url: 'https://example.com/ref', caption: 'x' }],
})
check('buildConfirmedProfile: composed summary', !!profile && profile.style_summary.startsWith('Mood: Bright and calm.'))
check('buildConfirmedProfile: palette carried', !!profile && profile.palette.length === 1 && profile.palette[0].label === 'Putty')
check('buildConfirmedProfile: prefs coerced', !!profile && profile.prefers_unique === true && profile.deal_sensitive === false)
check('buildConfirmedProfile: references validated', !!profile && profile.references.length === 1)
check('buildConfirmedProfile: null when nothing usable', buildConfirmedProfile({ mood: '', palette: [] }) === null)
check('buildConfirmedProfile: palette-only still builds', buildConfirmedProfile({ palette: [{ hex: '#000000', label: 'Ink' }] }) !== null)
check(
  'buildConfirmedProfile: missing prefs -> null (route decides not to wipe)',
  buildConfirmedProfile({ mood: 'x', prefers_unique: 'maybe' })?.prefers_unique === null
)

// --- describeConfirmation (no model prose) -----------------------
const line = describeConfirmation(profile!)
check('describeConfirmation names palette + refs count', line.includes('1-color palette') && line.includes('1 reference'))
check('describeConfirmation has no newlines', !line.includes('\n'))

// --- system prompt shape --------------------------------------------
const prompt = buildStyleSystemPrompt({
  projectName: 'The Riverhouse',
  address: '3765 Ed Smith Ave, Myrtle Beach, SC',
  vibeNotes: 'rental, needs to photograph well',
  currentSummary: null,
  currentPalette: [{ hex: '#A9835C', label: 'Putty' }],
  prefersUnique: null,
  dealSensitive: true,
})
check('system prompt: names the project', prompt.includes('The Riverhouse'))
check('system prompt: seeds existing quick notes', prompt.includes('rental, needs to photograph well'))
check('system prompt: shows current palette', prompt.includes('Putty (#A9835C)'))
check('system prompt: shows preference state', prompt.includes('unique / handmade pieces: not set yet') && prompt.includes('promo-code checking: yes'))
check('system prompt: forbids price-shopping here', /do not price-shop/i.test(prompt))
check('system prompt: grounding rule on references', /never describe or link a reference you did not retrieve/i.test(prompt))
check('system prompt: honors a direct save instruction immediately', /"save it"[\s\S]*IS approval[\s\S]*same turn/i.test(prompt))
check('system prompt: allows saving a still-light profile', /even when the profile is still light[\s\S]*empty arrays/i.test(prompt))
check('system prompt: does not withhold the save or ask another question first', /do not withhold the save or answer with another question first/i.test(prompt))
check('system prompt: still bars an unprompted self-initiated save', /do not call the tool on your own read of the room when the user has not asked to save/i.test(prompt))
check('confirm tool: description recognizes a direct save instruction', /direct instruction to save or confirm/i.test(JSON.stringify(CONFIRM_TOOL)))
check('confirm tool: description allows a partial profile', /still partial \(empty arrays are fine/i.test(JSON.stringify(CONFIRM_TOOL)))

// --- Phase 6c: image attachment helpers --------------------------------
const PID = '11111111-1111-1111-1111-111111111111'

check('mediaTypeFromPath: jpg', mediaTypeFromPath(`${PID}/a.jpg`) === 'image/jpeg')
check('mediaTypeFromPath: JPEG upper-case', mediaTypeFromPath(`${PID}/a.JPEG`) === 'image/jpeg')
check('mediaTypeFromPath: png/webp/gif', mediaTypeFromPath('x/a.png') === 'image/png' && mediaTypeFromPath('x/a.webp') === 'image/webp' && mediaTypeFromPath('x/a.gif') === 'image/gif')
check('mediaTypeFromPath: unknown ext -> null', mediaTypeFromPath('x/a.tiff') === null && mediaTypeFromPath('x/a') === null)

check('isValidStoragePath: accepts <projectId>/<uuid>.jpg', isValidStoragePath(`${PID}/2b2c.jpg`, PID))
check('isValidStoragePath: rejects wrong project folder', !isValidStoragePath(`22222222-2222-2222-2222-222222222222/a.jpg`, PID))
check('isValidStoragePath: rejects path traversal', !isValidStoragePath(`${PID}/../secrets.jpg`, PID))
check('isValidStoragePath: rejects nested dirs', !isValidStoragePath(`${PID}/sub/a.jpg`, PID))
check('isValidStoragePath: rejects backslash', !isValidStoragePath(`${PID}\\a.jpg`, PID))
check('isValidStoragePath: rejects non-image ext', !isValidStoragePath(`${PID}/a.pdf`, PID))
check('isValidStoragePath: rejects non-string', !isValidStoragePath(42 as unknown, PID) && !isValidStoragePath(null, PID))

const key = storageKeyForUpload(PID, 'image/jpeg')
check('storageKeyForUpload: under the project folder, .jpg', key.startsWith(`${PID}/`) && key.endsWith('.jpg'))
check('storageKeyForUpload: output passes its own validator', isValidStoragePath(key, PID))
check('storageKeyForUpload: png mime -> .png', storageKeyForUpload(PID, 'image/png').endsWith('.png'))

// --- buildTurnMessages (multimodal mapping) --------------------------
const mapped = buildTurnMessages([
  { role: 'user', content: 'here is the room', images: [{ media_type: 'image/jpeg', data: 'QUJD' }] },
  { role: 'assistant', content: 'got it' },
  { role: 'user', content: 'and this chair' },
])
check('buildTurnMessages: image turn becomes a content array', Array.isArray(mapped[0].content))
const firstContent = mapped[0].content as { type: string; source?: { type: string; media_type: string; data: string } }[]
check('buildTurnMessages: image block first, base64 source', firstContent[0].type === 'image' && firstContent[0].source?.type === 'base64' && firstContent[0].source?.media_type === 'image/jpeg' && firstContent[0].source?.data === 'QUJD')
check('buildTurnMessages: text block after the image', firstContent[1].type === 'text' && (firstContent[1] as unknown as { text: string }).text === 'here is the room')
check('buildTurnMessages: assistant stays a plain string', mapped[1].content === 'got it')
check('buildTurnMessages: user with no images stays a plain string', mapped[2].content === 'and this chair')
check('buildTurnMessages: empty images array stays a plain string', typeof buildTurnMessages([{ role: 'user', content: 'hi', images: [] }])[0].content === 'string')

// --- system prompt: photos are references, not products -------------
check('system prompt: tells the model to read attached photos as vibe references', /user may attach photos[\s\S]*never products to price or source/i.test(prompt))

console.log(`\n${fail === 0 ? 'STYLE RAIL CHECK PASSED' : 'STYLE RAIL CHECK FAILED'} (${pass} passed, ${fail} failed)`)
process.exit(fail === 0 ? 0 : 1)
