import * as React from 'react'
import { AlertCircle, Filter, Plus, X } from 'lucide-react'
import { ApiError } from '@/lib/api-client'
import { formatCount } from '@/lib/format'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useRuleFields } from '@/features/collections/queries'
import { collectionsApi } from '@/features/collections/api'
import type { MatchType, RuleDraft, RulePreview } from '@/types/api'
import { EmptyState } from '@/components/empty-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RuleValueControl } from './rule-value-control'

const OPERATOR_LABELS: Record<string, string> = {
  is: 'is',
  is_not: 'is not',
  contains: 'contains',
  greater_than: 'is more than',
  less_than: 'is less than',
  is_empty: 'is empty',
}

/** A condition with nothing filled in matches nothing and reads as a bug. */
const isIncomplete = (rule: RuleDraft) =>
  rule.operator !== 'is_empty' && (rule.value === null || rule.value === undefined || rule.value === '')

/**
 * The rule set, and a live count of what it catches.
 *
 * The preview is the point of the whole screen. A merchandiser writing
 * "Brand is Nike AND Price is more than 10000" has no way to know whether that
 * means 24 products or none until something tells them — and finding out after
 * saving, when the collection is already on a homepage shelf, is too late. So
 * it runs against unsaved rules, debounced, on every edit.
 */
export function RuleBuilder({
  matchType,
  onMatchTypeChange,
  rules,
  onRulesChange,
}: {
  matchType: MatchType
  onMatchTypeChange: (next: MatchType) => void
  rules: RuleDraft[]
  onRulesChange: (next: RuleDraft[]) => void
}) {
  const { data: fields, isPending } = useRuleFields()

  const [preview, setPreview] = React.useState<RulePreview | null>(null)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [previewing, setPreviewing] = React.useState(false)

  const definitions = React.useMemo(
    () => new Map((fields ?? []).map((field) => [field.field, field])),
    [fields],
  )

  // Serialised, so the effect fires on a value change rather than on every
  // parent render handing back a new array.
  const complete = rules.filter((rule) => !isIncomplete(rule))
  const signature = JSON.stringify([matchType, complete])
  const debounced = useDebouncedValue(signature, 500)

  React.useEffect(() => {
    const [type, ready] = JSON.parse(debounced) as [MatchType, RuleDraft[]]

    if (ready.length === 0) {
      setPreview({ count: 0, sample: [] })
      setPreviewError(null)
      return
    }

    let cancelled = false
    setPreviewing(true)
    collectionsApi
      .preview({ matchType: type, rules: ready, limit: 6 })
      .then((result) => {
        if (cancelled) return
        setPreview(result)
        setPreviewError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setPreview(null)
        setPreviewError(
          error instanceof ApiError
            ? (error.fields?.rules ?? error.message)
            : 'Could not preview these conditions',
        )
      })
      .finally(() => {
        // A stale request must not clear the spinner a newer one turned on.
        if (!cancelled) setPreviewing(false)
      })

    return () => {
      cancelled = true
    }
  }, [debounced])

  const addRule = () => {
    const first = fields?.[0]
    if (!first) return
    onRulesChange([...rules, { field: first.field, operator: first.operators[0], value: null }])
  }

  const updateRule = (index: number, next: Partial<RuleDraft>) =>
    onRulesChange(rules.map((rule, i) => (i === index ? { ...rule, ...next } : rule)))

  if (isPending) {
    return (
      <section className="bg-card space-y-3 rounded-lg border p-5">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-9 w-full" />
        ))}
      </section>
    )
  }

  return (
    <section className="bg-card rounded-lg border">
      <header className="space-y-3 border-b px-5 py-4">
        <Label className="text-sm font-semibold">Products match</Label>
        <RadioGroup
          value={matchType}
          onValueChange={(next) => onMatchTypeChange(next as MatchType)}
          className="flex flex-wrap items-center gap-5"
        >
          <div className="flex items-center gap-1.5">
            <RadioGroupItem value="ALL" id="match-all" />
            <Label htmlFor="match-all" className="text-sm font-normal">
              all conditions
            </Label>
          </div>
          <div className="flex items-center gap-1.5">
            <RadioGroupItem value="ANY" id="match-any" />
            <Label htmlFor="match-any" className="text-sm font-normal">
              any condition
            </Label>
          </div>
        </RadioGroup>
      </header>

      {rules.length === 0 ? (
        <EmptyState
          icon={Filter}
          title="No conditions yet"
          description="A dynamic collection with no conditions matches nothing. Add the first one."
          action={
            <Button type="button" size="sm" onClick={addRule}>
              <Plus className="size-4" />
              Add condition
            </Button>
          }
          className="py-10"
        />
      ) : (
        <ul className="divide-y">
          {rules.map((rule, index) => {
            const definition = definitions.get(rule.field)
            const incomplete = isIncomplete(rule)

            return (
              <li key={index} className="flex flex-wrap items-center gap-2 px-5 py-3">
                <Select
                  value={rule.field}
                  onValueChange={(field) => {
                    const next = definitions.get(field)
                    // Field and operator move together: "Price contains" is not
                    // a thing, and carrying the old value across types would
                    // post a uuid where a number belongs.
                    updateRule(index, {
                      field,
                      operator: next?.operators[0] ?? 'is',
                      value: null,
                    })
                  }}
                >
                  <SelectTrigger size="sm" className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(fields ?? []).map((field) => (
                      <SelectItem key={field.field} value={field.field}>
                        {field.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={rule.operator}
                  onValueChange={(operator) =>
                    updateRule(index, {
                      operator: operator as RuleDraft['operator'],
                      ...(operator === 'is_empty' ? { value: null } : {}),
                    })
                  }
                >
                  <SelectTrigger size="sm" className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(definition?.operators ?? []).map((operator) => (
                      <SelectItem key={operator} value={operator}>
                        {OPERATOR_LABELS[operator] ?? operator}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <RuleValueControl
                  definition={definition}
                  rule={rule}
                  invalid={incomplete}
                  onChange={(value) => updateRule(index, { value })}
                />

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  onClick={() => onRulesChange(rules.filter((_, i) => i !== index))}
                  aria-label="Remove condition"
                >
                  <X className="size-4" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      {rules.length > 0 && (
        <div className="border-t px-5 py-3">
          <Button type="button" variant="outline" size="sm" onClick={addRule}>
            <Plus className="size-4" />
            Add condition
          </Button>
        </div>
      )}

      {/* ─── preview ─────────────────────────────────────────────────────── */}
      <div className="bg-muted/30 space-y-3 border-t px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">
            {previewError ? (
              'Conditions could not be run'
            ) : preview === null ? (
              'Working out what matches…'
            ) : (
              <>
                {formatCount(preview.count)}{' '}
                {preview.count === 1 ? 'product matches' : 'products match'}
              </>
            )}
          </p>
          {previewing && <Spinner />}
        </div>

        {previewError && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{previewError}</AlertDescription>
          </Alert>
        )}

        {complete.length < rules.length && (
          <p className="text-muted-foreground text-xs">
            {rules.length - complete.length} condition
            {rules.length - complete.length === 1 ? ' is' : 's are'} unfinished and not counted yet.
          </p>
        )}

        {preview && preview.count === 0 && !previewError && complete.length > 0 && (
          // A helpful zero, not an empty box. Every wrong rule set looks the
          // same from here, so the message says what to try.
          <p className="text-muted-foreground text-sm">
            Nothing matches all of these. Try switching to <strong>any condition</strong>, widening a
            number, or removing the narrowest condition.
          </p>
        )}

        {preview && preview.sample.length > 0 && (
          <ul className="space-y-1.5">
            {preview.sample.map((product) => (
              <li key={product.id} className="flex items-center gap-3 text-sm">
                {product.coverUrl ? (
                  <img
                    src={product.coverUrl}
                    alt=""
                    loading="lazy"
                    className="bg-muted size-8 shrink-0 rounded border object-cover"
                  />
                ) : (
                  <span className="bg-muted size-8 shrink-0 rounded border" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate">{product.title}</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {product.categoryPath ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        )}

        {preview && preview.count > preview.sample.length && (
          <p className="text-muted-foreground text-xs">
            Showing {preview.sample.length} of {formatCount(preview.count)}.
          </p>
        )}
      </div>
    </section>
  )
}
