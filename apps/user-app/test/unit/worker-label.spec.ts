import { describe, it, expect } from 'vitest'
import { isPlaceholderWorkerName, workerDisplayLabels, workerDisplayName, UNNAMED_WORKER_LABEL } from '../../app/utils/worker-label'

describe('isPlaceholderWorkerName', () => {
  it.each(['عضو ۱', 'عضو 2', 'کارمند ۳', 'member 1', 'Staff-4', '۷', '', '   ', null, undefined])(
    'treats %j as a placeholder',
    (name) => expect(isPlaceholderWorkerName(name)).toBe(true),
  )

  it.each(['مریم', 'سارا احمدی', 'Sara', 'کارمند تست', 'عضو تیم رنگ'])('keeps %j as a real name', (name) => {
    expect(isPlaceholderWorkerName(name)).toBe(false)
  })
})

describe('workerDisplayName', () => {
  it('replaces a placeholder with the neutral label and trims a real name', () => {
    expect(workerDisplayName('عضو ۱')).toBe(UNNAMED_WORKER_LABEL)
    expect(workerDisplayName('  مریم ')).toBe('مریم')
  })
})

describe('workerDisplayLabels', () => {
  it('leaves a single unnamed worker un-numbered', () => {
    expect(workerDisplayLabels([{ id: 'a', name: 'عضو ۱' }, { id: 'b', name: 'مریم' }])).toEqual({
      a: 'متخصص سالن',
      b: 'مریم',
    })
  })

  it('numbers several unnamed workers so they stay distinguishable', () => {
    expect(workerDisplayLabels([{ id: 'a', name: 'عضو ۱' }, { id: 'b', name: '' }, { id: 'c', name: 'سارا' }])).toEqual({
      a: 'متخصص سالن ۱',
      b: 'متخصص سالن ۲',
      c: 'سارا',
    })
  })
})
