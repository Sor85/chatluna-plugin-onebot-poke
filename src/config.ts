import { Schema } from '@chatluna/schema'
import type { ResponseAction } from './response'

export interface Config {
    group: boolean
    private: boolean
    cooldownSeconds: number
    cooldownScope: 'user' | 'channel' | 'bot'
    actions: ResponseAction[]
}

export const Config: Schema<Partial<Config>, Config> = Schema.intersect([
    Schema.object({
        group: Schema.boolean().default(true).extra('label', '群聊响应')
            .description('响应群聊中戳向当前机器人的事件'),
        private: Schema.boolean().default(true).extra('label', '私聊响应')
            .description('响应私聊中戳向当前机器人的事件')
    }).description('响应范围'),
    Schema.object({
        cooldownSeconds: Schema.number().min(0).max(86400).default(1)
            .extra('label', '响应间隔（秒）')
            .description('从响应开始计时，间隔内的事件直接忽略；0表示无时间间隔，同一作用域仍不会并发执行'),
        cooldownScope: Schema.union([
            Schema.const('user').description('会话内每位用户独立'),
            Schema.const('channel').description('整个会话共用'),
            Schema.const('bot').description('当前机器人全局共用')
        ]).default('user').extra('label', '间隔作用域')
            .description('不同机器人始终独立计时；私聊按会话对端区分')
    }).description('响应间隔'),
    Schema.object({
        actions: Schema.array(Schema.object({
            type: Schema.union([
                Schema.const('message').description('回复消息'),
                Schema.const('command').description('执行指令')
            ]).default('message').extra('label', '响应类型'),
            weight: Schema.number().min(0).default(1).extra('label', '权重')
                .description('实际概率为本项权重占所有有效项权重之和的比例，0表示禁用'),
            content: Schema.string().role('textarea').default('')
                .extra('label', '响应内容')
                .description('消息按纯文本发送；指令不含前缀，例如help；支持{userId}、{botId}和{groupId}，空内容不参与抽取')
        })).role('onebot-poke:actions').default([]).extra('label', '加权响应列表')
            .description('每次抽取一个响应，消息与指令共同参与抽取；指令以戳人者权限执行，不提升权限')
    }).description('响应内容')
])
