import type { Attribute, ProductAttributeRow } from '@/types/api'
import type { AttributeDraft } from './schemas'

/**
 * One attribute as the editor holds it, which is not how the database stores
 * it: a MULTI_SELECT writes one `product_attributes` row per selected value,
 * but on screen it is one row with several ticks. Collapsing that here keeps
 * every control in the panel working on a single shape.
 */
export type AttributeEntry = {
  attributeId: string
  /** SELECT holds at most one; MULTI_SELECT holds any number. */
  valueIds: string[]
  text: string
  /** Kept as typed, never parsed — see the note on money in schemas.ts. */
  number: string
  boolean: boolean | null
}

export const emptyEntry = (attributeId: string): AttributeEntry => ({
  attributeId,
  valueIds: [],
  text: '',
  number: '',
  boolean: null,
})

/** Server rows → editor entries, preserving the stored order. */
export function toEntries(rows: ProductAttributeRow[]): AttributeEntry[] {
  const entries: AttributeEntry[] = []

  for (const row of rows) {
    let entry = entries.find((candidate) => candidate.attributeId === row.attributeId)
    if (!entry) {
      entry = emptyEntry(row.attributeId)
      entries.push(entry)
    }

    if (row.attributeValueId) entry.valueIds.push(row.attributeValueId)
    if (row.valueText !== null) entry.text = row.valueText
    if (row.valueNumber !== null) entry.number = row.valueNumber
    if (row.valueBoolean !== null) entry.boolean = row.valueBoolean
  }

  return entries
}

/**
 * Editor entries → the list the API diffs against. Rows with nothing in them
 * are dropped rather than sent: a half-filled row is a row the operator has not
 * finished, and the publish checklist already names the ones left empty.
 */
export function toDrafts(
  entries: AttributeEntry[],
  definitions: Map<string, Attribute>,
): AttributeDraft[] {
  return entries.flatMap<AttributeDraft>((entry) => {
    const definition = definitions.get(entry.attributeId)
    if (!definition) return []

    switch (definition.type) {
      case 'SELECT':
      case 'MULTI_SELECT':
        return entry.valueIds.map((attributeValueId) => ({
          attributeId: entry.attributeId,
          attributeValueId,
        }))
      case 'TEXT':
        return entry.text.trim()
          ? [{ attributeId: entry.attributeId, valueText: entry.text.trim() }]
          : []
      case 'NUMBER':
        return entry.number.trim()
          ? [{ attributeId: entry.attributeId, valueNumber: entry.number.trim() }]
          : []
      case 'BOOLEAN':
        return entry.boolean === null
          ? []
          : [{ attributeId: entry.attributeId, valueBoolean: entry.boolean }]
    }
  })
}

/** Stable comparison for the dirty check — order is part of the value. */
export const serializeEntries = (entries: AttributeEntry[]): string =>
  JSON.stringify(
    entries.map((entry) => [
      entry.attributeId,
      [...entry.valueIds].sort(),
      entry.text.trim(),
      entry.number.trim(),
      entry.boolean,
    ]),
  )
