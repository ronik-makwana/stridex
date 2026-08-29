import * as React from 'react'
import { Lock, Unlock } from 'lucide-react'
import { slugify } from '@/lib/slug'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type SlugFieldProps = {
  id?: string
  value: string
  onChange: (value: string) => void
  /** The field the slug follows while it is unlocked — usually the name. */
  source: string
  /** Edit forms start locked: a live slug is a URL somebody may have shared. */
  initiallyLocked?: boolean
  error?: string
  disabled?: boolean
  label?: string
  hint?: string
}

/**
 * Auto-fills from `source` until it is unlocked and edited, then stops
 * following. The lock is the whole point: on a new brand nobody wants to type
 * the slug, and on an existing one nobody wants it changing under them because
 * a typo in the name got fixed.
 */
export function SlugField({
  id = 'slug',
  value,
  onChange,
  source,
  initiallyLocked = false,
  error,
  disabled = false,
  label = 'Slug',
  hint,
}: SlugFieldProps) {
  const [locked, setLocked] = React.useState(initiallyLocked)
  // Once someone types their own slug, the name no longer drives it — even
  // after re-locking, which only stops further edits.
  const [manual, setManual] = React.useState(initiallyLocked)

  const onChangeRef = React.useRef(onChange)
  React.useEffect(() => {
    onChangeRef.current = onChange
  })

  React.useEffect(() => {
    if (manual) return
    const derived = slugify(source)
    onChangeRef.current(derived)
  }, [source, manual])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        <button
          type="button"
          onClick={() => {
            setLocked((current) => {
              // Unlocking is the moment the operator takes ownership of it.
              if (current) setManual(true)
              return !current
            })
          }}
          disabled={disabled}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors disabled:opacity-50"
        >
          {locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
          {locked ? 'Locked' : 'Editing'}
        </button>
      </div>

      <Input
        id={id}
        value={value}
        readOnly={locked}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => {
          setManual(true)
          // Type freely; normalise on the way out so the value posted always
          // satisfies the server's pattern.
          onChange(event.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))
        }}
        onBlur={(event) => onChange(slugify(event.target.value))}
        className={cn('font-mono text-sm', locked && 'bg-muted/50 cursor-default')}
      />

      {error ? (
        <p className="text-destructive text-sm">{error}</p>
      ) : (
        hint && <p className="text-muted-foreground text-xs">{hint}</p>
      )}
    </div>
  )
}
