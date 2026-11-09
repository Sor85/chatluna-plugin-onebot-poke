import { Context } from 'cordis'
import { h, type Session } from '@satorijs/core'
import { Channel, User } from 'koishi'
import type {} from '@chatluna/permission'
import type { Config } from './config'
import { cooldownKey, formatResponse, normalizePoke } from './poke'
import { chooseResponse, ResponseGate } from './response'

export function registerPokeResponses(ctx: Context, config: Config) {
    const gate = new ResponseGate()
    let disposed = false
    ctx.effect(() => {
        const timer = setInterval(() => gate.prune(), 60_000)
        timer.unref()
        return () => {
            disposed = true
            clearInterval(timer)
            gate.clear()
        }
    })

    ctx.on('internal/session', async (incoming) => {
        if (
            disposed ||
            incoming.platform !== 'onebot' ||
            incoming.type !== 'notice' ||
            incoming.subtype !== 'poke'
        ) return

        const raw: unknown = incoming.event._data ?? Reflect.get(incoming, 'onebot')
        const poke = normalizePoke(raw, incoming.bot.selfId)
        if (!poke || (poke.groupId ? !config.group : !config.private)) return

        // Notices do not enter message middleware. Use a fresh session, never mutate
        // the shared notice; the OneBot adapter omits DIRECT on private poke events.
        const session: Session = incoming.bot.session({
            ...incoming.event,
            type: 'message',
            user: { ...incoming.event.user, id: poke.userId },
            member: incoming.event.member ? { ...incoming.event.member } : undefined,
            guild: poke.groupId ? { ...incoming.event.guild, id: poke.groupId } : undefined,
            channel: {
                ...incoming.event.channel,
                id: poke.groupId ?? `private:${poke.userId}`,
                type: poke.groupId ? 0 : 1
            },
            message: {}
        })
        const filter: unknown = Reflect.get(session, Context.filter)
        if (typeof filter === 'function' && !filter.call(session, ctx)) return

        const action = chooseResponse(config.actions)
        if (!action) return
        const key = cooldownKey(poke, config.cooldownScope)
        if (!gate.acquire(key, config.cooldownSeconds * 1000)) return

        try {
            const user: User = await session.observeUser(['id', 'flag', 'authority', 'permissions', 'locales'])
            if (user.flag & User.Flag.ignore) return
            if (!session.isDirect) {
                const channel: Channel = await session.observeChannel(['flag', 'permissions', 'locales'])
                if (channel.flag & Channel.Flag.ignore) return
            }
            if (disposed) return

            const content = formatResponse(action.content, poke)
            session.content = content
            if (action.type === 'message') {
                const ids = await session.send(h.text(content))
                if (ids.length === 0) ctx.logger.warn('Poke reply returned no message IDs')
            } else {
                // execute() keeps command/option permission checks and scope filters.
                // No dispatch: a preset command must not also enter the AI pipeline.
                await session.execute(content.trim())
            }
        } catch (error) {
            ctx.logger.warn('Poke response failed: %s', error)
        } finally {
            try {
                // Message middleware normally flushes these observed records. Notices
                // bypass it, so command-side user/channel changes need an explicit flush.
                await Promise.all([
                    session.user?.$update(),
                    session.channel?.$update(),
                    session.guild !== session.channel ? session.guild?.$update() : undefined
                ])
            } catch (error) {
                ctx.logger.warn('Poke session persistence failed: %s', error)
            }
            gate.release(key)
        }
    })
}
