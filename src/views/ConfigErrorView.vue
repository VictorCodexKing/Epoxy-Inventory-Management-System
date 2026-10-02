<script setup lang="ts">
defineProps<{ missing: string[]; message?: string }>()
</script>

<template>
  <div class="grid min-h-dvh place-items-center bg-stone-50 px-6 font-sans">
    <div class="max-w-lg rounded-xl border border-stone-200 bg-white p-8 shadow-sm">
      <p class="text-[11px] font-semibold tracking-[0.14em] text-red-600 uppercase">Configuration needed</p>
      <h1 class="mt-2 text-xl font-semibold text-stone-900">EIMS cannot connect to Firebase</h1>
      <p v-if="message" class="mt-3 text-sm text-stone-600">{{ message }}</p>
      <template v-if="missing.length">
        <p class="mt-3 text-sm text-stone-600">
          These required environment variables are missing:
        </p>
        <ul class="mt-3 space-y-1 font-mono text-sm text-stone-800">
          <li v-for="k in missing" :key="k">• {{ k }}</li>
        </ul>
      </template>
      <p class="mt-4 text-sm text-stone-600">
        Add them to <code class="rounded bg-stone-100 px-1">.env.local</code> (local) or Vercel → Settings → Environment Variables, then rebuild. See
        <code class="rounded bg-stone-100 px-1">docs/FIREBASE_SETUP.md</code>.
      </p>
    </div>
  </div>
</template>
