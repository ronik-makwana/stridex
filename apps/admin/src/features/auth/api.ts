import { api, get, post } from '@/lib/api-client'
import type { AdminUser, AuthSession } from '@/types/api'

export const authApi = {
  login: (body: { email: string; password: string }) => post<AuthSession>('/auth/login', body),

  // No `refresh` here on purpose: rotation must be single-flighted, so it lives
  // in api-client as `refreshSession()` and nothing else may call the endpoint.

  me: () => get<AdminUser>('/auth/me'),

  logout: async () => {
    await api.post('/auth/logout')
  },

  forgotPassword: (body: { email: string }) =>
    post<{ message: string }>('/auth/forgot-password', body),

  resetPassword: (body: { token: string; password: string }) =>
    post<{ message: string }>('/auth/reset-password', body),
}
