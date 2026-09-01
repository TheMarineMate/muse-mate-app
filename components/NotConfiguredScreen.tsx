// Section 24 — shown when Supabase env vars are missing/blank, instead of a
// blank white crash. Plain message, no stack trace.
export function NotConfiguredScreen() {
  return (
    <div className="mm-center" role="alert">
      <div className="mm-center__title">Muse Mate isn&apos;t configured yet</div>
      <p className="mm-center__body">
        The app can&apos;t reach its database. If you&apos;re setting this up, add{' '}
        <span className="mm-code">NEXT_PUBLIC_SUPABASE_URL</span> and{' '}
        <span className="mm-code">NEXT_PUBLIC_SUPABASE_ANON_KEY</span> to the
        environment, then redeploy.
      </p>
    </div>
  )
}
