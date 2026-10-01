<script setup lang="ts">
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import ToastHost from '@/components/ui/ToastHost.vue'
import ConfirmHost from '@/components/ui/ConfirmHost.vue'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

// React to session changes that happen while the user is on a page
// (sign-out in another tab, access removed by an admin, role demoted).
watch(
  () => [auth.status, auth.isAdmin] as const,
  ([status, isAdmin]) => {
    if (status === 'signedOut' && route.meta.requiresAuth) {
      void router.replace({ name: 'login' })
    } else if (status === 'noAccess' && route.name !== 'no-access') {
      void router.replace({ name: 'no-access' })
    } else if (status === 'ready' && (route.name === 'no-access' || route.name === 'login')) {
      void router.replace({ name: 'dashboard' })
    } else if (status === 'ready' && route.meta.requiresAdmin && !isAdmin) {
      void router.replace({ name: 'dashboard' })
    }
  },
)
</script>

<template>
  <RouterView />
  <ToastHost />
  <ConfirmHost />
</template>
