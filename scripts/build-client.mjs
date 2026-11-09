import { resolve } from 'node:path'
import { build } from '@chatluna/ui-client'

await build(resolve(import.meta.dirname, '..'))
