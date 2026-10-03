import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/archivo/wdth.css'
import './styles/tokens.css'
import './styles/app.css'
import { App } from './app/App'
import { platform } from './storage/platform'
import { getProject, useProject } from './state/store'
import { useUI } from './state/ui'
import { validateHouse } from './planner/validation'

window.addEventListener('error', (e) => platform.log('error', `${e.message} @ ${e.filename}:${e.lineno}`))
window.addEventListener('unhandledrejection', (e) => platform.log('error', `unhandled: ${String(e.reason?.stack ?? e.reason)}`))

// automated UI tests (?e2e) read the model directly instead of scraping the screen
if (new URLSearchParams(location.search).has('e2e')) Object.assign(window, { __hf: { getProject, useProject, useUI, issues: () => validateHouse(getProject()).filter((i) => i.severity === 'error').map((i) => i.message) } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
