import { ServiceBusClient, type ServiceBusReceivedMessage, type ServiceBusReceiver } from '@azure/service-bus';
import type { Strings } from '../../i18n/strings';
import type { SbMessage } from '../../models/types';
import type { ConnectionInfo } from './connectionString';
import { AzureRequestError, StoppedError, throwIfStopped } from './http';
import { TokenResource, type TokenProvider } from './tokens';

/** Reads the active messages of a namespace without taking them (peek): nothing is locked, removed or counted as a delivery. */
export interface MessageReader {
    host: string;
    /** path: queue name, or « topic/Subscriptions/subscription ». */
    peek(path: string, max: number, signal?: AbortSignal): Promise<SbMessage[]>;
    close(): Promise<void>;
}

const BatchSize = 100;

/**
 * Peek through the Azure SDK: AMQP over WebSockets in the ToolBox (port 443, wss://host/$servicebus/websocket),
 * AMQP over TCP when the same code runs in Node (tests against the emulator).
 */
export class AmqpMessageReader implements MessageReader {
    private readonly client: ServiceBusClient;

    private constructor(
        readonly host: string,
        client: ServiceBusClient,
        private readonly strings: Strings,
    ) {
        this.client = client;
    }

    /** Shared access key or signature of a connection string: the Listen right is enough. */
    static withKey(info: ConnectionInfo, strings: Strings) {
        return new AmqpMessageReader(info.host, new ServiceBusClient(info.raw, { retryOptions: { maxRetries: 1, timeoutInMs: 30000 } }), strings);
    }

    /** Microsoft Entra token: needs the « Azure Service Bus Data Receiver » role (Reader is not enough). */
    static withEntra(host: string, tokens: TokenProvider, tenantId: string | undefined, strings: Strings) {
        const credential = {
            getToken: async () => ({ token: await tokens.getToken(tenantId, TokenResource.ServiceBus), expiresOnTimestamp: Date.now() + 30 * 60000 }),
        };
        return new AmqpMessageReader(host, new ServiceBusClient(host, credential, { retryOptions: { maxRetries: 1, timeoutInMs: 30000 } }), strings);
    }

    async peek(path: string, max: number, signal?: AbortSignal): Promise<SbMessage[]> {
        throwIfStopped(signal);
        const [topic, , subscription] = path.split('/Subscriptions/').length === 2 ? [path.split('/Subscriptions/')[0], '', path.split('/Subscriptions/')[1]] : [path, '', undefined];
        const options = { receiveMode: 'peekLock' as const, skipParsingBodyAsJson: true, skipConvertingDate: true };
        let receiver: ServiceBusReceiver | undefined;
        const messages: SbMessage[] = [];
        try {
            receiver = subscription ? this.client.createReceiver(topic, subscription, options) : this.client.createReceiver(topic, options);
            while (messages.length < max) {
                throwIfStopped(signal);
                // The receiver remembers the last sequence number peeked: each call continues after it.
                const batch = await receiver.peekMessages(Math.min(BatchSize, max - messages.length), { abortSignal: signal });
                if (batch.length === 0) break;
                messages.push(...batch.map(convert));
            }
            return messages;
        } catch (error) {
            if (signal?.aborted || (error as any)?.name === 'AbortError') throw new StoppedError();
            throw this.translate(error);
        } finally {
            await receiver?.close().catch(() => undefined);
        }
    }

    async close() {
        await this.client.close().catch(() => undefined);
    }

    private translate(error: any): AzureRequestError {
        const code = error?.code as string | undefined;
        const text = `${error?.message ?? error}`;
        if (code === 'UnauthorizedAccess' || error?.name === 'UnauthorizedError' || /unauthori[sz]ed|401|claim/i.test(text)) {
            return new AzureRequestError(401, this.strings.messagesAccessDenied(this.host), text, true);
        }
        if (code === 'MessagingEntityNotFound') return new AzureRequestError(404, this.strings.azureNotFound, text);
        if (code === 'ServiceCommunicationProblem' || code === 'ServiceTimeout' || /ENOTFOUND|ECONNREFUSED|websocket|network/i.test(text)) {
            return new AzureRequestError(0, this.strings.azureUnreachable(this.host), text, true);
        }
        return new AzureRequestError(0, this.strings.messagesFailed, code ? `${code}: ${text}` : text);
    }
}

const toDate = (value: unknown): Date | undefined => {
    if (value instanceof Date) return Number.isNaN(value.getTime()) || value.getUTCFullYear() >= 9999 ? undefined : value;
    if (typeof value === 'number') return new Date(value);
    return undefined;
};

const valueText = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Uint8Array) return btoa(String.fromCharCode(...value));
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
};

function bodyBytes(body: unknown): Uint8Array {
    if (body === null || body === undefined) return new Uint8Array(0);
    if (body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    // A value or sequence body (not what Dataverse sends): shown as JSON text.
    return new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body));
}

function convert(m: ServiceBusReceivedMessage): SbMessage {
    const sequence = m.sequenceNumber as any;
    return {
        source: undefined as any,
        sequenceNumber: typeof sequence?.toNumber === 'function' ? sequence.toNumber() : Number(sequence ?? 0),
        messageId: m.messageId === undefined ? undefined : String(m.messageId),
        correlationId: m.correlationId === undefined ? undefined : String(m.correlationId),
        subject: m.subject,
        contentType: m.contentType,
        to: m.to,
        replyTo: m.replyTo,
        sessionId: m.sessionId,
        enqueuedOn: toDate(m.enqueuedTimeUtc),
        expiresOn: toDate(m.expiresAtUtc),
        scheduledFor: toDate(m.scheduledEnqueueTimeUtc),
        deliveryCount: m.deliveryCount ?? 0,
        properties: Object.entries(m.applicationProperties ?? {}).map(([k, v]) => [k, valueText(v)] as [string, string]),
        body: bodyBytes(m.body),
        bodyText: '',
    };
}
