/**
 * `/login?redirect=…` is the one place this app takes a URL from a stranger and
 * then navigates to it. Unvalidated, it is an open redirect: an attacker sends
 * `/login?redirect=https://stridex-billing.example/pay`, the customer signs in
 * on the real domain, and the app itself hands them to the phishing page with
 * the trust of a completed login behind it.
 *
 * The rule from the spec is "starts with `/` and not `//`". These are the ways
 * a string can satisfy that reading and still leave the site:
 *
 *   //evil.com          protocol-relative — the browser reads it as absolute
 *   /\evil.com          browsers normalise the backslash to a slash
 *   https://evil.com    absolute, caught by the leading-slash check
 *   /%0d/evil.com       a CR/LF that some routers unfold before matching
 *   javascript:...      not a path at all
 *
 * So this validates positively — one allowed shape — rather than blocking a
 * list of known-bad ones, which is the check that ages badly.
 */
export const DEFAULT_REDIRECT = '/'

/** Control characters, including the CR/LF used to split a redirect apart. */
// The literal control characters are the entire point of this check: CR/LF is
// how a redirect gets split apart.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
/** The same characters arriving still percent-encoded. */
const ENCODED_CONTROL_CHARS = /%(0d|0a|00|09)/i

export function isSafeRedirect(value: string | null | undefined): value is string {
  if (!value) return false
  // Length cap first: everything below is regex work on attacker-controlled input.
  if (value.length > 512) return false

  // Must be a site-relative path and nothing else.
  if (!value.startsWith('/')) return false

  // `//host` and `/\host` are both absolute to a browser.
  if (value.startsWith('//') || value.startsWith('/\\')) return false

  // A backslash anywhere is never legitimate in a path this app generates, and
  // it is the character that normalises differently across browsers.
  if (value.includes('\\')) return false

  if (CONTROL_CHARS.test(value) || ENCODED_CONTROL_CHARS.test(value)) return false

  return true
}

/**
 * What every caller should use. Returns the path when it is safe and `/`
 * otherwise — silently, because a customer who followed a tampered link is not
 * helped by an error about it, and a scary message on the login page costs more
 * than it protects.
 */
export function safeRedirect(value: string | null | undefined): string {
  return isSafeRedirect(value) ? value : DEFAULT_REDIRECT
}

/**
 * Builds `/login?redirect=…` for a guard. Skips the param entirely when the
 * destination is the home page, so a bounced browse does not leave a pointless
 * `?redirect=/` in the address bar.
 */
export function loginPathFor(pathname: string, search = ''): string {
  const target = `${pathname}${search}`
  if (!isSafeRedirect(target) || target === DEFAULT_REDIRECT) return '/login'
  return `/login?redirect=${encodeURIComponent(target)}`
}
