import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { authenticateStrict } from '../../middleware/auth.js'
import { requireAdminSession } from '../../middleware/requireRole.js'
import { authLimiter, refreshLimiter } from '../../middleware/rateLimit.js'
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
} from '../../schemas/admin/auth.schema.js'
import * as controller from './admin.auth.controller.js'

export const adminAuthRouter: Router = Router()

adminAuthRouter.post('/login', authLimiter, validate({ body: loginSchema }), controller.login)
adminAuthRouter.post('/refresh', refreshLimiter, controller.refresh)
adminAuthRouter.post('/logout', controller.logout)
adminAuthRouter.get('/me', authenticateStrict, requireAdminSession, controller.me)

adminAuthRouter.post(
  '/forgot-password',
  authLimiter,
  validate({ body: forgotPasswordSchema }),
  controller.forgotPassword,
)
adminAuthRouter.post(
  '/reset-password',
  authLimiter,
  validate({ body: resetPasswordSchema }),
  controller.resetPassword,
)
