import { Badge } from '@/components/ui/badge'
import type { AttributeType } from '@/types/api'

/**
 * The five types, with the one-line explanation of what each stores. The hints
 * matter: SELECT versus MULTI_SELECT is the choice operators get wrong, and it
 * cannot be changed once values exist.
 */
export const ATTRIBUTE_TYPES: { value: AttributeType; label: string; hint: string }[] = [
  { value: 'SELECT', label: 'Select', hint: 'One value from a list you define' },
  { value: 'MULTI_SELECT', label: 'Multi-select', hint: 'Several values from a list you define' },
  { value: 'TEXT', label: 'Text', hint: 'Free text typed per product' },
  { value: 'NUMBER', label: 'Number', hint: 'A number, optionally with a unit' },
  { value: 'BOOLEAN', label: 'Yes / no', hint: 'A checkbox per product' },
]

const LABELS = Object.fromEntries(
  ATTRIBUTE_TYPES.map((type) => [type.value, type.label]),
) as Record<AttributeType, string>

/** For the `FilterSelect` in the list toolbar. */
export const ATTRIBUTE_TYPE_OPTIONS = ATTRIBUTE_TYPES.map(({ value, label }) => ({ value, label }))

export const attributeTypeLabel = (type: AttributeType) => LABELS[type]

export function AttributeTypeBadge({ type }: { type: AttributeType }) {
  return (
    <Badge variant="muted" className="font-normal">
      {LABELS[type]}
    </Badge>
  )
}
