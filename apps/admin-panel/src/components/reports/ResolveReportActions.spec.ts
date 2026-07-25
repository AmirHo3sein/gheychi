import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ResolveReportActions from './ResolveReportActions.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

describe('ResolveReportActions', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('expands for an optional note and resolves with it', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'r1', status: 'resolved' }, error: null })
    const wrapper = mount(ResolveReportActions, { props: { reportId: 'r1' } })

    await wrapper.get('[data-testid="resolve-button"]').trigger('click')
    expect(fetchMock).not.toHaveBeenCalled() // expanding is not yet a mutation

    await wrapper.get('[data-testid="note-input"]').setValue('با مالک سالن تماس گرفته شد')
    await wrapper.get('[data-testid="submit-resolution"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/reports/r1', {
      method: 'PATCH',
      body: { status: 'resolved', note: 'با مالک سالن تماس گرفته شد' },
    })
    expect(wrapper.emitted('updated')?.[0]).toEqual([{ id: 'r1', status: 'resolved' }])
  })

  it('dismisses without a note, omitting the note key entirely', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'r1', status: 'dismissed' }, error: null })
    const wrapper = mount(ResolveReportActions, { props: { reportId: 'r1' } })

    await wrapper.get('[data-testid="dismiss-button"]').trigger('click')
    await wrapper.get('[data-testid="submit-resolution"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/reports/r1', {
      method: 'PATCH',
      body: { status: 'dismissed' },
    })
    expect(wrapper.emitted('updated')?.[0]).toEqual([{ id: 'r1', status: 'dismissed' }])
  })

  it('renders the entry-step resolve button as secondary, never accent-filled (One Seal Rule: many open cards render this at once)', async () => {
    const wrapper = mount(ResolveReportActions, { props: { reportId: 'r1' } })

    const resolveButton = wrapper.get('[data-testid="resolve-button"]')
    expect(resolveButton.classes().join(' ')).toContain('bg-(--color-border-soft)')
    expect(resolveButton.classes().join(' ')).not.toContain('bg-(--color-accent-strong)')
  })

  it('binds the commit-step submit button to the actual action: danger when dismissing, primary when resolving', async () => {
    const wrapper = mount(ResolveReportActions, { props: { reportId: 'r1' } })

    // Dismiss (a destructive action) must commit with the same danger styling its entry
    // button already has -- never look identical to the affirmative resolve path.
    await wrapper.get('[data-testid="dismiss-button"]').trigger('click')
    let submit = wrapper.get('[data-testid="submit-resolution"]')
    expect(submit.classes().join(' ')).toContain('bg-(--color-danger-strong)')
    expect(submit.classes().join(' ')).not.toContain('bg-(--color-accent-strong)')

    await wrapper.get('[data-testid="cancel-resolution"]').trigger('click')

    await wrapper.get('[data-testid="resolve-button"]').trigger('click')
    submit = wrapper.get('[data-testid="submit-resolution"]')
    expect(submit.classes().join(' ')).toContain('bg-(--color-accent-strong)')
    expect(submit.classes().join(' ')).not.toContain('bg-(--color-danger-strong)')
  })

  it('collapses the panel and emits refresh instead of updated when the PATCH fails (409 lost race)', async () => {
    fetchMock.mockResolvedValueOnce({
      data: null,
      error: { status: 409, message: 'این گزارش قبلاً رسیدگی شده است' },
    })
    const wrapper = mount(ResolveReportActions, { props: { reportId: 'r1' } })

    await wrapper.get('[data-testid="resolve-button"]').trigger('click')
    await wrapper.get('[data-testid="note-input"]').setValue('یادداشتی که دیگر معتبر نیست')
    await wrapper.get('[data-testid="submit-resolution"]').trigger('click')
    await flushPromises()

    // The stale note panel must not stay open inviting a doomed retry.
    expect(wrapper.find('[data-testid="note-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="resolve-button"]').exists()).toBe(true)
    expect(wrapper.emitted('updated')).toBeUndefined()
    expect(wrapper.emitted('refresh')).toHaveLength(1)
  })

  it('cancelling collapses back to the action buttons without a request', async () => {
    const wrapper = mount(ResolveReportActions, { props: { reportId: 'r1' } })

    await wrapper.get('[data-testid="resolve-button"]').trigger('click')
    await wrapper.get('[data-testid="cancel-resolution"]').trigger('click')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="resolve-button"]').exists()).toBe(true)
  })

  it('disables submit while the request is in flight', async () => {
    let resolveFetch!: (value: { data: { id: string; status: string }; error: null }) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )
    const wrapper = mount(ResolveReportActions, { props: { reportId: 'r1' } })

    await wrapper.get('[data-testid="dismiss-button"]').trigger('click')
    const submit = wrapper.get('[data-testid="submit-resolution"]')
    await submit.trigger('click')

    expect((submit.element as HTMLButtonElement).disabled).toBe(true)

    // A second click while still in flight must not fire a duplicate request.
    await submit.trigger('click')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch({ data: { id: 'r1', status: 'dismissed' }, error: null })
    await flushPromises()
  })
})
