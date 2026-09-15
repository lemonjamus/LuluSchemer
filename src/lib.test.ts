import { expect, test } from 'vitest'
import { dueState, parseTaskLines, record, redo, stripThinking, undo, type History } from './lib'

test('stripThinking hides reasoning, including mid-stream', () => {
  expect(stripThinking('<think>plan it</think>\n\nHello')).toBe('Hello')
  expect(stripThinking('<think>still going')).toBe('')
  expect(stripThinking('Hi <thi')).toBe('Hi ')
  expect(stripThinking('Hi <thi', true)).toBe('Hi <thi')
  expect(stripThinking('a < b', true)).toBe('a < b')
})

test('parseTaskLines handles checklists, bullets and numbers', () => {
  const text = 'Here you go:\n- [ ] Research liquidity data\n* Build **heatmap** prototype\n2) Test detection\n[x] not a bullet\nplain line'
  expect(parseTaskLines(text)).toEqual(['Research liquidity data', 'Build heatmap prototype', 'Test detection'])
})

test('undo/redo round-trips snapshots', () => {
  let h: History<number[]> = { past: [], future: [] }
  const a: number[] = [], b = [1], c = [1, 2]
  h = record(h, a) // a -> b
  h = record(h, b) // b -> c
  const [h1, v1] = undo(h, c)!
  expect(v1).toBe(b)
  const [h2, v2] = undo(h1, v1)!
  expect(v2).toBe(a)
  expect(undo(h2, v2)).toBeNull()
  const [h3, v3] = redo(h2, v2)!
  expect(v3).toBe(b)
  expect(record(h3, v3).future).toEqual([]) // new action clears redo
})

test('dueState', () => {
  const today = new Date(2026, 8, 15)
  expect(dueState('2026-09-14', today)).toBe('overdue')
  expect(dueState('2026-09-15', today)).toBe('today')
  expect(dueState('2026-09-20', today)).toBe('upcoming')
  expect(dueState(null, today)).toBeNull()
})
