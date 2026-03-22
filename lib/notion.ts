import { Client } from '@notionhq/client'
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints'

export const notion = new Client({ auth: process.env.NOTION_TOKEN })

export function getPropText(page: PageObjectResponse, name: string): string {
    const prop = page.properties[name]
    if (!prop) return ''
    if (prop.type === 'title') return prop.title.map((t) => t.plain_text).join('')
    if (prop.type === 'rich_text') return prop.rich_text.map((t) => t.plain_text).join('')
    if (prop.type === 'select') return prop.select?.name ?? ''
    if (prop.type === 'url') return prop.url ?? ''
    return ''
}

export function getPropDate(page: PageObjectResponse, name: string): string | null {
    const prop = page.properties[name]
    if (!prop || prop.type !== 'date') return null
    return prop.date?.start ?? null
}

export function getPropMultiSelect(page: PageObjectResponse, name: string): string[] {
    const prop = page.properties[name]
    if (!prop || prop.type !== 'multi_select') return []
    return prop.multi_select.map((s) => s.name)
}

export function getPropFiles(page: PageObjectResponse, name: string): string | null {
    const prop = page.properties[name]
    if (!prop || prop.type !== 'files') return null
    const file = prop.files[0]
    if (!file) return null
    if (file.type === 'external') return file.external.url
    if (file.type === 'file') return file.file.url
    return null
}
