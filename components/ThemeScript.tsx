export const THEME_STORAGE_KEY = 'muse-mate-theme'

// Section 2 — runs before stylesheets to prevent a flash of the wrong theme.
// Sets data-theme on <html> from the persisted preference, defaulting to light.
const script = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');document.documentElement.setAttribute('data-theme',t==='dark'?'dark':'light');}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />
}
