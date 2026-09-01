/** Formatting helpers. Numeric Postgres columns can arrive as strings over
 *  PostgREST — every formatter coerces with Number() before use. */

export function formatCurrency(value: number | string | null | undefined): string {
  const n = value == null || value === '' ? 0 : Number(value)
  if (!Number.isFinite(n)) return '$0'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)
}

export function formatInches(value: number | string | null | undefined): string {
  if (value == null || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const trimmed = Number(n.toFixed(2)).toString()
  return `${trimmed}"`
}

export function parseNumberInput(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}
