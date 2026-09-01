import { patch, post } from '@/lib/api-client'
import type { ShopUser } from '@/types/api'

type ProfileValues = {
  firstName?: string
  lastName?: string | null
  phone?: string | null
  email?: string
}

export const accountApi = {
  /** Answers with the account, plus whether a new verification link went out. */
  update: (values: ProfileValues) =>
    patch<ShopUser & { verificationEmailSent: boolean }>('/account', values),

  /** 204. Every other session is ended; the one in use survives. */
  changePassword: (currentPassword: string, newPassword: string) =>
    post<void>('/account/password', { currentPassword, newPassword }),
}
