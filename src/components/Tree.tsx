import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { BranchForkRegular, ChannelRegular, ChevronDownRegular, ChevronRightRegular, CloudRegular, FilterRegular, MailInboxRegular, TextBulletListLtrRegular } from '@fluentui/react-icons';
import { useStrings } from '../i18n/I18nContext';
import type { Strings } from '../i18n/strings';
import { entities, isActive, stepsOf, type ExplorerModel, type SbEntity, type SbNamespace, type SbRule } from '../models/types';
import { Colors, Pill } from './Common';

/** What a node of the tree stands for. */
export type TreeItem =
    | { kind: 'namespace'; ns: SbNamespace }
    | { kind: 'group'; ns: SbNamespace; group: 'queues' | 'topics' }
    | { kind: 'entity'; entity: SbEntity }
    | { kind: 'rule'; rule: SbRule; subscription: SbEntity };

/** Stable key of an item: survives a reload of the model. */
export function itemKey(item: TreeItem): string {
    switch (item.kind) {
        case 'namespace':
            return `n:${item.ns.host}`;
        case 'group':
            return `g:${item.group}:${item.ns.host}`;
        case 'entity':
            return entityKey(item.entity);
        case 'rule':
            return `r:${entityKey(item.subscription)}/${item.rule.name}`;
    }
}

export const entityKey = (e: SbEntity) => `e:${e.namespace.host}/${e.topic?.name ?? ''}/${e.kind}/${e.name}`.toLowerCase();

interface Node {
    key: string;
    item: TreeItem;
    title: string;
    caption?: string;
    icon: ReactNode;
    color: string;
    muted?: boolean;
    bold?: boolean;
    pills: Array<{ text: string; color: string }>;
    children: Node[];
    /** Collapsed when the user never touched it. */
    collapsedByDefault?: boolean;
}

const contains = (value: string | undefined, filter: string) => filter.length === 0 || (value ?? '').toLowerCase().includes(filter.toLowerCase());

function statusPills(entity: SbEntity, s: Strings) {
    const pills: Node['pills'] = [];
    if (entity.isGhost && !entity.namespace.isGhost && !entity.namespace.error) pills.push({ text: s.pillMissing, color: Colors.danger });
    if (!isActive(entity)) pills.push({ text: s.pillDisabled, color: Colors.muted });
    if (entity.deadLetterMessages > 0) pills.push({ text: s.pillDeadLetter, color: Colors.danger });
    return pills;
}

const stepPill = (count: number, s: Strings) => (count > 0 ? [{ text: s.pillSteps(count), color: Colors.accent }] : []);

/** Builds the visible tree: the filters hide what does not match, unless a child matches (port of RebuildTree). */
export function buildTree(model: ExplorerModel | null, filter: string, onlyLinked: boolean, s: Strings): Node[] {
    if (!model) return [];
    const result: Node[] = [];
    for (const ns of model.namespaces) {
        const children: Node[] = [];
        for (const [group, list, icon, color] of [
            ['queues', ns.queues, <TextBulletListLtrRegular />, Colors.queue],
            ['topics', ns.topics, <BranchForkRegular />, Colors.topic],
        ] as const) {
            const nodes = list.map((e) => entityNode(e, filter, onlyLinked, s)).filter((n): n is Node => n !== null);
            if (nodes.length === 0) continue;
            const item: TreeItem = { kind: 'group', ns, group };
            children.push({ key: itemKey(item), item, title: group === 'queues' ? s.groupQueues : s.groupTopics, caption: String(nodes.length), icon, color, pills: [], children: nodes });
        }

        const item: TreeItem = { kind: 'namespace', ns };
        const pills = ns.error ? [{ text: s.pillError, color: Colors.danger }] : ns.isGhost ? [{ text: s.pillNotConnected, color: Colors.warning }] : stepPill(entities(ns).flatMap(stepsOf).length, s);
        const keep = children.length > 0 || (filter.length === 0 && !onlyLinked) || contains(ns.host, filter);
        if (!keep) continue;
        result.push({
            key: itemKey(item),
            item,
            title: ns.host.split('.')[0],
            caption: ns.isGhost || ns.error ? ns.host : s.namespaceCaption(ns.queues.filter((q) => !q.isGhost).length, ns.topics.filter((t) => !t.isGhost).length),
            icon: <CloudRegular />,
            color: Colors.accent,
            muted: ns.isGhost,
            bold: true,
            pills,
            children,
        });
    }
    return result;
}

function entityNode(entity: SbEntity, filter: string, onlyLinked: boolean, s: Strings): Node | null {
    const isTopic = entity.kind === 'topic';
    const children = isTopic
        ? [...entity.subscriptions]
              .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
              .map((sub) => subscriptionNode(sub, filter, s))
              .filter((n): n is Node => n !== null)
        : [];
    const linked = !onlyLinked || stepsOf(entity).length > 0;
    const matches = contains(entity.name, filter) || children.length > 0;
    if (!linked || !matches) return null;
    const item: TreeItem = { kind: 'entity', entity };
    return {
        key: itemKey(item),
        item,
        title: entity.name,
        caption: entity.isGhost ? s.kindLabel(entity.kind) : isTopic ? s.topicCaption(entity.subscriptions.length) : s.queueCaption(entity.activeMessages, entity.deadLetterMessages),
        icon: isTopic ? <BranchForkRegular /> : <MailInboxRegular />,
        color: isTopic ? Colors.topic : Colors.queue,
        muted: entity.isGhost,
        pills: [...statusPills(entity, s), ...stepPill(stepsOf(entity).length, s)],
        children,
    };
}

function subscriptionNode(subscription: SbEntity, filter: string, s: Strings): Node | null {
    const keep = filter.length === 0 || contains(subscription.name, filter) || contains(subscription.topic?.name, filter);
    if (!keep) return null;
    const item: TreeItem = { kind: 'entity', entity: subscription };
    return {
        key: itemKey(item),
        item,
        title: subscription.name,
        caption: s.subscriptionCaption(subscription.rules.length, subscription.activeMessages, subscription.deadLetterMessages),
        icon: <ChannelRegular />,
        color: Colors.subscription,
        pills: statusPills(subscription, s),
        collapsedByDefault: true,
        children: subscription.rules.map((rule) => {
            const ruleItem: TreeItem = { kind: 'rule', rule, subscription };
            return { key: itemKey(ruleItem), item: ruleItem, title: rule.name, caption: rule.expression, icon: <FilterRegular />, color: Colors.rule, pills: [], children: [] };
        }),
    };
}

interface TreeProps {
    model: ExplorerModel | null;
    filter: string;
    onlyLinked: boolean;
    selectedKey: string | null;
    onSelect: (key: string, item: TreeItem) => void;
}

export function Tree(props: TreeProps) {
    const s = useStrings();
    const nodes = useMemo(() => buildTree(props.model, props.filter, props.onlyLinked, s), [props.model, props.filter, props.onlyLinked, s]);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const isOpen = (node: Node) => expanded[node.key] ?? !node.collapsedByDefault;

    const rows: Array<{ node: Node; depth: number }> = [];
    const walk = (list: Node[], depth: number) => {
        for (const node of list) {
            rows.push({ node, depth });
            // The filter opens what it finds.
            if (node.children.length > 0 && (isOpen(node) || props.filter.length > 0)) walk(node.children, depth + 1);
        }
    };
    walk(nodes, 0);

    const move = (delta: number) => {
        const index = rows.findIndex((r) => r.node.key === props.selectedKey);
        const next = rows[Math.max(0, Math.min(rows.length - 1, index + delta))];
        if (next) props.onSelect(next.node.key, next.node.item);
    };

    return (
        <div
            className="sb-tree"
            role="tree"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === 'ArrowDown') move(1);
                else if (e.key === 'ArrowUp') move(-1);
                else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                    const row = rows.find((r) => r.node.key === props.selectedKey);
                    if (row && row.node.children.length > 0) setExpanded((x) => ({ ...x, [row.node.key]: e.key === 'ArrowRight' }));
                } else return;
                e.preventDefault();
            }}
        >
            {rows.map(({ node, depth }) => {
                const open = isOpen(node) || props.filter.length > 0;
                return (
                    <div
                        key={node.key}
                        role="treeitem"
                        aria-selected={node.key === props.selectedKey}
                        aria-expanded={node.children.length > 0 ? open : undefined}
                        data-key={node.key}
                        className={`sb-node ${node.key === props.selectedKey ? 'sb-node-selected' : ''} ${node.muted ? 'sb-node-muted' : ''}`}
                        style={{ paddingLeft: depth * 20, '--node': node.color } as CSSProperties}
                        title={node.item.kind === 'namespace' ? node.item.ns.host : node.title}
                        onClick={() => props.onSelect(node.key, node.item)}
                    >
                        <span
                            className="sb-chevron"
                            onClick={(e) => {
                                if (node.children.length === 0) return;
                                e.stopPropagation();
                                setExpanded((x) => ({ ...x, [node.key]: !open }));
                            }}
                        >
                            {node.children.length > 0 ? open ? <ChevronDownRegular /> : <ChevronRightRegular /> : null}
                        </span>
                        <span className="sb-node-icon">{node.icon}</span>
                        <span className="sb-node-text">
                            <span className={node.bold ? 'sb-node-title sb-node-bold' : 'sb-node-title'}>{node.title}</span>
                            {node.caption && <span className="sb-node-caption">{node.caption}</span>}
                        </span>
                        {node.pills.length > 0 && (
                            <span className="sb-pills">
                                {node.pills.map((p) => (
                                    <Pill key={p.text} text={p.text} color={p.color} />
                                ))}
                            </span>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
