import type { JSX as ReactJSX } from 'react'

/** React 19 no longer declares a global JSX namespace; keep `JSX.Element` annotations working. */
declare global {
  namespace JSX {
    type Element = ReactJSX.Element
  }
}
