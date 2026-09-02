import * as React from 'react'

const SUFFIX = 'StrideX'

/**
 * Sets the document title and meta description for the route that calls it.
 *
 * A hook rather than `react-helmet-async`, which the plan doc suggested: eight
 * routes already set `document.title` in an effect, a provider would be a
 * dependency and a wrapper to match a pattern this app had not adopted, and the
 * only thing helmet adds here — deduping tags across nested components — is not
 * a problem a single call per route can have.
 *
 * **Every route must call this.** Titles are not scoped to a component, so a
 * route that sets nothing keeps whatever the last one left: before this, moving
 * from the cart to a product left the tab reading "Cart (2) · StrideX", and the
 * bookmark and shared link went with it.
 *
 * `title` is null while data is loading, which leaves the previous title in
 * place rather than flashing "undefined · StrideX" for a frame.
 */
export function usePageMeta(meta: { title: string | null; description?: string | null }) {
  const { title, description } = meta

  React.useEffect(() => {
    if (title === null) return
    document.title = title === SUFFIX ? SUFFIX : `${title} · ${SUFFIX}`
  }, [title])

  React.useEffect(() => {
    if (!description) return

    // Created on demand: index.html ships without one, because a single static
    // description across a 210-product catalogue is worse than none.
    let tag = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    if (!tag) {
      tag = document.createElement('meta')
      tag.name = 'description'
      document.head.appendChild(tag)
    }
    tag.content = description
  }, [description])
}

/** Trims a description to something a search result will actually show. */
export function metaSummary(text: string | null | undefined, limit = 155): string | undefined {
  if (!text) return undefined
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= limit) return flat
  // Cut at a word, not mid-syllable, and let the ellipsis stand in for the rest.
  return `${flat.slice(0, flat.lastIndexOf(' ', limit))}…`
}
