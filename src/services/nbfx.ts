/**
 * Decoder of the .NET Binary XML format ([MC-NBFX]), the « .NETBinary » message format of the Dataverse service endpoints
 * (application/msbin1: DataContractSerializer over XmlDictionaryWriter.CreateBinaryWriter).
 * It builds a light XML tree; dictionary strings, which need the dictionary of the writer, are shown as « dict_N ».
 */

export interface XElement {
    prefix: string;
    name: string;
    attributes: Array<{ prefix: string; name: string; value: string }>;
    children: Array<XElement | string>;
}

export class NbfxError extends Error {}

const letter = (index: number) => String.fromCharCode(97 + index);

class Reader {
    private offset = 0;
    private readonly view: DataView;
    private readonly utf8 = new TextDecoder('utf-8');
    private readonly utf16 = new TextDecoder('utf-16le');

    constructor(private readonly bytes: Uint8Array) {
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }

    get done() {
        return this.offset >= this.bytes.length;
    }

    private need(count: number) {
        if (this.offset + count > this.bytes.length) throw new NbfxError('Unexpected end of the binary XML');
    }

    byte(): number {
        this.need(1);
        return this.bytes[this.offset++];
    }

    peek(): number {
        this.need(1);
        return this.bytes[this.offset];
    }

    take(count: number): Uint8Array {
        this.need(count);
        const slice = this.bytes.subarray(this.offset, this.offset + count);
        this.offset += count;
        return slice;
    }

    int8() {
        this.need(1);
        return this.view.getInt8(this.offset++);
    }

    int16() {
        this.need(2);
        const v = this.view.getInt16(this.offset, true);
        this.offset += 2;
        return v;
    }

    uint16() {
        this.need(2);
        const v = this.view.getUint16(this.offset, true);
        this.offset += 2;
        return v;
    }

    int32() {
        this.need(4);
        const v = this.view.getInt32(this.offset, true);
        this.offset += 4;
        return v;
    }

    uint32() {
        this.need(4);
        const v = this.view.getUint32(this.offset, true);
        this.offset += 4;
        return v;
    }

    int64(): bigint {
        this.need(8);
        const v = this.view.getBigInt64(this.offset, true);
        this.offset += 8;
        return v;
    }

    uint64(): bigint {
        this.need(8);
        const v = this.view.getBigUint64(this.offset, true);
        this.offset += 8;
        return v;
    }

    float() {
        this.need(4);
        const v = this.view.getFloat32(this.offset, true);
        this.offset += 4;
        return v;
    }

    double() {
        this.need(8);
        const v = this.view.getFloat64(this.offset, true);
        this.offset += 8;
        return v;
    }

    /** MultiByteInt31: 7 bits per byte, low bits first. */
    mbi31(): number {
        let value = 0;
        for (let shift = 0; shift < 35; shift += 7) {
            const b = this.byte();
            value |= (b & 0x7f) << shift;
            if ((b & 0x80) === 0) return value >>> 0;
        }
        throw new NbfxError('Invalid MultiByteInt31');
    }

    string(): string {
        return this.utf8.decode(this.take(this.mbi31()));
    }

    chars(length: number) {
        return this.utf8.decode(this.take(length));
    }

    unicode(length: number) {
        return this.utf16.decode(this.take(length));
    }
}

const dictionary = (id: number) => `dict_${id}`;

function guid(bytes: Uint8Array): string {
    const hex = (from: number, to: number, reverse: boolean) => {
        const part = Array.from(bytes.subarray(from, to));
        return (reverse ? part.reverse() : part).map((b) => b.toString(16).padStart(2, '0')).join('');
    };
    return `${hex(0, 4, true)}-${hex(4, 6, true)}-${hex(6, 8, true)}-${hex(8, 10, false)}-${hex(10, 16, false)}`;
}

function base64(bytes: Uint8Array): string {
    let text = '';
    for (const b of bytes) text += String.fromCharCode(b);
    return btoa(text);
}

const TicksAtEpoch = 621355968000000000n;

function dateTime(raw: bigint): string {
    const ticks = raw & 0x3fffffffffffffffn;
    const kind = Number(raw >> 62n);
    const sinceEpoch = ticks - TicksAtEpoch;
    const ms = Number(sinceEpoch / 10000n);
    const fraction = ((sinceEpoch % 10000000n) + 10000000n) % 10000000n;
    const iso = new Date(ms).toISOString().substring(0, 19);
    const digits = fraction === 0n ? '' : `.${fraction.toString().padStart(7, '0').replace(/0+$/, '')}`;
    return `${iso}${digits}${kind === 1 ? 'Z' : ''}`;
}

function timeSpan(ticks: bigint): string {
    const negative = ticks < 0n;
    let rest = negative ? -ticks : ticks;
    const fraction = rest % 10000000n;
    rest /= 10000000n;
    const seconds = rest % 60n;
    rest /= 60n;
    const minutes = rest % 60n;
    rest /= 60n;
    const hours = rest % 24n;
    const days = rest / 24n;
    let text = `${negative ? '-' : ''}P`;
    if (days > 0n) text += `${days}D`;
    if (hours > 0n || minutes > 0n || seconds > 0n || fraction > 0n || days === 0n) {
        text += 'T';
        if (hours > 0n) text += `${hours}H`;
        if (minutes > 0n) text += `${minutes}M`;
        if (seconds > 0n || fraction > 0n || (hours === 0n && minutes === 0n)) text += `${seconds}${fraction > 0n ? `.${fraction.toString().padStart(7, '0').replace(/0+$/, '')}` : ''}S`;
    }
    return text;
}

function decimal(bytes: Uint8Array): string {
    const view = new DataView(bytes.buffer, bytes.byteOffset, 16);
    const scale = bytes[2];
    const negative = (bytes[3] & 0x80) !== 0;
    const hi = BigInt(view.getUint32(4, true));
    const lo = view.getBigUint64(8, true);
    const digits = ((hi << 64n) | lo).toString().padStart(scale + 1, '0');
    const text = scale > 0 ? `${digits.substring(0, digits.length - scale)}.${digits.substring(digits.length - scale)}` : digits;
    return `${negative ? '-' : ''}${text}`;
}

function formatFloat(value: number): string {
    if (Number.isNaN(value)) return 'NaN';
    if (value === Infinity) return 'INF';
    if (value === -Infinity) return '-INF';
    return String(value);
}

/** Reads one text record (its type byte already consumed, without the « with end element » bit). */
function text(reader: Reader, type: number): string {
    switch (type) {
        case 0x80:
            return '0';
        case 0x82:
            return '1';
        case 0x84:
            return 'false';
        case 0x86:
            return 'true';
        case 0x88:
            return String(reader.int8());
        case 0x8a:
            return String(reader.int16());
        case 0x8c:
            return String(reader.int32());
        case 0x8e:
            return reader.int64().toString();
        case 0x90:
            return formatFloat(reader.float());
        case 0x92:
            return formatFloat(reader.double());
        case 0x94:
            return decimal(reader.take(16));
        case 0x96:
            return dateTime(reader.uint64());
        case 0x98:
            return reader.chars(reader.byte());
        case 0x9a:
            return reader.chars(reader.uint16());
        case 0x9c:
            return reader.chars(reader.int32());
        case 0x9e:
            return base64(reader.take(reader.byte()));
        case 0xa0:
            return base64(reader.take(reader.uint16()));
        case 0xa2:
            return base64(reader.take(reader.int32()));
        case 0xa4: {
            const items: string[] = [];
            while (reader.peek() !== 0xa6) items.push(text(reader, reader.byte() & 0xfe));
            reader.byte();
            return items.join(' ');
        }
        case 0xa6:
            return '';
        case 0xa8:
            return '';
        case 0xaa:
            return dictionary(reader.mbi31());
        case 0xac:
            return `urn:uuid:${guid(reader.take(16))}`;
        case 0xae:
            return timeSpan(reader.int64());
        case 0xb0:
            return guid(reader.take(16));
        case 0xb2:
            return reader.uint64().toString();
        case 0xb4:
            return reader.byte() ? 'true' : 'false';
        case 0xb6:
            return reader.unicode(reader.byte());
        case 0xb8:
            return reader.unicode(reader.uint16());
        case 0xba:
            return reader.unicode(reader.int32());
        case 0xbc: {
            const prefix = letter(reader.byte());
            return `${prefix}:${dictionary(reader.mbi31())}`;
        }
        default:
            throw new NbfxError(`Unknown text record 0x${type.toString(16)}`);
    }
}

/** Element start records: returns null for another record. */
function elementStart(reader: Reader, type: number): XElement | null {
    const element = (prefix: string, name: string): XElement => ({ prefix, name, attributes: [], children: [] });
    if (type === 0x40) return element('', reader.string());
    if (type === 0x41) {
        const prefix = reader.string();
        return element(prefix, reader.string());
    }
    if (type === 0x42) return element('', dictionary(reader.mbi31()));
    if (type === 0x43) {
        const prefix = reader.string();
        return element(prefix, dictionary(reader.mbi31()));
    }
    if (type >= 0x44 && type <= 0x5d) return element(letter(type - 0x44), dictionary(reader.mbi31()));
    if (type >= 0x5e && type <= 0x77) return element(letter(type - 0x5e), reader.string());
    return null;
}

/** Attribute records: returns false for another record. */
function attribute(reader: Reader, type: number, target: XElement): boolean {
    const add = (prefix: string, name: string, value: string) => target.attributes.push({ prefix, name, value });
    const value = () => text(reader, reader.byte() & 0xfe);
    if (type === 0x04) {
        const name = reader.string();
        add('', name, value());
    } else if (type === 0x05) {
        const prefix = reader.string();
        const name = reader.string();
        add(prefix, name, value());
    } else if (type === 0x06) {
        const name = dictionary(reader.mbi31());
        add('', name, value());
    } else if (type === 0x07) {
        const prefix = reader.string();
        const name = dictionary(reader.mbi31());
        add(prefix, name, value());
    } else if (type === 0x08) add('', 'xmlns', reader.string());
    else if (type === 0x09) {
        const prefix = reader.string();
        add('xmlns', prefix, reader.string());
    } else if (type === 0x0a) add('', 'xmlns', dictionary(reader.mbi31()));
    else if (type === 0x0b) {
        const prefix = reader.string();
        add('xmlns', prefix, dictionary(reader.mbi31()));
    } else if (type >= 0x0c && type <= 0x25) {
        const name = dictionary(reader.mbi31());
        add(letter(type - 0x0c), name, value());
    } else if (type >= 0x26 && type <= 0x3f) {
        const name = reader.string();
        add(letter(type - 0x26), name, value());
    } else return false;
    return true;
}

/** Decodes a whole binary XML document; throws NbfxError when the bytes are not binary XML. */
export function decodeNbfx(bytes: Uint8Array): XElement {
    const reader = new Reader(bytes);
    const root: XElement = { prefix: '', name: '#document', attributes: [], children: [] };
    const stack: XElement[] = [root];
    const current = () => stack[stack.length - 1];

    while (!reader.done) {
        const type = reader.byte();
        if (type === 0x01) {
            if (stack.length === 1) throw new NbfxError('End element without element');
            stack.pop();
            continue;
        }
        if (type === 0x02) {
            reader.string();
            continue;
        }
        if (type === 0x03) {
            const item = elementStart(reader, reader.byte());
            if (!item) throw new NbfxError('Invalid array record');
            while (reader.peek() !== 0x01) if (!attribute(reader, reader.byte(), item)) throw new NbfxError('Invalid array record');
            reader.byte();
            const valueType = reader.byte() & 0xfe;
            const count = reader.mbi31();
            for (let i = 0; i < count; i++) current().children.push({ ...item, attributes: [...item.attributes], children: [text(reader, valueType)] });
            continue;
        }
        if (type >= 0x04 && type <= 0x3f) {
            if (stack.length === 1 || !attribute(reader, type, current())) throw new NbfxError('Attribute outside an element');
            continue;
        }
        const element = elementStart(reader, type);
        if (element) {
            current().children.push(element);
            stack.push(element);
            continue;
        }
        if (type >= 0x80 && type <= 0xbd) {
            if (stack.length === 1) throw new NbfxError('Text outside an element');
            current().children.push(text(reader, type & 0xfe));
            if (type & 1) stack.pop();
            continue;
        }
        throw new NbfxError(`Unknown record 0x${type.toString(16)}`);
    }

    if (stack.length !== 1) throw new NbfxError('Unclosed elements');
    const top = root.children.filter((c): c is XElement => typeof c !== 'string');
    if (top.length !== 1) throw new NbfxError('No root element');
    return top[0];
}

// #region Tree helpers

const escapeText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = (value: string) => escapeText(value).replace(/"/g, '&quot;');
const qualified = (prefix: string, name: string) => (prefix ? `${prefix}:${name}` : name);

/** Indented XML of a tree (an element holding only text stays on one line). */
export function serialize(element: XElement, indent = ''): string {
    const attributes = element.attributes.map((a) => ` ${qualified(a.prefix, a.name)}="${escapeAttribute(a.value)}"`).join('');
    const name = qualified(element.prefix, element.name);
    if (element.children.length === 0) return `${indent}<${name}${attributes} />`;
    if (element.children.every((c) => typeof c === 'string')) return `${indent}<${name}${attributes}>${escapeText((element.children as string[]).join(''))}</${name}>`;
    const inner = element.children
        .map((c) => (typeof c === 'string' ? (c.trim() ? `${indent}  ${escapeText(c.trim())}` : '') : serialize(c, `${indent}  `)))
        .filter((line) => line.length > 0);
    return `${indent}<${name}${attributes}>\n${inner.join('\n')}\n${indent}</${name}>`;
}

/** Tree of a parsed DOM element (XML bodies), to share the indentation and the reading of the context. */
export function fromDom(element: Element): XElement {
    const node: XElement = { prefix: element.prefix ?? '', name: element.localName, attributes: [], children: [] };
    for (let i = 0; i < element.attributes.length; i++) {
        const a = element.attributes[i];
        node.attributes.push({ prefix: a.prefix ?? '', name: a.prefix ? a.localName : a.name, value: a.value });
    }
    for (let child = element.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 1) node.children.push(fromDom(child as Element));
        else if (child.nodeType === 3 || child.nodeType === 4) node.children.push(child.nodeValue ?? '');
    }
    return node;
}

export const childElements = (element: XElement | undefined): XElement[] => (element ? (element.children.filter((c) => typeof c !== 'string') as XElement[]) : []);

export const childNamed = (element: XElement | undefined, name: string) => childElements(element).find((c) => c.name === name);

export const textOf = (element: XElement | undefined): string | undefined => {
    if (!element) return undefined;
    if (element.attributes.some((a) => a.name === 'nil' && a.value.toLowerCase() === 'true')) return undefined;
    return element.children.map((c) => (typeof c === 'string' ? c : '')).join('');
};

// #endregion
