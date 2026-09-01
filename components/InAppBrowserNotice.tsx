'use client'

import { useEffect, useState } from 'react'

// Section 8 — shown inside in-app webviews where auth can't hold a session.
export function InAppBrowserNotice() {
  const [url, setUrl] = useState('')
  useEffect(() => {
    setUrl(window.location.href)
  }, [])

  return (
    <div className="mm-center" role="alert">
      <div className="mm-center__title">Open Muse Mate in your browser</div>
      <p className="mm-center__body">
        This in-app browser can&apos;t keep you signed in reliably. Open this link
        in Safari or Chrome instead.
      </p>
      {url && <span className="mm-code">{url}</span>}
    </div>
  )
}
