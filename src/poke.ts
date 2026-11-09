export interface Poke {
    botId: string
    userId: string
    groupId?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readId(value: unknown): string | undefined {
    if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
        return String(value)
    }
}

export function normalizePoke(raw: unknown, selfId: string): Poke | undefined {
    if (
        !isRecord(raw) ||
        raw['post_type'] !== 'notice' ||
        raw['notice_type'] !== 'notify' ||
        raw['sub_type'] !== 'poke' ||
        readId(raw['self_id']) !== selfId ||
        readId(raw['target_id']) !== selfId
    ) {
        return
    }

    const rawGroupId = raw['group_id']
    const isPrivate = rawGroupId == null || rawGroupId === 0 || rawGroupId === '0'
    const groupId = isPrivate ? undefined : readId(rawGroupId)
    if (!isPrivate && !groupId) return

    // NapCat and SnowLuma use user_id for the private peer, sender_id for the actor.
    const userId = readId(isPrivate ? raw['sender_id'] ?? raw['user_id'] : raw['user_id'])
    if (!userId || userId === selfId) return
    return { botId: selfId, userId, groupId }
}

export function formatResponse(content: string, poke: Poke): string {
    return content.replace(/\{(userId|botId|groupId)\}/g, (_, key: string) => {
        if (key === 'userId') return poke.userId
        if (key === 'botId') return poke.botId
        return poke.groupId ?? ''
    })
}

export function cooldownKey(
    poke: Poke,
    scope: 'user' | 'channel' | 'bot'
): string {
    const channel = poke.groupId ? `group:${poke.groupId}` : `private:${poke.userId}`
    if (scope === 'bot') return JSON.stringify([poke.botId])
    if (scope === 'channel') return JSON.stringify([poke.botId, channel])
    return JSON.stringify([poke.botId, channel, poke.userId])
}
