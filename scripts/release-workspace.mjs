import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

function within(root, location) {
    const path = resolve(root, location)
    const name = relative(root, path)
    if (isAbsolute(name) || name === '..' || name.startsWith(`..${sep}`)) throw new Error(`workspace 路径越界：${location}`)
    return path
}

function copyFile(from, to) {
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
}

function linkDependencies(from, to) {
    if (!existsSync(from)) return
    mkdirSync(to, { recursive: true })
    for (const item of readdirSync(from, { withFileTypes: true })) {
        const original = join(from, item.name)
        const target = join(to, item.name)
        if (item.name === '.yarn-state.yml') {
            copyFile(original, target)
            continue
        }
        // Keep cache locations local; never link the whole node_modules directory.
        if (item.name.startsWith('.') && item.name !== '.bin') continue
        if (item.name.startsWith('@') || item.name === '.bin') {
            linkDependencies(original, target)
            continue
        }
        if (item.name === 'chatluna-plugin-onebot-poke') continue
        const real = realpathSync(original)
        if (lstatSync(real).isDirectory()) {
            symlinkSync(real, target, process.platform === 'win32' ? 'junction' : 'dir')
        } else if (process.platform === 'win32') {
            copyFile(real, target)
        } else {
            symlinkSync(real, target, 'file')
        }
    }
}

export function prepareReleaseWorkspace(mirror, workspace, locations) {
    if (existsSync(workspace)) throw new Error('隔离构建目录必须是尚不存在的新目录')
    for (const required of ['yarn.lock', '.yarn/install-state.gz', 'node_modules/.yarn-state.yml']) {
        if (!existsSync(join(mirror, required))) throw new Error(`开发副本缺少 ${required}，先在开发副本完成依赖安装`)
    }
    mkdirSync(workspace, { recursive: true })
    copyFile(join(mirror, 'package.json'), join(workspace, 'package.json'))
    copyFile(join(mirror, 'yarn.lock'), join(workspace, 'yarn.lock'))
    copyFile(join(mirror, '.yarn/install-state.gz'), join(workspace, '.yarn/install-state.gz'))
    for (const file of ['yakumo.yml', 'tsconfig.base.json', 'tsconfig.client.json']) {
        if (existsSync(join(mirror, file))) copyFile(join(mirror, file), join(workspace, file))
    }

    // The target workspace is created by dev.mjs sync, preserving its ownership guard.
    // Other workspaces need manifests for Yarn resolution/pack, not writable source trees.
    for (const location of locations) {
        const original = within(mirror, location)
        const target = within(workspace, location)
        if (location !== '.' && original !== join(mirror, 'external/onebot-poke')) {
            copyFile(join(original, 'package.json'), join(target, 'package.json'))
        }
        if (original !== join(mirror, 'external/onebot-poke')) {
            linkDependencies(join(original, 'node_modules'), join(target, 'node_modules'))
        }
    }

    const host = JSON.parse(readFileSync(join(mirror, 'package.json'), 'utf8'))
    const yarnVersion = host.packageManager?.match(/^yarn@([^+]+)/)?.[1]
    const release = yarnVersion && join(mirror, '.yarn/releases', `yarn-${yarnVersion}.cjs`)
    const config = { nodeLinker: 'node-modules', enableScripts: false, enableTelemetry: false, enableNetwork: false }
    if (release && existsSync(release)) {
        const local = join('.yarn/releases', basename(release))
        copyFile(release, join(workspace, local))
        config.yarnPath = local.replaceAll('\\', '/')
    }
    // Never copy npmAuthToken or other credentials from the host's .yarnrc.yml.
    writeFileSync(join(workspace, '.yarnrc.yml'), JSON.stringify(config, null, 2) + '\n')
}

export function linkReleaseDependencies(mirror, workspace) {
    linkDependencies(
        join(mirror, 'external/onebot-poke/node_modules'),
        join(workspace, 'external/onebot-poke/node_modules')
    )
}
