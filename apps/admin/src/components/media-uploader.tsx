import * as React from 'react'
import { ImagePlus, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  uploadsApi,
  type UploadFolder,
} from '@/features/uploads/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'

type MediaUploaderProps = {
  /** The bucket folder the file lands in — `stridex/<folder>/<uuid>.<ext>`. */
  folder: UploadFolder
  /** The stored public URL, or null. */
  value: string | null
  onChange: (url: string | null) => void
  label?: string
  hint?: string
  error?: string
  disabled?: boolean
  /** Rendered in the empty slot before anything is uploaded. */
  fallback?: React.ReactNode
}

const formatSize = (bytes: number) => `${Math.round(bytes / 1024 / 1024)}MB`

/**
 * Uploads on selection rather than on submit. The form then only ever carries
 * a URL, so a slow upload never blocks Save and a failed one cannot leave the
 * entity pointing at an object that was never stored.
 *
 * The trade is orphaned objects when someone uploads and then cancels; the API
 * sweeps those when the logo is replaced or the brand is deleted.
 */
export function MediaUploader({
  folder,
  value,
  onChange,
  label = 'Image',
  hint,
  error,
  disabled = false,
  fallback,
}: MediaUploaderProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = React.useState(false)
  const [dragging, setDragging] = React.useState(false)
  const [failed, setFailed] = React.useState<string | null>(null)

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setFailed(null)

    // Checked here as well as on the server: a 5MB round trip just to be told
    // it was too big is a slow way to learn it.
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setFailed('Use a PNG, JPEG, WebP, GIF or SVG')
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setFailed(`That image is over ${formatSize(MAX_UPLOAD_BYTES)}`)
      return
    }

    setUploading(true)
    try {
      const uploaded = await uploadsApi.upload(folder, file)
      onChange(uploaded.url)
    } catch (uploadError) {
      const message =
        uploadError instanceof ApiError
          ? (uploadError.fields?.file ?? uploadError.message)
          : 'The upload failed. Try again.'
      setFailed(message)
      toast.error(message)
    } finally {
      setUploading(false)
      // Reset the input, or picking the same file twice fires no change event.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const pick = () => inputRef.current?.click()
  const message = error ?? failed

  return (
    <div className="space-y-2">
      <Label>{label}</Label>

      <div
        onDragOver={(event) => {
          if (disabled || uploading) return
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          if (disabled || uploading) return
          event.preventDefault()
          setDragging(false)
          void handleFile(event.dataTransfer.files[0])
        }}
        className={cn(
          'flex items-center gap-4 rounded-lg border border-dashed p-3 transition-colors',
          dragging && 'border-ring bg-accent/40',
          message && 'border-destructive/50',
        )}
      >
        <div className="bg-muted text-muted-foreground relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border">
          {value ? (
            <img src={value} alt="" className="size-full object-contain" />
          ) : (
            (fallback ?? <ImagePlus className="size-5" aria-hidden />)
          )}
          {uploading && (
            <span className="bg-background/70 absolute inset-0 flex items-center justify-center">
              <Spinner />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={pick}
              disabled={disabled || uploading}
            >
              <Upload className="size-4" />
              {value ? 'Replace' : 'Upload image'}
            </Button>

            {value && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFailed(null)
                  onChange(null)
                }}
                disabled={disabled || uploading}
              >
                <Trash2 className="size-4" />
                Remove
              </Button>
            )}
          </div>

          {message ? (
            <p className="text-destructive text-xs">{message}</p>
          ) : (
            <p className="text-muted-foreground text-xs">
              {hint ?? `PNG, JPEG, WebP, GIF or SVG, up to ${formatSize(MAX_UPLOAD_BYTES)}.`}
            </p>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />
      </div>
    </div>
  )
}
