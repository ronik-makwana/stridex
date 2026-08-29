import type { UserRole } from '@shoe/db'

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string
        email: string
        role: UserRole
        sessionId: string
      }
    }
  }
}

export {}
