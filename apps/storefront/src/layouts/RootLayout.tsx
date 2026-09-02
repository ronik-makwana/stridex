import { Outlet, ScrollRestoration } from 'react-router'

/**
 * The one place scroll position is decided, wrapped around every route group.
 *
 * Without this, react-router leaves the window exactly where it was, and a
 * client-side navigation that reuses its route component — /products/a to
 * /products/b from "You may also like", one category to the next, a collection
 * tile to the product it points at — lands the customer halfway down the new
 * page, still level with the card they just clicked.
 *
 * `ScrollRestoration` handles both directions of that:
 *   - a new location (a click) has no saved position, so the page opens at the
 *     top, which is where a product page has to start;
 *   - a Back press replays the location key it was recorded under, so returning
 *     to a grid puts the customer back at the row they left rather than at the
 *     top of a hundred products they already scrolled past.
 *
 * A `#hash` in the URL still wins over both — it scrolls to the element.
 *
 * Filter and sort changes are the deliberate exception: they rewrite the query
 * string in place and pass `preventScrollReset`, so the grid updates under a
 * customer who is standing still. See `use-list-params.ts`.
 */
export function RootLayout() {
  return (
    <>
      <ScrollRestoration />
      <Outlet />
    </>
  )
}
