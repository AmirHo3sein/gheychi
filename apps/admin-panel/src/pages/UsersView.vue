<!-- apps/admin-panel/src/pages/UsersView.vue -->
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import SuspendUserButton from '@/components/users/SuspendUserButton.vue'

interface UserRow {
  id: string
  phone: string
  name: string | null
  role: 'customer' | 'provider' | 'admin'
  status: 'active' | 'suspended'
  createdAt: string
}

const { apiFetch } = useApi()
const users = ref<UserRow[]>([])
const loading = ref(true)

const phoneFilter = ref('')
const nameFilter = ref('')
const roleFilter = ref<'' | 'customer' | 'provider' | 'admin'>('')
const joinedFrom = ref('')
const joinedTo = ref('')

async function load() {
  loading.value = true
  const params = new URLSearchParams()
  if (phoneFilter.value) params.set('phone', phoneFilter.value)
  if (nameFilter.value) params.set('name', nameFilter.value)
  if (roleFilter.value) params.set('role', roleFilter.value)
  if (joinedFrom.value) params.set('joinedFrom', new Date(joinedFrom.value).toISOString())
  if (joinedTo.value) params.set('joinedTo', new Date(`${joinedTo.value}T23:59:59.999`).toISOString())

  const { data } = await apiFetch<UserRow[]>(`/admin/users?${params.toString()}`, { silent: true })
  users.value = data ?? []
  loading.value = false
}

function onUpdated(userId: string, status: string) {
  const user = users.value.find((u) => u.id === userId)
  if (user) user.status = status as UserRow['status']
}

onMounted(load)
watch([phoneFilter, nameFilter, roleFilter, joinedFrom, joinedTo], load)
</script>

<template>
  <div class="space-y-4 p-6">
    <h1 class="text-lg font-bold">کاربران</h1>

    <div class="flex flex-wrap gap-3">
      <input v-model="phoneFilter" placeholder="شماره موبایل" class="rounded-lg border p-2 text-sm" />
      <input v-model="nameFilter" placeholder="نام" class="rounded-lg border p-2 text-sm" />
      <select v-model="roleFilter" class="rounded-lg border p-2 text-sm">
        <option value="">همه نقش‌ها</option>
        <option value="customer">مشتری</option>
        <option value="provider">آرایشگاه‌دار</option>
        <option value="admin">مدیر</option>
      </select>
      <input v-model="joinedFrom" type="date" class="rounded-lg border p-2 text-sm" />
      <input v-model="joinedTo" type="date" class="rounded-lg border p-2 text-sm" />
    </div>

    <p v-if="!loading && users.length === 0" class="text-sm text-gray-500">موردی یافت نشد.</p>

    <table v-else class="w-full text-right text-sm">
      <thead>
        <tr class="border-b text-gray-500">
          <th class="p-2">نام</th>
          <th class="p-2">موبایل</th>
          <th class="p-2">نقش</th>
          <th class="p-2">وضعیت</th>
          <th class="p-2"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="user in users" :key="user.id" class="border-b">
          <td class="p-2">{{ user.name ?? '—' }}</td>
          <td class="p-2">{{ user.phone }}</td>
          <td class="p-2">{{ user.role }}</td>
          <td class="p-2">{{ user.status }}</td>
          <td class="p-2">
            <SuspendUserButton :user-id="user.id" :status="user.status" @updated="(u) => onUpdated(u.id, u.status)" />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
