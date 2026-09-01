import * as React from 'react'
import { toast } from 'sonner'
import { MapPin, Plus } from 'lucide-react'
import { ApiError } from '@/lib/api-client'
import { useAddresses } from '@/features/addresses/queries'
import {
  useCreateAddress,
  useDeleteAddress,
  useSetDefaultAddress,
  useUpdateAddress,
} from '@/features/addresses/mutations'
import type { AddressValues } from '@/features/addresses/schemas'
import { AddressCard } from '@/components/address-card'
import { AddressForm } from '@/components/address-form'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * The address book. Built here rather than waiting for phase 16 because
 * checkout needs somewhere for these to come from — a customer who has never
 * saved one would otherwise meet the address form for the first time with a
 * ten-minute stock hold ticking.
 *
 * The form is the same component checkout will use, so the fields a customer
 * fills in here are the fields they will recognise there.
 */
export default function AddressesPage() {
  const { data: addresses, isPending } = useAddresses()
  const createAddress = useCreateAddress()
  const updateAddress = useUpdateAddress()
  const deleteAddress = useDeleteAddress()
  const setDefault = useSetDefaultAddress()

  /** `null` = closed, `'new'` = the add form, an id = editing that one. */
  const [editing, setEditing] = React.useState<string | null>(null)
  // Two-step, on the card itself: a delete that asks in a modal is a modal for
  // something the customer can simply re-add.
  const [confirming, setConfirming] = React.useState<string | null>(null)

  React.useEffect(() => {
    document.title = 'Addresses · StrideX'
  }, [])

  const rows = addresses ?? []

  const save = async (values: AddressValues, id?: string) => {
    if (id) await updateAddress.mutateAsync({ id, values })
    else await createAddress.mutateAsync(values)
    setEditing(null)
    toast.success(id ? 'Address updated' : 'Address saved')
  }

  const act = async (run: () => Promise<unknown>, failure: string) => {
    try {
      await run()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : failure)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl sm:text-2xl">Addresses</h1>
        {editing === null && rows.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => setEditing('new')}>
            <Plus className="size-4" />
            Add address
          </Button>
        )}
      </div>

      {editing === 'new' && (
        <section className="mt-6 border p-5">
          <h2 className="text-xs tracking-[0.14em] uppercase">New address</h2>
          <AddressForm
            className="mt-4"
            onSubmit={(values) => save(values)}
            onCancel={() => setEditing(null)}
          />
        </section>
      )}

      {isPending ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-52 w-full" />
          <Skeleton className="h-52 w-full" />
        </div>
      ) : rows.length === 0 && editing === null ? (
        <div className="mt-10 flex flex-col items-center border border-dashed px-6 py-16 text-center">
          <MapPin className="text-muted-foreground/40 size-8" />
          <p className="mt-4 text-sm">No addresses saved yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Add one now and checkout will already know where to send things.
          </p>
          <Button variant="accent" className="mt-5" onClick={() => setEditing('new')}>
            <Plus className="size-4" />
            Add your first address
          </Button>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {rows.map((address) =>
            editing === address.id ? (
              <section key={address.id} className="border p-5 sm:col-span-2">
                <h2 className="text-xs tracking-[0.14em] uppercase">Edit address</h2>
                <AddressForm
                  className="mt-4"
                  address={address}
                  onSubmit={(values) => save(values, address.id)}
                  onCancel={() => setEditing(null)}
                />
              </section>
            ) : (
              <AddressCard
                key={address.id}
                address={address}
                actions={
                  confirming === address.id ? (
                    <>
                      <span className="text-muted-foreground">Delete this address?</span>
                      <button
                        type="button"
                        className="text-destructive underline underline-offset-4"
                        onClick={() =>
                          void act(async () => {
                            await deleteAddress.mutateAsync(address.id)
                            setConfirming(null)
                            toast.success('Address deleted')
                          }, 'Could not delete that address')
                        }
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        className="underline underline-offset-4"
                        onClick={() => setConfirming(null)}
                      >
                        Keep
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="underline underline-offset-4"
                        onClick={() => setEditing(address.id)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground underline underline-offset-4"
                        onClick={() => setConfirming(address.id)}
                      >
                        Delete
                      </button>
                      {/* Absent on the default itself: there is nothing to
                          promote it to, and a disabled link reads as broken. */}
                      {!address.isDefault && (
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground underline underline-offset-4"
                          onClick={() =>
                            void act(
                              () => setDefault.mutateAsync(address.id),
                              'Could not set that as default',
                            )
                          }
                        >
                          Make default
                        </button>
                      )}
                    </>
                  )
                }
              />
            ),
          )}
        </div>
      )}
    </div>
  )
}
