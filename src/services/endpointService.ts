import type { ColumnInfo, EndpointInfo, ImageInfo, MessageOption, StepInfo } from '../models/types';
import { allColumns } from '../models/types';
import { chunk, escapeXml, fetchAll, formatted, getAll, getJson, type DvRecord } from './dataverse';
import { imageProperty, normalizeColumns, sameImage } from './stepRules';

/**
 * Reads the service endpoints of the organization, their steps and images, and what the step editor offers
 * (messages, tables, columns); writes the steps and images (port of Services/Dataverse/EndpointService.cs).
 */

const ChunkSize = 200;
const DefaultSuffix = '.servicebus.windows.net';

/**
 * Lower-case host of an endpoint: the address (sb://name.servicebus.windows.net/) or, for the older
 * « namespace name » format, the name on the public cloud.
 */
export function normalizeHost(address: string | null | undefined, solutionNamespace: string | null | undefined): string | null {
    const trimmed = address?.trim();
    if (trimmed) {
        const host = hostOf(trimmed) ?? hostOf(`sb://${trimmed}`);
        if (host) return host;
    }
    const name = solutionNamespace?.trim();
    if (!name) return null;
    return (name.includes('.') ? name : name + DefaultSuffix).toLowerCase();
}

function hostOf(value: string): string | null {
    const match = /^[a-z][a-z0-9+.-]*:\/\/([^/:?#]+)/i.exec(value);
    return match ? match[1].toLowerCase() : null;
}

const value = (record: DvRecord, name: string) => record[name] ?? undefined;

/** iscustomizable is a BooleanManagedProperty: an object with Value, or a plain boolean depending on the query. */
const managedBoolean = (raw: any, fallback: boolean) => (typeof raw === 'boolean' ? raw : typeof raw?.Value === 'boolean' ? raw.Value : fallback);

export async function loadEndpoints(): Promise<EndpointInfo[]> {
    const rows = await getAll('serviceendpoints?$select=name,description,contract,namespaceaddress,solutionnamespace,path,saskeyname,authtype,messageformat,ismanaged');
    return rows.map((e) => ({
        id: e.serviceendpointid,
        name: e.name ?? '',
        description: e.description ?? undefined,
        contract: e.contract ?? 0,
        host: normalizeHost(e.namespaceaddress, e.solutionnamespace),
        path: String(e.path ?? '')
            .trim()
            .replace(/^\/+|\/+$/g, ''),
        sasKeyName: e.saskeyname ?? undefined,
        authType: e.authtype ?? 0,
        messageFormat: e.messageformat ?? 0,
        isManaged: !!e.ismanaged,
        steps: [],
    }));
}

const inCondition = (attribute: string, ids: string[]) =>
    `<condition attribute="${attribute}" operator="in">${ids.map((id) => `<value>${escapeXml(id)}</value>`).join('')}</condition>`;

export async function loadSteps(endpoints: EndpointInfo[]): Promise<StepInfo[]> {
    const steps: StepInfo[] = [];
    for (const ids of chunk(
        endpoints.map((e) => e.id),
        ChunkSize,
    )) {
        const fetchXml =
            '<fetch><entity name="sdkmessageprocessingstep">' +
            ['sdkmessageprocessingstepid', 'name', 'description', 'stage', 'mode', 'rank', 'statecode', 'filteringattributes', 'asyncautodelete', 'eventhandler', 'sdkmessageid', 'sdkmessagefilterid', 'ismanaged', 'iscustomizable']
                .map((a) => `<attribute name="${a}"/>`)
                .join('') +
            `<filter>${inCondition('eventhandler', ids)}</filter>` +
            '<link-entity name="sdkmessagefilter" from="sdkmessagefilterid" to="sdkmessagefilterid" link-type="outer" alias="f"><attribute name="primaryobjecttypecode"/></link-entity>' +
            '</entity></fetch>';
        steps.push(...(await fetchAll(fetchXml, 'sdkmessageprocessingsteps')).map(toStep));
    }
    await loadImages(steps);
    return steps.sort((a, b) => (a.table ?? '').localeCompare(b.table ?? '', undefined, { sensitivity: 'base' }) || a.message.localeCompare(b.message, undefined, { sensitivity: 'base' }));
}

function toStep(e: DvRecord): StepInfo {
    const table = value(e, 'f.primaryobjecttypecode') as string | undefined;
    return {
        id: e.sdkmessageprocessingstepid,
        name: e.name ?? '',
        description: e.description ?? '',
        endpointId: e._eventhandler_value ?? '',
        messageId: e._sdkmessageid_value ?? '',
        message: formatted(e, '_sdkmessageid_value') ?? '',
        filterId: e._sdkmessagefilterid_value ?? null,
        table: !table || table === 'none' ? null : table,
        stage: e.stage ?? 0,
        mode: e.mode ?? 0,
        rank: e.rank ?? 0,
        enabled: (e.statecode ?? 0) === 0,
        filteringAttributes: e.filteringattributes ?? '',
        deleteJobOnSuccess: !!e.asyncautodelete,
        isManaged: !!e.ismanaged,
        isCustomizable: managedBoolean(e.iscustomizable, true),
        images: [],
    };
}

async function loadImages(steps: StepInfo[]) {
    const byId = new Map(steps.map((s) => [s.id, s]));
    for (const ids of chunk(
        steps.map((s) => s.id),
        ChunkSize,
    )) {
        const fetchXml =
            '<fetch><entity name="sdkmessageprocessingstepimage">' +
            ['sdkmessageprocessingstepimageid', 'name', 'entityalias', 'imagetype', 'attributes', 'messagepropertyname', 'sdkmessageprocessingstepid'].map((a) => `<attribute name="${a}"/>`).join('') +
            `<filter>${inCondition('sdkmessageprocessingstepid', ids)}</filter>` +
            '</entity></fetch>';
        for (const image of await fetchAll(fetchXml, 'sdkmessageprocessingstepimages')) {
            const step = byId.get(image._sdkmessageprocessingstepid_value);
            if (!step) continue;
            step.images.push({
                id: image.sdkmessageprocessingstepimageid,
                name: image.name ?? '',
                alias: image.entityalias ?? '',
                imageType: image.imagetype ?? 0,
                attributes: image.attributes ?? '',
                messageProperty: image.messagepropertyname ?? undefined,
            });
        }
    }
}

// #region Step editor data

let messagesCache: { url: string; messages: MessageOption[] } | null = null;
const columnsCache = new Map<string, ColumnInfo[]>();

/** The caches belong to one organization. */
export function resetCaches() {
    messagesCache = null;
    columnsCache.clear();
}

/** Messages a step can be registered on, sorted by name. */
export async function loadMessages(connectionUrl: string): Promise<MessageOption[]> {
    if (messagesCache?.url === connectionUrl) return messagesCache.messages;
    const fetchXml =
        '<fetch distinct="true"><entity name="sdkmessage"><attribute name="sdkmessageid"/><attribute name="name"/>' +
        '<link-entity name="sdkmessagefilter" from="sdkmessageid" to="sdkmessageid" link-type="inner"><filter><condition attribute="iscustomprocessingstepallowed" operator="eq" value="1"/></filter></link-entity>' +
        '</entity></fetch>';
    const messages = (await fetchAll(fetchXml, 'sdkmessages'))
        .map((m) => ({ id: m.sdkmessageid as string, name: m.name as string }))
        .filter((m) => m.id && m.name)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    messagesCache = { url: connectionUrl, messages };
    return messages;
}

/** Tables of a message: logical name → sdkmessagefilter id. The key "" is the « all tables » filter. */
export async function loadTables(messageId: string): Promise<Map<string, string>> {
    const rows = await getAll(`sdkmessagefilters?$select=primaryobjecttypecode&$filter=_sdkmessageid_value eq ${messageId} and iscustomprocessingstepallowed eq true`);
    const tables = new Map<string, string>();
    for (const row of rows) {
        const table = row.primaryobjecttypecode as string | undefined;
        tables.set(!table || table === 'none' ? '' : table, row.sdkmessagefilterid);
    }
    return tables;
}

/** Readable columns of a table, cached for the connection. */
export async function loadColumns(table: string): Promise<ColumnInfo[]> {
    const cached = columnsCache.get(table);
    if (cached) return cached;
    const response = await getJson<{ value: DvRecord[] }>(
        `EntityDefinitions(LogicalName='${table.replace(/'/g, "''")}')/Attributes?$select=LogicalName,DisplayName,AttributeType,IsValidForRead,AttributeOf`,
    );
    const columns = (response.value ?? [])
        .filter((a) => a.IsValidForRead !== false && !a.AttributeOf && a.AttributeType !== 'Virtual')
        .map((a) => ({
            logicalName: a.LogicalName as string,
            displayName: (a.DisplayName?.UserLocalizedLabel?.Label as string) ?? (a.LogicalName as string),
            type: (a.AttributeType as string) ?? '',
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));
    columnsCache.set(table, columns);
    return columns;
}

// #endregion

// #region Writes

/** Attributes of the step that differ between the original and the draft (only those are sent). */
export function stepUpdate(original: StepInfo, draft: StepInfo): Record<string, unknown> {
    const update: Record<string, unknown> = {};
    if (draft.messageId !== original.messageId) update['sdkmessageid@odata.bind'] = `/sdkmessages(${draft.messageId})`;
    if (draft.filterId !== original.filterId) update['sdkmessagefilterid@odata.bind'] = draft.filterId ? `/sdkmessagefilters(${draft.filterId})` : null;
    if (draft.stage !== original.stage) update.stage = draft.stage;
    if (draft.mode !== original.mode) update.mode = draft.mode;
    if (draft.rank !== original.rank) update.rank = draft.rank;
    if ((draft.filteringAttributes ?? '') !== (original.filteringAttributes ?? '')) update.filteringattributes = draft.filteringAttributes ? draft.filteringAttributes : null;
    if (draft.deleteJobOnSuccess !== original.deleteJobOnSuccess) update.asyncautodelete = draft.deleteJobOnSuccess;
    if (draft.name !== original.name) update.name = draft.name;
    if (draft.description !== original.description) update.description = draft.description;
    return update;
}

/** Writes the changed attributes of a step, then its images (removed ones first). */
export async function saveStep(original: StepInfo, draft: StepInfo, progress?: (text: string) => void): Promise<void> {
    const dv = window.dataverseAPI;
    const update = stepUpdate(original, draft);
    if (Object.keys(update).length > 0) {
        progress?.(draft.name);
        await dv.update('sdkmessageprocessingstep', original.id, update);
    }

    for (const image of original.images.filter((i) => !draft.images.some((x) => x.id === i.id))) {
        await dv.delete('sdkmessageprocessingstepimage', image.id);
    }

    const property = imageProperty(draft.message);
    for (const image of draft.images) {
        const before = original.images.find((i) => i.id === image.id);
        if (before && image.id && sameImage(before, image) && before.messageProperty === property) continue;
        const record = imageRecord(image, property);
        if (!image.id) {
            await dv.create('sdkmessageprocessingstepimage', { ...record, 'sdkmessageprocessingstepid@odata.bind': `/sdkmessageprocessingsteps(${original.id})` });
        } else {
            await dv.update('sdkmessageprocessingstepimage', image.id, record);
        }
    }
}

const imageRecord = (image: ImageInfo, property: string | undefined): Record<string, unknown> => ({
    name: image.name,
    entityalias: image.alias,
    imagetype: image.imageType,
    attributes: allColumns(image) ? null : normalizeColumns(image.attributes),
    messagepropertyname: property ?? null,
});

export async function setEnabled(step: StepInfo, enabled: boolean): Promise<void> {
    await window.dataverseAPI.update('sdkmessageprocessingstep', step.id, { statecode: enabled ? 0 : 1, statuscode: enabled ? 1 : 2 });
}

// #endregion
