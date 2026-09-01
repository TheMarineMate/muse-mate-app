import type { Item } from './types'

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
  items: Item[],
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
