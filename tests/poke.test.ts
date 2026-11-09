import { describe, expect, it } from 'vitest'
import { cooldownKey, formatResponse, normalizePoke } from '../src/poke'

const base = {
    time: 1700000000,
    self_id: 10001,
    post_type: 'notice',
    notice_type: 'notify',
    sub_type: 'poke',
    user_id: 20002,
    target_id: 10001
}

describe('OneBot poke normalization', () => {
    it.each(['NapCat', 'SnowLuma', 'LLBOT'])('%s group poke', () => {
        expect(normalizePoke({ ...base, group_id: 30003 }, '10001')).toEqual({
            botId: '10001',
            userId: '20002',
            groupId: '30003'
        })
    })

    it.each(['NapCat', 'SnowLuma'])('%s private poke uses sender_id', () => {
        expect(normalizePoke({ ...base, sender_id: 20002 }, '10001')).toEqual({
            botId: '10001',
            userId: '20002'
        })
        expect(normalizePoke({ ...base, sender_id: 10001 }, '10001')).toBeUndefined()
    })

    it('uses user_id for group actors even if an endpoint adds sender_id', () => {
        expect(normalizePoke({ ...base, group_id: 30003, sender_id: 10001 }, '10001')?.userId).toBe('20002')
    })

    it('supports LLBOT private notices without sender_id', () => {
        expect(normalizePoke(base, '10001')).toEqual({
            botId: '10001',
            userId: '20002'
        })
    })

    it('supports string IDs and zero group_id in private notices', () => {
        expect(normalizePoke({
            ...base,
            self_id: '10001',
            user_id: '20002',
            target_id: '10001',
            group_id: '0'
        }, '10001')).toEqual({ botId: '10001', userId: '20002' })
    })

    it.each([
        null,
        [],
        'poke',
        { ...base, post_type: 'message' },
        { ...base, notice_type: 'friend_add' },
        { ...base, sub_type: 'honor' },
        { ...base, target_id: 20002 },
        { ...base, self_id: 99999 },
        { ...base, user_id: 10001 },
        { ...base, user_id: undefined },
        { ...base, user_id: '20002 --admin' },
        { ...base, user_id: Number.MAX_SAFE_INTEGER + 1 },
        { ...base, sender_id: 'invalid' },
        { ...base, group_id: 'invalid' },
        { ...base, group_id: -1 }
    ])('rejects unrelated, self-generated or malformed events: %j', (raw) => {
        expect(normalizePoke(raw, '10001')).toBeUndefined()
    })
})

describe('response templates and cooldown scopes', () => {
    const poke = { botId: '10001', userId: '20002', groupId: '30003' }

    it('replaces only supported numeric identity placeholders', () => {
        expect(formatResponse('{userId}/{botId}/{groupId}/{userId}/{unknown}', poke))
            .toBe('20002/10001/30003/20002/{unknown}')
        expect(formatResponse('group={groupId}', { botId: '1', userId: '2' }))
            .toBe('group=')
    })

    it('isolates bots and conversations by default', () => {
        expect(cooldownKey(poke, 'user')).not.toBe(cooldownKey({ ...poke, botId: '9' }, 'user'))
        expect(cooldownKey(poke, 'user')).not.toBe(cooldownKey({ ...poke, userId: '9' }, 'user'))
        expect(cooldownKey(poke, 'user')).not.toBe(cooldownKey({ ...poke, groupId: '9' }, 'user'))
        expect(cooldownKey(poke, 'user')).not.toBe(cooldownKey({ botId: '10001', userId: '20002' }, 'user'))
    })

    it('shares channel cooldown within a group, not across private peers', () => {
        expect(cooldownKey(poke, 'channel')).toBe(cooldownKey({ ...poke, userId: '9' }, 'channel'))
        expect(cooldownKey({ botId: '1', userId: '2' }, 'channel'))
            .not.toBe(cooldownKey({ botId: '1', userId: '3' }, 'channel'))
    })

    it('shares bot cooldown across all of that bot’s conversations', () => {
        expect(cooldownKey(poke, 'bot'))
            .toBe(cooldownKey({ botId: '10001', userId: '9' }, 'bot'))
        expect(cooldownKey(poke, 'bot')).not.toBe(cooldownKey({ ...poke, botId: '9' }, 'bot'))
    })
})
