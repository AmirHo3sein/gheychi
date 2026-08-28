<script setup lang="ts">
import { formatRemainingTime } from '../../utils/remaining-time'

// A «... مانده» label for a backend-issued deadline (a booking's approvalExpiresAt /
// paymentExpiresAt). Purely a display convenience: the server owns the deadline and is the
// only thing that ever expires a booking, so nothing on any page is gated on what this
// renders. Once the deadline passes it says «منقضی شده» rather than counting into negatives,
// and the page keeps offering whatever action the booking's real status still allows -- the
// API's own 409 is what tells the customer they were too late, not this client-side clock.
//
// `expiresAt` is nullable because the field is null on every booking that isn't currently
// waiting on a deadline; nothing renders in that case.
const props = defineProps<{ expiresAt: string | null }>()

const now = useNow()

const label = computed(() => (props.expiresAt ? formatRemainingTime(props.expiresAt, now.value) : null))
</script>

<template>
  <span v-if="label" data-testid="remaining-time" class="tnum whitespace-nowrap">{{ label }}</span>
</template>
