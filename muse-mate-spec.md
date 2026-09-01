# Muse Mate — v1 Build Spec

*New app inside the existing Intelligent Mate platform. Read `intelligent-mate-platform-build-standards.md` before this file — this spec assumes and depends on those conventions rather than repeating them.*

**Test case:** The Riverhouse (3765 Ed Smith Ave, Myrtle Beach, SC) — a real, single, in-progress project this will be used on immediately after v1 ships.

---

## 0. What Muse Mate is

A design-project tracker: vision/palette direction, room-by-room item checklists with AI-assisted price-shopping, a to-scale floor-plan canvas for testing furniture layouts, and a lightweight budget rollup. Built for one owner + a small number of invited collaborators per project — not a public product, not multi-org, not billed. This is a functional v1, not a polished/marketed release.

---

## 1. Confirmed stack and platform requirements

**Stack (per consolidated build standards, Section 1):** Next.js 14 (App Router), plain CSS with CSS custom properties (**no Tailwind**), Supabase (DB + Auth), Vercel deploy, Stripe (not used in v1 — no billing), Resend for transactional email, Anthropic API server-side only.

**Accent color (Section 2):** `--accent-product: #A9835C` is listed in the platform doc as Muse Mate's locked color, but treat this as a **placeholder pending review** — not yet confirmed as final. It's a single CSS custom property, trivial to swap later; nothing should be built in a way that hardcodes this value outside the token itself.

**Muse Mate's place in the platform (Section 3, asset model):** *"The Muse Mate learns the space (rooms, measurements, style profile, furnishings/inventory, sourcing/budget)."* Confirms this app's data must be taggable to a single asset — the project/space — the same way Flow Mate taggs to ventures.

**Required platform hardening, non-negotiable from day one (not retrofit later):**
- `data-theme="light"|"dark"` architecture (Section 2/18), light mode default, FOUC-prevention inline script, theme preference in Supabase `user_settings.theme`
- Full semantic color token set (Section 19) — `--success-bg/text/border`, `--destructive-bg/text/border`, `--warning-bg/text/border`, `--info-bg/text/border`, defined for both themes, verified ≥4.5:1 contrast. No ad-hoc Tailwind-shade colors, no hardcoded hex anywhere.
- Auth (Section 8/22): Supabase `signInWithPassword` only, no public self-serve signup (collaborators are invited), cookie-based session storage (not localStorage), in-app-browser detection with an "open in Safari/Chrome" fallback screen, `AuthGate.tsx` client-side gate (not `middleware.ts`), auth email routed through Resend with a branded template — never Supabase's default emails
- `isSupabaseConfigured()` guard (Section 24) before every `getSupabase()` call, with a plain "not configured" fallback screen — never a blank white crash
- PWA: use `@ducanh2912/next-pwa`, actually call `withPWA()`, verify with a real `next build && next start` that a service worker registers and manifest resolves — "in package.json" is not proof it works (Section 25)
- Loading-state discipline (Section 26): never gate a full-page spinner on a post-action refresh where data already exists — only on true first load — or action confirmations get wiped before the user sees them
- Standard tables from day one (Section 5): `user_settings`, `push_subscriptions`, `project_members` (this app's `[asset]_members` equivalent)
- `.maybeSingle()` not `.single()` for any query that may return zero rows
- `lib/types.ts` committed and current with schema on every change; `npm run build` passing locally before every push

## 2. Shared UI package — decision and tradeoff, noted explicitly

Section 17 specifies extraction should happen **after** Flow Mate's code-quality audit/security cleanup/independent review is complete, so cruft isn't propagated into every future Mate. **Flow Mate's audit has been completed and the codebase confirmed clean** — proceeding with extraction now on that basis, not skipping the rule, satisfying its actual intent.

**Decided:** sibling-folder + `file:`-dependency package, for MVP speed. This deviates from Section 17's stated monorepo-workspace structure — documented here as a deliberate, known tradeoff (same category as the audit-sequencing decision above), not an oversight. **Future work, tracked separately, not part of this build:** migrate to a proper npm/pnpm workspace monorepo per Section 17, consolidating Flow Mate, Marine Mate, Muse Mate, and any other Mates built by then into the correct structure in one pass, rather than doing it piecemeal per-Mate.

Extraction **copies** components out of `flow-mate-app/components` into the new sibling package — Flow Mate's repo is not modified, no imports changed, no files deleted there. Muse Mate is the first consumer of the new package.

---

## 2. Data model

```
projects
  - id, owner_id, name, address, vibe_notes, palette (json), budget_target

project_collaborators
  - id, project_id, user_id, role (enum: owner | editor | viewer)

rooms
  - id, project_id, name, notes, photo_url
  - wall_length, wall_width          (real measurements, not free text)
  - doors (json: [{wall, offset, width}])
  - windows (json: [{wall, offset, width}])

items
  - id, room_id, name, priority (must-have | nice-to-have)
  - status (needed | sourced | ordered | received)
  - price_estimate, link, note
  - width, depth, height             (required for floor-plan placement; optional otherwise)

placements
  - id, item_id, room_id, x, y, rotation
```

**Access control:** every write action (add/edit room, add/edit item, move a placement, edit budget) must check the requesting user's role on `project_collaborators`. `viewer` role is read-only across the entire project — no exceptions for "small" edits.

---

## 3. Access model

- **Owner** — full edit, can invite/remove collaborators
- **Editor** (1 per project for v1) — full edit on rooms/items/placements/budget, cannot manage collaborators
- **Viewer** (1 per project for v1) — read-only across rooms, items, floor plan, budget

No org/staff tiers (that's Dispatch Mate's 21.2 pattern — deliberately not reused here; this is simpler by design).

---

## 4. Core screens

1. **Project dashboard** — budget rollup (target / planned / committed / received), room list, vibe/palette summary
2. **Room detail** — item checklist (priority, status, price, link, note) + floor-plan canvas for that room
3. **Floor-plan canvas** — room outline drawn to scale from `wall_length`/`wall_width`, doors/windows marked, draggable to-scale boxes for any item with dimensions set. Dragging a box updates its `placements` row. Viewers see the canvas but cannot drag.

   **Technical approach:** build custom on a lightweight 2D canvas library — `react-konva` (preferred, React-native wrapper for Konva.js) or Fabric.js — not a pre-built floor-plan application (e.g. open3dFloorplan, openPlan3D, Archilogic SDK). Those tools carry their own opinionated data models (furniture catalogs, room/wall structures) that don't match this schema and would require fighting the library to stay in sync with `items`/`placements` instead of building from them. The canvas library should be a rendering/interaction primitive only — room outline, doors/windows, and item boxes are all driven directly from this app's own tables, not a foreign catalog.
4. **Sourcing inbox** — chat-driven. User describes/pastes an item; Claude searches real current listings and logs price, link, and dimension estimate against the matching item (or creates a new item if none exists). Do not auto-place on the floor plan — the user drags it in manually once sourced.

---

## 5. AI rails for the sourcing feature (Section 20, applied)

- **Data confidence** — never mark an item "Sourced" from an inferred/unverified match; only from an actual retrieved listing with a real price and link.
- **Scope** — the sourcing assistant only price-shops and logs; it does not comment on the user's vibe/design choices unprompted.
- **Volume cap** — surface a small number of strong options per request, not an exhaustive list.
- **Fallback state** — a clean "no good match found yet" state, distinct from a broken/empty state.

---

## 6. Explicitly deferred (not in v1)

- Landing page, marketing copy, onboarding polish
- Billing / subscriptions (21.1's Stripe pattern)
- Org/staff-tier access (21.2)
- Demo infrastructure (21.3)
- Retention / soft-delete crons (19.4)
- Multiple saved floor-plan layout versions for comparison

---

## 7. Phased build plan

1. Data model + migrations (`projects`, `rooms`, `items`, `placements`, `project_collaborators`)
2. Access control enforcement (role checks on every write path)
3. Core CRUD screens — project dashboard, room detail, item checklist, budget rollup
4. Floor-plan canvas — room outline to scale, door/window rendering, draggable to-scale item boxes
5. Sourcing AI integration — chat interaction, rails from §5, writes into the item record

Show working output (running build / screenshot / passing test) at the end of each phase before moving to the next. Do not report a phase done on "should work."

---

## 8. Kickoff instruction for Claude Code

> Read `intelligent-mate-platform-build-standards.md` and this file (`muse-mate-spec.md`). Before writing any code, summarize back: (1) the data model you're about to create, (2) which build-standards sections apply and how, (3) your phased build plan. Wait for confirmation before implementing. Do not modify `@intelligent-mate/ui`, the theme system, or other Mates' code without flagging it first.
