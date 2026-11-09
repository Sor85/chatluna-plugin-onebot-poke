import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const root = process.env.PUBLISH_FIXTURE_ROOT
if (!root) throw new Error('该替身只允许在隔离测试目录运行')
const options = JSON.parse(readFileSync(join(root, 'options.json'), 'utf8'))
const dev = process.argv[1].endsWith('dev.mjs')
const command = dev ? 'dev' : process.argv[2]
const args = process.argv.slice(dev ? 2 : 3)
appendFileSync(join(root, 'calls.jsonl'), JSON.stringify({ command, args, cwd: process.cwd() }) + '\n')
const head = 'a'.repeat(40)
const target = join(root, 'mirror/external/onebot-poke')
const source = join(root, 'source')
const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
function fail(text) {
    console.error(text)
    process.exit(1)
}
function file(path, content) {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, content)
}
if (command === 'ps') {
    if (options.processInspectionFailure) fail('simulated process inspection failure')
    if (options.runningHost) console.log(`4321 node ${realpathSync(join(root, 'mirror'))}/packages/cli/launcher/lib/bin.js dev`)
    if (options.hostStartsAfterSync && existsSync(join(root, 'synced'))) {
        console.log(`4322 node --import file://${realpathSync(join(root, 'mirror'))}/packages/cli/launcher/lib/dev.js worker.js`)
    }
    console.log('9999 node /another/mirror/packages/cli/launcher/lib/bin.js dev')
} else if (command === 'git') {
    if (args[0] === 'rev-parse') {
        if (options.unborn) fail('no HEAD')
        console.log(head)
    } else if (args[0] === 'symbolic-ref') {
        if (options.detached) fail('detached')
        console.log('main')
    } else if (args[0] === 'status') {
        if (options.dirty || (options.drift && existsSync(join(root, 'built')))) console.log(' M src/index.ts')
    } else if (args[0] === 'remote') {
        console.log('git@github.com:example/onebot-poke.git')
    } else if (args[0] === 'tag') {
        if (args[1] === '--list' && options.localTag) console.log(args[2])
    } else if (args[0] === 'ls-remote') {
        if (args.includes('--heads')) console.log(`${options.remoteMismatch ? 'b'.repeat(40) : head}\trefs/heads/main`)
        else if (options.remoteTag) console.log(`${head}\t${args[3]}`)
    } else if (args[0] === 'push') {
        if (options.pushFailure) fail('simulated push failure')
    } else fail(`未预期的 Git 命令：${args}`)
} else if (command === 'dev') {
    mkdirSync(target, { recursive: true })
    cpSync(join(source, 'package.json'), join(target, 'package.json'))
    if (args[0] === 'sync') file(join(root, 'synced'), 'yes')
    if (args[0] === 'check') {
        if (options.buildFailure) fail('simulated build failure')
        for (const entry of ['lib', 'dist', 'tsconfig.tsbuildinfo']) {
            if (existsSync(join(target, entry))) fail(`发布前没有清理 ${entry}`)
        }
        file(join(target, 'lib/index.js'), 'export const name = "test"\n')
        file(join(target, 'lib/index.d.ts'), 'export declare const name: string\n')
        file(join(target, 'dist/client.js'), 'export default function apply() {}\n')
        file(join(target, 'dist/client.css'), '.test { font-size: 14px }\n')
        file(join(target, 'dist/.vite/manifest.json'), JSON.stringify({ 'client/index.ts': { file: 'client.js', css: ['client.css'] } }))
        file(join(target, 'client/index.ts'), 'export default function apply() {}\n')
        file(join(target, 'README.md'), '# 测试插件\n')
        file(join(target, 'LICENSE'), 'MIT\n')
        file(join(root, 'built'), 'yes')
    } else if (args[0] !== 'sync') fail(`未预期的开发命令：${args}`)
} else if (command === 'yarn') {
    if (args[0] !== 'pack') fail(`未预期的 Yarn 命令：${args}`)
    if (options.packFailure) fail('simulated pack failure')
    const stage = join(root, 'pack-stage')
    const packageDir = join(stage, 'package')
    mkdirSync(packageDir, { recursive: true })
    for (const entry of ['lib', 'dist', 'client', 'README.md', 'LICENSE']) cpSync(join(target, entry), join(packageDir, entry), { recursive: true })
    const packed = structuredClone(manifest)
    if (!options.workspaceResidue) packed.devDependencies['@chatluna/schema'] = '2.0.0-alpha.0'
    if (options.wrongVersion) packed.version = '9.9.9'
    file(join(packageDir, 'package.json'), JSON.stringify(packed))
    if (options.missingAsset) rmSync(join(packageDir, 'dist/client.css'))
    if (options.secretFile) file(join(packageDir, '.env'), 'FAKE_TEST_VALUE=not-a-secret\n')
    if (options.badManifest) file(join(packageDir, 'dist/.vite/manifest.json'), JSON.stringify({ 'client/index.ts': { file: '../outside.js' } }))
    const tarball = args[args.indexOf('--out') + 1]
    execFileSync('tar', ['-czf', tarball, '-C', stage, 'package'])
} else if (command === 'npm') {
    if (args[0] === 'whoami') {
        if (options.loginFailure) fail('not logged in')
        console.log('fixture-user')
    } else if (args[0] === 'view' && args[2] === 'version') {
        if (options.registryFailure) fail('ECONNRESET')
        if (options.versionExists) console.log(JSON.stringify(manifest.version))
        else fail('E404 package version not found')
    } else if (args[0] === 'view' && args[2] === 'versions') {
        const firstCheck = join(root, 'registry-checked')
        if (options.registryDelay && !existsSync(firstCheck)) {
            file(firstCheck, 'yes')
            console.log(JSON.stringify({ versions: [manifest.version], 'dist-tags': { latest: '0.0.0-stage' } }))
            process.exit(0)
        }
        const pre = manifest.version.match(/^[^-+]+-([^+]+)/)?.[1]?.split('.')[0]
        const channel = pre ? ['alpha', 'beta', 'rc', 'next'].includes(pre) ? pre : 'next' : 'latest'
        console.log(JSON.stringify({ versions: [manifest.version], 'dist-tags': { [channel]: manifest.version } }))
    } else if (args[0] === 'publish') {
        const otp = args.find((arg) => arg.startsWith('--otp='))
        if (otp) console.error(`测试命令回显 ${otp}`)
        if (options.publishFailure) fail('simulated publish failure')
        console.log('fixture npm completed')
    } else fail(`未预期的 npm 命令：${args}`)
} else fail(`未预期的命令：${command}`)
