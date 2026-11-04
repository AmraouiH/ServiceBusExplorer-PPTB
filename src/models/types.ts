import type { Language } from '../i18n/strings';

// #region Dataverse

/** Values of serviceendpoint.contract. */
export const EndpointContract = {
    OneWay: 1,
    Queue: 2,
    Rest: 3,
    TwoWay: 4,
    Topic: 5,
    QueuePersistent: 6,
    EventHub: 7,
    Webhook: 8,
    EventGrid: 9,
    ManagedDataLake: 10,
    ContainerStorage: 11,
} as const;

export const StepStage = { PreValidation: 10, PreOperation: 20, PostOperation: 40 } as const;
export const StepMode = { Synchronous: 0, Asynchronous: 1 } as const;
export const ImageKind = { Pre: 0, Post: 1, Both: 2 } as const;

export type SbKind = 'queue' | 'topic' | 'subscription';
export type RuleFilterKind = 'sql' | 'correlation' | 'true' | 'false';

/** A row of serviceendpoint. */
export interface EndpointInfo {
    id: string;
    name: string;
    description?: string;
    contract: number;
    /** Lower-case host of the namespace, null when the endpoint has none. */
    host: string | null;
    /** Queue or topic name, without the surrounding slashes. */
    path: string;
    sasKeyName?: string;
    authType: number;
    messageFormat: number;
    isManaged: boolean;
    steps: StepInfo[];
}

export const isServiceBusEndpoint = (e: EndpointInfo) => e.contract === EndpointContract.Queue || e.contract === EndpointContract.QueuePersistent || e.contract === EndpointContract.Topic;

export const expectedKind = (e: EndpointInfo): SbKind => (e.contract === EndpointContract.Topic ? 'topic' : 'queue');

/** A row of sdkmessageprocessingstepimage. id is empty until the image is created. */
export interface ImageInfo {
    id: string;
    name: string;
    alias: string;
    imageType: number;
    /** Comma-separated columns; empty means every column. */
    attributes: string;
    messageProperty?: string;
}

export const allColumns = (image: ImageInfo) => !image.attributes || image.attributes.trim().length === 0;

/** A row of sdkmessageprocessingstep bound to a service endpoint. */
export interface StepInfo {
    id: string;
    name: string;
    description: string;
    endpointId: string;
    endpointName?: string;
    messageId: string;
    message: string;
    filterId: string | null;
    /** Logical name of the table, null when the step runs for every table. */
    table: string | null;
    stage: number;
    mode: number;
    rank: number;
    enabled: boolean;
    filteringAttributes: string;
    deleteJobOnSuccess: boolean;
    isManaged: boolean;
    isCustomizable: boolean;
    images: ImageInfo[];
    /** Queue or topic name, for the lists. */
    targetPath?: string;
}

export const cloneStep = (step: StepInfo): StepInfo => ({ ...step, images: step.images.map((i) => ({ ...i })) });

export interface ColumnInfo {
    logicalName: string;
    displayName: string;
    type: string;
}

export interface MessageOption {
    id: string;
    name: string;
}

// #endregion

// #region Azure

/** A Service Bus namespace, as read from Azure or, when it is a ghost, only known from Dataverse. */
export interface SbNamespace {
    host: string;
    location?: string;
    sku?: string;
    status?: string;
    resourceId?: string;
    subscriptionName?: string;
    readWithKey: boolean;
    /** Referenced by a Dataverse endpoint but not connected in the tool. */
    isGhost: boolean;
    /** The namespace could not be read. */
    error?: string;
    errorDetails?: string;
    queues: SbEntity[];
    topics: SbEntity[];
}

export interface SbEntity {
    kind: SbKind;
    name: string;
    status?: string;
    /** Set by the loader; not serialized. */
    namespace: SbNamespace;
    topic?: SbEntity;
    /** Missing on Azure (or namespace not connected), only known from a Dataverse endpoint. */
    isGhost: boolean;
    activeMessages: number;
    deadLetterMessages: number;
    scheduledMessages: number;
    transferMessages: number;
    totalMessages: number;
    sizeBytes: number;
    maxSizeMegabytes: number;
    subscriptionCount: number;
    lockDuration?: string;
    defaultTimeToLive?: string;
    autoDeleteOnIdle?: string;
    maxDeliveryCount: number;
    requiresSession: boolean;
    requiresDuplicateDetection: boolean;
    deadLetterOnExpiration: boolean;
    partitioned: boolean;
    forwardTo?: string;
    forwardDeadLetteredTo?: string;
    createdOn?: Date;
    updatedOn?: Date;
    lastAccessedOn?: Date;
    subscriptions: SbEntity[];
    rules: SbRule[];
    /** Dataverse endpoints that send to this entity (filled by the matching). */
    endpoints: EndpointInfo[];
}

export interface SbRule {
    name: string;
    filterKind: RuleFilterKind;
    /** SQL expression, or the conditions of a correlation filter. */
    expression: string;
    actionExpression?: string;
}

export const entities = (ns: SbNamespace) => [...ns.queues, ...ns.topics];
export const allSubscriptions = (ns: SbNamespace) => ns.topics.flatMap((t) => t.subscriptions);

/** Queue or topic that receives the messages of the steps (a subscription is fed by its topic). */
export const targetOf = (e: SbEntity) => (e.kind === 'subscription' && e.topic ? e.topic : e);

export const stepsOf = (e: SbEntity) => targetOf(e).endpoints.flatMap((x) => x.steps);

export const isActive = (e: SbEntity) => !e.status || e.status.toLowerCase() === 'active';

export function newEntity(kind: SbKind, name: string, ns: SbNamespace, extra: Partial<SbEntity> = {}): SbEntity {
    return {
        kind,
        name,
        namespace: ns,
        isGhost: false,
        activeMessages: 0,
        deadLetterMessages: 0,
        scheduledMessages: 0,
        transferMessages: 0,
        totalMessages: 0,
        sizeBytes: 0,
        maxSizeMegabytes: 0,
        subscriptionCount: 0,
        maxDeliveryCount: 0,
        requiresSession: false,
        requiresDuplicateDetection: false,
        deadLetterOnExpiration: false,
        partitioned: false,
        subscriptions: [],
        rules: [],
        endpoints: [],
        ...extra,
    };
}

/** A namespace found with a Microsoft sign-in. */
export interface DiscoveredNamespace {
    host: string;
    resourceId: string;
    tenantId: string;
    subscriptionName: string;
    resourceGroup?: string;
    location?: string;
    sku?: string;
}

// #endregion

// #region Matching

export type MatchStatus = 'linked' | 'noSteps' | 'missingOnAzure' | 'typeMismatch' | 'notConnected' | 'noEndpoint' | 'otherType';

export interface MatchRow {
    status: MatchStatus;
    endpoint?: EndpointInfo;
    entity?: SbEntity;
    host: string | null;
    path: string;
}

export interface ExplorerModel {
    namespaces: SbNamespace[];
    endpoints: EndpointInfo[];
    steps: StepInfo[];
    rows: MatchRow[];
}

// #endregion

// #region Messages

/** What a Dataverse message says about the operation that produced it (RemoteExecutionContext). */
export interface DataverseContext {
    /** OwningExtension: the sdkmessageprocessingstep that sent the message. */
    stepId?: string;
    stepName?: string;
    messageName?: string;
    table?: string;
    recordId?: string;
    userId?: string;
    initiatingUserId?: string;
    organization?: string;
    correlationId?: string;
    operationId?: string;
    stage?: number;
    mode?: number;
    depth?: number;
    operationCreatedOn?: Date;
}

/** A message peeked from a queue or a subscription (never locked, never removed). */
export interface SbMessage {
    source: SbEntity;
    sequenceNumber: number;
    messageId?: string;
    correlationId?: string;
    subject?: string;
    contentType?: string;
    to?: string;
    replyTo?: string;
    sessionId?: string;
    enqueuedOn?: Date;
    expiresOn?: Date;
    scheduledFor?: Date;
    deliveryCount: number;
    properties: Array<[string, string]>;
    body: Uint8Array;
    context?: DataverseContext;
    bodyFormat?: string;
    bodyText: string;
    step?: StepInfo;
}

/** The messages read from one queue or subscription. */
export interface MessageBatch {
    source: SbEntity;
    messages: SbMessage[];
    /** More messages are waiting than the limit read. */
    truncated: boolean;
    error?: string;
    errorDetails?: string;
}

// #endregion

// #region Settings

export type ConnectionMethod = 'connectionString' | 'microsoft' | 'azureCli';

/** A namespace added by the user. */
export interface SavedConnection {
    host: string;
    method: ConnectionMethod;
    /** Connection string: kept in memory only, unless the user asked to remember it (stored as is in the ToolBox settings). */
    connectionString?: string;
    remember?: boolean;
    resourceId?: string;
    tenantId?: string;
    subscriptionName?: string;
}

export interface PluginSettings {
    language: Language;
    /** Azure requests sent in parallel to read subscriptions and filters (1 to 16). */
    parallelRequests: number;
    /** Active messages peeked per queue or subscription (1 to 5000). */
    maxMessages: number;
    /** Microsoft Entra tenant of the sign-in (empty = organizations). */
    tenantId: string;
    /** Public client of the sign-in (empty = Azure CLI). */
    clientId: string;
    connections: SavedConnection[];
}

export const MaxMessagesLimit = 5000;

export const defaultSettings: PluginSettings = {
    language: 'en',
    parallelRequests: 6,
    maxMessages: 100,
    tenantId: '',
    clientId: '',
    connections: [],
};

// #endregion
