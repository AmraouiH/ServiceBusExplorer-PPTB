import { newEntity, type SbEntity, type SbKind, type SbNamespace, type SbRule } from '../../models/types';

/**
 * Reads the Atom feeds of the Service Bus management endpoint. Elements are matched by local name:
 * the children of CountDetails live in another XML namespace than their parent (port of AtomParser.cs).
 * Only childNodes / localName are used, so the same code runs on a DOM or on xmldom in the tests.
 */

const XsiNamespace = 'http://www.w3.org/2001/XMLSchema-instance';

const elements = (parent: Element | null | undefined): Element[] => {
    if (!parent) return [];
    const result: Element[] = [];
    for (let node = parent.firstChild; node; node = node.nextSibling) if (node.nodeType === 1) result.push(node as Element);
    return result;
};

const child = (parent: Element | null | undefined, name: string) => elements(parent).find((e) => e.localName === name) ?? null;

const text = (parent: Element | null | undefined, name: string): string | undefined => {
    const value = child(parent, name)?.textContent;
    return value ? value : undefined;
};

const long = (parent: Element | null | undefined, name: string) => {
    const value = Number(text(parent, name));
    return Number.isFinite(value) ? value : 0;
};

const bool = (parent: Element | null | undefined, name: string) => (text(parent, name) ?? '').toLowerCase() === 'true';

function date(parent: Element | null | undefined, name: string): Date | undefined {
    const value = text(parent, name);
    if (!value) return undefined;
    const parsed = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
    return Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() < 1900 ? undefined : parsed;
}

function entries(feed: string): Element[] {
    const doc = new DOMParser().parseFromString(feed, 'text/xml');
    return elements(doc.documentElement).filter((e) => e.localName === 'entry');
}

const description = (entry: Element, name: string) => elements(child(entry, 'content')).find((e) => e.localName === name) ?? null;

export const countEntries = (feed: string) => entries(feed).length;

export function parseEntities(feed: string, kind: SbKind, ns: SbNamespace): SbEntity[] {
    const tag = kind === 'queue' ? 'QueueDescription' : kind === 'topic' ? 'TopicDescription' : 'SubscriptionDescription';
    const result: SbEntity[] = [];
    for (const entry of entries(feed)) {
        const d = description(entry, tag);
        const name = text(entry, 'title');
        if (!d || !name) continue;
        const counts = child(d, 'CountDetails');
        result.push(
            newEntity(kind, name, ns, {
                status: text(d, 'Status'),
                totalMessages: long(d, 'MessageCount'),
                activeMessages: long(counts, 'ActiveMessageCount'),
                deadLetterMessages: long(counts, 'DeadLetterMessageCount'),
                scheduledMessages: long(counts, 'ScheduledMessageCount'),
                transferMessages: long(counts, 'TransferMessageCount'),
                sizeBytes: long(d, 'SizeInBytes'),
                maxSizeMegabytes: long(d, 'MaxSizeInMegabytes'),
                subscriptionCount: long(d, 'SubscriptionCount'),
                lockDuration: text(d, 'LockDuration'),
                defaultTimeToLive: text(d, 'DefaultMessageTimeToLive'),
                autoDeleteOnIdle: text(d, 'AutoDeleteOnIdle'),
                maxDeliveryCount: long(d, 'MaxDeliveryCount'),
                requiresSession: bool(d, 'RequiresSession'),
                requiresDuplicateDetection: bool(d, 'RequiresDuplicateDetection'),
                deadLetterOnExpiration: bool(d, 'DeadLetteringOnMessageExpiration'),
                partitioned: bool(d, 'EnablePartitioning'),
                forwardTo: text(d, 'ForwardTo'),
                forwardDeadLetteredTo: text(d, 'ForwardDeadLetteredMessagesTo'),
                createdOn: date(d, 'CreatedAt'),
                updatedOn: date(d, 'UpdatedAt'),
                lastAccessedOn: date(d, 'AccessedAt'),
            }),
        );
    }
    return result;
}

const typeOf = (element: Element | null) => element?.getAttributeNS(XsiNamespace, 'type') || element?.getAttribute('i:type') || element?.getAttribute('xsi:type') || '';

export function parseRules(feed: string): SbRule[] {
    const result: SbRule[] = [];
    for (const entry of entries(feed)) {
        const d = description(entry, 'RuleDescription');
        if (!d) continue;
        const filter = child(d, 'Filter');
        const action = child(d, 'Action');
        const rule: SbRule = { name: text(d, 'Name') ?? text(entry, 'title') ?? '', filterKind: 'sql', expression: '' };

        switch (typeOf(filter)) {
            case 'CorrelationFilter':
                rule.filterKind = 'correlation';
                rule.expression = correlation(filter!);
                break;
            case 'TrueFilter':
                rule.filterKind = 'true';
                rule.expression = '1=1';
                break;
            case 'FalseFilter':
                rule.filterKind = 'false';
                rule.expression = '1=0';
                break;
            default:
                rule.expression = text(filter, 'SqlExpression') ?? '';
        }
        if (typeOf(action) === 'SqlRuleAction') rule.actionExpression = text(action, 'SqlExpression');
        result.push(rule);
    }
    return result;
}

function correlation(filter: Element): string {
    const conditions: string[] = [];
    for (const name of ['CorrelationId', 'MessageId', 'To', 'ReplyTo', 'Label', 'SessionId', 'ReplyToSessionId', 'ContentType']) {
        const value = text(filter, name);
        if (value !== undefined) conditions.push(condition(name === 'Label' ? 'Subject' : name, value));
    }
    for (const pair of elements(child(filter, 'Properties')).filter((e) => e.localName === 'KeyValueOfstringanyType')) {
        conditions.push(condition(text(pair, 'Key') ?? '', text(pair, 'Value') ?? ''));
    }
    return conditions.join(' AND ');
}

export const condition = (name: string, value: string) => `${name} = '${value}'`;
