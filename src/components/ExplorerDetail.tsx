import { useEffect, useMemo, useState } from 'react';
import { Button, Tab, TabList } from '@fluentui/react-components';
import { CopyRegular, FilterRegular, ListRegular, MailMultipleRegular, PlayRegular } from '@fluentui/react-icons';
import { useStrings } from '../i18n/I18nContext';
import type { Strings } from '../i18n/strings';
import { allSubscriptions, entities, isActive, stepsOf, type MessageBatch, type SbEntity, type SbNamespace, type SbRule, type StepInfo } from '../models/types';
import { date, duration, size, yesNo } from '../services/format';
import { sourcesOf } from '../services/messageService';
import { Badge, Colors, EmptyState, PropertiesGrid, StatTile } from './Common';
import { MessagesPanel } from './MessagesPanel';
import { StepsTable } from './StepsTable';
import type { TreeItem } from './Tree';

export type DetailTab = 'steps' | 'filters' | 'properties' | 'messages';

interface ExplorerDetailProps {
    item: TreeItem | null;
    tab: DetailTab;
    onTab: (tab: DetailTab) => void;
    busy: boolean;
    /** Messages of the selected entity, kept by the app while it stays selected. */
    messages: MessageBatch[] | null;
    onReadMessages: (entity: SbEntity) => void;
    onConnect: (host: string) => void;
    onShowText: (title: string, subtitle: string, text: string) => void;
    onEdit: (step: StepInfo) => void;
    onEnable: (steps: StepInfo[]) => void;
    onDisable: (steps: StepInfo[]) => void;
    onStepMessages: (steps: StepInfo[]) => void;
}

/** A namespace that was not read has unknown counters, not zeros. */
const countOf = (ns: SbNamespace, count: number) => (ns.isGhost || ns.error ? '–' : String(count));

/** Detail of the selected item of the tree (port of ServiceBusExplorerControl.Explorer.cs). */
export function ExplorerDetail(props: ExplorerDetailProps) {
    const s = useStrings();
    const item = props.item;

    if (!item) return <EmptyState title={s.detailEmptyTitle} text={s.detailEmpty} />;

    // A group shows its namespace, a rule shows its subscription with the rule selected.
    const ns = item.kind === 'namespace' || item.kind === 'group' ? item.ns : null;
    const entity = item.kind === 'entity' ? item.entity : item.kind === 'rule' ? item.subscription : null;
    const rule = item.kind === 'rule' ? item.rule : null;

    return ns ? <NamespaceDetail ns={ns} {...props} /> : <EntityDetail entity={entity!} rule={rule} {...props} s={s} />;
}

function NamespaceDetail(props: ExplorerDetailProps & { ns: SbNamespace }) {
    const s = useStrings();
    const { ns } = props;
    const steps = useMemo(() => entities(ns).flatMap(stepsOf), [ns]);
    const unread = ns.isGhost || !!ns.error;
    const tab = props.tab === 'filters' || props.tab === 'messages' ? 'steps' : props.tab;

    return (
        <>
            <DetailTitle title={ns.host.split('.')[0]} subtitle={ns.host} />
            {ns.error && <Alert text={s.alertNamespaceError(ns.error)} action={s.details} onAction={() => props.onShowText(s.somethingWentWrong, ns.host, [ns.error, ns.errorDetails].filter(Boolean).join('\n\n'))} />}
            {!ns.error && ns.isGhost && <Alert text={s.alertGhostNamespace(ns.host)} action={s.connectNamespace} onAction={() => props.onConnect(ns.host)} />}
            <div className="sb-tiles">
                <StatTile caption={s.tileQueues} value={countOf(ns, ns.queues.filter((q) => !q.isGhost).length)} tint={Colors.queue} />
                <StatTile caption={s.tileTopics} value={countOf(ns, ns.topics.filter((t) => !t.isGhost).length)} tint={Colors.topic} />
                <StatTile caption={s.tileSubscriptions} value={countOf(ns, allSubscriptions(ns).length)} tint={Colors.subscription} />
                <StatTile caption={s.tileDeadLetter} value={unread ? '–' : [...entities(ns), ...allSubscriptions(ns)].reduce((sum, e) => sum + e.deadLetterMessages, 0).toLocaleString()} tint={Colors.danger} />
                <StatTile caption={s.tileSteps} value={String(steps.length)} tint={Colors.success} />
            </div>
            <TabList className="sb-detail-tabs" selectedValue={tab} onTabSelect={(_e, d) => props.onTab(d.value as DetailTab)}>
                <Tab value="steps" icon={<PlayRegular />}>
                    {s.detailSteps}
                    <Badge value={String(steps.length)} />
                </Tab>
                <Tab value="properties" icon={<ListRegular />}>
                    {s.detailProperties}
                </Tab>
            </TabList>
            {tab === 'steps' ? (
                <StepsTable key={ns.host} steps={steps} showMessages={false} busy={props.busy} onEdit={props.onEdit} onEnable={props.onEnable} onDisable={props.onDisable} onMessages={props.onStepMessages} />
            ) : (
                <PropertiesGrid
                    rows={[
                        [s.propHost, ns.host],
                        [s.propLocation, ns.location],
                        [s.propTier, ns.sku],
                        [s.propStatus, ns.status],
                        [s.propAzureSubscription, ns.subscriptionName],
                        [s.propAccess, ns.isGhost ? undefined : ns.readWithKey ? s.propAccessKey : s.propAccessMicrosoft],
                    ]}
                />
            )}
        </>
    );
}

function EntityDetail(props: ExplorerDetailProps & { entity: SbEntity; rule: SbRule | null; s: Strings }) {
    const { entity, rule, s } = props;
    const ns = entity.namespace;
    const steps = useMemo(() => stepsOf(entity), [entity]);
    const isTopic = entity.kind === 'topic';
    const hasFilters = !entity.isGhost && (isTopic || entity.kind === 'subscription');
    const sources = sourcesOf(entity);

    // Opening a rule shows the filters.
    useEffect(() => {
        if (rule) props.onTab('filters');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rule]);

    let tab = props.tab;
    if (tab === 'filters' && !hasFilters) tab = 'steps';

    const count = (value: number) => (entity.isGhost ? '–' : value.toLocaleString());
    const counted = entity.isGhost ? [] : isTopic ? entity.subscriptions : [entity];
    const messagesBadge = counted.length === 0 ? null : counted.reduce((sum, e) => sum + e.activeMessages, 0).toLocaleString();

    let alert: { text: string; action?: string; onAction?: () => void } | null = null;
    if (entity.isGhost && ns.error) alert = { text: s.alertNamespaceError(ns.error), action: s.details, onAction: () => props.onShowText(s.somethingWentWrong, ns.host, [ns.error, ns.errorDetails].filter(Boolean).join('\n\n')) };
    else if (entity.isGhost && ns.isGhost) alert = { text: s.alertGhostNamespace(ns.host), action: s.connectNamespace, onAction: () => props.onConnect(ns.host) };
    else if (entity.isGhost) alert = { text: s.alertGhostEntity };
    else if (!isActive(entity)) alert = { text: s.alertEntityDisabled(entity.status ?? '') };

    return (
        <>
            <DetailTitle title={entity.name} subtitle={`${s.kindLabel(entity.kind)}${entity.topic ? ` · ${entity.topic.name}` : ''} · ${ns.host}`} />
            {alert && <Alert {...alert} />}
            <div className="sb-tiles">
                <StatTile caption={s.tileActive} value={count(entity.activeMessages)} tint={Colors.accent} />
                <StatTile caption={s.tileDeadLetter} value={count(entity.deadLetterMessages)} tint={entity.deadLetterMessages > 0 ? Colors.danger : Colors.muted} />
                <StatTile caption={s.tileScheduled} value={count(entity.scheduledMessages)} tint={Colors.topic} />
                {isTopic ? (
                    <StatTile caption={s.tileSubscriptions} value={count(entity.subscriptions.length)} tint={Colors.subscription} />
                ) : (
                    <StatTile caption={s.tileSize} value={entity.isGhost ? '–' : size(entity.sizeBytes)} tint={Colors.subscription} />
                )}
                <StatTile caption={s.tileSteps} value={String(steps.length)} tint={Colors.success} />
            </div>
            <TabList className="sb-detail-tabs" selectedValue={tab} onTabSelect={(_e, d) => props.onTab(d.value as DetailTab)}>
                <Tab value="steps" icon={<PlayRegular />}>
                    {s.detailSteps}
                    <Badge value={String(steps.length)} />
                </Tab>
                {hasFilters && (
                    <Tab value="filters" icon={<FilterRegular />}>
                        {isTopic ? s.detailFilters : s.detailFiltersOnly}
                        <Badge value={String(isTopic ? entity.subscriptions.length : entity.rules.length)} />
                    </Tab>
                )}
                <Tab value="properties" icon={<ListRegular />}>
                    {s.detailProperties}
                </Tab>
                <Tab value="messages" icon={<MailMultipleRegular />}>
                    {s.detailMessages}
                    <Badge value={messagesBadge} />
                </Tab>
            </TabList>

            {tab === 'steps' && (
                <StepsTable
                    key={`${entity.namespace.host}/${entity.name}`}
                    steps={steps}
                    hint={entity.kind === 'subscription' && entity.topic ? s.subscriptionStepsHint(entity.topic.name) : undefined}
                    busy={props.busy}
                    onEdit={props.onEdit}
                    onEnable={props.onEnable}
                    onDisable={props.onDisable}
                    onMessages={props.onStepMessages}
                />
            )}
            {tab === 'filters' && <Filters entity={entity} rule={rule} />}
            {tab === 'properties' && <PropertiesGrid rows={entityProperties(entity, s)} />}
            {tab === 'messages' && (
                <MessagesPanel
                    batches={props.messages}
                    intro={sources.length > 0 ? s.messagesIntro(entity.name, sources.length) : null}
                    canRead={sources.length > 0 && !props.busy}
                    onRead={() => props.onReadMessages(entity)}
                    onShowText={props.onShowText}
                />
            )}
        </>
    );
}

function DetailTitle(props: { title: string; subtitle: string }) {
    return (
        <div className="sb-card-header sb-detail-title" style={{ padding: '0 0 2px' }}>
            <h2>{props.title}</h2>
            <p>{props.subtitle}</p>
        </div>
    );
}

function Alert(props: { text: string; action?: string; onAction?: () => void }) {
    return (
        <div className="sb-alert sb-detail-alert">
            <span>{props.text}</span>
            {props.action && (
                <Button size="small" onClick={props.onAction}>
                    {props.action}
                </Button>
            )}
        </div>
    );
}

function Filters(props: { entity: SbEntity; rule: SbRule | null }) {
    const s = useStrings();
    const isTopic = props.entity.kind === 'topic';
    const subscriptions = useMemo(() => [...props.entity.subscriptions].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })), [props.entity]);
    const [subscription, setSubscription] = useState<SbEntity | null>(isTopic ? (subscriptions[0] ?? null) : props.entity);
    const [rule, setRule] = useState<SbRule | null>(props.rule);

    useEffect(() => {
        setSubscription(isTopic ? (subscriptions[0] ?? null) : props.entity);
        setRule(props.rule);
    }, [props.entity, props.rule, isTopic, subscriptions]);

    const rules = subscription?.rules ?? [];
    const detail = rule ? rule.expression + (rule.actionExpression ? `\n\n${s.ruleAction}: ${rule.actionExpression}` : '') : s.noFilterSelected;

    return (
        <div className="sb-detail-page sb-filters">
            {isTopic && (
                <div className="sb-panel" style={{ flex: '1 1 40%' }}>
                    <div className="sb-panel-title">{s.tileSubscriptions}</div>
                    <div className="sb-grid-wrapper">
                        <table className="sb-grid sb-grid-select sb-subscriptions-grid">
                            <thead>
                                <tr>
                                    <th>{s.colSubscription}</th>
                                    <th className="sb-num">{s.colActive}</th>
                                    <th className="sb-num">{s.colDeadLetter}</th>
                                    <th className="sb-num">{s.colFilters}</th>
                                    <th>{s.colForwardTo}</th>
                                    <th>{s.colStatus}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {subscriptions.map((x) => (
                                    <tr
                                        key={x.name}
                                        className={x === subscription ? 'sb-row-selected' : undefined}
                                        onClick={() => {
                                            setSubscription(x);
                                            setRule(null);
                                        }}
                                    >
                                        <td className="sb-strong">{x.name}</td>
                                        <td className="sb-num">{x.activeMessages.toLocaleString()}</td>
                                        <td className="sb-num" style={{ color: x.deadLetterMessages > 0 ? Colors.danger : undefined }}>
                                            {x.deadLetterMessages.toLocaleString()}
                                        </td>
                                        <td className="sb-num">{x.rules.length}</td>
                                        <td>{x.forwardTo}</td>
                                        <td>{x.status}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            <div className="sb-panel" style={{ flex: '1 1 35%' }}>
                <div className="sb-panel-title">{subscription && isTopic ? `${s.detailFiltersOnly} · ${subscription.name}` : s.detailFiltersOnly}</div>
                <div className="sb-grid-wrapper">
                    <table className="sb-grid sb-grid-select sb-rules-grid">
                        <thead>
                            <tr>
                                <th>{s.colRule}</th>
                                <th>{s.colType}</th>
                                <th>{s.colExpression}</th>
                                <th>{s.colAction}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rules.map((r) => (
                                <tr key={r.name} className={r === rule ? 'sb-row-selected' : undefined} onClick={() => setRule(r)}>
                                    <td className="sb-strong">{r.name}</td>
                                    <td>{s.filterKindLabel(r.filterKind)}</td>
                                    <td className="sb-mono" title={r.expression}>
                                        {r.expression}
                                    </td>
                                    <td className="sb-mono">{r.actionExpression}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
            <div className="sb-panel" style={{ flex: '0 0 auto' }}>
                <div className="sb-panel-title">
                    {s.selectedFilter}
                    <span className="sb-spacer" />
                    <Button size="small" appearance="subtle" icon={<CopyRegular />} disabled={!rule} onClick={() => window.toolboxAPI.utils.copyToClipboard(detail).catch(() => undefined)}>
                        {s.copy}
                    </Button>
                </div>
                <pre className="sb-code sb-code-wrap sb-rule-detail" style={{ minHeight: 64, maxHeight: 120 }}>
                    {detail}
                </pre>
            </div>
        </div>
    );
}

function entityProperties(e: SbEntity, s: Strings): Array<[string, string | undefined]> {
    const rows: Array<[string, string | undefined]> = [
        [s.propType, s.kindLabel(e.kind)],
        [s.propPath, e.kind === 'subscription' && e.topic ? `${e.topic.name}/Subscriptions/${e.name}` : e.name],
        [s.propEndpoints, (e.kind === 'subscription' && e.topic ? e.topic : e).endpoints.map((x) => x.name).join(', ')],
    ];
    if (e.isGhost) return rows;
    rows.push(
        [s.propStatus, e.status],
        [s.propTotal, e.totalMessages.toLocaleString()],
        [s.propTransfer, e.transferMessages.toLocaleString()],
        [s.tileSize, size(e.sizeBytes)],
        [s.propMaxSize, e.maxSizeMegabytes > 0 ? size(e.maxSizeMegabytes * 1048576) : undefined],
        [s.propLock, duration(e.lockDuration, s)],
        [s.propTtl, duration(e.defaultTimeToLive, s)],
        [s.propAutoDelete, duration(e.autoDeleteOnIdle, s)],
        [s.propMaxDelivery, e.maxDeliveryCount > 0 ? String(e.maxDeliveryCount) : undefined],
    );
    if (e.kind !== 'topic') rows.push([s.propSessions, yesNo(e.requiresSession, s)], [s.propDeadLetterExpiry, yesNo(e.deadLetterOnExpiration, s)]);
    if (e.kind !== 'subscription') rows.push([s.propDuplicate, yesNo(e.requiresDuplicateDetection, s)], [s.propPartitioned, yesNo(e.partitioned, s)]);
    rows.push([s.propForwardTo, e.forwardTo], [s.propForwardDead, e.forwardDeadLetteredTo], [s.propCreated, date(e.createdOn)], [s.propUpdated, date(e.updatedOn)], [s.propAccessed, date(e.lastAccessedOn)]);
    return rows;
}
