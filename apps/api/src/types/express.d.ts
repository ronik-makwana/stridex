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
      /**
       * The bytes as they arrived, kept for `/api/webhooks/*` only — see the
       * `verify` hook in app.ts. A provider signs what it sent, and a signature
       * checked against a re-serialised body proves nothing.
       */
      rawBody?: Buffer
    }
  }
}

export {}
