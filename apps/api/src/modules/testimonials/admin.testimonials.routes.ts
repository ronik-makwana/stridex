import { Router } from 'express'
import { validate } from '../../middleware/validate.js'
import { reorderSchema, uuidParamSchema } from '../../schemas/admin/common.schema.js'
import { productStatusSchema } from '../../schemas/admin/product.schema.js'
import {
  createTestimonialSchema,
  testimonialListQuerySchema,
  updateTestimonialSchema,
} from '../../schemas/admin/testimonial.schema.js'
import * as controller from './admin.testimonials.controller.js'

/** Mounted behind `authenticate` + `requireAdminSession`. Front-page copy. */
export const adminTestimonialsRouter: Router = Router()

adminTestimonialsRouter.get('/', validate({ query: testimonialListQuerySchema }), controller.list)
adminTestimonialsRouter.post('/', validate({ body: createTestimonialSchema }), controller.create)

// Before `/:id`, or Express reads 'reorder' as an id.
adminTestimonialsRouter.patch('/reorder', validate({ body: reorderSchema }), controller.reorder)

adminTestimonialsRouter.get('/:id', validate({ params: uuidParamSchema }), controller.getOne)
adminTestimonialsRouter.patch(
  '/:id',
  validate({ params: uuidParamSchema, body: updateTestimonialSchema }),
  controller.update,
)
adminTestimonialsRouter.patch(
  '/:id/status',
  validate({ params: uuidParamSchema, body: productStatusSchema }),
  controller.setStatus,
)
adminTestimonialsRouter.delete('/:id', validate({ params: uuidParamSchema }), controller.remove)
