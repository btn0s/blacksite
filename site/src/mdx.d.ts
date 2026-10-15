declare module '*.md' {
  import type { ComponentType } from 'react'
  const MDXContent: ComponentType<{ components?: Record<string, unknown> }>
  export default MDXContent
}
