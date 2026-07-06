<script setup lang="ts">
definePageMeta({ middleware: 'admin' })

interface AdminSalon { id: string; name: string; city: string; isFeatured: boolean; featuredUntil: string | null }

const { apiFetch } = useApi()
const salons = ref<AdminSalon[]>([])
const savingId = ref<string | null>(null)

async function load() {
  const { data } = await apiFetch<AdminSalon[]>('/admin/salons', { silent: true })
  salons.value = data ?? []
}

onMounted(load)

async function toggle(salon: AdminSalon, featuredUntilInput: string) {
  savingId.value = salon.id
  await apiFetch(`/admin/salons/${salon.id}/featured`, {
    method: 'PATCH',
    body: {
      isFeatured: !salon.isFeatured,
      featuredUntil: featuredUntilInput ? new Date(featuredUntilInput).toISOString() : undefined,
    },
  })
  savingId.value = null
  await load()
}

function onToggleClick(salon: AdminSalon) {
  const input = document.getElementById(`until-${salon.id}`) as HTMLInputElement
  toggle(salon, input.value)
}
</script>

<template>
  <div class="p-4">
    <h1 class="text-lg font-bold mb-4">مدیریت سالن‌های ویژه (تبلیغ)</h1>
    <table class="w-full text-sm border-collapse">
      <thead>
        <tr class="border-b">
          <th class="text-start p-2">نام</th>
          <th class="text-start p-2">شهر</th>
          <th class="text-start p-2">ویژه</th>
          <th class="text-start p-2">تا تاریخ</th>
          <th class="text-start p-2"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="salon in salons" :key="salon.id" class="border-b">
          <td class="p-2">{{ salon.name }}</td>
          <td class="p-2">{{ salon.city }}</td>
          <td class="p-2">{{ salon.isFeatured ? 'بله' : 'خیر' }}</td>
          <td class="p-2">
            <input :id="`until-${salon.id}`" type="date" class="border rounded p-1" />
          </td>
          <td class="p-2">
            <button
              type="button"
              :disabled="savingId === salon.id"
              class="rounded bg-(--color-accent) text-white px-2 py-1"
              @click="onToggleClick(salon)"
            >
              {{ salon.isFeatured ? 'حذف از ویژه' : 'افزودن به ویژه' }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
