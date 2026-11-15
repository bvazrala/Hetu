import 'katex/dist/katex.min.css'
import type React from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { normalizeMath } from '../lib/math'

/**
 * Renders a reply written in Markdown, with typeset math and formatted code.
 * Raw HTML in the text is not rendered, so a reply cannot inject markup.
 */
export function Markdown({ text }: { text: string }) {
  // Headings inside a reply sit below the page's own headings: the reply's
  // top level becomes h4 and anything deeper h5, whichever levels it used.
  const levels = [...text.matchAll(/^(#{1,6})\s/gm)].map((match) => match[1].length)
  const top = levels.length > 0 ? Math.min(...levels) : 1
  const heading = (level: number) =>
    function Heading({ children }: { children?: React.ReactNode }) {
      return level <= top ? <h4>{children}</h4> : <h5>{children}</h5>
    }

  return (
    <div className="hetu-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: 'ignore', throwOnError: false, errorColor: 'inherit' }]]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          // A wide table or code block scrolls inside itself, not the page.
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
          pre: ({ children }) => <pre tabIndex={0}>{children}</pre>,
          h1: heading(1),
          h2: heading(2),
          h3: heading(3),
          h4: heading(4),
          h5: heading(5),
          h6: heading(6),
        }}
      >
        {normalizeMath(text)}
      </ReactMarkdown>
    </div>
  )
}
