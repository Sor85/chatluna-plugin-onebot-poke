import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Config, inject } from '../src'

function agentDocs(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        if (['node_modules', 'lib', 'dist', '.git', '.claude'].includes(entry.name)) return []
        const path = join(directory, entry.name)
        if (entry.isDirectory()) return agentDocs(path)
        return entry.name === 'AGENTS.md' ? [path] : []
    })
}

describe('plugin configuration', () => {
    it('has safe defaults and native schema groups', () => {
        const config = Config({})
        expect(config.group).toBe(true)
        expect(config.private).toBe(true)
        expect(config.cooldownSeconds).toBe(1)
        expect(config.cooldownScope).toBe('user')
        expect(config.actions).toEqual([])
        expect(Config.type).toBe('intersect')
        expect(Config.list?.map((group) => group.meta.description))
            .toEqual(['响应范围', '响应间隔', '响应内容'])
    })

    it('keeps disabled and fractional weights, fractional and zero cooldowns', () => {
        expect(Config({ cooldownSeconds: 0 }).cooldownSeconds).toBe(0)
        expect(Config({ cooldownSeconds: 0.5 }).cooldownSeconds).toBe(0.5)
        expect(Config({ cooldownSeconds: 30 }).cooldownSeconds).toBe(30)
        expect(Config({ actions: [{ type: 'command', weight: 0, content: 'help' }] }).actions[0]?.weight).toBe(0)
        expect(Config({ actions: [{ type: 'message', weight: 0.5, content: '消息' }] }).actions[0]?.weight).toBe(0.5)
        expect(Config({ actions: [] }).actions).toEqual([])
    })

    it.each([
        { cooldownSeconds: -1 },
        { cooldownSeconds: 86401 },
        { cooldownScope: 'unknown' },
        { actions: [{ type: 'shell', content: 'ls' }] },
        { actions: [{ weight: -1 }] }
    ])('rejects invalid settings %j', (config) => {
        expect(() => Reflect.apply(Config, undefined, [config])).toThrow()
    })

    it('declares required runtime services and the MIT license', () => {
        const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
        expect(manifest.cordis.service.required).toEqual(inject)
        expect(manifest.cordis.service.optional).toEqual(['chatluna_webui'])
        expect(manifest.files).toEqual(expect.arrayContaining(['client', 'dist']))
        expect(manifest.devDependencies['@chatluna/ui-client']).toBe('workspace:*')
        expect(manifest.license).toBe('MIT')
    })

    it('registers every scoped AGENTS document in the root index', () => {
        const root = readFileSync('AGENTS.md', 'utf8')
        const docs = agentDocs('.').filter((path) => path !== 'AGENTS.md')
        for (const path of docs) expect(root).toContain(path)
        const registered = [...root.matchAll(/`([^`]+\/AGENTS\.md)`/g)].map((match) => match[1])
        expect(registered.sort()).toEqual(docs.sort())
    })
})
