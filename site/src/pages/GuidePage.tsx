import { lazy, Suspense, useMemo, type ReactNode } from 'react'
import { toolBySlug } from '../content'
import { githubUrl, resolveRepoPath, rewriteHref, type Doc } from '../docs'
import { base, link } from '../links'

export function GuidePage({ doc }: { doc: Doc }) {
  const Content = useMemo(() => lazy(doc.load), [doc])
  const tool = doc.tool ? toolBySlug(doc.tool) : undefined
  const components = useMemo(() => ({
    a: ({ href, children }: { href?: string; children?: ReactNode }) => <a href={rewriteHref(base, doc.path, href)}>{children}</a>,
    img: ({ src, alt }: { src?: string; alt?: string }) => <img src={src && !/^[a-z]+:/i.test(src) ? githubUrl(resolveRepoPath(doc.path, src)).replace('/blob/', '/raw/') : src} alt={alt ?? ''} />,
  }), [doc])
  return <div className="page guide-page">
    <header className="guide-head">
      {tool && <a href={link(`tools/${tool.slug}`)}>← {tool.name}</a>}
      <a className="guide-source" href={githubUrl(doc.path)}>{doc.path}</a>
    </header>
    <article className="markdown"><Suspense fallback={<p className="loading-line">Loading…</p>}><Content components={components} /></Suspense></article>
  </div>
}
