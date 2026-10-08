import { beforeEach, describe, expect, it } from 'vitest'
import { resetConfirm, useConfirm } from './useConfirm'

describe('useConfirm', () => {
  beforeEach(resetConfirm)

  it('resolves true when settled with true', async () => {
    const { confirm, settle, pending } = useConfirm()
    const result = confirm({ title: 'حذف؟' })
    expect(pending.value?.options.title).toBe('حذف؟')
    settle(true)
    await expect(result).resolves.toBe(true)
    expect(pending.value).toBeNull()
  })

  it('resolves false when cancelled', async () => {
    const { confirm, settle } = useConfirm()
    const result = confirm({ title: 'x' })
    settle(false)
    await expect(result).resolves.toBe(false)
  })

  it('settles a still-open prompt as cancelled when a second one opens', async () => {
    const { confirm, settle } = useConfirm()
    const first = confirm({ title: 'اول' })
    const second = confirm({ title: 'دوم' })
    await expect(first).resolves.toBe(false)
    settle(true)
    await expect(second).resolves.toBe(true)
  })
})
