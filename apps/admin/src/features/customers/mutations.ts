import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Customer, CustomerStatus } from '@/types/api'
import { customersApi } from './api'
import { customerKeys } from './queries'

export function useSetCustomerStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: CustomerStatus }) =>
      customersApi.setStatus(id, status),
    onSuccess: (customer: Customer) => {
      queryClient.setQueryData(customerKeys.detail(customer.id), customer)
      void queryClient.invalidateQueries({ queryKey: customerKeys.lists() })
    },
  })
}

export function useRevokeCustomerSessions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => customersApi.revokeSessions(id),
    // The sessions panel is the only thing that changed, and it changed to empty.
    onSuccess: (_result, id) =>
      queryClient.invalidateQueries({ queryKey: customerKeys.tab(id, 'sessions') }),
  })
}
