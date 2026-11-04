import type { Strings } from '../../i18n/strings';
import type { PluginSettings, SavedConnection, SbMessage } from '../../models/types';
import { parseConnectionString } from './connectionString';
import { AzureRequestError } from './http';
import { AmqpMessageReader, type MessageReader } from './messageReader';
import { ArmReader, SasReader, type ServiceBusReader } from './readers';
import { AzureCliProvider, DeviceCodeProvider, type TokenProvider } from './tokens';

/** Builds the readers of a saved connection (port of ConnectionFactory.cs). */

/** Connection strings entered for this session only (never written to the settings). */
const sessionSecrets = new Map<string, string>();

export const rememberSecret = (host: string, connectionString: string) => sessionSecrets.set(host.toLowerCase(), connectionString);
export const forgetSecret = (host: string) => sessionSecrets.delete(host.toLowerCase());
export const hasSecret = (connection: SavedConnection) => !!connection.connectionString || sessionSecrets.has(connection.host.toLowerCase());

function secretOf(connection: SavedConnection, strings: Strings): string {
    const secret = connection.connectionString ?? sessionSecrets.get(connection.host.toLowerCase());
    if (!secret) throw new AzureRequestError(0, strings.secretMissing, undefined, true);
    return secret;
}

export function tokenProvider(connection: SavedConnection, settings: PluginSettings, strings: Strings): TokenProvider {
    return connection.method === 'azureCli' ? new AzureCliProvider(strings) : new DeviceCodeProvider(settings.clientId, settings.tenantId, strings);
}

export function createReader(connection: SavedConnection, settings: PluginSettings, strings: Strings): ServiceBusReader {
    if (connection.method === 'connectionString') return new SasReader(parseConnectionString(secretOf(connection, strings), strings), strings);
    return new ArmReader(tokenProvider(connection, settings, strings), connection.host, connection.resourceId ?? '', connection.tenantId, strings);
}

/**
 * Message reader of the end-to-end tests: they cannot open AMQP WebSockets, so the in-memory host supplies the messages.
 * Never set by the ToolBox.
 */
interface E2EHooks {
    peek?: (host: string, path: string, max: number) => Promise<Array<Omit<SbMessage, 'source' | 'body'> & { body: number[] | Uint8Array }>>;
}

export function createMessageReader(connection: SavedConnection, settings: PluginSettings, strings: Strings): MessageReader {
    const hooks = (globalThis as any).__SBX_E2E__ as E2EHooks | undefined;
    if (hooks?.peek) {
        return {
            host: connection.host,
            peek: async (path, max) => {
                try {
                    return (await hooks.peek!(connection.host, path, max)).map((m) => ({ ...m, source: undefined as any, body: Uint8Array.from(m.body as ArrayLike<number>) }));
                } catch (error: any) {
                    throw new AzureRequestError(error?.status ?? 0, error?.message ?? String(error), error?.details, !!error?.fatal);
                }
            },
            close: async () => undefined,
        };
    }
    if (connection.method === 'connectionString') return AmqpMessageReader.withKey(parseConnectionString(secretOf(connection, strings), strings), strings);
    return AmqpMessageReader.withEntra(connection.host, tokenProvider(connection, settings, strings), connection.tenantId, strings);
}
