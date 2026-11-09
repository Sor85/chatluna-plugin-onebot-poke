import type { Context } from 'cordis'
import { registerReactFormExtension } from '@chatluna/ui-schema-form/client'
import { ResponseTable } from './response-table'

export default function apply(ctx: Context) {
    ctx.effect(() => registerReactFormExtension({
        type: 'array',
        role: 'onebot-poke:actions',
        component: ResponseTable,
        priority: 30
    }))
}
