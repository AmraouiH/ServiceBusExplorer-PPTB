import type { Strings } from '../i18n/strings';
import type { ExplorerModel, MessageBatch, SbEntity, SbNamespace, StepInfo } from '../models/types';
import { entities } from '../models/types';
import { AzureRequestError, isStopped, StoppedError, throwIfStopped } from './azure/http';
import type { MessageReader } from './azure/messageReader';
import { errorMessage } from './dataverse';
import { decodeMessage } from './messageDecoder';

/**
 * Peeks the active messages of queues and subscriptions, decodes them and finds the step that sent each one.
 * A topic keeps no message: its subscriptions do, each with its own copy. The dead-letter queue is not read.
 * (port of Services/MessageService.cs)
 */

/** Queues and subscriptions that hold the messages of an entity of the tree (none when it was not read on Azure). */
export function sourcesOf(entity: SbEntity | null | undefined): SbEntity[] {
    if (!entity || entity.isGhost || entity.namespace.isGhost || entity.namespace.error) return [];
    if (entity.kind !== 'topic') return [entity];
    return entity.subscriptions.filter((s) => !s.isGhost).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** Queue or topic the endpoint of the step sends to, undefined when the endpoint matches nothing. */
export const targetOfStep = (step: StepInfo, model: ExplorerModel | null) =>
    model?.namespaces.flatMap(entities).find((e) => e.endpoints.some((x) => x.id === step.endpointId));

/** Path of the entity in the namespace, as AMQP addresses it. */
export const pathOf = (entity: SbEntity) => (entity.kind === 'subscription' && entity.topic ? `${entity.topic.name}/Subscriptions/${entity.name}` : entity.name);

/**
 * @param openReader Reader of a namespace, closed after its entities are read.
 * @param max Messages read per queue or subscription.
 */
export async function readMessages(
    sources: SbEntity[],
    max: number,
    openReader: (ns: SbNamespace) => Promise<MessageReader>,
    progress: ((text: string) => void) | undefined,
    strings: Strings,
    signal?: AbortSignal,
): Promise<MessageBatch[]> {
    const batches: MessageBatch[] = [];
    const groups = new Map<SbNamespace, SbEntity[]>();
    for (const source of sources) groups.set(source.namespace, [...(groups.get(source.namespace) ?? []), source]);

    for (const [ns, group] of groups) {
        const wanted: MessageBatch[] = group.map((source) => ({ source, messages: [], truncated: false }));
        batches.push(...wanted);

        let fatal: AzureRequestError | Error | undefined;
        let reader: MessageReader | undefined;
        try {
            reader = await openReader(ns);
        } catch (error) {
            if (isStopped(error)) throw new StoppedError();
            fatal = error instanceof Error ? error : new Error(errorMessage(error));
        }

        try {
            for (const batch of wanted) {
                throwIfStopped(signal);
                if (fatal) {
                    setError(batch, fatal);
                    continue;
                }
                const path = pathOf(batch.source);
                progress?.(strings.readingMessages(path));
                try {
                    const messages = await reader!.peek(path, max + 1, signal);
                    batch.truncated = messages.length > max;
                    batch.messages = messages.slice(0, max);
                    for (const message of batch.messages) {
                        message.source = batch.source;
                        decodeMessage(message);
                    }
                } catch (error) {
                    if (isStopped(error)) throw error;
                    if (!(error instanceof AzureRequestError)) throw error;
                    setError(batch, error);
                    // Refused or unreachable: the other entities of the namespace would fail the same way, after the same wait.
                    if (error.fatal) fatal = error;
                }
            }
        } finally {
            await reader?.close();
        }
    }
    return batches;
}

function setError(batch: MessageBatch, error: Error) {
    batch.error = error.message;
    batch.errorDetails = error instanceof AzureRequestError ? error.details : undefined;
}

/** Links each message to the step named by its context. */
export function resolveSteps(batches: MessageBatch[], steps: StepInfo[] | undefined) {
    const byId = new Map((steps ?? []).map((s) => [s.id.toLowerCase(), s]));
    for (const message of batches.flatMap((b) => b.messages)) {
        const id = message.context?.stepId;
        message.step = id ? byId.get(id.toLowerCase()) : undefined;
    }
}
