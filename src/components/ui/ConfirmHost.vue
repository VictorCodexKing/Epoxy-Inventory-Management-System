<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useUiStore } from '@/stores/ui'
import AppModal from './AppModal.vue'
import AppButton from './AppButton.vue'
import FormField from './FormField.vue'

const ui = useUiStore()
const reason = ref('')
const touched = ref(false)
const c = computed(() => ui.confirmState)

watch(c, () => {
  reason.value = ''
  touched.value = false
})

const reasonMissing = computed(() => !!c.value?.requireReason && reason.value.trim().length < 3)

function confirm() {
  touched.value = true
  if (reasonMissing.value) return
  ui.settleConfirm(true, reason.value.trim())
}
</script>

<template>
  <AppModal :open="!!c" :title="c?.title ?? ''" size="sm" layer="top" @close="ui.settleConfirm(false)">
    <p class="text-sm leading-relaxed text-stone-600">{{ c?.message }}</p>
    <div v-if="c?.requireReason" class="mt-4">
      <FormField :label="c.reasonLabel ?? 'Reason'" for="confirm-reason" :error="touched && reasonMissing ? 'Please give a short reason (at least 3 characters).' : null">
        <textarea id="confirm-reason" v-model="reason" rows="3" maxlength="300" class="input resize-none" placeholder="e.g. Entered against the wrong supplier" />
      </FormField>
    </div>
    <template #footer>
      <AppButton variant="ghost" @click="ui.settleConfirm(false)">Cancel</AppButton>
      <AppButton :variant="c?.tone === 'danger' ? 'danger' : 'dark'" @click="confirm">{{ c?.confirmLabel ?? 'Confirm' }}</AppButton>
    </template>
  </AppModal>
</template>
