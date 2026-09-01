import { del, get, patch, post } from '@/lib/api-client'
import type { Address } from '@/types/api'
import type { AddressValues } from './schemas'

/** Every one of these is owner-scoped by the token. There is no user id anywhere. */
export const addressesApi = {
  list: () => get<Address[]>('/addresses'),
  create: (body: AddressValues) => post<Address>('/addresses', body),
  update: (id: string, body: Partial<AddressValues>) => patch<Address>(`/addresses/${id}`, body),
  remove: (id: string) => del(`/addresses/${id}`),
  /** Its own route, because the card's "Default" link should not post an address. */
  setDefault: (id: string) => post<Address>(`/addresses/${id}/default`),
}
