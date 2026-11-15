import { useMemo } from 'react'
import hljs from 'highlight.js/lib/core'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import bash from 'highlight.js/lib/languages/bash'
import sql from 'highlight.js/lib/languages/sql'
import 'highlight.js/styles/atom-one-dark.css'

hljs.registerLanguage('c', c)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sql', sql)

const LANGUAGES = ['c', 'cpp', 'javascript', 'typescript', 'python', 'rust', 'bash', 'sql']

export function CodeBlock({ code }: { code: string }) {
  const html = useMemo(
    () => hljs.highlightAuto(code, LANGUAGES).value,
    [code],
  )

  return (
    <pre className="overflow-x-auto rounded-lg border border-line bg-black/35 p-4 text-[13px] leading-6">
      <code className="hljs font-mono" dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  )
}
