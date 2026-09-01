import { Card } from '@intelligent-mate/ui'

export default function DashboardPage() {
  return (
    <div className="mm-stack">
      <h1 className="mm-page-title">Dashboard</h1>
      <Card padding="lg">
        <p className="mm-muted">
          You&apos;re signed in. The budget rollup, room list, and palette summary
          arrive in Phase 3.
        </p>
      </Card>
    </div>
  )
}
