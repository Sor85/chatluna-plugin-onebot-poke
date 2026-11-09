import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

const fixtures: string[] = []
interface Call { command: string; args: string[]; cwd: string }

function fixture(options: Record<string, unknown> = {}, version = '0.0.1') {
    const root = mkdtempSync(join(tmpdir(), 'poke-publish-test-'))
    fixtures.push(root)
    const source = join(root, 'source')
    const mirror = join(root, 'mirror')
    const target = join(mirror, 'external/onebot-poke')
    for (const path of [join(source, 'scripts'), join(root, 'bin'), join(root, 'tmp'), target]) mkdirSync(path, { recursive: true })
    writeFileSync(join(root, 'options.json'), JSON.stringify(options))
    writeFileSync(join(source, 'package.json'), JSON.stringify({
        name: 'chatluna-plugin-onebot-poke', version, type: 'module',
        devDependencies: { '@chatluna/schema': 'workspace:*' }
    }))
    writeFileSync(join(mirror, 'package.json'), JSON.stringify({ name: '@chatluna/root', workspaces: ['external/*'] }))
    copyFileSync(resolve('scripts/publish.mjs'), join(source, 'scripts/publish.mjs'))
    copyFileSync(resolve('tests/helpers/publish-cli.mjs'), join(root, 'fake-cli.mjs'))
    writeFileSync(join(source, 'scripts/dev.mjs'), "import '../../fake-cli.mjs'\n")
    for (const folder of ['lib', 'dist']) {
        mkdirSync(join(target, folder))
        writeFileSync(join(target, folder, 'stale.txt'), 'stale')
    }
    writeFileSync(join(target, 'tsconfig.tsbuildinfo'), 'stale')
    for (const command of ['git', 'npm', 'yarn', 'ps']) {
        const executable = join(root, 'bin', command)
        writeFileSync(executable, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(root, 'fake-cli.mjs'))} ${command} "$@"\n`)
        chmodSync(executable, 0o755)
    }
    function run(args: string[] = []) {
        const result = spawnSync(process.execPath, [join(source, 'scripts/publish.mjs'), ...args], {
            cwd: source,
            encoding: 'utf8',
            timeout: 20000,
            env: {
                ...process.env,
                PATH: join(root, 'bin') + delimiter + process.env['PATH'],
                PUBLISH_FIXTURE_ROOT: root,
                CHATLUNA_V2_ROOT: mirror,
                TMPDIR: join(root, 'tmp')
            }
        })
        if (result.error) throw result.error
        const log = join(root, 'calls.jsonl')
        const calls: Call[] = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : []
        return { status: result.status, output: result.stdout + result.stderr, calls }
    }
    return { run, target, mirror }
}

afterEach(() => {
    for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function publishCall(calls: Call[]) {
    return calls.find((call) => call.command === 'npm' && call.args[0] === 'publish')
}
function tagCalls(calls: Call[]) {
    return calls.filter((call) => call.command === 'git' && call.args[0] === 'tag' && call.args[1] !== '--list')
}

describe('发布脚本', () => {
    it('帮助与无效参数不触发构建、Git 或 npm', () => {
        const app = fixture()
        const help = app.run(['--help'])
        expect(help.status).toBe(0)
        expect(help.calls).toEqual([])
        expect(help.output).toContain('--dry-run')
        const invalid = app.run(['--unknown'])
        expect(invalid.status).toBe(1)
        expect(invalid.calls).toEqual([])
    })

    it('演练允许未提交内容，清产物后检查并从解包目录演练，不打标签或推送', () => {
        const app = fixture({ dirty: true, unborn: true })
        const result = app.run(['--dry-run', '--mirror', app.mirror])
        expect(result.status, result.output).toBe(0)
        expect(result.calls.some((call) => call.command === 'git')).toBe(false)
        expect(result.calls.filter((call) => call.command === 'dev').map((call) => call.args[0])).toEqual(['sync', 'check'])
        const pack = result.calls.find((call) => call.command === 'yarn')
        expect(pack?.args[0]).toBe('pack')
        const publish = publishCall(result.calls)
        expect(publish?.args).toEqual(expect.arrayContaining(['--dry-run', '--ignore-scripts', '--access', 'public', '--tag', 'latest']))
        expect(publish?.args[1]).toMatch(/[/\\]package$/)
        expect(existsSync(join(publish?.args[1] ?? '', 'README.md'))).toBe(true)
        expect(existsSync(join(app.target, 'lib/stale.txt'))).toBe(false)
        expect(existsSync(join(app.target, 'dist/stale.txt'))).toBe(false)
        expect(existsSync(join(app.target, 'tsconfig.tsbuildinfo'))).toBe(false)
        expect(tagCalls(result.calls)).toEqual([])
    })

    it.each([{ args: [] }, { args: ['--dry-run'] }])('使用中的开发副本拒绝发布或演练 $args，不清理现有产物', ({ args }) => {
        const app = fixture({ runningHost: true })
        const result = app.run(args)
        expect(result.status).toBe(1)
        expect(result.output).toContain('仍有 ChatLuna 进程运行')
        expect(result.output).toContain('4321')
        expect(result.output).not.toContain('/packages/cli/launcher/lib/bin.js')
        expect(result.calls.some((call) => call.command === 'dev')).toBe(false)
        expect(existsSync(join(app.target, 'lib/stale.txt'))).toBe(true)
        expect(publishCall(result.calls)).toBeUndefined()
    })

    it('同步后新启动的宿主也会阻止清理', () => {
        const app = fixture({ hostStartsAfterSync: true })
        const result = app.run(['--dry-run'])
        expect(result.status).toBe(1)
        expect(result.output).toContain('4322')
        expect(result.calls.filter((call) => call.command === 'dev').map((call) => call.args[0])).toEqual(['sync'])
        expect(existsSync(join(app.target, 'lib/stale.txt'))).toBe(true)
        expect(publishCall(result.calls)).toBeUndefined()
    })

    it('无法检查进程时拒绝演练，不假定副本闲置', () => {
        const app = fixture({ processInspectionFailure: true })
        const result = app.run(['--dry-run'])
        expect(result.status).toBe(1)
        expect(existsSync(join(app.target, 'lib/stale.txt'))).toBe(true)
        expect(result.calls.some((call) => call.command === 'dev')).toBe(false)
    })

    it.each([
        ['unborn', '尚无提交'],
        ['dirty', '源码或 HEAD 已变化'],
        ['detached', 'detached HEAD'],
        ['localTag', '本地标签'],
        ['remoteTag', '远端标签'],
        ['remoteMismatch', '不一致'],
        ['loginFailure', 'npm 未登录'],
        ['versionExists', '已存在'],
        ['registryFailure', '无法确认 npm 版本']
    ])('正式发布前拒绝 %s', (flag, message) => {
        const result = fixture({ [flag]: true }).run()
        expect(result.status).toBe(1)
        expect(result.output).toContain(message)
        expect(publishCall(result.calls)).toBeUndefined()
        expect(result.calls.some((call) => call.command === 'dev')).toBe(false)
        expect(tagCalls(result.calls)).toEqual([])
    })

    it.each([
        ['buildFailure', '命令失败'],
        ['packFailure', '命令失败'],
        ['drift', '源码或 HEAD 已变化'],
        ['missingAsset', '缺少有效文件'],
        ['wrongVersion', '版本与源码不一致'],
        ['workspaceResidue', '本地依赖'],
        ['secretFile', '不应发布的文件'],
        ['badManifest', '资源缺失或越界']
    ])('构建及包检查失败 %s 时禁止发布', (flag, message) => {
        const result = fixture({ [flag]: true }).run()
        expect(result.status).toBe(1)
        expect(result.output).toContain(message)
        expect(publishCall(result.calls)).toBeUndefined()
        expect(tagCalls(result.calls)).toEqual([])
    })

    it.each([
        ['0.0.2', 'latest'],
        ['0.0.2-alpha.1', 'alpha'],
        ['0.0.2-beta.1', 'beta'],
        ['0.0.2-rc.1', 'rc'],
        ['0.0.2-next.1', 'next'],
        ['0.0.2-preview.1', 'next'],
        ['0.0.2-alpha-test.1', 'next']
    ])('版本 %s 使用 %s 渠道，确认 npm 后才为固定提交打标签', (version, channel) => {
        const result = fixture({}, version).run()
        expect(result.status, result.output).toBe(0)
        const publish = publishCall(result.calls)
        if (!publish) throw new Error('缺少发布调用')
        expect(publish.args[publish.args.indexOf('--tag') + 1]).toBe(channel)
        expect(publish?.args).not.toContain('--dry-run')
        const verify = result.calls.findIndex((call) => call.command === 'npm' && call.args[2] === 'versions')
        const tag = result.calls.findIndex((call) => call.command === 'git' && call.args[0] === 'tag' && call.args[1] !== '--list')
        expect(verify).toBeGreaterThan(result.calls.indexOf(publish))
        expect(tag).toBeGreaterThan(verify)
        expect(tagCalls(result.calls)[0]?.args).toEqual(['tag', `v${version}`, 'a'.repeat(40)])
        expect(result.calls.at(-1)?.args).toEqual(['push', 'origin', `refs/tags/v${version}`])
    })

    it('npm 索引仍为 stage 时等待目标 dist-tag 确认后才创建标签', () => {
        const result = fixture({ registryDelay: true }).run()
        expect(result.status, result.output).toBe(0)
        const checks = result.calls.filter((call) => call.command === 'npm' && call.args[2] === 'versions')
        expect(checks).toHaveLength(2)
        const tag = tagCalls(result.calls)[0]
        if (!tag) throw new Error('缺少 Git 标签调用')
        expect(result.calls.indexOf(tag)).toBeGreaterThan(result.calls.indexOf(checks[1]))
    })

    it('隐藏命令与失败输出中的 OTP，npm 失败后不打标签', () => {
        const result = fixture({ publishFailure: true }).run(['--otp=246810'])
        expect(result.status).toBe(1)
        expect(publishCall(result.calls)?.args).toContain('--otp=246810')
        expect(result.output).not.toContain('246810')
        expect(result.output).toContain('[已隐藏]')
        expect(tagCalls(result.calls)).toEqual([])
    })

    it('npm 成功但标签推送失败时明确要求核对，不再次发布', () => {
        const result = fixture({ pushFailure: true }).run()
        expect(result.status).toBe(1)
        expect(result.output).toContain('禁止盲目重发')
        expect(result.calls.filter((call) => call.command === 'npm' && call.args[0] === 'publish')).toHaveLength(1)
    })
})
