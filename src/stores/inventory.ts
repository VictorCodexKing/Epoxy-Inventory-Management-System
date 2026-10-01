import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { todayMY } from '@/lib/dates'
import { EPSILON, roundMoney, roundQty } from '@/lib/numbers'
import { compareFefo, expiryBucket, type ExpiryBucket } from '@/lib/stock'
import type { BaseUnit, Batch, Material, StorageLocation } from '@/types/models'
import { useDataStore } from './data'

export interface LowStockAlert {
  material: Material
  total: number
  threshold: number
}

export interface ExpiryAlert {
  batch: Batch
  material: Material | undefined
  location: StorageLocation | undefined
  bucket: Exclude<ExpiryBucket, 'ok' | 'none'>
}

/** Derived, read-only views over the cached collections. No Firestore reads happen here. */
export const useInventoryStore = defineStore('inventory', () => {
  const data = useDataStore()

  // "Today" in Malaysia, refreshed every minute so expiry badges roll over at midnight MYT.
  const today = ref(todayMY())
  setInterval(() => {
    const t = todayMY()
    if (t !== today.value) today.value = t
  }, 60_000)

  const materialsById = computed(() => new Map(data.materials.map((m) => [m.id, m])))
  const locationsById = computed(() => new Map(data.locations.map((l) => [l.id, l])))
  const sortedMaterials = computed(() => [...data.materials].sort((a, b) => a.name.localeCompare(b.name)))
  const sortedLocations = computed(() => [...data.locations].sort((a, b) => a.name.localeCompare(b.name)))
  const activeMaterials = computed(() => sortedMaterials.value.filter((m) => m.active))
  const activeLocations = computed(() => sortedLocations.value.filter((l) => l.active))

  /** Batches that currently hold stock, FEFO-ordered. */
  const stockBatches = computed(() => data.batches.filter((b) => b.quantity > EPSILON).sort(compareFefo))

  const totalsByMaterial = computed(() => {
    const map = new Map<string, number>()
    for (const b of stockBatches.value) map.set(b.materialId, roundQty((map.get(b.materialId) ?? 0) + b.quantity))
    return map
  })

  /** materialId → locationId → quantity */
  const matrix = computed(() => {
    const map = new Map<string, Map<string, number>>()
    for (const b of stockBatches.value) {
      let row = map.get(b.materialId)
      if (!row) map.set(b.materialId, (row = new Map()))
      row.set(b.locationId, roundQty((row.get(b.locationId) ?? 0) + b.quantity))
    }
    return map
  })

  const stockByLocation = computed(() => {
    const map = new Map<string, number>()
    for (const b of stockBatches.value) map.set(b.locationId, roundQty((map.get(b.locationId) ?? 0) + b.quantity))
    return map
  })

  /** Total quantity per base unit (kg, L and pcs are never added together). */
  const totalsByUnit = computed(() => {
    const out: Record<BaseUnit, number> = { kg: 0, L: 0, pcs: 0 }
    for (const [mid, qty] of totalsByMaterial.value) {
      const m = materialsById.value.get(mid)
      if (m) out[m.baseUnit] = roundQty(out[m.baseUnit] + qty)
    }
    return out
  })

  // ── Financial (admin only — lotCosts is empty for normal users) ──
  const unitCostByLot = computed(() => new Map(data.lotCosts.map((c) => [c.id, c.unitCost])))

  function batchValue(b: Batch): number {
    return roundMoney(b.quantity * (unitCostByLot.value.get(b.lotId) ?? 0))
  }

  const valuationByMaterial = computed(() => {
    const map = new Map<string, number>()
    for (const b of stockBatches.value) map.set(b.materialId, (map.get(b.materialId) ?? 0) + b.quantity * (unitCostByLot.value.get(b.lotId) ?? 0))
    for (const [k, v] of map) map.set(k, roundMoney(v))
    return map
  })

  const valuationByLocation = computed(() => {
    const map = new Map<string, number>()
    for (const b of stockBatches.value) map.set(b.locationId, (map.get(b.locationId) ?? 0) + b.quantity * (unitCostByLot.value.get(b.lotId) ?? 0))
    for (const [k, v] of map) map.set(k, roundMoney(v))
    return map
  })

  const totalValuation = computed(() =>
    roundMoney(stockBatches.value.reduce((acc, b) => acc + b.quantity * (unitCostByLot.value.get(b.lotId) ?? 0), 0)),
  )

  // ── Alerts ──
  const lowStock = computed<LowStockAlert[]>(() =>
    activeMaterials.value
      .filter((m) => m.lowStockThreshold > 0)
      .map((m) => ({ material: m, total: totalsByMaterial.value.get(m.id) ?? 0, threshold: m.lowStockThreshold }))
      .filter((a) => a.total < a.threshold - EPSILON)
      .sort((a, b) => a.total / a.threshold - b.total / b.threshold),
  )

  const expiryAlerts = computed<ExpiryAlert[]>(() => {
    const out: ExpiryAlert[] = []
    for (const b of stockBatches.value) {
      const bucket = expiryBucket(b.expiryDate, today.value)
      if (bucket === 'ok' || bucket === 'none') continue
      out.push({ batch: b, material: materialsById.value.get(b.materialId), location: locationsById.value.get(b.locationId), bucket })
    }
    return out // already FEFO-sorted → soonest first
  })

  const expiryCounts = computed(() => {
    const c = { expired: 0, d30: 0, d60: 0, d90: 0 }
    for (const a of expiryAlerts.value) c[a.bucket]++
    return c
  })

  return {
    today,
    materialsById,
    locationsById,
    sortedMaterials,
    sortedLocations,
    activeMaterials,
    activeLocations,
    stockBatches,
    totalsByMaterial,
    totalsByUnit,
    matrix,
    stockByLocation,
    unitCostByLot,
    batchValue,
    valuationByMaterial,
    valuationByLocation,
    totalValuation,
    lowStock,
    expiryAlerts,
    expiryCounts,
  }
})
