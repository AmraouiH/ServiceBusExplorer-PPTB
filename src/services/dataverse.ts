/**
 * Thin helpers over window.dataverseAPI (Web API): OData GET and FetchXML with paging (same as MergeIt).
 */

export type DvRecord = Record<string, any>;

const api = () => window.dataverseAPI;

/**
 * Relative Web API GET (e.g. "serviceendpoints?$select=name").
 * The ToolBox already sends Prefer: odata.include-annotations="*"; passing extra headers would trigger a consent prompt.
 */
export async function getJson<T = any>(path: string): Promise<T> {
    return (await api().queryData(path)) as T;
}

/** Every page of an OData collection (follows @odata.nextLink). */
export async function getAll(path: string): Promise<DvRecord[]> {
    const rows: DvRecord[] = [];
    let next: string | undefined = path;
    while (next) {
        const page: any = await getJson(next);
        rows.push(...((page?.value ?? []) as DvRecord[]));
        const link = page?.['@odata.nextLink'] as string | undefined;
        // The next link is absolute: queryData expects the path after /api/data/v9.x/.
        next = link ? link.replace(/^.*\/api\/data\/v[0-9.]+\//i, '') : undefined;
    }
    return rows;
}

interface FetchPage {
    records: DvRecord[];
    moreRecords: boolean;
    pagingCookie?: string;
}

async function fetchPage(fetchXml: string, entitySetName: string): Promise<FetchPage> {
    const result = (await getJson(`${entitySetName}?fetchXml=${encodeURIComponent(fetchXml)}`)) as Record<string, any>;
    const cookieAnnotation = result['@Microsoft.Dynamics.CRM.fetchxmlpagingcookie'] as string | undefined;
    const moreFlag = result['@Microsoft.Dynamics.CRM.morerecords'];
    return {
        records: (result.value ?? []) as DvRecord[],
        moreRecords: typeof moreFlag === 'boolean' ? moreFlag : cookieAnnotation !== undefined,
        pagingCookie: extractPagingCookie(cookieAnnotation),
    };
}

/** The Web API returns the paging cookie wrapped in a <cookie pagingcookie="..."> element, double URL-encoded. */
function extractPagingCookie(annotation: string | undefined): string | undefined {
    if (!annotation) return undefined;
    try {
        const doc = new DOMParser().parseFromString(annotation, 'text/xml');
        const encoded = doc.documentElement.getAttribute('pagingcookie');
        return encoded ? decodeURIComponent(decodeURIComponent(encoded)) : undefined;
    } catch {
        return undefined;
    }
}

/** Runs a FetchXML query on every page (5000 rows each). */
export async function fetchAll(fetchXml: string, entitySetName: string): Promise<DvRecord[]> {
    const doc = new DOMParser().parseFromString(fetchXml, 'text/xml');
    const root = doc.documentElement;
    root.setAttribute('count', '5000');
    const records: DvRecord[] = [];
    for (let page = 1, cookie: string | undefined; ; page++) {
        root.setAttribute('page', String(page));
        if (cookie) root.setAttribute('paging-cookie', cookie);
        const result = await fetchPage(new XMLSerializer().serializeToString(doc), entitySetName);
        records.push(...result.records);
        if (!result.moreRecords || result.records.length === 0) return records;
        cookie = result.pagingCookie;
    }
}

export function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    const message = (error as any)?.message ?? (error as any)?.error?.message;
    if (typeof message === 'string') return message;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

/** Runs an async action on every item with at most `limit` actions in flight. */
export async function mapLimit<T>(items: T[], limit: number, action: (item: T, index: number) => Promise<void>): Promise<void> {
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const index = next++;
            await action(items[index], index);
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

export function chunk<T>(source: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < source.length; i += size) chunks.push(source.slice(i, i + size));
    return chunks;
}

export function escapeXml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export const formatted = (record: DvRecord, attribute: string): string | undefined => record[`${attribute}@OData.Community.Display.V1.FormattedValue`];
