/**
 * Database row shapes. Section 6 — keep this file in lockstep with
 * supabase/migrations on every schema change and commit it in the same pass.
 *
 * These mirror the tables created in supabase/migrations/001_core_schema.sql
 * and 002_standard_tables.sql. Clients are left untyped (matching the platform
 * pattern); import these types explicitly at query sites.
 */

// --- Enums (Postgres CHECK constraints, represented as string unions) ---

export type MemberRole = 'owner' | 'editor' | 'viewer'
export type MemberStatus = 'invited' | 'active'
export type ItemPriority = 'must-have' | 'nice-to-have'
export type ItemStatus = 'needed' | 'sourced' | 'ordered' | 'received'
export type ThemePref = 'light' | 'dark'
export type Wall = 'N' | 'E' | 'S' | 'W'
/** style_references.kind — uploaded photo, or a real retrieved web image/link. */
export type StyleReferenceKind = 'uploaded_image' | 'web_image' | 'web_link'

// --- JSON column shapes ---

/** projects.palette — direction swatches, not per-item colors. */
export type PaletteEntry = {
  hex: string
  label: string
}

/** rooms.doors / rooms.windows — openings measured along a named wall.
 *  offset = distance in inches from the wall's start corner to the opening's
 *  near edge; width = opening width in inches. */
export type Opening = {
  wall: Wall
  offset: number
  width: number
}

// --- Tables ---

export type Project = {
  id: string
  owner_id: string
  name: string
  address: string | null
  vibe_notes: string | null
  palette: PaletteEntry[]
  budget_target: number | null
  /** Phase 6 — confirmed mood/descriptor summary from the style-intake chat. */
  style_summary: string | null
  /** Set/refreshed each time the user confirms the profile (additive, not a lock). */
  style_confirmed_at: string | null
  /** Shopping preference: handmade/one-of-a-kind lean vs mass-market. */
  prefers_unique: boolean | null
  /** Shopping preference: actively check current sales / promo codes. */
  deal_sensitive: boolean | null
  created_at: string
  updated_at: string
}

/** Phase 6 (spec 9.3) — a persisted visual reference for the project's vibe.
 *  Exactly one of storage_path / url is set, matching `kind` (DB CHECK). */
export type StyleReference = {
  id: string
  project_id: string
  kind: StyleReferenceKind
  /** kind = 'uploaded_image' — object key in the 'style-references' Storage
   *  bucket, path '<project_id>/<uuid>.<ext>'. Null for web kinds. */
  storage_path: string | null
  /** kind = 'web_image' | 'web_link' — the real retrieved URL. Null for uploads. */
  url: string | null
  caption: string | null
  created_at: string
}

export type ProjectMember = {
  id: string
  project_id: string
  user_id: string | null
  invited_email: string | null
  role: MemberRole
  status: MemberStatus
  invited_by: string | null
  created_at: string
}

export type Room = {
  id: string
  project_id: string
  name: string
  notes: string | null
  photo_url: string | null
  /** inches */
  wall_length: number | null
  /** inches */
  wall_width: number | null
  doors: Opening[]
  windows: Opening[]
  created_at: string
  updated_at: string
}

export type Item = {
  id: string
  room_id: string
  /** denormalized from room_id for RLS + sourcing queries */
  project_id: string
  name: string
  priority: ItemPriority
  status: ItemStatus
  price_estimate: number | null
  link: string | null
  note: string | null
  /** inches — required before the item can be placed on the floor plan */
  width: number | null
  depth: number | null
  height: number | null
  /** set only when status reaches 'sourced' from a verified match */
  sourced_at: string | null
  sourced_via: 'manual' | 'assistant' | null
  /** how the sourced price was confirmed — by the model (priceInPage on a
   *  fetched page) or by a person tapping through the "Log this" confirm step.
   *  null for manual entries and anything sourced before the feature. */
  price_confirmation: 'fetch_verified' | 'human_confirmed' | null
  created_at: string
  updated_at: string
}

export type Placement = {
  id: string
  item_id: string
  room_id: string
  /** inches from the room outline's top-left origin */
  x: number
  y: number
  /** degrees, clockwise */
  rotation: number
  created_at: string
  updated_at: string
}

export type UserSettings = {
  user_id: string
  theme: ThemePref
  notifications_enabled: boolean
  onboarding_complete: boolean
  created_at: string
  updated_at: string
}

export type PushSubscription = {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  created_at: string
}
