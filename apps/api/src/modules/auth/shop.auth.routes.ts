import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { authenticateStrict } from '../../middleware/auth.js'
import { requireCustomerSession } from '../../middleware/requireRole.js'
import { authLimiter, refreshLimiter } from '../../middleware/rateLimit.js'
import {
  registerSchema,
  resendVerificationSchema,
  shopForgotPasswordSchema,
  shopLoginSchema,
  shopResetPasswordSchema,
  verifyEmailSchema,
} from '../../schemas/shop/auth.schema.js'
import * as controller from './shop.auth.controller.js'

export const shopAuthRouter: Router = Router()

// `authLimiter` keys on IP *and* email, so signup spray from one address is
// capped without one attacker being able to lock a real customer out.
shopAuthRouter.post('/register', authLimiter, validate({ body: registerSchema }), controller.register)
shopAuthRouter.post('/login', authLimiter, validate({ body: shopLoginSchema }), controller.login)
shopAuthRouter.post('/refresh', refreshLimiter, controller.refresh)
shopAuthRouter.post('/logout', controller.logout)

// Strict: `/me` is where a suspended account or a revoked session has to be
// noticed, so it pays the one indexed read the stateless guard skips.
shopAuthRouter.get('/me', authenticateStrict, requireCustomerSession, controller.me)

// Public: the link opens in whatever browser owns the inbox, which is routinely
// not the one that signed up.
shopAuthRouter.post(
  '/verify-email',
  authLimiter,
  validate({ body: verifyEmailSchema }),
  controller.verifyEmail,
)
shopAuthRouter.post(
  '/resend-verification',
  authLimiter,
  validate({ body: resendVerificationSchema }),
  controller.resendVerification,
)

shopAuthRouter.post(
  '/forgot-password',
  authLimiter,
  validate({ body: shopForgotPasswordSchema }),
  controller.forgotPassword,
)
shopAuthRouter.post(
  '/reset-password',
  authLimiter,
  validate({ body: shopResetPasswordSchema }),
  controller.resetPassword,
)
