import type { Item } from './types'

/** Only the two fields the rollup actually reads — lets callers pass a trimmed
 *  `select('price_estimate, status')` result without a full Item. */
export type BudgetItem = Pick<Item, 'price_estimate' | 'status'>

export type BudgetRollup = {
  target: number
  /** status = needed | sourced — estimated, not yet committed */
  planned: number
  /** status = ordered — real money committed */
  committed: number
  /** status = received — delivered */
  received: number
  totalEstimated: number
  remaining: number
}

/** Pure so it's easy to hand-verify. Every item.price_estimate contributes to
 *  exactly one bucket, chosen by its status. */
export function computeBudgetRollup(
  items: BudgetItem[],
  target: number | string | null | undefined
): BudgetRollup {
  let planned = 0
  let committed = 0
  let received = 0

  for (const item of items) {
    const price = item.price_estimate == null ? 0 : Number(item.price_estimate)
    if (!Number.isFinite(price)) continue
    if (item.status === 'needed' || item.status === 'sourced') planned += price
    else if (item.status === 'ordered') committed += price
    else if (item.status === 'received') received += price
  }

  const t = target == null || target === '' ? 0 : Number(target)
  const totalEstimated = planned + committed + received

  return {
    target: Number.isFinite(t) ? t : 0,
    planned,
    committed,
    received,
    totalEstimated,
    remaining: (Number.isFinite(t) ? t : 0) - totalEstimated,
  }
}

/**
 * One-line budget context for an AI system prompt (spec 9.2 — the room chat
 * needs to know what's affordable). Returns null when there's nothing useful to
 * say yet (no target set and no spend), so the caller can omit the section
 * entirely rather than inject "$0 / $0 / $0".
 */
export function describeBudgetForPrompt(rollup: BudgetRollup): string | null {
  const { target, planned, committed, received, totalEstimated, remaining } = rollup
  if (target <= 0 && totalEstimated <= 0) return null

  const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
  const parts = [
    target > 0 ? `target ${usd(target)}` : 'no target set',
    `planned ${usd(planned)}`,
    `committed ${usd(committed)}`,
    `received ${usd(received)}`,
  ]
  if (target > 0) {
    parts.push(remaining >= 0 ? `${usd(remaining)} left` : `${usd(-remaining)} over`)
  }
  return parts.join(', ')
}
