export function FullPageSpinner() {
  return (
    <div className="mm-center" role="status" aria-live="polite">
      <div className="mm-spinner" />
      <span className="mm-muted">Loading</span>
    </div>
  )
}
