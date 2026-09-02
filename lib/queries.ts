import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Item,
  ItemPriority,
  ItemStatus,
  MemberRole,
  PaletteEntry,
  Placement,
  Project,
  Room,
  StyleReference,
} from './types'

// Thin, typed wrappers around the Supabase calls the app makes. RLS (Phase 2)
// is the real access boundary — these just keep the query shape in one place
// and cast PostgREST's loose response into the app's row types.

export async function listMyProjects(supabase: SupabaseClient): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Project[]
}

export async function getProject(
  supabase: SupabaseClient,
  projectId: string
): Promise<Project | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .maybeSingle()
  if (error) throw error
  return data as Project | null
}

export async function getMyRole(
  supabase: SupabaseClient,
  projectId: string,
  userId: string
): Promise<MemberRole | null> {
  const { data, error } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return (data?.role as MemberRole | undefined) ?? null
}

export async function listRooms(supabase: SupabaseClient, projectId: string): Promise<Room[]> {
  const { data, error } = await supabase
    .from('rooms')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as Room[]
}

export async function getRoom(supabase: SupabaseClient, roomId: string): Promise<Room | null> {
  const { data, error } = await supabase.from('rooms').select('*').eq('id', roomId).maybeSingle()
  if (error) throw error
  return data as Room | null
}

export async function listItemsByProject(
  supabase: SupabaseClient,
  projectId: string
): Promise<Item[]> {
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as Item[]
}

export async function listItemsByRoom(supabase: SupabaseClient, roomId: string): Promise<Item[]> {
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as Item[]
}

export async function listPlacementsByRoom(
  supabase: SupabaseClient,
  roomId: string
): Promise<Placement[]> {
  const { data, error } = await supabase.from('placements').select('*').eq('room_id', roomId)
  if (error) throw error
  return (data ?? []) as Placement[]
}

// --- projects ---------------------------------------------------------------

export async function createProject(
  supabase: SupabaseClient,
  input: { name: string; address?: string | null; budget_target?: number | null }
): Promise<Project> {
  const { data, error } = await supabase.rpc('create_project', {
    p_name: input.name,
    p_address: input.address ?? null,
    p_budget_target: input.budget_target ?? null,
  })
  if (error) throw error
  return data as Project
}

export async function updateProject(
  supabase: SupabaseClient,
  projectId: string,
  patch: Partial<Pick<Project, 'name' | 'address' | 'vibe_notes' | 'budget_target' | 'palette'>>
): Promise<Project> {
  const { data, error } = await supabase
    .from('projects')
    .update(patch)
    .eq('id', projectId)
    .select()
    .single()
  if (error) throw error
  return data as Project
}

export async function setProjectPalette(
  supabase: SupabaseClient,
  projectId: string,
  palette: PaletteEntry[]
): Promise<Project> {
  return updateProject(supabase, projectId, { palette })
}

// --- style references (Phase 6) --------------------------------------------

export const STYLE_BUCKET = 'style-references'

export async function listStyleReferences(
  supabase: SupabaseClient,
  projectId: string
): Promise<StyleReference[]> {
  const { data, error } = await supabase
    .from('style_references')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as StyleReference[]
}

/** Upload a prepared image blob (Phase 6c). RLS on storage.objects enforces
 *  editor+; the key must be `<projectId>/<name>` so the policy resolves. */
export async function uploadStyleImage(
  supabase: SupabaseClient,
  storagePath: string,
  blob: Blob
): Promise<void> {
  const { error } = await supabase.storage
    .from(STYLE_BUCKET)
    .upload(storagePath, blob, { contentType: blob.type || 'image/jpeg', upsert: false })
  if (error) throw error
}

/** Persist the uploaded image as a lasting reference row (spec 9.4). */
export async function createUploadedStyleReference(
  supabase: SupabaseClient,
  input: { projectId: string; storagePath: string; caption?: string | null }
): Promise<StyleReference> {
  const { data, error } = await supabase
    .from('style_references')
    .insert({
      project_id: input.projectId,
      kind: 'uploaded_image',
      storage_path: input.storagePath,
      caption: input.caption ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as StyleReference
}

/** Short-lived signed URL for displaying a private uploaded image. */
export async function signedStyleImageUrl(
  supabase: SupabaseClient,
  storagePath: string,
  expiresIn = 600
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(STYLE_BUCKET)
    .createSignedUrl(storagePath, expiresIn)
  if (error) return null
  return data?.signedUrl ?? null
}

/** Remove the row and, for an uploaded image, its Storage object too. */
export async function deleteStyleReference(
  supabase: SupabaseClient,
  reference: Pick<StyleReference, 'id' | 'kind' | 'storage_path'>
): Promise<void> {
  const { error } = await supabase.from('style_references').delete().eq('id', reference.id)
  if (error) throw error
  if (reference.kind === 'uploaded_image' && reference.storage_path) {
    // Best effort — the row is already gone; a stray object is harmless.
    await supabase.storage.from(STYLE_BUCKET).remove([reference.storage_path])
  }
}

// --- rooms -------------------------------------------------------------------

export async function createRoom(
  supabase: SupabaseClient,
  input: {
    project_id: string
    name: string
    notes?: string | null
    wall_length?: number | null
    wall_width?: number | null
  }
): Promise<Room> {
  const { data, error } = await supabase.from('rooms').insert(input).select().single()
  if (error) throw error
  return data as Room
}

export async function updateRoom(
  supabase: SupabaseClient,
  roomId: string,
  patch: Partial<Pick<Room, 'name' | 'notes' | 'wall_length' | 'wall_width' | 'doors' | 'windows'>>
): Promise<Room> {
  const { data, error } = await supabase
    .from('rooms')
    .update(patch)
    .eq('id', roomId)
    .select()
    .single()
  if (error) throw error
  return data as Room
}

export async function deleteRoom(supabase: SupabaseClient, roomId: string): Promise<void> {
  const { error } = await supabase.from('rooms').delete().eq('id', roomId)
  if (error) throw error
}

// --- items ---------------------------------------------------------------

export type ItemInput = {
  room_id: string
  name: string
  priority: ItemPriority
  price_estimate?: number | null
  link?: string | null
  note?: string | null
  width?: number | null
  depth?: number | null
  height?: number | null
}

export async function createItem(supabase: SupabaseClient, input: ItemInput): Promise<Item> {
  // project_id is filled by the items_sync_project_id trigger.
  const { data, error } = await supabase.from('items').insert(input).select().single()
  if (error) throw error
  return data as Item
}

export type ItemPatch = Partial<
  Pick<
    Item,
    | 'name'
    | 'priority'
    | 'status'
    | 'price_estimate'
    | 'link'
    | 'note'
    | 'width'
    | 'depth'
    | 'height'
    | 'sourced_at'
    | 'sourced_via'
  >
>

export async function updateItem(
  supabase: SupabaseClient,
  itemId: string,
  patch: ItemPatch
): Promise<Item> {
  const { data, error } = await supabase
    .from('items')
    .update(patch)
    .eq('id', itemId)
    .select()
    .single()
  if (error) throw error
  return data as Item
}

export async function deleteItem(supabase: SupabaseClient, itemId: string): Promise<void> {
  const { error } = await supabase.from('items').delete().eq('id', itemId)
  if (error) throw error
}

// --- placements (floor plan) ---------------------------------------------

export async function createPlacement(
  supabase: SupabaseClient,
  input: { item_id: string; room_id: string; x: number; y: number; rotation?: number }
): Promise<Placement> {
  const { data, error } = await supabase
    .from('placements')
    .insert({ rotation: 0, ...input })
    .select()
    .single()
  if (error) throw error
  return data as Placement
}

export async function updatePlacement(
  supabase: SupabaseClient,
  placementId: string,
  patch: Partial<Pick<Placement, 'x' | 'y' | 'rotation'>>
): Promise<Placement> {
  const { data, error } = await supabase
    .from('placements')
    .update(patch)
    .eq('id', placementId)
    .select()
    .single()
  if (error) throw error
  return data as Placement
}

export async function deletePlacement(
  supabase: SupabaseClient,
  placementId: string
): Promise<void> {
  const { error } = await supabase.from('placements').delete().eq('id', placementId)
  if (error) throw error
}

/** Manual status change from the UI (not the sourcing assistant). Stamps
 * provenance when an item is marked 'sourced' by hand; clears it if the item
 * moves back to 'needed'. Mirrors the AI rail's confidence requirement -
 * every 'sourced' item carries who/how it was sourced. */
export function statusPatchFor(nextStatus: ItemStatus, previousStatus: ItemStatus): ItemPatch {
  if (nextStatus === 'sourced' && previousStatus !== 'sourced') {
    return { status: nextStatus, sourced_at: new Date().toISOString(), sourced_via: 'manual' }
  }
  if (nextStatus === 'needed') {
    return { status: nextStatus, sourced_at: null, sourced_via: null }
  }
  return { status: nextStatus }
}
