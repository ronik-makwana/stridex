import { api, get, post } from '@/lib/api-client'
import type { AuthSession, MessageResponse, RegisterResponse, ShopUser } from '@/types/api'
import type { RegisterValues } from './schemas'

export const authApi = {
  login: (body: { email: string; password: string }) => post<AuthSession>('/auth/login', body),

  register: (body: RegisterValues) => post<RegisterResponse>('/auth/register', body),

  // No `refresh` here on purpose: rotation must be single-flighted, so it lives
  // in api-client as `refreshSession()` and nothing else may call the endpoint.

  me: () => get<ShopUser>('/auth/me'),

  logout: async () => {
    await api.post('/auth/logout')
  },

  verifyEmail: (body: { token: string }) => post<{ user: ShopUser }>('/auth/verify-email', body),

  resendVerification: (body: { email: string }) =>
    post<MessageResponse>('/auth/resend-verification', body),

  forgotPassword: (body: { email: string }) =>
    post<MessageResponse>('/auth/forgot-password', body),

  resetPassword: (body: { token: string; password: string }) =>
    post<MessageResponse>('/auth/reset-password', body),
}
