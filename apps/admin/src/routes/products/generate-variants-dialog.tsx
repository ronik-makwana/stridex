import * as React from 'react'
import { AlertCircle, Check, Sparkles } from 'lucide-react'
import { ApiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import type { GenerateValues } from '@/features/products/schemas'
import type { GenerateResult, ProductVariantOptionRow } from '@/types/api'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  options: ProductVariantOptionRow[]
  /** Which values are ticked, per option, in the panel above. */
  selection: Record<string, string[]>
  onGenerate: (values: GenerateValues) => Promise<GenerateResult>
}

/**
 * Two steps, always. The first call is a dry run that reports "adds 3 · keeps 6
 * · removes 0"; nothing is written until the operator has read that line and
 * confirmed it.
 *
 * This is not caution for its own sake. Generate is additive, so the failure
 * mode is not a wrong SKU — it is six existing variants, each with a price
 * somebody set by hand and stock somebody counted, disappearing because a value
 * got unticked. That deserves to be shown before it happens, not after.
 */
export function GenerateVariantsDialog({
  open,
  onOpenChange,
  options,
  selection,
  onGenerate,
}: Props) {
  const [price, setPrice] = React.useState('')
  const [compareAtPrice, setCompareAtPrice] = React.useState('')
  const [quantity, setQuantity] = React.useState('0')
  const [skuPattern, setSkuPattern] = React.useState('')
  const [removeUnselected, setRemoveUnselected] = React.useState(false)

  const [preview, setPreview] = React.useState<GenerateResult | null>(null)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // A dialog that remembers last time's preview would show counts against a
  // selection that has since changed.
  React.useEffect(() => {
    if (!open) return
    setPreview(null)
    setError(null)
  }, [open])

  // Any change to the inputs invalidates the preview it was computed from.
  React.useEffect(() => {
    setPreview(null)
  }, [price, compareAtPrice, quantity, skuPattern, removeUnselected])

  const payload = (dryRun: boolean): GenerateValues => ({
    dryRun,
    options: options.map((option) => ({
      variantOptionId: option.variantOptionId,
      valueIds: selection[option.variantOptionId] ?? [],
    })),
    defaults: {
      price: price.trim(),
      compareAtPrice: compareAtPrice.trim() || null,
      quantity: Number(quantity) || 0,
      skuPattern: skuPattern.trim() || null,
    },
    removeUnselected,
  })

  const run = async (dryRun: boolean) => {
    setError(null)
    setPending(true)
    try {
      const result = await onGenerate(payload(dryRun))
      if (result.applied) {
        onOpenChange(false)
        return
      }
      setPreview(result)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (err.reason ?? err.message)
          : 'Something went wrong. Try again in a moment.',
      )
    } finally {
      setPending(false)
    }
  }

  const emptyOption = options.find((option) => (selection[option.variantOptionId] ?? []).length === 0)
  const combinations = options.reduce(
    (count, option) => count * Math.max((selection[option.variantOptionId] ?? []).length, 0),
    1,
  )

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="flex max-h-[calc(100svh-6rem)] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b py-4 pr-12 pl-6">
          <DialogTitle>Generate variants</DialogTitle>
          <DialogDescription>
            Existing combinations keep their SKU, price and stock. Only new ones are created.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {emptyOption ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>
                Tick at least one value under {emptyOption.name} before generating.
              </AlertDescription>
            </Alert>
          ) : (
            <p className="text-muted-foreground text-sm">
              {options
                .map(
                  (option) =>
                    `${option.name}: ${(selection[option.variantOptionId] ?? []).length}`,
                )
                .join(' × ')}{' '}
              — {combinations} {combinations === 1 ? 'combination' : 'combinations'}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="generate-price">Price</Label>
              <Input
                id="generate-price"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                inputMode="decimal"
                placeholder="8999.00"
              />
              <p className="text-muted-foreground text-xs">Applied to new variants only.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="generate-compare">Compare at price</Label>
              <Input
                id="generate-compare"
                value={compareAtPrice}
                onChange={(event) => setCompareAtPrice(event.target.value)}
                inputMode="decimal"
                placeholder="Optional"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="generate-quantity">Opening stock</Label>
              <Input
                id="generate-quantity"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                inputMode="numeric"
              />
              <p className="text-muted-foreground text-xs">
                Written to the ledger as an adjustment, like every other stock move.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="generate-sku">SKU pattern</Label>
              <Input
                id="generate-sku"
                value={skuPattern}
                onChange={(event) => setSkuPattern(event.target.value)}
                placeholder={`{brand}-${options.map((option) => `{${option.slug}}`).join('-')}`}
                spellCheck={false}
                className="font-mono text-xs"
              />
              <p className="text-muted-foreground text-xs">
                Tokens: {'{brand}'}, {'{title}'}
                {options.map((option) => `, {${option.slug}}`).join('')}. Leave empty for the
                default.
              </p>
            </div>
          </div>

          <label className="flex items-start gap-2.5">
            <Checkbox
              checked={removeUnselected}
              onCheckedChange={(checked) => setRemoveUnselected(checked === true)}
              className="mt-0.5"
            />
            <span className="text-sm">
              Delete variants outside this selection
              <span className="text-muted-foreground block text-xs">
                Off by default. Unticking a value should not destroy the variant that was holding
                its stock. Anything that has sold is never deleted.
              </span>
            </span>
          </label>

          {error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {preview && (
            <div className="space-y-3 rounded-lg border p-4">
              <p className="text-sm font-medium">
                Adds {preview.added} · keeps {preview.kept} · removes {preview.removed}
              </p>

              {preview.blocked.length > 0 && (
                <Alert>
                  <AlertCircle />
                  <AlertDescription>
                    {preview.blocked.map((row) => row.sku).join(', ')}{' '}
                    {preview.blocked.length === 1 ? 'is' : 'are'} outside the selection but{' '}
                    {preview.blocked.length === 1 ? 'has' : 'have'} sold, so{' '}
                    {preview.blocked.length === 1 ? 'it stays' : 'they stay'}.
                  </AlertDescription>
                </Alert>
              )}

              <ul className="max-h-56 space-y-1 overflow-y-auto">
                {preview.preview.map((row) => (
                  <li
                    key={row.key}
                    className={cn(
                      'flex items-center justify-between gap-3 rounded px-2 py-1 text-sm',
                      row.isNew ? 'bg-accent/60' : 'text-muted-foreground',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {row.isNew ? (
                        <Sparkles className="size-3.5 shrink-0" aria-label="New" />
                      ) : (
                        <Check className="size-3.5 shrink-0" aria-label="Kept" />
                      )}
                      <span className="truncate">
                        {row.options.map((option) => option.value).join(' / ')}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-xs">{row.sku}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          {preview ? (
            <Button onClick={() => void run(false)} disabled={pending || preview.added + preview.removed === 0}>
              {pending && <Spinner />}
              {preview.added + preview.removed === 0
                ? 'Nothing to change'
                : `Generate ${preview.added} · remove ${preview.removed}`}
            </Button>
          ) : (
            <Button onClick={() => void run(true)} disabled={pending || Boolean(emptyOption) || !price.trim()}>
              {pending && <Spinner />}
              Preview
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
