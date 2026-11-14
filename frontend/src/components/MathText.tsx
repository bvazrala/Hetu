import katex from 'katex'
import 'katex/dist/katex.min.css'
import { Fragment } from 'react'
import { splitMath } from '../lib/math'

/** Returns typeset HTML, or null if the source is not valid LaTeX. */
function typeset(source: string, display: boolean): string | null {
  try {
    return katex.renderToString(source, {
      displayMode: display,
      throwOnError: true,
      strict: 'ignore', // accept characters such as ² without complaint
      trust: false, // no links or raw HTML from the source
      // KaTeX adds MathML next to the visual output. Screen readers read
      // the MathML, and the visual part is hidden from them.
      output: 'htmlAndMathml',
    })
  } catch {
    return null
  }
}

/**
 * Renders text and typesets any LaTeX in it. Text without math comes out
 * unchanged. Math that cannot be typeset is shown as it was written.
 */
export function MathText({ text }: { text: string }) {
  return (
    <>
      {splitMath(text).map((segment, index) => {
        const html = segment.math ? typeset(segment.value, segment.display) : null
        return html ? (
          // KaTeX escapes its input, so this HTML is safe to insert.
          <span key={index} dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <Fragment key={index}>{segment.raw}</Fragment>
        )
      })}
    </>
  )
}
