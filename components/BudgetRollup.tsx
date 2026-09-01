import { Card } from '@intelligent-mate/ui'
import { computeBudgetRollup } from '@/lib/budget'
import { formatCurrency } from '@/lib/format'
import type { Item } from '@/lib/types'

export function BudgetRollup({
  items,
  budgetTarget,
}: {
  items: Item[]
  budgetTarget: number | string | null
}) {
  const r = computeBudgetRollup(items, budgetTarget)
  const hasTarget = r.target > 0
  const over = r.remaining < 0

  return (
    <Card padding="lg">
      <div className="mm-rollup">
        <div className="mm-rollup__cell">
          <span className="mm-rollup__label">Target</span>
          <span className="mm-rollup__value">{hasTarget ? formatCurrency(r.target) : '—'}</span>
        </div>
        <div className="mm-rollup__cell">
          <span className="mm-rollup__label">Planned (needed + sourced)</span>
          <span className="mm-rollup__value">{formatCurrency(r.planned)}</span>
        </div>
        <div className="mm-rollup__cell">
          <span className="mm-rollup__label">Committed (ordered)</span>
          <span className="mm-rollup__value">{formatCurrency(r.committed)}</span>
        </div>
        <div className="mm-rollup__cell">
          <span className="mm-rollup__label">Received (delivered)</span>
          <span className="mm-rollup__value">{formatCurrency(r.received)}</span>
        </div>
      </div>
      <div className="mm-rollup__foot">
        <span className="mm-muted">Estimated total {formatCurrency(r.totalEstimated)}</span>
        {hasTarget && (
          <span className={over ? 'mm-rollup__remaining--over' : 'mm-rollup__remaining--under'}>
            {over
              ? `${formatCurrency(Math.abs(r.remaining))} over`
              : `${formatCurrency(r.remaining)} left`}
          </span>
        )}
      </div>
    </Card>
  )
}
