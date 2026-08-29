import { Prisma } from '@shoe/db'
import { prisma } from '../../lib/prisma.js'
import { badRequest } from '../../lib/errors.js'
import type { RuleInput, RuleOperator } from '../../schemas/admin/collection.schema.js'

/**
 * Translates a saved or unsaved rule set into one `Prisma.ProductWhereInput`.
 *
 * This file is the whole of phase 7's risk. A collection is only as trustworthy
 * as this translation: a rule that quietly matches nothing looks identical to a
 * collection nobody has filled in, and one that matches too much puts the wrong
 * products in front of customers. So every field validates its own operator and
 * its own value shape, and anything unrecognised is a 400 naming the field
 * rather than a silently dropped condition.
 *
 * It is async because two fields genuinely need a lookup — a category's
 * descendants, and an attribute's type — and pretending otherwise would mean
 * either a synchronous cache that goes stale or a rule that cannot express what
 * merchandisers actually mean.
 */

/** What kind of control the builder should render, and what the value means. */
export type RuleFieldKind =
  | 'category'
  | 'brand'
  | 'money'
  | 'text'
  | 'number'
  | 'date'
  | 'attribute-select'
  | 'attribute-text'
  | 'attribute-number'
  | 'attribute-boolean'

export type RuleFieldDefinition = {
  field: string
  label: string
  kind: RuleFieldKind
  operators: RuleOperator[]
  /** Attribute fields only — the values the picker offers. */
  values?: { id: string; label: string }[]
  /** NUMBER attributes only. */
  unit?: string | null
}

const TEXT_OPERATORS: RuleOperator[] = ['contains', 'is', 'is_not']
const NUMBER_OPERATORS: RuleOperator[] = ['is', 'greater_than', 'less_than']
const CHOICE_OPERATORS: RuleOperator[] = ['is', 'is_not']

/** The fixed half of the field list. Attributes are appended from the table. */
const BASE_FIELDS: RuleFieldDefinition[] = [
  { field: 'category', label: 'Category', kind: 'category', operators: CHOICE_OPERATORS },
  { field: 'brand', label: 'Brand', kind: 'brand', operators: CHOICE_OPERATORS },
  { field: 'price', label: 'Price', kind: 'money', operators: NUMBER_OPERATORS },
  { field: 'title', label: 'Title', kind: 'text', operators: TEXT_OPERATORS },
  { field: 'sku', label: 'SKU', kind: 'text', operators: ['contains', 'is'] },
  { field: 'stock', label: 'Available stock', kind: 'number', operators: NUMBER_OPERATORS },
  { field: 'created_at', label: 'Created', kind: 'date', operators: ['greater_than', 'less_than'] },
]

const ATTRIBUTE_KIND = {
  SELECT: 'attribute-select',
  MULTI_SELECT: 'attribute-select',
  TEXT: 'attribute-text',
  NUMBER: 'attribute-number',
  BOOLEAN: 'attribute-boolean',
} as const

/**
 * Served to the rule builder so it never has to guess which operators a field
 * accepts or what control to draw. A client-side copy would drift the first
 * time an attribute is added and start posting rules the engine rejects.
 */
export async function fieldDefinitions(): Promise<RuleFieldDefinition[]> {
  const attributes = await prisma.attribute.findMany({
    include: { values: { orderBy: [{ position: 'asc' }, { value: 'asc' }] } },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
  })

  return [
    ...BASE_FIELDS,
    ...attributes.map<RuleFieldDefinition>((attribute) => {
      const kind = ATTRIBUTE_KIND[attribute.type]
      return {
        field: `attribute:${attribute.id}`,
        label: attribute.name,
        kind,
        operators:
          kind === 'attribute-select'
            ? [...CHOICE_OPERATORS, 'is_empty']
            : kind === 'attribute-number'
              ? [...NUMBER_OPERATORS, 'is_empty']
              : kind === 'attribute-boolean'
                ? ['is', 'is_empty']
                : [...TEXT_OPERATORS, 'is_empty'],
        values:
          kind === 'attribute-select'
            ? attribute.values.map((value) => ({ id: value.id, label: value.value }))
            : undefined,
        unit: attribute.unit,
      }
    }),
  ]
}

// ─── value coercion ──────────────────────────────────────────────────────────

const label = (field: string) => field.replace(/^attribute:.*/, 'that attribute')

function requireString(rule: RuleInput): string {
  const value = typeof rule.value === 'string' ? rule.value.trim() : ''
  if (!value) {
    throw badRequest(`The ${label(rule.field)} condition has no value`, {
      rules: 'Fill it in, or remove the condition.',
    })
  }
  return value
}

function requireNumber(rule: RuleInput): number {
  const value = typeof rule.value === 'number' ? rule.value : Number(rule.value)
  if (!Number.isFinite(value)) {
    throw badRequest(`The ${label(rule.field)} condition needs a number`, {
      rules: 'Enter a number, or remove the condition.',
    })
  }
  return value
}

function requireDate(rule: RuleInput): Date {
  const value = new Date(String(rule.value ?? ''))
  if (Number.isNaN(value.getTime())) {
    throw badRequest('The Created condition needs a date', {
      rules: 'Pick a date, or remove the condition.',
    })
  }
  return value
}

function assertOperator(rule: RuleInput, allowed: RuleOperator[], fieldLabel: string) {
  if (!allowed.includes(rule.operator)) {
    throw badRequest(`${fieldLabel} cannot be matched with "${rule.operator.replace('_', ' ')}"`, {
      rules: `Try one of: ${allowed.map((op) => op.replace('_', ' ')).join(', ')}.`,
    })
  }
}

// ─── field translations ──────────────────────────────────────────────────────

/**
 * A category rule means the branch, not the single node. "Category is Men" that
 * excluded Men > Running would report zero on a branch holding hundreds, which
 * is never what a merchandiser meant by it.
 */
async function categorySubtree(categoryId: string): Promise<string[]> {
  const all = await prisma.category.findMany({ select: { id: true, parentId: true } })

  const children = new Map<string, string[]>()
  for (const row of all) {
    if (!row.parentId) continue
    children.set(row.parentId, [...(children.get(row.parentId) ?? []), row.id])
  }

  const ids: string[] = []
  const queue = [categoryId]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (ids.includes(current)) continue
    ids.push(current)
    queue.push(...(children.get(current) ?? []))
  }
  return ids
}

/**
 * Available stock is `quantity - reserved_quantity` summed across a product's
 * variants, and Prisma's filter language cannot subtract one column from
 * another — let alone aggregate the result. So this one field resolves to a set
 * of ids first.
 *
 * That is a real cost: it reads one row per product with stock. It is bounded
 * by the catalogue rather than by the page, which is fine at this size and is
 * the thing to revisit first if a dynamic collection ever feels slow.
 */
async function productIdsByStock(operator: RuleOperator, value: number): Promise<string[]> {
  const comparison =
    operator === 'greater_than'
      ? Prisma.sql`> ${value}`
      : operator === 'less_than'
        ? Prisma.sql`< ${value}`
        : Prisma.sql`= ${value}`

  const rows = await prisma.$queryRaw<{ product_id: string }[]>`
    SELECT pv.product_id
    FROM product_variants pv
    LEFT JOIN inventories i ON i.variant_id = pv.id
    WHERE pv.status <> 'ARCHIVED'
    GROUP BY pv.product_id
    HAVING COALESCE(SUM(GREATEST(i.quantity - i.reserved_quantity, 0)), 0) ${comparison}
  `
  return rows.map((row) => row.product_id)
}

async function attributeCondition(
  rule: RuleInput,
  attributeId: string,
): Promise<Prisma.ProductWhereInput> {
  const attribute = await prisma.attribute.findUnique({ where: { id: attributeId } })
  if (!attribute) {
    throw badRequest('One of these conditions points at an attribute that no longer exists', {
      rules: 'Remove the condition and try again.',
    })
  }

  // "Is empty" means the product has no row for this attribute at all — which
  // is a different question from "has a row whose value is blank", and the only
  // one worth asking, since blank rows are rejected on save.
  if (rule.operator === 'is_empty') {
    return { NOT: { attributes: { some: { attributeId } } } }
  }

  const kind = ATTRIBUTE_KIND[attribute.type]

  if (kind === 'attribute-select') {
    assertOperator(rule, CHOICE_OPERATORS, attribute.name)
    const match = { attributes: { some: { attributeId, attributeValueId: requireString(rule) } } }
    return rule.operator === 'is' ? match : { NOT: match }
  }

  if (kind === 'attribute-boolean') {
    assertOperator(rule, ['is'], attribute.name)
    return { attributes: { some: { attributeId, valueBoolean: Boolean(rule.value) } } }
  }

  if (kind === 'attribute-number') {
    assertOperator(rule, NUMBER_OPERATORS, attribute.name)
    const number = requireNumber(rule)
    const filter: Prisma.DecimalNullableFilter =
      rule.operator === 'greater_than'
        ? { gt: number }
        : rule.operator === 'less_than'
          ? { lt: number }
          : { equals: number }
    return { attributes: { some: { attributeId, valueNumber: filter } } }
  }

  assertOperator(rule, TEXT_OPERATORS, attribute.name)
  const text = requireString(rule)
  const match = {
    attributes: {
      some: {
        attributeId,
        valueText:
          rule.operator === 'contains'
            ? { contains: text, mode: 'insensitive' as const }
            : { equals: text, mode: 'insensitive' as const },
      },
    },
  }
  return rule.operator === 'is_not' ? { NOT: match } : match
}

async function translate(rule: RuleInput): Promise<Prisma.ProductWhereInput> {
  if (rule.field.startsWith('attribute:')) {
    return attributeCondition(rule, rule.field.slice('attribute:'.length))
  }

  switch (rule.field) {
    case 'category': {
      assertOperator(rule, CHOICE_OPERATORS, 'Category')
      const ids = await categorySubtree(requireString(rule))
      return rule.operator === 'is'
        ? { categoryId: { in: ids } }
        : { OR: [{ categoryId: null }, { categoryId: { notIn: ids } }] }
    }

    case 'brand': {
      assertOperator(rule, CHOICE_OPERATORS, 'Brand')
      const brandId = requireString(rule)
      return rule.operator === 'is'
        ? { brandId }
        : { OR: [{ brandId: null }, { brandId: { not: brandId } }] }
    }

    case 'price': {
      assertOperator(rule, NUMBER_OPERATORS, 'Price')
      const value = requireNumber(rule)
      // Price lives on variants, so a product matches when *any* of its
      // variants does. "Under ₹5000" should catch a product whose small sizes
      // are cheap, which is what a shopper browsing that collection expects.
      const filter: Prisma.DecimalFilter =
        rule.operator === 'greater_than'
          ? { gt: value }
          : rule.operator === 'less_than'
            ? { lt: value }
            : { equals: value }
      return { variants: { some: { price: filter } } }
    }

    case 'title': {
      assertOperator(rule, TEXT_OPERATORS, 'Title')
      const text = requireString(rule)
      const filter =
        rule.operator === 'contains'
          ? { contains: text, mode: 'insensitive' as const }
          : { equals: text, mode: 'insensitive' as const }
      return rule.operator === 'is_not' ? { NOT: { title: filter } } : { title: filter }
    }

    case 'sku': {
      assertOperator(rule, ['contains', 'is'], 'SKU')
      const text = requireString(rule)
      return {
        variants: {
          some: {
            sku:
              rule.operator === 'contains'
                ? { contains: text, mode: 'insensitive' }
                : { equals: text, mode: 'insensitive' },
          },
        },
      }
    }

    case 'stock': {
      assertOperator(rule, NUMBER_OPERATORS, 'Available stock')
      const ids = await productIdsByStock(rule.operator, requireNumber(rule))
      // An empty match has to stay empty. `{ id: { in: [] } }` matches nothing,
      // which is right — dropping the condition instead would silently widen
      // the collection to everything.
      return { id: { in: ids } }
    }

    case 'created_at': {
      assertOperator(rule, ['greater_than', 'less_than'], 'Created')
      const date = requireDate(rule)
      return { createdAt: rule.operator === 'greater_than' ? { gt: date } : { lt: date } }
    }

    default:
      throw badRequest(`"${rule.field}" is not a field collections can match on`, {
        rules: 'Remove the condition and pick a field from the list.',
      })
  }
}

/**
 * The whole rule set as one `where`. An empty set matches nothing rather than
 * everything: a dynamic collection with no conditions is one somebody has not
 * finished, and quietly resolving it to the entire catalogue is how every
 * product ends up on a homepage shelf labelled "Summer Sale".
 */
export async function buildWhere(
  rules: RuleInput[],
  matchType: 'ALL' | 'ANY',
): Promise<Prisma.ProductWhereInput> {
  if (rules.length === 0) return { id: { in: [] } }

  const conditions = await Promise.all(rules.map(translate))
  return matchType === 'ANY' ? { OR: conditions } : { AND: conditions }
}
