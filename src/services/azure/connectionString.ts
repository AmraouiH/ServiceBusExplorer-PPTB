import type { Strings } from '../../i18n/strings';

/** A parsed Service Bus connection string, and the SAS token that authenticates its calls (port of ServiceBusConnectionInfo.cs). */
export interface ConnectionInfo {
    host: string;
    keyName?: string;
    key?: string;
    sharedAccessSignature?: string;
    entityPath?: string;
    /** Local Service Bus emulator: plain HTTP, no TLS. */
    isEmulator: boolean;
    /** Base of the management (Atom) calls, with a trailing slash. */
    managementUrl: string;
    /** The original string, for the AMQP client. */
    raw: string;
}

const EmulatorManagementPort = 5300;
const TokenMinutes = 60;

export function parseConnectionString(connectionString: string, strings: Strings): ConnectionInfo {
    const values = new Map<string, string>();
    for (const part of (connectionString ?? '').split(';')) {
        const index = part.indexOf('=');
        if (index > 0) values.set(part.substring(0, index).trim().toLowerCase(), part.substring(index + 1).trim());
    }

    const endpoint = values.get('endpoint');
    const match = endpoint ? /^[a-z][a-z0-9+.-]*:\/\/([^/:?#]+)(?::(\d+))?/i.exec(endpoint) : null;
    if (!match) throw new Error(strings.invalidConnectionString);

    const keyName = values.get('sharedaccesskeyname');
    const key = values.get('sharedaccesskey');
    const signature = values.get('sharedaccesssignature');
    const isEmulator = (values.get('usedevelopmentemulator') ?? '').toLowerCase() === 'true';
    if (!signature && (!keyName || !key)) throw new Error(strings.connectionStringNoKey);

    const host = match[1].toLowerCase();
    const port = isEmulator ? Number(match[2] ?? EmulatorManagementPort) : undefined;
    return {
        host,
        keyName,
        key,
        sharedAccessSignature: signature,
        entityPath: values.get('entitypath'),
        isEmulator,
        managementUrl: isEmulator ? `http://${host}:${port}/` : `https://${host}/`,
        raw: connectionString.trim(),
    };
}

/** Same escaping as Uri.EscapeDataString: RFC 3986 unreserved characters only. */
const escapeData = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function base64(bytes: ArrayBuffer): string {
    let text = '';
    for (const b of new Uint8Array(bytes)) text += String.fromCharCode(b);
    return btoa(text);
}

/** SharedAccessSignature for a resource, signed with HMAC-SHA256 (WebCrypto). */
export async function createSasToken(resource: string, keyName: string, key: string, expiry: Date): Promise<string> {
    const encoded = escapeData(resource);
    const seconds = String(Math.floor(expiry.getTime() / 1000));
    const hmacKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = base64(await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(`${encoded}\n${seconds}`)));
    return `SharedAccessSignature sr=${encoded}&sig=${escapeData(signature)}&se=${seconds}&skn=${escapeData(keyName)}`;
}

/** Value of the Authorization header of the management calls, valid one hour. */
export async function managementAuthorization(info: ConnectionInfo): Promise<string> {
    if (info.sharedAccessSignature) return info.sharedAccessSignature;
    return createSasToken(info.managementUrl, info.keyName!, info.key!, new Date(Date.now() + TokenMinutes * 60000));
}
