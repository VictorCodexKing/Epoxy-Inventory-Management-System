import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef, type ShallowRef } from 'vue'
import { getBackend } from '@/services/backend'
import type { CollectionName, CollectionQuery, Unsubscribe } from '@/services/backend/types'
import type {
  Batch,
  LotCost,
  Material,
  Movement,
  PurchaseOrder,
  Sale,
  StorageLocation,
  Transfer,
  UserProfile,
} from '@/types/models'

/** How many recent ledger entries the dashboard keeps live (bounded to protect the free-tier read quota). */
export const RECENT_MOVEMENTS_LIMIT = 60

/**
 * Client-side cache of Firestore collections, kept fresh by realtime listeners.
 * Each collection is fetched once per session; afterwards only changed documents are transferred,
 * which keeps reads far below the Spark (free) plan quota.
 *
 * Normal users only subscribe to cost-free collections — they never receive financial documents.
 */
export const useDataStore = defineStore('data', () => {
  const materials = shallowRef<Material[]>([])
  const locations = shallowRef<StorageLocation[]>([])
  const batches = shallowRef<Batch[]>([])
  const lotCosts = shallowRef<LotCost[]>([])
  const purchaseOrders = shallowRef<PurchaseOrder[]>([])
  const sales = shallowRef<Sale[]>([])
  const transfers = shallowRef<Transfer[]>([])
  const movements = shallowRef<Movement[]>([])
  const users = shallowRef<UserProfile[]>([])

  const loaded = reactive<Partial<Record<CollectionName, boolean>>>({})
  const errors = reactive<Partial<Record<CollectionName, string>>>({})
  const running = ref(false)
  const adminScope = ref(false)
  let subs: Unsubscribe[] = []

  function bind<T extends { id: string }>(name: CollectionName, target: ShallowRef<T[]>, query?: CollectionQuery) {
    const { store } = getBackend()
    loaded[name] = false
    subs.push(
      store.subscribeCollection<T>(
        name,
        (docs) => {
          target.value = docs
          loaded[name] = true
          delete errors[name]
        },
        (err) => {
          errors[name] = err.message
          loaded[name] = true
        },
        query,
      ),
    )
  }

  function start(isAdmin: boolean) {
    stop()
    running.value = true
    adminScope.value = isAdmin
    bind('materials', materials)
    bind('locations', locations)
    bind('batches', batches)
    if (isAdmin) {
      bind('lotCosts', lotCosts)
      bind('purchaseOrders', purchaseOrders)
      bind('sales', sales)
      bind('transfers', transfers)
      bind('users', users)
      bind('movements', movements, { orderBy: 'createdAt', direction: 'desc', limit: RECENT_MOVEMENTS_LIMIT })
    }
  }

  function stop() {
    subs.forEach((off) => off())
    subs = []
    running.value = false
    adminScope.value = false
    for (const key of Object.keys(loaded) as CollectionName[]) delete loaded[key]
    for (const key of Object.keys(errors) as CollectionName[]) delete errors[key]
    for (const r of [materials, locations, batches, lotCosts, purchaseOrders, sales, transfers, movements, users]) {
      ;(r as ShallowRef<unknown[]>).value = []
    }
  }

  /** True once the collections needed by the current role have produced their first snapshot. */
  const ready = computed(() => {
    const base: CollectionName[] = ['materials', 'locations', 'batches']
    const admin: CollectionName[] = ['lotCosts', 'purchaseOrders', 'sales', 'transfers', 'users']
    const needed = adminScope.value ? [...base, ...admin] : base
    return running.value && needed.every((n) => loaded[n])
  })

  const firstError = computed(() => Object.values(errors).find(Boolean) ?? null)

  return {
    materials,
    locations,
    batches,
    lotCosts,
    purchaseOrders,
    sales,
    transfers,
    movements,
    users,
    loaded,
    errors,
    running,
    ready,
    firstError,
    start,
    stop,
  }
})
