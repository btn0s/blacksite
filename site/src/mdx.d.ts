declare module '*.md' {
  import type { ComponentType } from 'react'
  const MDXContent: ComponentType<{ components?: Record<string, unknown> }>
  export default MDXContent
}

declare module 'virtual:blacksite-skills' {
  const files: Record<string, string>
  export default files
}
