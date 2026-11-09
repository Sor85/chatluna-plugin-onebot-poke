import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [command = 'check', ...args] = process.argv.slice(2)
const commands = ['sync', 'install', 'build', 'typecheck', 'test', 'check']
if (!commands.includes(command) || (args.length && (args.length !== 2 || args[0] !== '--mirror'))) {
    throw new Error('用法：node scripts/dev.mjs <sync|install|build|typecheck|test|check> [--mirror <v2目录>]')
}
const mirror = await realpath(resolve((args[1] ?? process.env.CHATLUNA_V2_ROOT ?? resolve(source, '../../chatluna-v2-mirror')).replaceAll('\\', '/')))
const hostPackage = JSON.parse(await readFile(join(mirror, 'package.json'), 'utf8'))
if (hostPackage.name !== '@chatluna/root' || !hostPackage.workspaces?.includes('external/*')) {
    throw new Error('目标不是带有external/* workspace的ChatLuna v2开发环境')
}
const target = join(mirror, 'external/onebot-poke')
await mkdir(target, { recursive: true })
if (await realpath(target) !== target || source === target) {
    throw new Error('同步目标必须是独立目录，不允许符号链接或覆盖源码')
}
const markerPath = join(target, '.onebot-poke-sync.json')
const marker = await readFile(markerPath, 'utf8').then(JSON.parse).catch((error) => {
    if (error.code !== 'ENOENT') throw error
    return undefined
})
if (!marker && (await readdir(target)).length > 0) {
    throw new Error('同步目标已存在且不是本脚本创建的目录，停止以保护原有文件')
}
if (marker && marker.source !== source) {
    throw new Error('同步目标属于另一个源码目录，停止以保护原有文件')
}

async function listFiles(directory, prefix = '') {
    const files = []
    for (const item of await readdir(directory, { withFileTypes: true })) {
        if (item.name === '.DS_Store') continue
        const path = join(prefix, item.name)
        if (item.isSymbolicLink()) throw new Error(`源码不允许符号链接：${path}`)
        if (item.isDirectory()) files.push(...await listFiles(join(directory, item.name), path))
        else if (item.isFile()) files.push(path)
    }
    return files
}

const files = []
for (const entry of ['src', 'client', 'tests', 'scripts', 'package.json', 'tsconfig.json', 'tsconfig.check.json', 'tsconfig.client.json', 'vitest.config.ts', 'README.md', 'LICENSE', 'AGENTS.md', '.gitignore']) {
    const path = join(source, entry)
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) throw new Error(`源码不允许符号链接：${entry}`)
    files.push(...(stat.isDirectory() ? await listFiles(path, entry) : [entry]))
}

async function safeDestination(file) {
    const destination = resolve(target, file)
    const inside = relative(target, destination)
    if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`) || !inside) {
        throw new Error(`同步记录包含非法路径：${file}`)
    }
    // Check each existing component, not just the final path.
    let path = target
    for (const part of inside.split(sep)) {
        path = join(path, part)
        const stat = await lstat(path).catch((error) => {
            if (error.code !== 'ENOENT') throw error
        })
        if (stat?.isSymbolicLink()) throw new Error(`同步目标包含符号链接：${file}`)
    }
    return destination
}

for (const file of marker?.files ?? []) {
    if (!files.includes(file)) await rm(await safeDestination(file), { force: true })
}
for (const file of files) {
    const destination = await safeDestination(file)
    await mkdir(dirname(destination), { recursive: true })
    await cp(join(source, file), destination)
}
await writeFile(markerPath, JSON.stringify({ source, files }, null, 2) + '\n')
console.log(`已同步 ${files.length} 个文件至 ${target}`)

function run(cwd, args) {
    console.log(`运行：yarn ${args.join(' ')}`)
    const result = spawnSync(process.platform === 'win32' ? 'yarn.cmd' : 'yarn', args, {
        cwd,
        stdio: 'inherit',
        shell: process.platform === 'win32'
    })
    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status ?? 1)
}

if (command === 'install') run(mirror, ['install', '--mode=skip-build'])
if (command === 'build' || command === 'check') {
    // Avoid Yakumo tsc's root-level tsconfig.temp.json, which concurrent plugin
    // builds can overwrite. Build declarations, the server bundle and the UI entry.
    run(mirror, ['exec', 'tsc', '--build', 'external/onebot-poke/tsconfig.json'])
    run(mirror, ['yakumo', 'rolldown', 'onebot-poke'])
    run(target, ['exec', 'node', 'scripts/build-client.mjs'])
}
if (command === 'typecheck' || command === 'check') {
    run(mirror, ['exec', 'tsc', '-p', 'external/onebot-poke/tsconfig.check.json'])
    run(mirror, ['exec', 'tsc', '-p', 'external/onebot-poke/tsconfig.client.json'])
}
if (command === 'test' || command === 'check') run(target, ['exec', 'vitest', 'run'])
