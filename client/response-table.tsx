import { useState } from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@chatluna/ui-kit'
import { extensionProps, inferFallback, type SchemaRendererProps } from '@chatluna/ui-schema-form/client'

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value))
        : {}
}

export function ResponseTable(props: SchemaRendererProps) {
    const [revision, setRevision] = useState(0)
    const items: unknown[] = Array.isArray(props.value) ? props.value : []
    const fields = Object.entries(props.schema.inner?.dict ?? {})
    const min = props.schema.meta.min ?? 0
    const max = props.schema.meta.max ?? Infinity
    const replaceRows = (next: unknown[]) => {
        // Structural edits discard the controls' local drafts instead of moving them to another row.
        setRevision((value) => value + 1)
        props.onChange(next)
    }
    const add = (
        <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={items.length >= max}
            onClick={() => replaceRows([...items, Object.fromEntries(fields.map(([key, field]) => [key, inferFallback(field)]))])}
        >
            <PlusIcon />
            添加一项
        </Button>
    )
    const descriptions = fields.flatMap(([key, field]) => {
        const description = field.meta.description
        return typeof description === 'string' && description !== field.meta.label ? [{ key, description }] : []
    })

    return (
        <div className="min-w-0 text-sm leading-5" data-poke-response-table="">
            {extensionProps(props, (
                <div className="space-y-2">
                    <div className="overflow-hidden rounded-lg border">
                        <Table aria-label={String(props.schema.meta.label ?? props.path)} className="min-w-[44rem] table-fixed">
                            <TableHeader>
                                <TableRow className="bg-muted/50 hover:bg-muted/50">
                                    {fields.map(([key, field]) => (
                                        <TableHead key={key} className={key === 'type' ? 'w-44 px-3' : key === 'weight' ? 'w-36 px-3' : 'px-3'}>
                                            {String(field.meta.label ?? key)}
                                        </TableHead>
                                    ))}
                                    <TableHead className="w-20 pr-3 text-right">操作</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {items.map((item, index) => {
                                    const row = record(item)
                                    const rowLabel = `第 ${index + 1} 项`
                                    return (
                                        <TableRow key={`${revision}:${index}`}>
                                            {fields.map(([key, field]) => {
                                                const path = `${props.path}.${index}.${key}`
                                                return (
                                                    <TableCell key={key} className="px-3 py-2 align-top">
                                                        <label className="sr-only" htmlFor={path}>{`${rowLabel}：${String(field.meta.label ?? key)}`}</label>
                                                        <div className="[&_[data-slot=select-trigger]]:w-full [&_[data-slot=input-group]]:w-full [&_textarea]:h-9 [&_textarea]:min-h-9">
                                                            {props.render(field, row[key], path, (value) => {
                                                                props.onChange(items.map((current, at) => at === index ? { ...row, [key]: value } : current))
                                                            }, { embedded: true })}
                                                        </div>
                                                    </TableCell>
                                                )
                                            })}
                                            <TableCell className="pr-3 align-top">
                                                <div className="flex justify-end">
                                                    <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" disabled={items.length <= min} aria-label={`删除：${rowLabel}`} title="删除" onClick={() => replaceRows(items.filter((_, at) => at !== index))}>
                                                        <Trash2Icon />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}
                                {items.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={fields.length + 1} className="h-20 text-center text-muted-foreground">暂无响应</TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                    {descriptions.map(({ key, description }) => (
                        <p key={key} className="text-xs leading-5 text-muted-foreground">{description}</p>
                    ))}
                </div>
            ), true, add)}
        </div>
    )
}
