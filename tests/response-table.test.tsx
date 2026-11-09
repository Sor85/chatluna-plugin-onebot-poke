// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Context } from 'cordis'
import { Schema } from '@chatluna/schema'
import { SchemaForm, extensionOf, registerReactFormExtension } from '@chatluna/ui-schema-form/client'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import apply from '../client'
import { ResponseTable } from '../client/response-table'
import { Config } from '../src/config'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
})
afterAll(() => vi.unstubAllGlobals())

const fields: Record<string, Schema> = Object.assign({}, ...(Config.list ?? []).map((group) => group.dict))
const schema = Schema.object({ actions: fields['actions'], cooldownSeconds: fields['cooldownSeconds'] })
let root: Root | undefined
let dispose: (() => void) | undefined
let container: HTMLDivElement

afterEach(async () => {
    await act(async () => root?.unmount())
    root = undefined
    dispose?.()
    dispose = undefined
    container?.remove()
})

async function mount(value: Record<string, unknown> = {}) {
    dispose = registerReactFormExtension({ type: 'array', role: 'onebot-poke:actions', component: ResponseTable, priority: 30 })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    let current = value
    function Form() {
        const [draft, setDraft] = useState(value)
        current = draft
        return <SchemaForm schema={schema} value={draft} initial={value} onChange={setDraft} />
    }
    await act(async () => root?.render(<Form />))
    return () => current
}

function table() {
    const element = container.querySelector('table[aria-label="加权响应列表"]')
    if (!(element instanceof HTMLTableElement)) throw new Error('缺少响应表格')
    return element
}
function button(label: string) {
    const element = container.querySelector(`button[aria-label="${label}"]`)
    if (!(element instanceof HTMLButtonElement)) throw new Error(`缺少按钮：${label}`)
    return element
}
async function click(element: Element | undefined | null) {
    if (!element) throw new Error('缺少点击目标')
    await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}
async function input(index: number, value: string, textarea = false) {
    const element = textarea
        ? table().querySelectorAll('textarea')[index]
        : table().querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]')[index]
    if (!element) throw new Error('缺少输入框')
    await act(async () => {
        const prototype = textarea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value)
        element.dispatchEvent(new Event('input', { bubbles: true }))
    })
}

const first = { type: 'message', weight: 3, content: '第一条' }
const second = { type: 'command', weight: 1, content: 'help' }

describe('响应表格', () => {
    it('默认显示空表格，不自动添加示例或写回配置', async () => {
        const current = await mount()
        expect(table().tBodies[0]?.rows).toHaveLength(1)
        expect(table().textContent).toContain('暂无响应')
        expect([...table().querySelectorAll('th')].map((cell) => cell.textContent))
            .toEqual(['响应类型', '权重', '响应内容', '操作'])
        expect(table().querySelectorAll('[data-schema-field]')).toHaveLength(0)
        expect(table().querySelectorAll('[role="combobox"]')).toHaveLength(0)
        expect(table().querySelectorAll('textarea')).toHaveLength(0)
        expect(current()).toEqual({})
        expect(table().querySelector('button[title="上移"]')).toBeNull()
        expect(table().querySelector('button[title="下移"]')).toBeNull()
        expect(table().querySelectorAll('button[title="删除"]')).toHaveLength(0)
        expect(container.textContent).toContain('0表示禁用')
        expect(container.textContent).toContain('消息按纯文本发送')
        expect(container.textContent).toContain('{userId}')
    })

    it('编辑权重保留零值、其他字段和原始输入', async () => {
        const original = { actions: [{ ...first, extra: '保留' }] }
        const current = await mount(original)
        await input(0, '0')
        expect(current()['actions']).toEqual([{ ...first, weight: 0, extra: '保留' }])
        await click(button('减少'))
        expect(current()['actions']).toEqual([{ ...first, weight: 0, extra: '保留' }])
        await click(button('增加'))
        expect(current()['actions']).toEqual([{ ...first, weight: 1, extra: '保留' }])
        expect(original.actions[0]?.weight).toBe(3)
    })

    it('内容保留多行与占位符，不影响权重或类型', async () => {
        const current = await mount({ actions: [first, second] })
        await input(0, '第一行\n{userId} 第二行', true)
        expect(current()['actions']).toEqual([{ ...first, content: '第一行\n{userId} 第二行' }, second])
    })

    it('类型下拉使用宿主选项，切换不清空内容', async () => {
        const current = await mount({ actions: [first] })
        await click(table().querySelector('[role="combobox"]'))
        const option = [...document.querySelectorAll('[role="option"]')].find((element) => element.textContent?.includes('执行指令'))
        if (!option) throw new Error('缺少指令选项')
        await act(async () => option.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', buttons: 1 })))
        await click(option)
        expect(current()['actions']).toEqual([{ ...first, type: 'command' }])
    })

    it('删除行后数字与文本草稿不串到剩余行，重复响应保持独立', async () => {
        const current = await mount({ actions: [first, { ...first, weight: 9 }] })
        await input(0, '7')
        await input(0, '编辑后的内容', true)
        await click(button('删除：第 1 项'))
        expect(current()['actions']).toEqual([{ ...first, weight: 9 }])
        expect([...table().querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]')].map((el) => el.value)).toEqual(['9'])
        expect([...table().querySelectorAll('textarea')].map((el) => el.value)).toEqual(['第一条'])
    })

    it('删除到空数组后新增写入完整默认值，不恢复旧响应', async () => {
        const current = await mount({ actions: [first] })
        await click(button('删除：第 1 项'))
        expect(current()['actions']).toEqual([])
        expect(table().textContent).toContain('暂无响应')
        const add = [...container.querySelectorAll('button')].find((el) => el.textContent?.includes('添加一项'))
        await click(add)
        expect(current()['actions']).toEqual([{ type: 'message', weight: 1, content: '' }])
    })

    it('重新打开保留零权重、空文本及已有顺序', async () => {
        const value = { actions: [{ ...second, weight: 0 }, { ...first, content: '' }] }
        const current = await mount(value)
        expect(current()).toEqual(value)
        expect([...table().querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]')].map((el) => el.value)).toEqual(['0', '3'])
        expect([...table().querySelectorAll('textarea')].map((el) => el.value)).toEqual(['help', ''])
    })

    it('整组恢复默认保留另行设置的响应间隔', async () => {
        const current = await mount({ actions: [second], cooldownSeconds: 8 })
        await click(button('加权响应列表更多操作'))
        const restore = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.includes('恢复默认'))
        await click(restore)
        expect(current()['actions']).toBeUndefined()
        expect(current()['cooldownSeconds']).toBe(8)
        expect(table().querySelectorAll('textarea')).toHaveLength(0)
        expect(table().textContent).toContain('暂无响应')
    })

    it('专属角色随上下文注销，不替换宿主通用数组或其他插件角色', async () => {
        const ordinary = Schema.array(Schema.object({ weight: Schema.number() })).role('table')
        const before = extensionOf(ordinary, [])?.component
        const ctx = new Context()
        await ctx.plugin(apply)
        try {
            expect(extensionOf(fields['actions'], Config({}).actions)?.component).toBe(ResponseTable)
            expect(extensionOf(ordinary, [])?.component).toBe(before)
        } finally {
            await ctx.fiber.dispose()
        }
        expect(extensionOf(fields['actions'], [])?.component).not.toBe(ResponseTable)
    })
})
