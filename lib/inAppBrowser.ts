/**
 * Section 8 — auth still breaks inside in-app webviews (Gmail, Instagram,
 * Facebook, etc.): they don't reliably share cookies/session with the real
 * browser, so the user lands in a looping or broken state. Detect these and
 * show an "open in Safari/Chrome" screen instead of letting sign-in fail
 * silently.
 */
const IN_APP_PATTERNS: RegExp[] = [
  /FBAN|FBAV|FB_IAB/i, // Facebook
  /Instagram/i,
  /Twitter/i,
  /Line\//i,
  /LinkedInApp/i,
  /GSA\//i, // Google Search app
  /\bGmail\b/i,
  /Snapchat/i,
  /Pinterest/i,
  /(TikTok|musical_ly|BytedanceWebview)/i,
]

export function isInAppBrowser(ua: string | null | undefined): boolean {
  if (!ua) return false
  if (IN_APP_PATTERNS.some((re) => re.test(ua))) return true

  // iOS heuristic: a WebKit UA that is neither Safari nor a known third-party
  // browser is an embedded webview.
  const isIOS = /iPhone|iPod|iPad/i.test(ua)
  const isSafari = /Safari/i.test(ua)
  const isKnownIOSBrowser = /(CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo)/i.test(ua)
  return isIOS && !isSafari && !isKnownIOSBrowser
}
