import type { RuleDraft, RuleFieldDefinition } from '@/types/api'
import { useBrands } from '@/features/brands/queries'
import { CategorySelect } from '@/components/category-select'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * The control changes shape per field, and that is most of the work in the rule
 * builder. A category needs the tree, a brand needs the list, price needs a
 * number, an attribute needs its own values — offering a plain text box for all
 * of them would mean typing uuids by hand.
 *
 * `is_empty` renders nothing at all: the operator is the whole condition.
 */
export function RuleValueControl({
  definition,
  rule,
  onChange,
  invalid,
}: {
  definition: RuleFieldDefinition | undefined
  rule: RuleDraft
  onChange: (value: RuleDraft['value']) => void
  invalid?: boolean
}) {
  const { data: brands } = useBrands({ limit: 100, sort: 'name:asc' })

  if (!definition) return null
  if (rule.operator === 'is_empty') {
    return <span className="text-muted-foreground flex-1 text-xs">No value needed</span>
  }

  const text = rule.value === null || rule.value === undefined ? '' : String(rule.value)

  switch (definition.kind) {
    case 'category':
      return (
        <div className="min-w-0 flex-1">
          <CategorySelect
            id={`rule-${definition.field}`}
            value={text || null}
            onChange={(next) => onChange(next)}
            allowNone={false}
            placeholder="Choose a category"
            className="h-8 w-full"
            error={invalid ? ' ' : undefined}
          />
        </div>
      )

    case 'brand':
      return (
        <Select value={text} onValueChange={onChange}>
          <SelectTrigger size="sm" className="min-w-0 flex-1" aria-invalid={invalid}>
            <SelectValue placeholder="Choose a brand" />
          </SelectTrigger>
          <SelectContent>
            {(brands?.data ?? []).map((brand) => (
              <SelectItem key={brand.id} value={brand.id}>
                {brand.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )

    // Both pick one row from a list the API sent with the field: an attribute's
    // values, or the catalogue's tags.
    case 'tag':
    case 'attribute-select':
      return (
        <Select value={text} onValueChange={onChange}>
          <SelectTrigger size="sm" className="min-w-0 flex-1" aria-invalid={invalid}>
            <SelectValue placeholder={definition.kind === 'tag' ? 'Choose a tag' : 'Choose a value'} />
          </SelectTrigger>
          <SelectContent>
            {(definition.values ?? []).map((value) => (
              <SelectItem key={value.id} value={value.id}>
                {value.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )

    case 'boolean':
    case 'attribute-boolean':
      return (
        <Select value={text} onValueChange={(next) => onChange(next === 'true')}>
          <SelectTrigger size="sm" className="min-w-0 flex-1" aria-invalid={invalid}>
            <SelectValue placeholder="Yes or no" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Yes</SelectItem>
            <SelectItem value="false">No</SelectItem>
          </SelectContent>
        </Select>
      )

    case 'date':
      return (
        <Input
          type="date"
          value={text.slice(0, 10)}
          onChange={(event) => onChange(event.target.value || null)}
          aria-invalid={invalid}
          className="h-8 min-w-0 flex-1"
        />
      )

    case 'money':
    case 'number':
    case 'attribute-number':
      return (
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Input
            value={text}
            onChange={(event) => {
              const next = event.target.value
              // Kept as a string while typing — coercing on every keystroke
              // makes '1.' impossible to type.
              onChange(next === '' ? null : Number.isNaN(Number(next)) ? next : Number(next))
            }}
            inputMode="decimal"
            placeholder={definition.kind === 'money' ? '10000' : '0'}
            aria-invalid={invalid}
            className="h-8 tabular-nums"
          />
          {definition.unit && (
            <span className="text-muted-foreground shrink-0 text-xs">{definition.unit}</span>
          )}
        </div>
      )

    default:
      return (
        <Input
          value={text}
          onChange={(event) => onChange(event.target.value || null)}
          placeholder="Value"
          aria-invalid={invalid}
          className="h-8 min-w-0 flex-1"
        />
      )
  }
}
