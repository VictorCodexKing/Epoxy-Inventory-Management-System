import type { Material, PackagingUnit } from '@/types/models'
import { formatNumber, UNIT_LABELS } from './format'
import { EPSILON, isPositive, roundQty } from './numbers'

/**
 * Size of one package in the material's base unit, following nested packaging
 * (e.g. Box → 12 × Can → 1 L = 12 L). Returns null for unknown ids or cyclic/invalid definitions.
 * Never converts between kg and L: a package always resolves to the material's own base unit.
 */
export function packageSize(packaging: PackagingUnit[], packagingId: string | null): number | null {
  if (packagingId === null) return 1
  const byId = new Map(packaging.map((p) => [p.id, p]))
  let size = 1
  let current = byId.get(packagingId)
  const seen = new Set<string>()
  while (current) {
    if (seen.has(current.id)) return null // cycle
    seen.add(current.id)
    if (!isPositive(current.contains)) return null
    size *= current.contains
    if (current.of === 'base') return roundQty(size)
    current = byId.get(current.of)
  }
  return null
}

export function materialPackageSize(material: Material, packagingId: string | null): number | null {
  return packageSize(material.packaging, packagingId)
}

/** Validation errors for a material's packaging list (empty array = valid). */
export function validatePackaging(packaging: PackagingUnit[]): string[] {
  const errors: string[] = []
  const names = new Set<string>()
  const ids = new Set(packaging.map((p) => p.id))
  for (const p of packaging) {
    const label = p.name.trim() || 'Unnamed packaging'
    if (!p.name.trim()) errors.push('Every packaging level needs a name.')
    const key = p.name.trim().toLowerCase()
    if (key && names.has(key)) errors.push(`Packaging name "${p.name.trim()}" is used twice.`)
    names.add(key)
    if (!isPositive(p.contains)) errors.push(`${label}: quantity must be greater than 0.`)
    if (p.of !== 'base' && !ids.has(p.of)) errors.push(`${label}: refers to a packaging level that no longer exists.`)
    if (p.of === p.id) errors.push(`${label}: cannot contain itself.`)
    else if (isPositive(p.contains) && packageSize(packaging, p.id) === null) {
      errors.push(`${label}: packaging levels form a loop.`)
    }
  }
  return [...new Set(errors)]
}

/** Human description, e.g. `12 × Can (1 L each) = 12 L` */
export function describePackaging(material: Pick<Material, 'packaging' | 'baseUnit'>, p: PackagingUnit): string {
  const unit = UNIT_LABELS[material.baseUnit]
  const total = packageSize(material.packaging, p.id)
  if (p.of === 'base') return `${formatNumber(p.contains)} ${unit}`
  const child = material.packaging.find((c) => c.id === p.of)
  const childSize = child ? packageSize(material.packaging, child.id) : null
  if (!child || childSize === null || total === null) return 'Invalid definition'
  return `${formatNumber(p.contains)} × ${child.name} (${formatNumber(childSize)} ${unit}) = ${formatNumber(total)} ${unit}`
}

/** Packaging options sorted largest first, with their resolved sizes. Invalid levels are skipped. */
export function packagingOptions(material: Pick<Material, 'packaging'>): Array<PackagingUnit & { size: number }> {
  return material.packaging
    .map((p) => ({ ...p, size: packageSize(material.packaging, p.id) }))
    .filter((p): p is PackagingUnit & { size: number } => p.size !== null)
    .sort((a, b) => b.size - a.size)
}

/**
 * Greedy physical breakdown of a base quantity into whole packages, largest first.
 * 430 kg with Drum(200) & Pail(20) → "2 Drum + 1 Pail + 10 kg".
 * Returns null when the material has no packaging or the quantity is below the smallest package.
 */
export function packagingBreakdown(material: Material, quantity: number): string | null {
  const options = packagingOptions(material)
  if (options.length === 0 || quantity <= EPSILON) return null
  let remaining = quantity
  const parts: string[] = []
  for (const opt of options) {
    const count = Math.floor((remaining + EPSILON) / opt.size)
    if (count > 0) {
      parts.push(`${formatNumber(count)} ${opt.name}`)
      remaining = roundQty(remaining - count * opt.size)
    }
  }
  if (parts.length === 0) return null
  if (remaining > EPSILON) parts.push(`${formatNumber(remaining)} ${UNIT_LABELS[material.baseUnit]}`)
  return parts.join(' + ')
}

/** Label for a packaging id on a line: `Drum` or the base unit. */
export function packagingLabel(material: Material | undefined, packagingId: string | null): string {
  if (!material) return '—'
  if (packagingId === null) return UNIT_LABELS[material.baseUnit]
  return material.packaging.find((p) => p.id === packagingId)?.name ?? UNIT_LABELS[material.baseUnit]
}
