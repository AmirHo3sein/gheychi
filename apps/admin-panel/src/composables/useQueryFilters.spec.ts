import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ISO_DATE_RE, useQueryFilters } from './useQueryFilters'

let filters: ReturnType<typeof makeFilters>
function makeFilters() {
  return useQueryFilters(
    { page: 1, status: 'all', name: '', from: '' },
    { allowed: { status: ['all', 'pending', 'approved'], from: ISO_DATE_RE } },
  )
}
const ListPage = defineComponent({
  setup() {
    filters = makeFilters()
    return () => h('div')
  },
})

async function setup(start: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/list', component: ListPage },
      { path: '/detail', component: { render: () => h('div') } },
    ],
  })
  router.push(start)
  await router.isReady()
  const wrapper = mount(ListPage, { global: { plugins: [router] } })
  await flushPromises()
  return { router, wrapper }
}

describe('useQueryFilters', () => {
  it('initialises each filter from the query, parsing numbers and rejecting unknown values', async () => {
    await setup('/list?page=3&status=pending&name=%D8%B3%D8%A7%D9%84%D9%86&from=2026-10-01')
    expect(filters.page.value).toBe(3)
    expect(filters.status.value).toBe('pending')
    expect(filters.name.value).toBe('سالن')
    expect(filters.from.value).toBe('2026-10-01')

    await setup('/list?page=-2&status=hacked&from=yesterday')
    expect(filters.page.value).toBe(1)
    expect(filters.status.value).toBe('all')
    expect(filters.from.value).toBe('')
  })

  it('writes changes back with replace, omitting defaults and keeping foreign params', async () => {
    const { router } = await setup('/list?keep=1')
    const replace = vi.spyOn(router, 'replace')
    const push = vi.spyOn(router, 'push')

    filters.status.value = 'approved'
    filters.name.value = 'ب'
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ keep: '1', status: 'approved', name: 'ب' })
    expect(replace).toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()

    filters.status.value = 'all'
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ keep: '1', name: 'ب' })
  })

  it('restores filters when the browser goes back to the filtered list', async () => {
    const { router } = await setup('/list')
    filters.status.value = 'pending'
    filters.page.value = 2
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/list?page=2&status=pending')

    await router.push('/detail')
    // The outgoing page must not rewrite the detail route's URL.
    expect(router.currentRoute.value.fullPath).toBe('/detail')

    router.back()
    await flushPromises()
    await new Promise((r) => setTimeout(r, 0))
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/list?page=2&status=pending')
  })

  it('follows a query change while the page stays mounted (e.g. its own sidebar link)', async () => {
    const { router } = await setup('/list?status=pending&page=4')
    await router.push('/list')
    await flushPromises()
    expect(filters.status.value).toBe('all')
    expect(filters.page.value).toBe(1)
  })

  it('tells a navigation-driven change apart from an edit, even after the edit reached the URL', async () => {
    const { router } = await setup('/list?status=pending&page=3')
    expect(filters.changedByUrl()).toBe(true)

    // An edit -- and still an edit once its own replace has landed (a debounced text filter
    // only reacts after that).
    filters.name.value = 'x'
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ name: 'x' })
    expect(filters.changedByUrl()).toBe(false)

    // A navigation that moves several filters at once.
    await router.push('/list?status=approved&page=2')
    await flushPromises()
    expect(filters.page.value).toBe(2)
    expect(filters.changedByUrl()).toBe(true)
  })

  it('works as plain local state when no router is installed', async () => {
    mount(ListPage)
    expect(filters.status.value).toBe('all')
    filters.status.value = 'pending'
    expect(filters.status.value).toBe('pending')
  })
})
