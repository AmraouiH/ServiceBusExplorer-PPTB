import type { DataverseContext, SbMessage } from '../models/types';
import { childNamed, decodeNbfx, fromDom, NbfxError, serialize, textOf, type XElement } from './nbfx';

/**
 * Reads the body of a message. Dataverse sends a RemoteExecutionContext in the format of its endpoint:
 * JSON (application/json), XML (application/xml) or .NETBinary (binary XML of the DataContractSerializer, application/msbin1).
 * Its OwningExtension is the step that sent the message (port of Services/MessageDecoder.cs).
 */

export const FormatJson = 'JSON';
export const FormatXml = 'XML';
export const FormatBinary = '.NETBinary';
export const FormatText = 'Text';
export const FormatRaw = 'Binary';

const MaxTextLength = 2000000;
const HexDumpBytes = 4096;
const JsonDate = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/;

export function decodeMessage(message: SbMessage): void {
    const body = message.body ?? new Uint8Array(0);
    message.context = undefined;
    message.bodyFormat = undefined;
    message.bodyText = '';
    if (body.length === 0) return;

    const text = utf8(body);
    const start = text?.trimStart()[0] ?? '';
    const binaryFirst = (message.contentType ?? '').toLowerCase().includes('msbin');

    if (!binaryFirst && text !== null && (start === '{' || start === '[') && tryJson(message, text)) return;
    if (!binaryFirst && text !== null && start === '<' && tryXml(message, text)) return;
    if (tryBinaryXml(message, body)) return;
    if (text !== null && isReadable(text)) {
        message.bodyFormat = FormatText;
        message.bodyText = cut(text);
        return;
    }
    message.bodyFormat = FormatRaw;
    message.bodyText = hexDump(body);
}

// #region Formats

function tryJson(message: SbMessage, text: string): boolean {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return false;
    }
    message.bodyFormat = FormatJson;
    message.bodyText = cut(JSON.stringify(value, null, 2));
    if (value && typeof value === 'object' && !Array.isArray(value)) message.context = fromJson(value as Record<string, unknown>);
    return true;
}

function tryXml(message: SbMessage, text: string): boolean {
    let doc: Document;
    try {
        doc = new DOMParser().parseFromString(text, 'text/xml');
    } catch {
        // Some parsers throw instead of returning a parsererror document.
        return false;
    }
    const root = doc.documentElement;
    if (!root || doc.getElementsByTagName('parsererror').length > 0 || root.localName === 'parsererror') return false;
    const tree = fromDom(root);
    message.bodyFormat = FormatXml;
    message.bodyText = cut(serialize(tree));
    message.context = fromXml(tree);
    return true;
}

function tryBinaryXml(message: SbMessage, body: Uint8Array): boolean {
    let tree: XElement;
    try {
        tree = decodeNbfx(body);
    } catch (error) {
        if (error instanceof NbfxError || error instanceof RangeError || error instanceof TypeError) return false;
        throw error;
    }
    message.bodyFormat = FormatBinary;
    message.bodyText = cut(serialize(tree));
    message.context = fromXml(tree);
    return true;
}

// #endregion

// #region Execution context

function fromJson(json: Record<string, unknown>): DataverseContext | undefined {
    const value = (name: string) => Object.entries(json).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
    const text = (v: unknown) => (v === null || v === undefined ? undefined : typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v));
    const owner = value('OwningExtension') as Record<string, unknown> | undefined;
    const context: DataverseContext = {
        stepId: toGuid(text(owner?.Id)),
        stepName: text(owner?.Name),
        messageName: text(value('MessageName')),
        table: text(value('PrimaryEntityName')),
        recordId: toGuid(text(value('PrimaryEntityId'))),
        userId: toGuid(text(value('UserId'))),
        initiatingUserId: toGuid(text(value('InitiatingUserId'))),
        organization: text(value('OrganizationName')),
        correlationId: toGuid(text(value('CorrelationId'))),
        operationId: toGuid(text(value('OperationId'))),
        stage: toInt(text(value('Stage'))),
        mode: toInt(text(value('Mode'))),
        depth: toInt(text(value('Depth'))),
        operationCreatedOn: toDate(text(value('OperationCreatedOn'))),
    };
    return isContext(context) ? context : undefined;
}

function fromXml(root: XElement): DataverseContext | undefined {
    const owner = childNamed(root, 'OwningExtension');
    const text = (name: string) => textOf(childNamed(root, name));
    const context: DataverseContext = {
        stepId: toGuid(textOf(childNamed(owner, 'Id'))),
        stepName: textOf(childNamed(owner, 'Name')),
        messageName: text('MessageName'),
        table: text('PrimaryEntityName'),
        recordId: toGuid(text('PrimaryEntityId')),
        userId: toGuid(text('UserId')),
        initiatingUserId: toGuid(text('InitiatingUserId')),
        organization: text('OrganizationName'),
        correlationId: toGuid(text('CorrelationId')),
        operationId: toGuid(text('OperationId')),
        stage: toInt(text('Stage')),
        mode: toInt(text('Mode')),
        depth: toInt(text('Depth')),
        operationCreatedOn: toDate(text('OperationCreatedOn')),
    };
    return isContext(context) ? context : undefined;
}

/** Any JSON or XML is not an execution context: it needs at least its step or its message. */
const isContext = (context: DataverseContext) => !!context.stepId || !!context.messageName;

function toGuid(value: string | undefined): string | undefined {
    const match = value ? /^\{?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}?$/i.exec(value.trim()) : null;
    if (!match || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(match[1])) return undefined;
    return match[1].toLowerCase();
}

function toInt(value: string | undefined): number | undefined {
    if (value === undefined || !/^-?\d+$/.test(value.trim())) return undefined;
    return Number(value);
}

/** ISO 8601 (XML), or « /Date(milliseconds+offset)/ » (DataContractJsonSerializer). */
function toDate(value: string | undefined): Date | undefined {
    if (!value) return undefined;
    const json = JsonDate.exec(value);
    if (json) return new Date(Number(json[1]));
    const parsed = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

// #endregion

// #region Text

function utf8(body: Uint8Array): string | null {
    try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
        return text.charCodeAt(0) === 0xfeff ? text.substring(1) : text;
    } catch {
        return null;
    }
}

function isReadable(text: string): boolean {
    const sample = text.length > 2000 ? text.substring(0, 2000) : text;
    let control = 0;
    for (const c of sample) {
        const code = c.charCodeAt(0);
        if ((code < 32 && c !== '\r' && c !== '\n' && c !== '\t') || (code >= 127 && code < 160)) control++;
    }
    return control * 20 < Math.max(1, sample.length);
}

const cut = (text: string) => (text.length <= MaxTextLength ? text : `${text.substring(0, MaxTextLength)}\n…`);

function hexDump(body: Uint8Array): string {
    const lines: string[] = [];
    const length = Math.min(body.length, HexDumpBytes);
    for (let offset = 0; offset < length; offset += 16) {
        let hex = '';
        let ascii = '';
        for (let i = 0; i < 16; i++) {
            if (offset + i < length) {
                const b = body[offset + i];
                hex += b.toString(16).toUpperCase().padStart(2, '0') + ' ';
                ascii += b >= 32 && b < 127 ? String.fromCharCode(b) : '.';
            } else hex += '   ';
        }
        lines.push(`${offset.toString(16).toUpperCase().padStart(6, '0')}  ${hex} ${ascii}`);
    }
    if (body.length > length) lines.push(`… ${body.length.toLocaleString('en-US')} bytes`);
    return lines.join('\n');
}

// #endregion
