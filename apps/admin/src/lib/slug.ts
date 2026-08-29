/**
 * Mirrors the API's `slugify` so the preview in the form matches what the
 * server would derive. If the two ever drift, the server wins — it owns the
 * unique index — but the operator should not be surprised.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/g, '')
}
