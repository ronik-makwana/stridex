import type { Testimonial } from '@shoe/db'

export function serializeAdminTestimonial(testimonial: Testimonial) {
  return {
    id: testimonial.id,
    quote: testimonial.quote,
    authorName: testimonial.authorName,
    authorRole: testimonial.authorRole,
    rating: testimonial.rating,
    imageUrl: testimonial.imageUrl,
    status: testimonial.status,
    position: testimonial.position,
    createdAt: testimonial.createdAt,
    updatedAt: testimonial.updatedAt,
  }
}

export type AdminTestimonialPayload = ReturnType<typeof serializeAdminTestimonial>
