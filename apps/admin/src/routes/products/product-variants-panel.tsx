import * as React from 'react'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import {
  useBulkVariants,
  useDeleteVariant,
  useGenerateVariants,
} from '@/features/products/mutations'
import type { Product } from '@/types/api'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { GenerateVariantsDialog } from './generate-variants-dialog'
import { VariantGrid } from './variant-grid'
import {
  VariantOptionsPicker,
  defaultValueIds,
  type Selection,
} from './variant-options-picker'

/**
 * Options, generate, and the grid — one panel, because they are one workflow.
 * Pick Colour and Size, tick the values this product actually stocks, generate,
 * then price the rows.
 *
 * Generate reads options from the server, so an unsaved change has to be
 * written first. That save is done for the operator rather than demanded of
 * them: being told "save before you can generate" is a step nobody would
 * choose, and the button already knows exactly what needs saving.
 */
export function ProductVariantsPanel({
  product,
  variantOptionIds,
  onOptionsChange,
  hasUnsavedOptions,
  onSaveOptions,
  initialSelection,
}: {
  product: Product
  variantOptionIds: string[]
  onOptionsChange: (next: string[]) => void
  hasUnsavedOptions: boolean
  /** Saves the product so generate has options to match against. */
  onSaveOptions: () => Promise<void>
  /** Carried over from the create screen, so its ticks are not thrown away. */
  initialSelection?: Selection
}) {
  const generate = useGenerateVariants(product.id)
  const bulkVariants = useBulkVariants(product.id)
  const deleteVariant = useDeleteVariant(product.id)

  const [generating, setGenerating] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [selection, setSelection] = React.useState<Selection>(initialSelection ?? {})

  const variants = React.useMemo(() => product.variants ?? [], [product.variants])
  const optionRows = React.useMemo(
    () => (product.variantOptions ?? []).slice().sort((a, b) => a.position - b.position),
    [product.variantOptions],
  )

  /**
   * Fills in any option the operator has not touched yet. Values already
   * carrying a variant win — generate is additive, so the safe default is
   * "everything that exists stays" — and an option with no variants falls back
   * to the same small-list rule the picker uses when one is added.
   *
   * The updater returns `current` unchanged when nothing moved, or every render
   * of the parent would hand back a fresh object and loop.
   */
  React.useEffect(() => {
    setSelection((current) => {
      const next: Selection = {}
      for (const optionId of variantOptionIds) {
        if (current[optionId]) {
          next[optionId] = current[optionId]
          continue
        }
        const inUse = [
          ...new Set(
            variants.flatMap((variant) =>
              variant.options
                .filter((row) => row.variantOptionId === optionId)
                .map((row) => row.optionValueId),
            ),
          ),
        ]
        const definition = optionRows.find((row) => row.variantOptionId === optionId)
        next[optionId] = inUse.length > 0 ? inUse : defaultValueIds(definition?.values)
      }

      const unchanged =
        Object.keys(next).length === Object.keys(current).length &&
        Object.keys(next).every((key) => current[key] === next[key])
      return unchanged ? current : next
    })
  }, [variantOptionIds, variants, optionRows])

  const openGenerate = async () => {
    if (!hasUnsavedOptions) {
      setGenerating(true)
      return
    }

    setSaving(true)
    try {
      await onSaveOptions()
      setGenerating(true)
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Could not save the options. Try again.',
      )
    } finally {
      setSaving(false)
    }
  }

  /** Generate matches on stored ids, so the dialog reads the saved options. */
  const savedOptions = optionRows

  // Shown next to the button rather than only inside the dialog: an option with
  // nothing ticked generates nothing, and finding that out after opening a
  // dialog is one click too late.
  const combinations = variantOptionIds.reduce(
    (count, optionId) => count * (selection[optionId] ?? []).length,
    variantOptionIds.length > 0 ? 1 : 0,
  )
  const untickedOption = optionRows.find(
    (row) => (selection[row.variantOptionId] ?? []).length === 0,
  )

  return (
    <VariantOptionsPicker
      variantOptionIds={variantOptionIds}
      onOptionsChange={onOptionsChange}
      selection={selection}
      onSelectionChange={setSelection}
      removeBlockedReason={
        variants.length > 0
          ? 'Delete the variants built on it first — they carry its values'
          : undefined
      }
    >
      {variantOptionIds.length > 0 && (
        <div className="border-t px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void openGenerate()}
              disabled={saving}
            >
              {saving ? <Spinner /> : <Sparkles className="size-4" />}
              Generate variants
            </Button>
            <span className="text-muted-foreground text-xs">
              {untickedOption
                ? `Tick at least one value under ${untickedOption.name}`
                : `${combinations} ${combinations === 1 ? 'combination' : 'combinations'} selected`}
            </span>
          </div>
          {hasUnsavedOptions && (
            <p className="text-muted-foreground mt-2 text-xs">
              Your option changes are saved automatically when you generate.
            </p>
          )}
        </div>
      )}

      {variants.length > 0 && (
        <div className="border-t px-5 py-4">
          <VariantGrid
            product={product}
            variants={variants}
            isSaving={bulkVariants.isPending}
            onSave={(values) => bulkVariants.mutateAsync(values)}
            onDelete={(variantId) => deleteVariant.mutateAsync(variantId)}
          />
        </div>
      )}

      <GenerateVariantsDialog
        open={generating}
        onOpenChange={setGenerating}
        options={savedOptions}
        selection={selection}
        onGenerate={(values) => generate.mutateAsync(values)}
      />
    </VariantOptionsPicker>
  )
}
