#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const registry = 'https://registry.npmjs.org'
let otp = ''
let published = false
let workdir

function fail(message) {
    throw new Error(message)
}

function redact(value) {
    return otp ? String(value).split(otp).join('[已隐藏]') : String(value)
}

function execute(command, args, { cwd = source, quiet = false, allowFailure = false } = {}) {
    if (!quiet) console.log(`[publish] ${redact([command, ...args].join(' '))}`)
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        stdio: ['inherit', 'pipe', 'pipe'],
        maxBuffer: 64 * 1024 * 1024,
        shell: process.platform === 'win32' && ['npm', 'yarn'].includes(command)
    })
    if (!quiet) {
        if (result.stdout) process.stdout.write(redact(result.stdout))
        if (result.stderr) process.stderr.write(redact(result.stderr))
    }
    if (result.error) fail(`无法运行 ${command}：${redact(result.error.message)}`)
    if (result.status !== 0 && !allowFailure) {
        if (quiet && result.stderr) process.stderr.write(redact(result.stderr))
        fail(`命令失败：${redact([command, ...args].join(' '))}（${result.status ?? result.signal}）`)
    }
    return { status: result.status, stdout: result.stdout?.trim() ?? '', stderr: result.stderr?.trim() ?? '' }
}

function git(args, options = {}) {
    return execute('git', args, { quiet: true, ...options })
}

function assertHostStopped(mirror) {
    // PID files are per instance, not a registry of processes sharing this code copy.
    // Do not log command lines: other processes may pass private credentials.
    const normalize = (value) => {
        const path = value.replaceAll('\\', '/')
        return process.platform === 'win32' ? path.toLowerCase() : path
    }
    const prefix = normalize(mirror) + '/'
    const referencesHost = (command) => {
        const text = normalize(command)
        return text.includes(prefix + 'packages/cli/launcher/') || text.includes(prefix + 'node_modules/@cordisjs/plugin-cli-cordis/')
    }
    let active
    if (process.platform === 'win32') {
        const result = execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
            'Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress'
        ], { quiet: true })
        const rows = JSON.parse(result.stdout || '[]')
        active = [rows].flat().filter((row) => row && typeof row.CommandLine === 'string' && referencesHost(row.CommandLine)).map((row) => row.ProcessId)
    } else {
        const result = execute('ps', ['-axo', 'pid=,args='], { quiet: true })
        active = result.stdout.split('\n').flatMap((line) => {
            const match = /^\s*(\d+)\s+(.+)$/.exec(line)
            return match && referencesHost(match[2]) ? [match[1]] : []
        })
    }
    if (active.length) fail(`该开发副本仍有 ChatLuna 进程运行（PID：${active.join(', ')}）；停止对应 launcher/worker 或改用闲置副本后重试，避免清理产物触发热重载错误`)
}

function assertUnchanged(head) {
    if (git(['rev-parse', '--verify', 'HEAD']).stdout !== head || git(['status', '--porcelain']).stdout) {
        fail('构建期间源码或 HEAD 已变化，停止发布；检查工作区后重新执行')
    }
}

function assertTagsAbsent(tag) {
    if (git(['tag', '--list', tag]).stdout) fail(`本地标签 ${tag} 已存在`)
    if (git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`]).stdout) {
        fail(`远端标签 ${tag} 已存在`)
    }
}

function assertBranchPushed(branch, head) {
    const remote = git(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]).stdout
    if (remote.split(/\s+/)[0] !== head) fail(`当前 HEAD 与 origin/${branch} 不一致，先完成提交和推送`)
}

function assertVersionUnused(name, version) {
    const result = execute('npm', ['view', `${name}@${version}`, 'version', '--json', '--registry', registry], { quiet: true, allowFailure: true })
    if (result.status === 0) fail(`${name}@${version} 已存在，不可重复发布`)
    if (!/E404/.test(result.stdout + result.stderr)) fail('无法确认 npm 版本是否存在，停止发布；检查网络、registry 与 npm 权限')
}

function checkPackage(directory, expected) {
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    if (manifest.name !== expected.name || manifest.version !== expected.version) fail('打包后的包名或版本与源码不一致')
    if (manifest.private) fail('打包后的包被标记为 private，不能发布')
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const [name, range] of Object.entries(manifest[section] ?? {})) {
            if (/^(workspace:|file:|link:|portal:)/.test(range)) fail(`包中仍有本地依赖：${name}=${range}`)
        }
    }
    for (const file of ['lib/index.js', 'lib/index.d.ts', 'dist/client.js', 'dist/client.css', 'dist/.vite/manifest.json', 'client/index.ts', 'README.md', 'LICENSE']) {
        const path = join(directory, file)
        if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).size === 0) fail(`发布包缺少有效文件：${file}`)
    }
    const visit = (folder) => {
        for (const item of readdirSync(folder, { withFileTypes: true })) {
            const path = join(folder, item.name)
            if (item.isSymbolicLink()) fail(`发布包包含符号链接：${relative(directory, path)}`)
            if (['.git', '.npmrc', 'node_modules', 'data', 'tests'].includes(item.name) || item.name.startsWith('.env') || item.name.endsWith('.tsbuildinfo')) {
                fail(`发布包包含不应发布的文件：${relative(directory, path)}`)
            }
            if (item.isDirectory()) visit(path)
        }
    }
    visit(directory)
    const assets = JSON.parse(readFileSync(join(directory, 'dist/.vite/manifest.json'), 'utf8'))
    for (const asset of Object.values(assets)) {
        for (const file of [asset.file, ...(asset.css ?? []), ...(asset.assets ?? [])]) {
            if (typeof file !== 'string') fail('客户端清单含无效资源路径')
            const path = resolve(directory, 'dist', file)
            const inside = relative(join(directory, 'dist'), path)
            if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`) || !existsSync(path)) fail(`客户端资源缺失或越界：${file}`)
        }
    }
}

async function main() {
    const args = process.argv.slice(2)
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`用法：node scripts/publish.mjs [--dry-run] [--otp=<验证码>] [--mirror <目录>]

发布 package.json 中的现有版本，不自动更新版本或提交代码。
正式发布要求干净工作区、HEAD 已推送到 origin 同名分支、Git/npm 版本未发布。
--dry-run  允许未提交内容，执行清理、构建、测试、打包和 npm 演练，不上传或打标签
--otp      npm 两步验证码，输出中隐藏；无需验证时不传
--mirror   ChatLuna 开发副本，默认 ../../chatluna-v2-mirror，也可用 CHATLUNA_V2_ROOT

正式发布经 npm 版本与 dist-tag 确认后，才创建并推送 v<版本> 标签。
正式发布和演练均要求开发副本闲置；检测到相关 launcher/worker 时拒绝同步或清理。
打包产物保留在系统临时目录；脚本不安装依赖、不启动服务、不推送分支。`)
        return
    }
    let dryRun = false
    let mirrorInput = process.env.CHATLUNA_V2_ROOT ?? resolve(source, '../../chatluna-v2-mirror')
    for (let index = 0; index < args.length; index++) {
        const arg = args[index]
        if (arg === '--dry-run') dryRun = true
        else if (arg.startsWith('--otp=')) {
            otp = arg.slice(6)
            if (!/^\d{6,8}$/.test(otp)) fail('OTP 必须是 6–8 位数字')
        } else if (arg === '--mirror') {
            mirrorInput = args[++index]
            if (!mirrorInput || mirrorInput.startsWith('--')) fail('--mirror 缺少目录参数')
        } else fail(`未知参数：${redact(arg)}`)
    }

    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
    const { name, version } = manifest
    if (name !== 'chatluna-plugin-onebot-poke') fail('发布脚本只能用于 chatluna-plugin-onebot-poke')
    if (manifest.private) fail('当前包标记为 private，不能发布')
    if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) fail('package.json 版本号无效')
    const prerelease = version.match(/^[^-+]+-([^+]+)/)?.[1]
    if (prerelease?.split('.').some((part) => /^0\d+$/.test(part))) fail('预发布版本的数字标识不能包含前导零')
    const channel = prerelease ? ['alpha', 'beta', 'rc', 'next'].find((name) => prerelease === name || prerelease.startsWith(`${name}.`)) ?? 'next' : 'latest'
    const tag = `v${version}`
    let head
    let branch
    if (!dryRun) {
        const commit = git(['rev-parse', '--verify', 'HEAD'], { allowFailure: true })
        if (commit.status !== 0) fail('Git 尚无提交，请先提交源码并设置、推送 origin')
        head = commit.stdout
        const current = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true })
        if (current.status !== 0) fail('当前处于 detached HEAD，不能发布')
        branch = current.stdout
        assertUnchanged(head)
        git(['remote', 'get-url', 'origin'])
        assertTagsAbsent(tag)
        assertBranchPushed(branch, head)
        const login = execute('npm', ['whoami', '--registry', registry], { quiet: true, allowFailure: true })
        if (login.status !== 0) fail('npm 未登录，请先运行 npm login')
        assertVersionUnused(name, version)
    }
    const mirror = realpathSync(resolve(mirrorInput.replaceAll('\\', '/')))
    const host = JSON.parse(readFileSync(join(mirror, 'package.json'), 'utf8'))
    if (host.name !== '@chatluna/root' || !host.workspaces?.includes('external/*')) fail('目标不是 ChatLuna 开发副本')
    const target = join(mirror, 'external/onebot-poke')
    console.log(`[publish] ${name}@${version} → ${channel}${dryRun ? '（演练，不上传）' : ''}`)
    assertHostStopped(mirror)
    execute(process.execPath, [join(source, 'scripts/dev.mjs'), 'sync', '--mirror', mirror])
    if (realpathSync(target) !== target) fail('发布目标不允许符号链接')
    assertHostStopped(mirror)
    for (const entry of ['lib', 'dist', 'tsconfig.tsbuildinfo']) {
        const path = join(target, entry)
        if (existsSync(path) && lstatSync(path).isSymbolicLink()) fail(`构建产物不允许符号链接：${entry}`)
        rmSync(path, { recursive: true, force: true })
    }
    execute(process.execPath, [join(source, 'scripts/dev.mjs'), 'check', '--mirror', mirror])
    if (!dryRun) assertUnchanged(head)

    workdir = mkdtempSync(join(tmpdir(), 'onebot-poke-publish-'))
    const tarball = join(workdir, 'package.tgz')
    execute('yarn', ['pack', '--out', tarball], { cwd: target })
    const files = execute('tar', ['-tzf', tarball], { quiet: true }).stdout.split('\n')
    if (files.some((file) => !file.startsWith('package/') || file.includes('\\') || file.split('/').includes('..'))) fail('压缩包包含不安全路径')
    execute('tar', ['-xzf', tarball, '-C', workdir])
    const packageDir = join(workdir, 'package')
    checkPackage(packageDir, manifest)
    if (!dryRun) {
        assertUnchanged(head)
        assertTagsAbsent(tag)
        assertBranchPushed(branch, head)
        assertVersionUnused(name, version)
    }

    // Publish the extracted directory, not the tarball, so npm includes README metadata.
    const publishArgs = ['publish', packageDir, '--access', 'public', '--tag', channel, '--registry', registry, '--ignore-scripts']
    if (dryRun) publishArgs.push('--dry-run')
    if (otp) publishArgs.push(`--otp=${otp}`)
    execute('npm', publishArgs)
    if (dryRun) {
        console.log(`[publish] 演练完成，未上传、未创建或推送标签。产物：${tarball}`)
        return
    }
    published = true
    for (let attempt = 0; attempt < 10; attempt++) {
        const check = execute('npm', ['view', name, 'versions', 'dist-tags', '--json', '--registry', registry], { quiet: true, allowFailure: true })
        if (check.status === 0) {
            try {
                const value = JSON.parse(check.stdout)
                if ([value.versions].flat().includes(version) && value['dist-tags']?.[channel] === version) {
                    assertUnchanged(head)
                    execute('git', ['tag', tag, head])
                    execute('git', ['push', 'origin', `refs/tags/${tag}`])
                    console.log(`[publish] 已确认 ${name}@${version}（${channel}），标签 ${tag} 已推送`)
                    return
                }
            } catch (error) {
                if (!(error instanceof SyntaxError)) throw error
            }
        }
        if (attempt < 9) await setTimeout(3000)
    }
    fail('npm 命令成功，但 registry 尚未确认目标版本和 dist-tag；未创建 Git 标签，请核实后处理，不要直接重复发布')
}

try {
    await main()
} catch (error) {
    console.error(`[publish] ${redact(error instanceof Error ? error.message : error)}`)
    if (published) console.error('[publish] npm 发布命令已成功，后续步骤失败；请检查 registry 与 Git 标签，禁止盲目重发')
    if (workdir) console.error(`[publish] 本次产物保留在 ${workdir}`)
    process.exitCode = 1
}
