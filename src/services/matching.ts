import { entities, expectedKind, isServiceBusEndpoint, newEntity, type EndpointInfo, type ExplorerModel, type MatchRow, type MatchStatus, type SbEntity, type SbNamespace, type StepInfo } from '../models/types';

/**
 * Matches the Dataverse service endpoints with the Azure entities (namespace host + path, case-insensitive,
 * like Service Bus itself). What Dataverse references without Azure counterpart is added as a ghost, so its
 * steps stay visible and editable even when Azure cannot be read (port of Services/MatchingService.cs).
 */

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase();
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

export function buildModel(azure: SbNamespace[], endpoints: EndpointInfo[], steps: StepInfo[]): ExplorerModel {
    const namespaces = azure.filter((n) => !n.isGhost);
    for (const ns of namespaces) {
        ns.queues = ns.queues.filter((e) => !e.isGhost);
        ns.topics = ns.topics.filter((e) => !e.isGhost);
        for (const entity of entities(ns)) entity.endpoints = [];
    }

    for (const endpoint of endpoints) endpoint.steps = [];
    const byEndpoint = new Map(endpoints.map((e) => [e.id, e]));
    for (const step of steps) {
        const endpoint = byEndpoint.get(step.endpointId);
        if (!endpoint) continue;
        endpoint.steps.push(step);
        step.endpointName = endpoint.name;
        step.targetPath = endpoint.path;
    }

    const hosts = new Map(namespaces.filter((n) => !n.error).map((n) => [n.host.toLowerCase(), n]));
    const failed = new Map(namespaces.filter((n) => n.error).map((n) => [n.host.toLowerCase(), n]));
    const ghosts = new Map<string, SbNamespace>();
    const rows: MatchRow[] = [];

    for (const endpoint of [...endpoints].sort(byName)) {
        if (!isServiceBusEndpoint(endpoint) || !endpoint.host || !endpoint.path) {
            rows.push({ status: 'otherType', endpoint, host: endpoint.host, path: endpoint.path });
            continue;
        }

        let entity: SbEntity;
        let status: MatchStatus;
        const ns = hosts.get(endpoint.host.toLowerCase());
        if (ns) {
            const found = find(entities(ns), endpoint.path);
            if (!found) {
                entity = addGhost(ns, endpoint);
                status = 'missingOnAzure';
            } else {
                entity = found;
                if (found.isGhost) status = 'missingOnAzure';
                else if (found.kind !== expectedKind(endpoint)) status = 'typeMismatch';
                else status = endpoint.steps.length > 0 ? 'linked' : 'noSteps';
            }
        } else {
            const holder = failed.get(endpoint.host.toLowerCase()) ?? ghostOf(ghosts, endpoint.host);
            entity = find(entities(holder), endpoint.path) ?? addGhost(holder, endpoint);
            status = 'notConnected';
        }

        entity.endpoints.push(endpoint);
        rows.push({ status, endpoint, entity, host: endpoint.host, path: entity.name });
    }

    for (const ns of hosts.values()) {
        for (const entity of entities(ns).filter((e) => e.endpoints.length === 0)) rows.push({ status: 'noEndpoint', entity, host: ns.host, path: entity.name });
    }

    for (const ns of [...namespaces, ...ghosts.values()]) {
        ns.queues.sort(byName);
        ns.topics.sort(byName);
    }

    return {
        namespaces: [...namespaces, ...ghosts.values()].sort((a, b) => a.host.localeCompare(b.host, undefined, { sensitivity: 'base' })),
        endpoints,
        steps,
        rows,
    };
}

const find = (list: SbEntity[], path: string) => list.find((e) => same(e.name, path));

function ghostOf(ghosts: Map<string, SbNamespace>, host: string): SbNamespace {
    let ghost = ghosts.get(host.toLowerCase());
    if (!ghost) {
        ghost = { host, isGhost: true, readWithKey: false, queues: [], topics: [] };
        ghosts.set(host.toLowerCase(), ghost);
    }
    return ghost;
}

function addGhost(ns: SbNamespace, endpoint: EndpointInfo): SbEntity {
    const entity = newEntity(expectedKind(endpoint), endpoint.path, ns, { isGhost: true });
    (entity.kind === 'topic' ? ns.topics : ns.queues).push(entity);
    return entity;
}

export const isProblem = (status: MatchStatus) => status === 'missingOnAzure' || status === 'typeMismatch' || status === 'noSteps';
