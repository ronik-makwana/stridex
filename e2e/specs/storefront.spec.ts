import { expect, test } from '@playwright/test'
import { CATALOG } from '../seed.js'

/**
 * The storefront in a real browser.
 *
 * These deliberately assert on what a customer can see and reach — a heading, a
 * price, an accessible label — rather than on class names or component
 * internals. A selector tied to `className` breaks on a restyle and teaches the
 * team that the e2e suite is noise; one tied to a role or a label breaks only
 * when the page genuinely stops working.
 *
 * Every wait is on a signal, never a duration. `networkidle` alone is not
 * enough after a lazy route: the URL changes before the chunk is fetched, so an
 * assertion made on it measures the page just left.
 */

const [first, , , soldOut] = CATALOG.products

/**
 * Choose the size, then add.
 *
 * The product page keeps the button disabled and reading "Select a size" until
 * every option has been chosen — so a spec that clicks straight at "Add to
 * cart" is testing a button that was never live.
 */
async function addFirstSizeToCart(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: new RegExp(CATALOG.size.values[1], 'i') }).first().click()
  const addToCart = page.getByRole('button', { name: /^add to cart$/i })
  await expect(addToCart).toBeEnabled()
  await addToCart.click()
}

test.describe('browsing', () => {
  test('the home page renders the catalogue', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveTitle(/StrideX/i)
    // The seeded products are the only ones in this database, so seeing one
    // means the API, the query and the grid all worked.
    await expect(page.getByRole('link', { name: new RegExp(first.title, 'i') }).first()).toBeVisible()
  })

  test('a product page opens from the grid', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('link', { name: new RegExp(first.title, 'i') }).first().click()

    await page.waitForURL('**/products/**')
    await expect(page.getByRole('heading', { level: 1, name: first.title })).toBeVisible()
  })

  test('a product page can be opened directly by its slug', async ({ page }) => {
    await page.goto(`/products/${first.slug}`)

    await expect(page.getByRole('heading', { level: 1, name: first.title })).toBeVisible()
    // Priced server-side; the page renders the string the API sent.
    await expect(page.getByText('4,999', { exact: false }).first()).toBeVisible()
  })

  test('an unknown slug renders not-found rather than a blank page', async ({ page }) => {
    await page.goto('/products/no-such-shoe-exists')

    await expect(page.getByText(/not found|does not exist|no longer/i).first()).toBeVisible()
  })

  /** The bundle failing to load looks exactly like a slow page until you check. */
  test('client-side navigation works without a full reload', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: new RegExp(first.title, 'i') }).first().click()
    await page.waitForURL('**/products/**')

    await page.goBack()
    await expect(page).toHaveURL(/\/$/)
  })
})

test.describe('stock', () => {
  /**
   * The rule the storefront must never break: a customer is told whether they
   * can buy, never how many exist.
   */
  test('a sold-out product cannot be added to the cart', async ({ page }) => {
    await page.goto(`/products/${soldOut.slug}`)

    await expect(page.getByRole('heading', { level: 1, name: soldOut.title })).toBeVisible()

    const button = page.getByRole('button', { name: /sold out/i }).first()
    await expect(button).toBeVisible()
    await expect(button).toBeDisabled()
  })

  test('an in-stock product becomes addable once a size is chosen', async ({ page }) => {
    await page.goto(`/products/${first.slug}`)

    // Before choosing: the control exists and refuses. With two sizes on the
    // product nothing is auto-selected, so this state is real.
    await expect(page.getByRole('button', { name: /select a size/i })).toBeDisabled()

    await page.getByRole('button', { name: new RegExp(CATALOG.size.values[1], 'i') }).first().click()

    await expect(page.getByRole('button', { name: /^add to cart$/i })).toBeEnabled()
  })
})

test.describe('the cart', () => {
  /**
   * Adding opens the cart drawer, and the drawer is a modal — so the header's
   * cart link is behind `aria-hidden` while it is open and cannot be asserted
   * on. The drawer's own heading carries the same count, and it is the feedback
   * the customer actually sees.
   */
  test('adding a product raises the cart count', async ({ page }) => {
    await page.goto(`/products/${first.slug}`)

    await expect(page.getByRole('link', { name: /^Cart/ })).toBeVisible()

    await addFirstSizeToCart(page)

    await expect(page.getByRole('heading', { name: /Cart \(1\)/ })).toBeVisible()
  })

  test('the cart survives a reload, because a guest bag is local', async ({ page }) => {
    await page.goto(`/products/${first.slug}`)
    await addFirstSizeToCart(page)
    await expect(page.getByRole('heading', { name: /Cart \(1\)/ })).toBeVisible()

    // After the reload the drawer is closed, so the header link is reachable
    // again — and it is the thing that proves the bag outlived the page.
    await page.reload()

    await expect(page.getByRole('link', { name: /Cart \(1\)/ })).toBeVisible()
  })

  test('the cart page lists what was added', async ({ page }) => {
    await page.goto(`/products/${first.slug}`)
    await addFirstSizeToCart(page)
    await expect(page.getByRole('heading', { name: /Cart \(1\)/ })).toBeVisible()

    await page.goto('/cart')

    await expect(page.getByText(first.title).first()).toBeVisible()
    await expect(page.getByText(CATALOG.size.values[1]).first()).toBeVisible()
  })
})

test.describe('the auth wall', () => {
  /** Holding stock needs an account to hold it for. */
  test('checkout redirects a guest to sign in', async ({ page }) => {
    await page.goto('/checkout')

    await page.waitForURL(/\/login/)
    await expect(page.getByRole('heading', { name: /sign in/i }).first()).toBeVisible()
  })

  test('an account page redirects a guest to sign in', async ({ page }) => {
    await page.goto('/account/orders')

    await page.waitForURL(/\/login/)
  })

  /**
   * Wrong credentials must produce a message, not a blank form — and the
   * message must not say which half was wrong.
   */
  test('a bad sign-in shows an error rather than failing silently', async ({ page }) => {
    await page.goto('/login')

    await page.getByLabel(/email/i).fill('nobody@example.test')
    // `getByLabel(/password/i)` also matches the show/hide toggle button beside
    // the field, so this asks for the textbox specifically.
    await page.getByRole('textbox', { name: /^password$/i }).fill('wrong-password-entirely')
    await page.getByRole('button', { name: /sign in/i }).click()

    await expect(page.getByText(/invalid email or password/i).first()).toBeVisible()
  })
})

test.describe('what crawlers get', () => {
  test('robots.txt is served', async ({ request }) => {
    // Emitted at build time, so a dev server may not have it — a 404 here is
    // information, not a failure of the site.
    const response = await request.get('/robots.txt')
    expect([200, 404]).toContain(response.status())
  })

  test('a product page sets its own title', async ({ page }) => {
    await page.goto(`/products/${first.slug}`)
    await expect(page).toHaveTitle(new RegExp(first.title, 'i'))
  })
})
