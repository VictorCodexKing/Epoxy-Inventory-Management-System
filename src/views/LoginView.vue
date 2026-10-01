<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Eye, EyeOff, ArrowRight } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { errorMessage } from '@/stores/ui'
import { backendKind } from '@/services/backend'
import { DEMO_ACCOUNTS } from '@/services/backend/demo'
import AppButton from '@/components/ui/AppButton.vue'
import FormField from '@/components/ui/FormField.vue'
import BrandMark from '@/components/domain/BrandMark.vue'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const showPassword = ref(false)
const submitting = ref(false)
const error = ref<string | null>(null)
const resetSent = ref(false)

const demoRoles: Record<string, string> = { 'demo-admin': 'Super Admin', 'demo-user': 'Normal User', 'demo-store': 'Normal User' }

function safeRedirect(): string {
  const r = route.query.redirect
  return typeof r === 'string' && r.startsWith('/') && !r.startsWith('//') ? r : '/dashboard'
}

// Navigate once the profile has loaded (or access was refused).
watch(
  () => auth.status,
  (s) => {
    if (s === 'ready') void router.replace(safeRedirect())
    else if (s === 'noAccess') void router.replace({ name: 'no-access' })
  },
)

async function submit() {
  error.value = null
  resetSent.value = false
  if (!email.value.trim() || !password.value) {
    error.value = 'Enter your email and password.'
    return
  }
  submitting.value = true
  try {
    await auth.signIn(email.value, password.value)
  } catch (e) {
    error.value = errorMessage(e)
    submitting.value = false
  }
}

async function forgot() {
  error.value = null
  if (!email.value.trim()) {
    error.value = 'Enter your email above first, then choose “Forgot password”.'
    return
  }
  try {
    await auth.sendPasswordReset(email.value)
    resetSent.value = true
  } catch (e) {
    error.value = errorMessage(e)
  }
}

function fill(acct: (typeof DEMO_ACCOUNTS)[number]) {
  email.value = acct.email
  password.value = acct.password
  error.value = null
}
</script>

<template>
  <div class="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
    <!-- Brand panel -->
    <section class="relative hidden overflow-hidden bg-stone-950 text-stone-200 lg:flex lg:flex-col lg:justify-between lg:p-12">
      <div
        class="pointer-events-none absolute -top-40 -right-32 size-[34rem] rounded-full opacity-60 blur-3xl"
        style="background: radial-gradient(circle at 40% 40%, rgba(240, 143, 11, 0.45), rgba(176, 74, 9, 0.15) 45%, transparent 70%)"
        aria-hidden="true"
      />
      <div
        class="pointer-events-none absolute inset-0 opacity-[0.07]"
        style="background-image: linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px); background-size: 48px 48px"
        aria-hidden="true"
      />
      <div class="relative flex items-center gap-3">
        <BrandMark class="size-10" />
        <div>
          <p class="text-lg font-semibold tracking-tight text-white">EIMS</p>
          <p class="text-xs text-stone-500">Epoxy Inventory Management System</p>
        </div>
      </div>

      <div class="relative max-w-md">
        <p class="eyebrow !text-resin-400">Batch-level control</p>
        <h1 class="mt-3 text-4xl leading-[1.1] font-semibold tracking-tight text-white">Every drum, pail and can — accounted for.</h1>
        <p class="mt-4 text-[15px] leading-relaxed text-stone-400">
          Track resin and hardener lots from purchase order to dispatch across your own and vendor warehouses, with expiry alerts and
          real-time valuation in Ringgit.
        </p>
      </div>

      <dl class="relative grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-white/10 text-sm ring-1 ring-white/10">
        <div class="bg-stone-950/80 p-4">
          <dt class="text-[11px] tracking-wider text-stone-500 uppercase">Units</dt>
          <dd class="num mt-1 text-stone-200">kg · L · pcs</dd>
        </div>
        <div class="bg-stone-950/80 p-4">
          <dt class="text-[11px] tracking-wider text-stone-500 uppercase">Rotation</dt>
          <dd class="num mt-1 text-stone-200">FEFO</dd>
        </div>
        <div class="bg-stone-950/80 p-4">
          <dt class="text-[11px] tracking-wider text-stone-500 uppercase">Currency</dt>
          <dd class="num mt-1 text-stone-200">MYR</dd>
        </div>
      </dl>
    </section>

    <!-- Form -->
    <section class="flex items-center justify-center bg-stone-50 px-5 py-12 sm:px-10">
      <div class="w-full max-w-sm">
        <div class="mb-8 flex items-center gap-3 lg:hidden">
          <BrandMark class="size-9" />
          <p class="text-lg font-semibold tracking-tight">EIMS</p>
        </div>
        <h2 class="text-2xl font-semibold tracking-tight text-stone-900">Sign in</h2>
        <p class="mt-1 text-sm text-stone-500">Use the account provided by your administrator.</p>

        <form class="mt-8 space-y-4" novalidate @submit.prevent="submit">
          <FormField label="Email" for="email">
            <input id="email" v-model="email" type="email" autocomplete="username" class="input h-11" placeholder="name@company.com" required />
          </FormField>
          <FormField label="Password" for="password">
            <div class="relative">
              <input
                id="password"
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                class="input h-11 pr-11"
                required
              />
              <button
                type="button"
                class="absolute inset-y-0 right-0 grid w-11 place-items-center text-stone-400 hover:text-stone-700"
                :aria-label="showPassword ? 'Hide password' : 'Show password'"
                @click="showPassword = !showPassword"
              >
                <component :is="showPassword ? EyeOff : Eye" class="size-4" />
              </button>
            </div>
          </FormField>

          <p v-if="error" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{{ error }}</p>
          <p v-if="resetSent" class="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
            If an account exists for that email, a reset link is on its way.
          </p>

          <AppButton type="submit" variant="dark" block :loading="submitting || (auth.status === 'loading' && !!auth.user)" class="h-11">
            Sign in <ArrowRight class="size-4" />
          </AppButton>
          <button v-if="backendKind === 'firebase'" type="button" class="w-full text-center text-sm text-stone-500 hover:text-stone-800" @click="forgot">
            Forgot password?
          </button>
        </form>

        <div v-if="backendKind === 'demo'" class="mt-10">
          <p class="eyebrow">Demo accounts</p>
          <div class="mt-3 space-y-2">
            <button
              v-for="a in DEMO_ACCOUNTS"
              :key="a.uid"
              type="button"
              class="flex w-full items-center justify-between rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-left text-sm transition hover:border-resin-400 hover:bg-resin-50/40"
              @click="fill(a)"
            >
              <span>
                <span class="block font-medium text-stone-800">{{ a.displayName }}</span>
                <span class="num block text-xs text-stone-500">{{ a.email }} · {{ a.password }}</span>
              </span>
              <span class="text-xs font-medium text-stone-500">{{ demoRoles[a.uid] }}</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
