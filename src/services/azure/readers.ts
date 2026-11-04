import type { Strings } from '../../i18n/strings';
import { newEntity, type DiscoveredNamespace, type SbEntity, type SbKind, type SbNamespace, type SbRule } from '../../models/types';
import { countEntries, condition, parseEntities, parseRules } from './atomParser';
import { managementAuthorization, type ConnectionInfo } from './connectionString';
import { AzureRequestError, getText, throwIfStopped } from './http';
import { TokenResource, type TokenProvider } from './tokens';

/** Read-only access to a namespace: the tool never writes to Azure. */
export interface ServiceBusReader {
    host: string;
    readWithKey: boolean;
    readDetails(ns: SbNamespace, signal?: AbortSignal): Promise<void>;
    readQueues(ns: SbNamespace, signal?: AbortSignal): Promise<SbEntity[]>;
    readTopics(ns: SbNamespace, signal?: AbortSignal): Promise<SbEntity[]>;
    readSubscriptions(topic: SbEntity, signal?: AbortSignal): Promise<SbEntity[]>;
    readRules(subscription: SbEntity, signal?: AbortSignal): Promise<SbRule[]>;
}

/** Entity names can hold slashes: they stay path separators. */
const escapePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

// #region Shared access key (Atom management endpoint)

const AtomApi = '2021-05';
const PageSize = 100;

/** Reads a namespace through its management endpoint with a shared access key (port of SasServiceBusReader.cs). */
export class SasReader implements ServiceBusReader {
    readonly readWithKey = true;

    constructor(
        private readonly info: ConnectionInfo,
        private readonly strings: Strings,
    ) {}

    get host() {
        return this.info.host;
    }

    // The location and the tier are not exposed to a shared access key.
    async readDetails(): Promise<void> {}

    readQueues(ns: SbNamespace, signal?: AbortSignal) {
        return this.pages('$Resources/queues', (feed) => parseEntities(feed, 'queue', ns), signal);
    }

    readTopics(ns: SbNamespace, signal?: AbortSignal) {
        return this.pages('$Resources/topics', (feed) => parseEntities(feed, 'topic', ns), signal);
    }

    readSubscriptions(topic: SbEntity, signal?: AbortSignal) {
        return this.pages(`${escapePath(topic.name)}/Subscriptions`, (feed) => parseEntities(feed, 'subscription', topic.namespace), signal);
    }

    readRules(subscription: SbEntity, signal?: AbortSignal) {
        return this.pages(`${escapePath(subscription.topic!.name)}/Subscriptions/${encodeURIComponent(subscription.name)}/rules`, parseRules, signal);
    }

    private async pages<T>(path: string, parse: (feed: string) => T[], signal?: AbortSignal): Promise<T[]> {
        const items: T[] = [];
        for (let skip = 0; ; skip += PageSize) {
            throwIfStopped(signal);
            const url = `${this.info.managementUrl}${path}?api-version=${AtomApi}&$skip=${skip}&$top=${PageSize}`;
            const feed = await getText(url, { Authorization: await managementAuthorization(this.info) }, this.strings, signal);
            items.push(...parse(feed));
            if (countEntries(feed) < PageSize) return items;
        }
    }
}

// #endregion

// #region Azure Resource Manager

/** Azure Resource Manager (replaced by the tests). */
export const Arm = { root: 'https://management.azure.com' };
const TenantApi = '2022-12-01';
const ServiceBusApi = '2021-11-01';

/** Paged GET on Azure Resource Manager, and discovery of the namespaces of an account (port of ArmClient.cs). */
export class ArmClient {
    constructor(
        private readonly tokens: TokenProvider,
        private readonly strings: Strings,
    ) {}

    async getObject(path: string, apiVersion: string, tenantId: string | undefined, signal?: AbortSignal): Promise<any> {
        return JSON.parse(await this.get(`${Arm.root}${path}?api-version=${apiVersion}`, tenantId, signal));
    }

    async getAll(path: string, apiVersion: string, tenantId: string | undefined, signal?: AbortSignal): Promise<any[]> {
        const items: any[] = [];
        let next: string | undefined = `${Arm.root}${path}?api-version=${apiVersion}`;
        while (next) {
            throwIfStopped(signal);
            const page = JSON.parse(await this.get(next, tenantId, signal));
            if (Array.isArray(page.value)) items.push(...page.value);
            next = page.nextLink || undefined;
        }
        return items;
    }

    private async get(url: string, tenantId: string | undefined, signal?: AbortSignal) {
        const token = await this.tokens.getToken(tenantId, TokenResource.Management, signal);
        return getText(url, { Authorization: `Bearer ${token}` }, this.strings, signal);
    }

    /** Every namespace the account can read, in all its tenants. A tenant or a subscription that refuses is skipped. */
    async discoverNamespaces(defaultTenant: string | undefined, progress: (text: string) => void, signal?: AbortSignal): Promise<DiscoveredNamespace[]> {
        const found: DiscoveredNamespace[] = [];
        const tenants = (await this.getAll('/tenants', TenantApi, defaultTenant, signal)).map((t) => t.tenantId as string).filter(Boolean);
        for (const tenant of tenants) {
            let subscriptions: any[];
            try {
                subscriptions = await this.getAll('/subscriptions', TenantApi, tenant, signal);
            } catch (error) {
                if (error instanceof AzureRequestError) continue;
                throw error;
            }
            for (const subscription of subscriptions) {
                const name = subscription.displayName as string;
                progress(this.strings.searchingIn(name));
                let namespaces: any[];
                try {
                    namespaces = await this.getAll(`/subscriptions/${subscription.subscriptionId}/providers/Microsoft.ServiceBus/namespaces`, ServiceBusApi, tenant, signal);
                } catch (error) {
                    // Subscription without access, or the Microsoft.ServiceBus provider is not registered on it.
                    if (error instanceof AzureRequestError) continue;
                    throw error;
                }
                for (const n of namespaces) {
                    const host = armHost(n);
                    if (!host) continue;
                    found.push({ host, resourceId: n.id, tenantId: tenant, subscriptionName: name, resourceGroup: segment(n.id, 'resourceGroups'), location: n.location, sku: n.sku?.name });
                }
            }
        }
        return found.sort((a, b) => a.host.localeCompare(b.host));
    }
}

/** Reads a namespace through Azure Resource Manager: the Reader role is enough, no key is needed (port of ArmServiceBusReader). */
export class ArmReader implements ServiceBusReader {
    readonly readWithKey = false;
    private hasTopics = true;
    private readonly client: ArmClient;

    constructor(
        tokens: TokenProvider,
        readonly host: string,
        private readonly resourceId: string,
        private readonly tenantId: string | undefined,
        strings: Strings,
    ) {
        this.client = new ArmClient(tokens, strings);
    }

    async readDetails(ns: SbNamespace, signal?: AbortSignal) {
        const resource = await this.client.getObject(this.resourceId, ServiceBusApi, this.tenantId, signal);
        ns.location = resource.location;
        ns.sku = resource.sku?.name;
        ns.status = resource.properties?.status;
        ns.resourceId = resource.id;
        // The Basic tier has no topics: the call would be refused.
        this.hasTopics = (ns.sku ?? '').toLowerCase() !== 'basic';
    }

    readQueues(ns: SbNamespace, signal?: AbortSignal) {
        return this.entities(`${this.resourceId}/queues`, 'queue', ns, signal);
    }

    async readTopics(ns: SbNamespace, signal?: AbortSignal) {
        return this.hasTopics ? this.entities(`${this.resourceId}/topics`, 'topic', ns, signal) : [];
    }

    readSubscriptions(topic: SbEntity, signal?: AbortSignal) {
        return this.entities(`${this.resourceId}/topics/${encodeURIComponent(topic.name)}/subscriptions`, 'subscription', topic.namespace, signal);
    }

    async readRules(subscription: SbEntity, signal?: AbortSignal) {
        const path = `${this.resourceId}/topics/${encodeURIComponent(subscription.topic!.name)}/subscriptions/${encodeURIComponent(subscription.name)}/rules`;
        return (await this.client.getAll(path, ServiceBusApi, this.tenantId, signal)).map(armRule);
    }

    private async entities(path: string, kind: SbKind, ns: SbNamespace, signal?: AbortSignal) {
        return (await this.client.getAll(path, ServiceBusApi, this.tenantId, signal)).map((r) => armEntity(r, kind, ns));
    }
}

// #endregion

// #region ARM parsing (port of ArmParser.cs)

const nullIfEmpty = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : undefined);

function armDate(value: unknown): Date | undefined {
    if (typeof value !== 'string' || !value) return undefined;
    const parsed = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
    return Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() < 1900 ? undefined : parsed;
}

export function armEntity(resource: any, kind: SbKind, ns: SbNamespace): SbEntity {
    const p = resource.properties ?? {};
    const c = p.countDetails ?? {};
    return newEntity(kind, resource.name, ns, {
        status: p.status,
        totalMessages: p.messageCount ?? 0,
        activeMessages: c.activeMessageCount ?? 0,
        deadLetterMessages: c.deadLetterMessageCount ?? 0,
        scheduledMessages: c.scheduledMessageCount ?? 0,
        transferMessages: c.transferMessageCount ?? 0,
        sizeBytes: p.sizeInBytes ?? 0,
        maxSizeMegabytes: p.maxSizeInMegabytes ?? 0,
        subscriptionCount: p.subscriptionCount ?? 0,
        lockDuration: p.lockDuration,
        defaultTimeToLive: p.defaultMessageTimeToLive,
        autoDeleteOnIdle: p.autoDeleteOnIdle,
        maxDeliveryCount: p.maxDeliveryCount ?? 0,
        requiresSession: !!p.requiresSession,
        requiresDuplicateDetection: !!p.requiresDuplicateDetection,
        deadLetterOnExpiration: !!p.deadLetteringOnMessageExpiration,
        partitioned: !!p.enablePartitioning,
        forwardTo: nullIfEmpty(p.forwardTo),
        forwardDeadLetteredTo: nullIfEmpty(p.forwardDeadLetteredMessagesTo),
        createdOn: armDate(p.createdAt),
        updatedOn: armDate(p.updatedAt),
        lastAccessedOn: armDate(p.accessedAt),
    });
}

export function armRule(resource: any): SbRule {
    const p = resource.properties ?? {};
    const rule: SbRule = { name: resource.name, filterKind: 'sql', expression: '', actionExpression: nullIfEmpty(p.action?.sqlExpression) };
    if (String(p.filterType ?? '').toLowerCase() === 'correlationfilter') {
        rule.filterKind = 'correlation';
        const f = p.correlationFilter ?? {};
        const conditions: string[] = [];
        for (const field of ['correlationId', 'messageId', 'to', 'replyTo', 'label', 'sessionId', 'replyToSessionId', 'contentType']) {
            const value = nullIfEmpty(f[field]);
            if (value !== undefined) conditions.push(condition(field === 'label' ? 'Subject' : field[0].toUpperCase() + field.substring(1), value));
        }
        for (const [name, value] of Object.entries(f.properties ?? {})) conditions.push(condition(name, String(value)));
        rule.expression = conditions.join(' AND ');
    } else {
        rule.expression = p.sqlFilter?.sqlExpression ?? '';
        rule.filterKind = rule.expression === '1=1' ? 'true' : rule.expression === '1=0' ? 'false' : 'sql';
    }
    return rule;
}

export function armHost(resource: any): string | null {
    const endpoint = resource?.properties?.serviceBusEndpoint as string | undefined;
    const match = endpoint ? /^[a-z]+:\/\/([^/:]+)/i.exec(endpoint) : null;
    return match ? match[1].toLowerCase() : null;
}

/** Segment of a resource id, for example « resourceGroups ». */
export function segment(resourceId: string | undefined, name: string): string | undefined {
    const parts = (resourceId ?? '').split('/').filter(Boolean);
    const index = parts.findIndex((p) => p.toLowerCase() === name.toLowerCase());
    return index >= 0 && index + 1 < parts.length ? parts[index + 1] : undefined;
}

// #endregion

// #region Loader

/** Reads a whole namespace: queues, topics, then the subscriptions and rules in parallel (port of NamespaceLoader.cs). */
export async function loadNamespace(reader: ServiceBusReader, parallel: number, progress: (text: string) => void, strings: Strings, signal?: AbortSignal): Promise<SbNamespace> {
    const ns: SbNamespace = { host: reader.host, readWithKey: reader.readWithKey, isGhost: false, queues: [], topics: [] };
    const name = ns.host.split('.')[0];
    await reader.readDetails(ns, signal);

    progress(strings.readingQueues(name));
    ns.queues = await reader.readQueues(ns, signal);
    progress(strings.readingTopics(name));
    ns.topics = await reader.readTopics(ns, signal);

    const limit = Math.max(1, Math.min(16, parallel));
    progress(strings.readingSubscriptions(name, ns.topics.length));
    await runLimited(ns.topics, limit, async (topic) => {
        const subscriptions = await reader.readSubscriptions(topic, signal);
        for (const subscription of subscriptions) subscription.topic = topic;
        topic.subscriptions.push(...subscriptions);
        topic.subscriptionCount = subscriptions.length;
    });

    const all = ns.topics.flatMap((t) => t.subscriptions);
    progress(strings.readingRules(name, all.length));
    await runLimited(all, limit, async (subscription) => {
        subscription.rules.push(...(await reader.readRules(subscription, signal)));
    });
    return ns;
}

/** At most `limit` calls in flight; the first failure stops the rest (the same refusal comes back from every call). */
async function runLimited<T>(items: T[], limit: number, action: (item: T) => Promise<void>): Promise<void> {
    let next = 0;
    let failure: unknown;
    const worker = async () => {
        while (next < items.length && failure === undefined) {
            const item = items[next++];
            try {
                await action(item);
            } catch (error) {
                failure ??= error;
            }
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
    if (failure !== undefined) throw failure;
}

// #endregion
