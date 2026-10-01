<script setup lang="ts">
import { useRouter } from 'vue-router'
import { Lock } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import AppButton from '@/components/ui/AppButton.vue'

const auth = useAuthStore()
const router = useRouter()

async function signOut() {
  await auth.signOut()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <div class="grid min-h-dvh place-items-center bg-stone-50 px-6">
    <div class="card max-w-md p-8 text-center">
      <div class="mx-auto grid size-12 place-items-center rounded-xl bg-stone-100 text-stone-600 ring-1 ring-stone-200">
        <Lock class="size-5" />
      </div>
      <h1 class="mt-5 text-lg font-semibold text-stone-900">No access to EIMS</h1>
      <p class="mt-2 text-sm leading-relaxed text-stone-500">
        The account <span class="font-medium text-stone-700">{{ auth.user?.email }}</span> has been removed from EIMS. If you think this is a
        mistake, contact the system owner.
      </p>
      <p v-if="auth.problem" class="mt-3 text-xs text-stone-400">{{ auth.problem }}</p>
      <AppButton variant="dark" class="mt-6" @click="signOut">Sign out</AppButton>
    </div>
  </div>
</template>
