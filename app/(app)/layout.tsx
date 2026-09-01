import { AuthGate } from '@/components/AuthGate'
import { TopNav } from '@/components/TopNav'
import { BottomNav } from '@/components/BottomNav'

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthGate>
      <div className="mm-shell">
        <TopNav />
        <main className="mm-main">{children}</main>
        <BottomNav />
      </div>
    </AuthGate>
  )
}
