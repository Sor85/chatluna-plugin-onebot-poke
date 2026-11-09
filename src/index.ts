import type { Context } from 'cordis'
import type {} from '@chatluna/ui-server'
import type { Config } from './config'
import { registerPokeResponses } from './service'

export { Config } from './config'

export const name = 'chatluna-onebot-poke'
export const inject = ['koishi', 'database', 'permissions']

export function apply(ctx: Context, config: Config) {
    registerPokeResponses(ctx, config)
    ctx.inject(['chatluna_webui'], (ctx) => {
        ctx.chatluna_webui.addEntry({
            baseUrl: import.meta.url,
            source: '../client/index.ts',
            bundle: '../dist/client.js'
        })
    })
}
