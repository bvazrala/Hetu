import 'katex/dist/katex.min.css'
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
          // Headings inside a reply sit below the page's own headings.
          h1: ({ children }) => <h4>{children}</h4>,
          h2: ({ children }) => <h4>{children}</h4>,
          h3: ({ children }) => <h4>{children}</h4>,
          h4: ({ children }) => <h5>{children}</h5>,
          h5: ({ children }) => <h5>{children}</h5>,
          h6: ({ children }) => <h5>{children}</h5>,
        }}
      >
        {normalizeMath(text)}
      </ReactMarkdown>
    </div>
  )
}
