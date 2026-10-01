import { nowISO } from '@/lib/dates'
import { isNonNegative, roundQty } from '@/lib/numbers'
import { validatePackaging } from '@/lib/packaging'
import type { Actor, BaseUnit, LocationType, Material, PackagingUnit, StorageLocation } from '@/types/models'
import { AppError, type DocumentStore } from '../backend/types'
import { assertAdmin, optionalText, requireText } from './common'

export interface MaterialInput {
  code: string
  name: string
  baseUnit: BaseUnit
  packaging: PackagingUnit[]
  lowStockThreshold: number
  notes: string
  active: boolean
}

const BASE_UNITS: BaseUnit[] = ['kg', 'L', 'pcs']

export interface CatalogContext {
  /** Current materials/locations from the client cache, for uniqueness checks (Firestore has no unique index). */
  existing: Array<{ id: string; name: string; code?: string }>
  /** True when any batch (even emptied) references this record — locks the base unit. */
  hasStockHistory?: boolean
  /** Quantity currently held — blocks deactivating a location that still holds stock. */
  currentStock?: number
}

export async function saveMaterial(
  store: DocumentStore,
  actor: Actor,
  id: string | null,
  input: MaterialInput,
  ctx: CatalogContext,
): Promise<string> {
  const name = requireText(input.name, 'Material name', 120)
  const code = requireText(input.code, 'Material code', 30).toUpperCase()
  if (!BASE_UNITS.includes(input.baseUnit)) throw new AppError('Select a base unit.')
  if (!isNonNegative(input.lowStockThreshold)) throw new AppError('Low-stock threshold cannot be negative.')
  const packaging = input.packaging.map((p) => ({ id: p.id, name: p.name.trim(), contains: p.contains, of: p.of }))
  const pkgErrors = validatePackaging(packaging)
  if (pkgErrors.length) throw new AppError(pkgErrors[0]!)
  const others = ctx.existing.filter((e) => e.id !== id)
  if (others.some((e) => e.name.trim().toLowerCase() === name.toLowerCase())) {
    throw new AppError(`A material named "${name}" already exists.`)
  }
  if (others.some((e) => (e.code ?? '').toUpperCase() === code)) {
    throw new AppError(`Material code "${code}" is already in use.`)
  }
  const docId = id ?? store.newId('materials')
  await store.runTransaction(async (tx) => {
    await assertAdmin(tx, actor)
    const now = nowISO()
    const fields = {
      code,
      name,
      baseUnit: input.baseUnit,
      packaging,
      lowStockThreshold: roundQty(input.lowStockThreshold),
      notes: optionalText(input.notes, 'Notes'),
      active: input.active,
      updatedAt: now,
    }
    if (id) {
      const existing = await tx.get<Material>('materials', id)
      if (!existing) throw new AppError('Material not found.')
      if (existing.baseUnit !== input.baseUnit && ctx.hasStockHistory) {
        throw new AppError(
          `The base unit cannot be changed from ${existing.baseUnit} to ${input.baseUnit} because stock has already been recorded in ${existing.baseUnit}. Create a new material instead.`,
        )
      }
      tx.update('materials', id, fields)
    } else {
      tx.set('materials', docId, { ...fields, createdAt: now })
    }
  })
  return docId
}

export interface LocationInput {
  name: string
  type: LocationType
  address: string
  active: boolean
}

export async function saveLocation(
  store: DocumentStore,
  actor: Actor,
  id: string | null,
  input: LocationInput,
  ctx: CatalogContext,
): Promise<string> {
  const name = requireText(input.name, 'Location name', 80)
  if (input.type !== 'internal' && input.type !== 'vendor') throw new AppError('Select a location type.')
  if (ctx.existing.filter((e) => e.id !== id).some((e) => e.name.trim().toLowerCase() === name.toLowerCase())) {
    throw new AppError(`A location named "${name}" already exists.`)
  }
  if (id && !input.active && (ctx.currentStock ?? 0) > 0) {
    throw new AppError(`"${name}" still holds stock. Transfer it out before deactivating the location.`)
  }
  const docId = id ?? store.newId('locations')
  await store.runTransaction(async (tx) => {
    await assertAdmin(tx, actor)
    const now = nowISO()
    const fields = {
      name,
      type: input.type,
      address: optionalText(input.address, 'Address', 300),
      active: input.active,
      updatedAt: now,
    }
    if (id) {
      const existing = await tx.get<StorageLocation>('locations', id)
      if (!existing) throw new AppError('Location not found.')
      tx.update('locations', id, fields)
    } else {
      tx.set('locations', docId, { ...fields, createdAt: now })
    }
  })
  return docId
}
