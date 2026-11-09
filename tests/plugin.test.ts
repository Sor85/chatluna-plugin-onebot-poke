import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import { h, type Session } from '@satorijs/core'
import Database from '@cordisjs/plugin-database'
import Sqlite from '@cordisjs/plugin-database-sqlite'
import Permission from '@chatluna/permission'
import Koishi, { Channel, User, type Context as KoishiContext } from 'koishi'
import { OneBot, OneBotBot } from 'koishi-plugin-adapter-onebot'
import { apply, Config, inject, name } from '../src'

const plugin = { apply, Config, inject, name }
const roots: Context[] = []
const payload = {
    time: 1700000000,
    self_id: 10001,
    post_type: 'notice',
    notice_type: 'notify',
    sub_type: 'poke',
    user_id: 20002,
    target_id: 10001
}

async function host(config: Partial<Config> = {}, filter?: (session: Session) => boolean) {
    const ctx = new Context()
    roots.push(ctx)
    await ctx.plugin(Database)
    await ctx.plugin(Sqlite, { path: ':memory:' })
    await ctx.plugin(Permission, {})
    await ctx.plugin(Koishi, { prefix: ['/'] })
    // The host's database declaration wins the merged Context type; its runtime
    // object also owns Koishi's bound database methods after the plugin loads.
    const database: KoishiContext['database'] = Reflect.get(ctx, 'database')
    // No HTTP/server service is mounted, so the real adapter cannot connect.
    const bot = new OneBotBot(ctx, {
        protocol: 'http',
        selfId: '10001',
        advanced: { splitMixedContent: false }
    })
    const sent: { channelId: string; text: string; direct?: boolean }[] = []
    const send = vi.spyOn(bot, 'sendMessage').mockImplementation(async (channelId, content, _referrer, options) => {
        sent.push({ channelId, text: h.normalize(content).join(''), direct: options?.session?.isDirect })
        return [String(sent.length)]
    })
    const scope = filter ? ctx.intersect(filter) : ctx
    const fork = await scope.plugin(plugin, Config({
        cooldownSeconds: 0,
        actions: [{ type: 'message', weight: 1, content: '收到{userId}' }],
        ...config
    }))
    // Allow the adapter's deferred login-added event to finish before teardown.
    await new Promise((resolve) => setTimeout(resolve, 0))

    async function decode(extra: object = {}) {
        const data = { ...payload, ...extra }
        // OneBot.Payload overstates required fields for notices; exercise the real
        // parser with the subset a protocol endpoint sends, without type assertions.
        const session: Session = await Reflect.apply(OneBot.adaptSession, undefined, [bot, data])
        session.setInternal('onebot', data)
        return session
    }
    async function poke(extra: object = {}) {
        const session = await decode(extra)
        await ctx.parallel('internal/session', session)
        return session
    }
    return { ctx, database, bot, sent, send, fork, poke, decode }
}

afterEach(async () => {
    for (const ctx of roots.splice(0)) await ctx.fiber.dispose()
    vi.restoreAllMocks()
})

describe('real adapter and plugin integration', () => {
    it.each([
        { endpoint: 'NapCat', sender_id: 20002 },
        { endpoint: 'SnowLuma', sender_id: 20002 },
        { endpoint: 'LLBOT' }
    ])('replies privately after $endpoint decoding without mutating the notice', async ({ endpoint: _endpoint, ...extra }) => {
        const app = await host()
        const session = await app.decode(extra)
        expect(session.isDirect).toBe(false)
        const before = JSON.stringify(session.event)
        await app.ctx.parallel('internal/session', session)
        expect(app.sent).toEqual([{ channelId: 'private:20002', text: '收到20002', direct: true }])
        expect(JSON.stringify(session.event)).toBe(before)
    })

    it('sends a single group reply as plain text, not executable elements', async () => {
        const app = await host({ actions: [{ type: 'message', weight: 1, content: '<at id="{userId}"/>' }] })
        await app.poke({ group_id: 30003 })
        expect(app.sent).toEqual([{ channelId: '30003', text: '&lt;at id="20002"/&gt;', direct: false }])
    })

    it('accepts the current sandbox raw-notice attachment', async () => {
        const app = await host()
        const session = app.bot.session({ type: 'notice', channel: { id: 'private:20002', type: 1 } })
        session.subtype = 'poke'
        Object.assign(session, { onebot: { ...payload, sender_id: 20002 } })
        await app.ctx.parallel('internal/session', session)
        expect(app.sent).toHaveLength(1)
    })

    it('ignores unrelated targets and identifiable self-pokes', async () => {
        const app = await host()
        await app.poke({ target_id: 99999 })
        await app.poke({ sender_id: 10001 })
        await app.poke({ group_id: 30003, user_id: 10001 })
        expect(app.sent).toHaveLength(0)
    })

    it('honors group/private switches and the plugin context filter', async () => {
        const app = await host({ group: false, private: false })
        await app.poke()
        await app.poke({ group_id: 30003 })
        expect(app.sent).toHaveLength(0)
        const filtered = await host({}, (session) => session.userId === '99999')
        await filtered.poke()
        expect(filtered.sent).toHaveLength(0)
    })

    it('applies private context filters after fixing DIRECT', async () => {
        const app = await host({}, (session) => session.isDirect)
        await app.poke()
        await app.poke({ group_id: 30003 })
        expect(app.sent).toHaveLength(1)
    })

    it('does not respond with the default empty action list', async () => {
        const app = await host({ actions: Config({}).actions })
        await app.poke()
        expect(app.sent).toHaveLength(0)
    })

    it('reserves cooldown before awaiting and keeps user scopes independent', async () => {
        const app = await host({ cooldownSeconds: 30 })
        await Promise.all([app.poke({ group_id: 30003 }), app.poke({ group_id: 30003 })])
        await app.poke({ group_id: 30003, user_id: 20003 })
        expect(app.sent).toHaveLength(2)
    })

    it('shares channel and bot cooldowns when configured', async () => {
        const channel = await host({ cooldownSeconds: 30, cooldownScope: 'channel' })
        await channel.poke({ group_id: 30003 })
        await channel.poke({ group_id: 30003, user_id: 20003 })
        expect(channel.sent).toHaveLength(1)
        const bot = await host({ cooldownSeconds: 30, cooldownScope: 'bot' })
        await bot.poke()
        await bot.poke({ group_id: 30003, user_id: 20003 })
        expect(bot.sent).toHaveLength(1)
    })

    it('retains cooldown when a send fails', async () => {
        const app = await host({ cooldownSeconds: 30 })
        app.send.mockRejectedValueOnce(new Error('simulated send failure'))
        await app.poke()
        await app.poke()
        expect(app.send).toHaveBeenCalledTimes(1)
    })

    it('removes listeners on unload and resets cooldown on reload', async () => {
        const app = await host({ cooldownSeconds: 30 })
        await app.poke()
        await app.fork.dispose()
        await app.poke()
        expect(app.sent).toHaveLength(1)
        await app.ctx.plugin(plugin, Config({
            cooldownSeconds: 30,
            actions: [{ type: 'message', weight: 1, content: '重载后的响应' }]
        }))
        await app.poke()
        expect(app.sent).toHaveLength(2)
    })
})

describe('commands and real database permissions', () => {
    const command = (content: string): Partial<Config> => ({ actions: [{ type: 'command', weight: 1, content }] })

    it('executes as the poker, sends its result once and never dispatches a chat message', async () => {
        const app = await host(command('poke-who {userId}'))
        const messages = vi.fn()
        app.ctx.on('message', messages)
        app.ctx.command('poke-who <id:string>').userFields(['authority']).action(({ session }, id) => {
            return `${session?.userId}|${session?.isDirect}|${session?.user?.authority}|${id}`
        })
        await app.poke({ sender_id: 20002 })
        expect(app.sent.map((item) => item.text)).toEqual(['20002|true|1|20002'])
        expect(messages).not.toHaveBeenCalled()
    })

    it('denies admin commands for normal users and allows the actual authorized user', async () => {
        const app = await host(command('poke-admin'))
        const action = vi.fn(() => 'allowed')
        app.ctx.command('poke-admin', { authority: 3 }).action(action)
        await app.poke({ group_id: 30003 })
        expect(action).not.toHaveBeenCalled()
        await app.database.setUser('onebot', '20002', { authority: 3 })
        await app.poke({ group_id: 30003 })
        expect(action).toHaveBeenCalledTimes(1)
        expect(app.sent.at(-1)?.text).toBe('allowed')
    })

    it('enforces option permissions and command scope filters', async () => {
        const app = await host(command('poke-option --admin'))
        const action = vi.fn(() => 'not allowed')
        app.ctx.command('poke-option').option('admin', '--admin', { permissions: ['authority:3'] }).action(action)
        app.ctx.permissions.rule({ permission: 'command:poke-option:option:admin', effect: 'deny' })
        await app.poke()
        expect(action).not.toHaveBeenCalled()
        const scoped = app.ctx.never()
        scoped.command('poke-scoped').action(action)
        await app.fork.dispose()
        await app.ctx.plugin(plugin, Config({ ...command('poke-scoped'), cooldownSeconds: 0 }))
        await app.poke()
        expect(action).not.toHaveBeenCalled()
    })

    it('persists command-side observed user changes', async () => {
        const app = await host(command('poke-save'))
        app.ctx.command('poke-save').userFields(['name']).action(({ session }) => {
            if (session?.user) session.user.name = '戳一戳测试用户'
            return 'saved'
        })
        await app.poke()
        const user = await app.database.getUser('onebot', '20002', ['name'])
        expect(user?.name).toBe('戳一戳测试用户')
    })

    it('ignores blocked users and channels before commands or text replies', async () => {
        const app = await host()
        await app.database.createUser('onebot', '20002', { flag: User.Flag.ignore, authority: 5 })
        await app.poke()
        expect(app.sent).toHaveLength(0)
        await app.database.setUser('onebot', '20002', { flag: 0 })
        await app.database.createChannel('onebot', '30003', { flag: Channel.Flag.ignore })
        await app.poke({ group_id: 30003 })
        expect(app.sent).toHaveLength(0)
    })
})
