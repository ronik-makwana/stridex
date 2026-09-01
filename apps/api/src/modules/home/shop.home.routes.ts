import { Router } from 'express'
import * as service from './shop.home.service.js'

/**
 * Public, and the only endpoint on the storefront that is about arrangement
 * rather than about a thing. Everything it returns is shaped like something
 * that already exists — cards, tiles, categories.
 */
export const shopHomeRouter: Router = Router()

shopHomeRouter.get('/', async (_req, res) => {
  res.status(200).json({ data: await service.home() })
})
