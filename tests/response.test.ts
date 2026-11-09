import { describe, expect, it } from 'vitest'
import { chooseResponse, ResponseGate, type ResponseAction } from '../src/response'

const actions: ResponseAction[] = [
    { type: 'message', weight: 3, content: '收到戳一戳。' },
    { type: 'command', weight: 1, content: 'help' }
]

describe('weighted responses', () => {
    it('uses relative weights across message and command actions', () => {
        expect(chooseResponse(actions, () => 0)).toBe(actions[0])
        expect(chooseResponse(actions, () => 0.749999)).toBe(actions[0])
        expect(chooseResponse(actions, () => 0.75)).toBe(actions[1])
        expect(chooseResponse(actions, () => 0.999999)).toBe(actions[1])
    })

    it('ignores disabled, invalid and empty actions', () => {
        const disabled: ResponseAction[] = [
            { type: 'message', weight: 0, content: '禁用' },
            { type: 'message', weight: -1, content: '无效' },
            { type: 'message', weight: NaN, content: '无效' },
            { type: 'message', weight: Infinity, content: '无效' },
            { type: 'command', weight: 1, content: '  ' }
        ]
        expect(chooseResponse([])).toBeUndefined()
        expect(chooseResponse(disabled)).toBeUndefined()
        expect(chooseResponse([...disabled, ...actions], () => 0)).toBe(actions[0])
    })

    it('does not overflow when large finite weights are added', () => {
        const large: ResponseAction[] = actions.map((action) => ({
            ...action,
            weight: Number.MAX_VALUE
        }))
        expect(chooseResponse(large, () => 0.49)).toBe(large[0])
        expect(chooseResponse(large, () => 0.5)).toBe(large[1])
    })
})

describe('response gate', () => {
    it('reserves cooldown before asynchronous work and does not extend it on rejection', () => {
        const gate = new ResponseGate()
        expect(gate.acquire('a', 1000, 0)).toBe(true)
        expect(gate.acquire('a', 1000, 500)).toBe(false)
        gate.release('a')
        expect(gate.acquire('a', 1000, 999)).toBe(false)
        expect(gate.acquire('a', 1000, 1000)).toBe(true)
    })

    it('keeps independent scopes separate', () => {
        const gate = new ResponseGate()
        expect(gate.acquire('a', 1000, 0)).toBe(true)
        expect(gate.acquire('b', 1000, 0)).toBe(true)
    })

    it('does not overlap running responses even with zero cooldown', () => {
        const gate = new ResponseGate()
        expect(gate.acquire('a', 0, 0)).toBe(true)
        expect(gate.acquire('a', 0, 1000)).toBe(false)
        gate.prune(2000)
        expect(gate.acquire('a', 0, 2000)).toBe(false)
        gate.release('a')
        expect(gate.acquire('a', 0, 2000)).toBe(true)
    })

    it('retains cooldown after failure and clears expired or disposed state', () => {
        const gate = new ResponseGate()
        gate.acquire('a', 1000, 0)
        gate.release('a')
        gate.prune(500)
        expect(gate.acquire('a', 1000, 999)).toBe(false)
        gate.prune(1000)
        expect(gate.acquire('a', 1000, 1000)).toBe(true)
        gate.clear()
        gate.release('a')
        expect(gate.acquire('a', 1000, 1000)).toBe(true)
    })
})
