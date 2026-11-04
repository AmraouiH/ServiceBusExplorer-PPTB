import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Input, Tooltip } from '@fluentui/react-components';
import { ArrowClockwiseRegular, ArrowMaximizeRegular, CopyRegular, SearchRegular, StopRegular } from '@fluentui/react-icons';
import { useStrings } from '../i18n/I18nContext';
import type { MessageBatch, SbMessage } from '../models/types';
import { date, size } from '../services/format';
import { pathOf } from '../services/messageService';
import { EmptyState, PropertiesGrid } from './Common';

interface MessagesPanelProps {
    /** The messages read last, null before the first read. */
    batches: MessageBatch[] | null;
    /** Text shown before the first read, null when the entity cannot be read. */
    intro: string | null;
    canRead: boolean;
    /** Steps of the popup: their messages are shown alone, unless the user unticks the box. */
    stepFilter?: Set<string> | null;
    /** A read is in progress (popup only: the explorer has the loading overlay). The Read button becomes Stop. */
    busy?: boolean;
    progress?: string;
    onRead: () => void;
    onStop?: () => void;
    onShowText: (title: string, subtitle: string, text: string) => void;
}

const sourceLabel = (batch: { source: MessageBatch['source'] }) => pathOf(batch.source);

/**
 * Peeked active messages of queues and subscriptions, with their Dataverse context and body (port of UI/Controls/MessagesPanel.cs).
 * The owner reads, this panel displays.
 */
export function MessagesPanel(props: MessagesPanelProps) {
    const s = useStrings();
    const [search, setSearch] = useState('');
    const [onlySteps, setOnlySteps] = useState(true);
    const [selected, setSelected] = useState<SbMessage | null>(null);
    const [copied, setCopied] = useState(false);

    const all = useMemo(() => props.batches?.flatMap((b) => b.messages) ?? [], [props.batches]);
    const stepOnly = !!props.stepFilter && onlySteps;

    const visible = useMemo(() => {
        const query = search.trim().toLowerCase();
        const has = (v: string | undefined) => !!v && v.toLowerCase().includes(query);
        return all
            .filter((m) => !stepOnly || (m.context?.stepId && props.stepFilter!.has(m.context.stepId.toLowerCase())))
            .filter((m) => {
                if (!query) return true;
                const c = m.context;
                return has(m.step?.name) || has(c?.stepName) || has(c?.messageName) || has(c?.table) || has(c?.recordId) || has(m.messageId) || has(m.correlationId) || has(m.source?.name) || has(m.bodyText);
            })
            .sort((a, b) => (a.enqueuedOn?.getTime() ?? Infinity) - (b.enqueuedOn?.getTime() ?? Infinity) || a.sequenceNumber - b.sequenceNumber);
    }, [all, search, stepOnly, props.stepFilter]);

    // A new read selects its first message; the selection follows the filters.
    useEffect(() => setSelected(visible[0] ?? null), [props.batches]);
    useEffect(() => {
        if (selected && !visible.includes(selected)) setSelected(visible[0] ?? null);
    }, [visible, selected]);
    useEffect(() => setCopied(false), [selected]);

    const multipleSources = !!props.batches && new Set(props.batches.map((b) => b.source)).size > 1;
    const failed = props.batches?.filter((b) => b.error) ?? [];
    const truncated = props.batches?.filter((b) => b.truncated) ?? [];

    const stepText = (m: SbMessage) => {
        if (m.step) return m.step.name;
        if (!m.context) return s.notDataverseMessage;
        return m.context.stepName ? `${m.context.stepName} · ${s.unknownStep}` : s.unknownStep;
    };

    const emptyText = () => {
        if (!props.canRead) return s.messagesUnavailable;
        if (!props.batches) return props.intro ?? '';
        if (props.batches.length > 0 && props.batches.every((b) => b.error)) return s.messagesAllFailed;
        if (all.length === 0) return s.messagesNone;
        if (stepOnly) return s.messagesNoneForStep(all.length);
        return s.messagesNoMatch;
    };

    let count = '';
    if (props.busy) count = props.progress ?? s.readingMessagesShort;
    else if (props.batches) count = s.messagesCount(visible.length, all.length) + (truncated.length > 0 ? s.messagesTruncated(Math.max(...truncated.map((b) => b.messages.length))) : '');

    const showErrors = () =>
        props.onShowText(
            s.messagesErrorsTitle,
            s.messagesErrors(failed.length, sourceLabel(failed[0])),
            failed.map((b) => [sourceLabel(b), b.error, b.errorDetails].filter(Boolean).join('\n')).join('\n\n'),
        );

    const copy = async () => {
        if (!selected) return;
        await window.toolboxAPI.utils.copyToClipboard(selected.bodyText || ' ').catch(() => undefined);
        setCopied(true);
    };

    const m = selected;
    const c = m?.context;
    const d = (value: Date | undefined) => date(value, true);

    return (
        <div className="sb-detail-page sb-messages">
            <div className="sb-toolbar">
                <Tooltip content={s.readMessagesTip} relationship="description">
                    <Button
                        className="sb-read-messages"
                        appearance={props.busy ? 'secondary' : 'primary'}
                        icon={props.busy ? <StopRegular /> : <ArrowClockwiseRegular />}
                        disabled={!props.canRead}
                        onClick={() => (props.busy ? props.onStop?.() : props.onRead())}
                    >
                        {props.busy ? s.stop : s.readMessages}
                    </Button>
                </Tooltip>
                {props.stepFilter && (
                    <Checkbox
                        className="sb-only-steps"
                        label={props.stepFilter.size > 1 ? s.onlyStepsMessages : s.onlyStepMessages}
                        checked={onlySteps}
                        onChange={(_e, data) => setOnlySteps(!!data.checked)}
                    />
                )}
                <Input className="sb-search sb-messages-search" contentBefore={<SearchRegular />} placeholder={s.messagesSearchCue} value={search} onChange={(_e, data) => setSearch(data.value)} />
                <span className="sb-muted sb-messages-count">{count}</span>
            </div>
            <div className="sb-hint">{s.peekHint}</div>

            {failed.length > 0 && (
                <div className="sb-alert sb-messages-alert">
                    <span>
                        {s.messagesErrors(failed.length, sourceLabel(failed[0]))} {failed[0].error}
                    </span>
                    <Button size="small" onClick={showErrors}>
                        {s.details}
                    </Button>
                </div>
            )}

            {visible.length === 0 ? (
                <EmptyState text={emptyText()} />
            ) : (
                <div className="sb-split sb-split-rows-messages">
                    <div className="sb-grid-wrapper">
                        <table className="sb-grid sb-grid-select sb-messages-grid">
                            <thead>
                                <tr>
                                    <th className="sb-num">{s.colSequence}</th>
                                    <th>{s.colEnqueued}</th>
                                    <th>{s.colStep}</th>
                                    <th>{s.colMessage}</th>
                                    <th>{s.colTable}</th>
                                    <th className="sb-num">{s.colDelivery}</th>
                                    {multipleSources && <th>{s.colSource}</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {visible.map((x) => (
                                    <tr
                                        key={`${x.source?.name}/${x.sequenceNumber}/${x.messageId}`}
                                        className={x === selected ? 'sb-row-selected' : undefined}
                                        onClick={() => setSelected(x)}
                                        onDoubleClick={() => props.onShowText(s.bodyTitle(x.bodyFormat, size(x.body.length)), `${sourceLabel(x)} · #${x.sequenceNumber} · ${stepText(x)}`, x.bodyText)}
                                    >
                                        <td className="sb-num">{x.sequenceNumber.toLocaleString()}</td>
                                        <td>{d(x.enqueuedOn)}</td>
                                        <td className={x.step ? 'sb-step-cell' : 'sb-step-cell sb-muted'}>{stepText(x)}</td>
                                        <td>{x.context?.messageName}</td>
                                        <td className="sb-strong">{x.context?.table}</td>
                                        <td className="sb-num">{x.deliveryCount}</td>
                                        {multipleSources && <td>{x.source?.name}</td>}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="sb-split sb-split-cols">
                        <PropertiesGrid
                            className="sb-message-properties"
                            rows={
                                m
                                    ? [
                                          { section: s.sectionMessage },
                                          [s.propSource, sourceLabel(m)],
                                          [s.propSequence, String(m.sequenceNumber)],
                                          [s.propMessageId, m.messageId],
                                          [s.propEnqueued, d(m.enqueuedOn)],
                                          [s.propScheduled, d(m.scheduledFor)],
                                          [s.propExpires, d(m.expiresOn)],
                                          [s.propDeliveryCount, String(m.deliveryCount)],
                                          [s.propContentType, m.contentType],
                                          [s.propSubject, m.subject],
                                          [s.propCorrelation, m.correlationId],
                                          [s.propSession, m.sessionId],
                                          [s.propTo, m.to],
                                          [s.propReplyTo, m.replyTo],
                                          ...(c
                                              ? [
                                                    { section: s.sectionDataverse },
                                                    [s.colStep, stepText(m)] as [string, string],
                                                    [s.propStepId, c.stepId] as [string, string | undefined],
                                                    [s.colMessage, c.messageName] as [string, string | undefined],
                                                    [s.colTable, c.table] as [string, string | undefined],
                                                    [s.propRecord, c.recordId] as [string, string | undefined],
                                                    [s.colStage, c.stage !== undefined ? s.stageLabel(c.stage) : undefined] as [string, string | undefined],
                                                    [s.colMode, c.mode !== undefined ? s.modeLabel(c.mode) : undefined] as [string, string | undefined],
                                                    [s.propDepth, c.depth?.toString()] as [string, string | undefined],
                                                    [s.propUser, c.userId] as [string, string | undefined],
                                                    [s.propInitiatingUser, c.initiatingUserId] as [string, string | undefined],
                                                    [s.propOrganization, c.organization] as [string, string | undefined],
                                                    [s.propOperationCorrelation, c.correlationId] as [string, string | undefined],
                                                    [s.propOperationCreated, d(c.operationCreatedOn)] as [string, string | undefined],
                                                ]
                                              : []),
                                          ...(m.properties.length > 0 ? [{ section: s.sectionApplicationProperties }, ...m.properties] : []),
                                      ]
                                    : []
                            }
                        />
                        <div className="sb-panel">
                            <div className="sb-panel-title">
                                <span className="sb-body-title">{s.bodyTitle(m?.bodyFormat, size(m?.body.length ?? 0))}</span>
                                <span className="sb-spacer" />
                                <Button size="small" appearance="subtle" icon={<CopyRegular />} disabled={!m} onClick={copy}>
                                    {copied ? s.copied : s.copy}
                                </Button>
                                <Button
                                    size="small"
                                    appearance="subtle"
                                    icon={<ArrowMaximizeRegular />}
                                    disabled={!m}
                                    onClick={() => m && props.onShowText(s.bodyTitle(m.bodyFormat, size(m.body.length)), `${sourceLabel(m)} · #${m.sequenceNumber} · ${stepText(m)}`, m.bodyText)}
                                >
                                    {s.openBody}
                                </Button>
                            </div>
                            <pre className="sb-code sb-message-body">{m?.bodyText}</pre>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
