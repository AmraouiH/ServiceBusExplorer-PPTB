import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, FluentProvider, Input, Tab, TabList, Tooltip } from '@fluentui/react-components';
import { AddRegular, CloudRegular, PlayRegular, SearchRegular, TargetRegular } from '@fluentui/react-icons';
import { AppIcon } from './components/AppIcon';
import { Badge, Card } from './components/Common';
import { ConnectionsDialog } from './components/ConnectionsDialog';
import {
    ConfirmDialog,
    DeviceCodeDialog,
    MessageDialog,
    OptionsDialog,
    StepMessagesDialog,
    TextViewerDialog,
    type ConfirmState,
    type MessageState,
    type StepMessagesState,
    type TextState,
    type WriteTarget,
} from './components/Dialogs';
import { ExplorerDetail, type DetailTab } from './components/ExplorerDetail';
import { Header } from './components/Header';
import { MatchingPage, StepsPage } from './components/Pages';
import { StepEditor, type EditorState } from './components/StepEditor';
import { entityKey, itemKey, Tree, type TreeItem } from './components/Tree';
import { useConnection, useSettings, useToolboxEvents, useToolboxTheme } from './hooks/useToolbox';
import { I18nContext } from './i18n/I18nContext';
import { AppTitle, getStrings, type Language } from './i18n/strings';
import { entities, isServiceBusEndpoint, MaxMessagesLimit, type ExplorerModel, type MatchRow, type MessageBatch, type PluginSettings, type SavedConnection, type SbEntity, type SbNamespace, type StepInfo } from './models/types';
import { createMessageReader, createReader } from './services/azure/connectionFactory';
import { AzureRequestError, isStopped, StoppedError } from './services/azure/http';
import { loadNamespace } from './services/azure/readers';
import { DeviceCodeUi, type DeviceCodePrompt } from './services/azure/tokens';
import { errorMessage } from './services/dataverse';
import { loadEndpoints, loadMessages, loadSteps, loadTables, resetCaches, saveStep, setEnabled } from './services/endpointService';
import { exportBackup, exportModel } from './services/exportService';
import { buildModel, isProblem } from './services/matching';
import { readMessages, resolveSteps, sourcesOf, targetOfStep } from './services/messageService';
import { darkTheme, lightTheme } from './theme';

type Page = 'explorer' | 'matching' | 'steps';

/** Delay after Stop before a task stuck in a server call is abandoned (its result will be ignored). */
const AbandonDelayMs = 3000;

interface BusyState {
    title: string;
    text?: string;
    started: number;
    stopping: boolean;
}

/** Item of the tree for a key, in the current model (the selection survives a reload). */
function findItem(model: ExplorerModel | null, key: string | null): TreeItem | null {
    if (!model || !key) return null;
    for (const ns of model.namespaces) {
        const candidates: TreeItem[] = [{ kind: 'namespace', ns }, { kind: 'group', ns, group: 'queues' }, { kind: 'group', ns, group: 'topics' }];
        for (const e of entities(ns)) {
            candidates.push({ kind: 'entity', entity: e });
            for (const sub of e.subscriptions) {
                candidates.push({ kind: 'entity', entity: sub });
                for (const rule of sub.rules) candidates.push({ kind: 'rule', rule, subscription: sub });
            }
        }
        const found = candidates.find((c) => itemKey(c) === key);
        if (found) return found;
    }
    return null;
}

/**
 * Tool UI: tree of the namespaces, matching with the Dataverse endpoints, steps, images and messages
 * (port of ServiceBusExplorerControl.cs). Business logic lives in src/services.
 */
function App() {
    const { settings, settingsRef, loaded: settingsLoaded, updateSettings } = useSettings();
    const strings = useMemo(() => getStrings(settings.language), [settings.language]);
    const stringsRef = useRef(strings);
    stringsRef.current = strings;

    const { theme, refreshTheme } = useToolboxTheme();
    const { connection, refreshConnection } = useConnection();

    const [page, setPage] = useState<Page>('explorer');
    const [model, setModel] = useState<ExplorerModel | null>(null);
    const azureRef = useRef<SbNamespace[]>([]);
    const [loadedAt, setLoadedAt] = useState<Date | null>(null);
    const [info, setInfo] = useState<{ text: string; tone: 'warning' | 'success' } | null>(null);

    const [treeFilter, setTreeFilter] = useState('');
    const [onlyLinked, setOnlyLinked] = useState(false);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [detailTab, setDetailTab] = useState<DetailTab>('steps');
    /** Messages of the explorer, kept while the same entity stays selected. */
    const [messages, setMessages] = useState<{ key: string; batches: MessageBatch[] } | null>(null);

    const [busy, setBusy] = useState<BusyState | null>(null);
    const [, setTick] = useState(0);
    const task = useRef<{ controller: AbortController; abandoned: boolean } | null>(null);

    const [message, setMessage] = useState<MessageState | null>(null);
    const [confirm, setConfirm] = useState<ConfirmState | null>(null);
    const [text, setText] = useState<TextState | null>(null);
    const [optionsOpen, setOptionsOpen] = useState(false);
    const [connectionsOpen, setConnectionsOpen] = useState<{ host: string | null } | null>(null);
    const [editor, setEditor] = useState<EditorState | null>(null);
    const [stepMessages, setStepMessages] = useState<StepMessagesState | null>(null);
    const [deviceCode, setDeviceCode] = useState<{ prompt: DeviceCodePrompt; cancel: () => void } | null>(null);

    // #region Helpers

    const showError = useCallback((error: unknown, title = stringsRef.current.somethingWentWrong) => {
        const details = error instanceof AzureRequestError ? error.details : (error as Error)?.stack;
        setMessage({ title, text: errorMessage(error), intent: 'error', details });
    }, []);

    const notify = (title: string, body: string, type: 'info' | 'success' | 'warning' | 'error') => {
        window.toolboxAPI.utils.showNotification({ title, body, type, duration: 4000 }).catch(() => undefined);
    };

    /**
     * Runs a task behind the loading overlay (replaces the XrmToolBox WorkAsync panel). Stop cancels its signal;
     * a task stuck in a server call is abandoned after a few seconds and its result ignored.
     */
    const work = useCallback(async <T,>(title: string, action: (progress: (text: string) => void, signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
        if (task.current) return undefined;
        const controller = new AbortController();
        const current = { controller, abandoned: false };
        task.current = current;
        setBusy({ title, started: Date.now(), stopping: false });
        try {
            const result = await action((progress) => !current.abandoned && setBusy((b) => (b ? { ...b, text: progress } : b)), controller.signal);
            if (current.abandoned) return undefined;
            if (controller.signal.aborted) throw new StoppedError();
            return result;
        } catch (error) {
            if (current.abandoned) return undefined;
            if (isStopped(error) || controller.signal.aborted) {
                setInfo({ text: stringsRef.current.stopped, tone: 'warning' });
                return undefined;
            }
            console.error(`ServiceBus Explorer: ${title}`, error);
            showError(error);
            return undefined;
        } finally {
            if (task.current === current) {
                task.current = null;
                setBusy(null);
            }
        }
    }, [showError]);

    const stopTask = useCallback(() => {
        const current = task.current;
        if (!current) return;
        current.controller.abort();
        setBusy((b) => (b ? { ...b, stopping: true } : b));
        // A Dataverse call cannot be interrupted: if the task does not stop by itself, the UI is given back.
        setTimeout(() => {
            if (task.current !== current) return;
            current.abandoned = true;
            task.current = null;
            setBusy(null);
            setInfo({ text: stringsRef.current.stopped, tone: 'warning' });
        }, AbandonDelayMs);
    }, []);

    // Elapsed time of the overlay; Esc stops the task.
    useEffect(() => {
        if (!busy) return;
        const timer = setInterval(() => setTick((t) => t + 1), 1000);
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') stopTask();
        };
        window.addEventListener('keydown', onKey);
        return () => {
            clearInterval(timer);
            window.removeEventListener('keydown', onKey);
        };
    }, [busy, stopTask]);

    // The Microsoft sign-in shows its code through the app.
    useEffect(() => {
        DeviceCodeUi.show = (prompt) => {
            let resolveCancel: () => void = () => undefined;
            const cancelled = new Promise<void>((resolve) => (resolveCancel = resolve));
            setDeviceCode({ prompt, cancel: resolveCancel });
            return { cancelled, close: () => setDeviceCode(null) };
        };
        return () => {
            DeviceCodeUi.show = undefined;
        };
    }, []);

    // #endregion

    // #region Load

    const requireDataverse = async () => {
        const current = connection ?? (await refreshConnection());
        if (!current) {
            setMessage({ title: AppTitle, text: stringsRef.current.noDataverse, intent: 'warning' });
            return false;
        }
        return true;
    };

    /** Reads Azure and Dataverse. Nothing is read before the user clicks Load. */
    const loadAll = async () => {
        if (!(await requireDataverse())) return;
        const s = stringsRef.current;
        const current = settingsRef.current;
        const result = await work(s.loading, async (progress, signal) => {
            progress(s.readingEndpoints);
            const endpoints = await loadEndpoints();
            progress(s.readingSteps);
            const steps = await loadSteps(endpoints);
            const azure: SbNamespace[] = [];
            for (const c of current.connections) {
                progress(c.method === 'connectionString' ? s.readingNamespace(c.host) : s.signingIn);
                azure.push(await readNamespace(c, current, progress, signal));
            }
            return { endpoints, steps, azure };
        });
        if (!result) return;
        azureRef.current = result.azure;
        setModel(buildModel(result.azure, result.endpoints, result.steps));
        setLoadedAt(new Date());
        setInfo(null);
        // Azure was read again: the messages shown before are no longer current.
        setMessages(null);
    };

    /** A namespace that cannot be read must not stop the others: its error is displayed on its node. */
    const readNamespace = async (c: SavedConnection, current: PluginSettings, progress: (text: string) => void, signal: AbortSignal): Promise<SbNamespace> => {
        const s = stringsRef.current;
        try {
            const ns = await loadNamespace(createReader(c, current, s), current.parallelRequests, progress, s, signal);
            ns.subscriptionName = c.subscriptionName;
            return ns;
        } catch (error) {
            if (isStopped(error)) throw error;
            return {
                host: c.host,
                readWithKey: c.method === 'connectionString',
                isGhost: false,
                subscriptionName: c.subscriptionName,
                error: errorMessage(error),
                errorDetails: error instanceof AzureRequestError ? error.details : undefined,
                queues: [],
                topics: [],
            };
        }
    };

    /** Reads Dataverse again after a change, without calling Azure. */
    const reloadDataverse = async (done?: string) => {
        const s = stringsRef.current;
        const result = await work(s.loading, async (progress) => {
            progress(s.readingSteps);
            const endpoints = await loadEndpoints();
            return { endpoints, steps: await loadSteps(endpoints) };
        });
        if (!result) return;
        setModel(buildModel(azureRef.current, result.endpoints, result.steps));
        if (done) setInfo({ text: done, tone: 'success' });
    };

    // #endregion

    // #region Steps

    /** File name with the local date and time, e.g. "ServiceBus Explorer backup 2026-11-05 10-42.xlsx". */
    const stampedName = (prefix: string) => {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${prefix} ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}.xlsx`;
    };

    const saveWorkbook = (name: string, bytes: Uint8Array) => window.toolboxAPI.fileSystem.saveFile(name, bytes, [{ name: 'Excel', extensions: ['xlsx'] }]);

    /** Environment named in the confirmation, and the backup of the steps as they are now. */
    const writeTarget = (steps: StepInfo[], warning?: string): WriteTarget => {
        const s = stringsRef.current;
        const environment = s.targetEnvironment(connection?.name ?? '', connection?.url ?? '');
        return {
            environment,
            warning,
            backup: () => saveWorkbook(stampedName(`${AppTitle} backup`), exportBackup(steps, environment, new Date(), s)),
        };
    };

    const editStep = async (step: StepInfo) => {
        if (!(await requireDataverse())) return;
        const s = stringsRef.current;
        const url = connection?.url ?? '';
        const data = await work(s.preparingEditor, async () => {
            const list = await loadMessages(url);
            const tables = step.messageId ? await loadTables(step.messageId) : new Map<string, string>();
            return { list, tables };
        });
        if (data) setEditor({ step, messages: data.list, tables: data.tables });
    };

    const saveEditedStep = async (original: StepInfo, draft: StepInfo) => {
        setEditor(null);
        const s = stringsRef.current;
        await window.toolboxAPI.preventClose().catch(() => false);
        let saved = false;
        try {
            saved = (await work(s.saving, async (progress) => {
                progress(s.writingStep(original.name));
                await saveStep(original, draft);
                return true;
            })) === true;
        } finally {
            await window.toolboxAPI.releasePreventClose().catch(() => false);
        }
        // Even after an error part of the change may be written: the screen must show the real state.
        await reloadDataverse(saved ? s.stepSaved(original.name) : undefined);
        if (saved) notify(AppTitle, s.stepSaved(original.name), 'success');
    };

    const setStepsEnabled = (steps: StepInfo[], enable: boolean) => {
        const s = stringsRef.current;
        const targets = steps.filter((x) => x.enabled !== enable && (x.isCustomizable || !x.isManaged));
        if (targets.length === 0) {
            setMessage({ title: s.confirmBulkTitle(enable), text: s.nothingToChange, intent: 'info' });
            return;
        }
        const skipped = steps.filter((x) => x.enabled !== enable).length - targets.length;
        setConfirm({
            title: s.confirmBulkTitle(enable),
            text: s.confirmBulkMessage(targets.length, enable) + (skipped > 0 ? `\n${s.bulkSkipped(skipped)}` : ''),
            lines: targets.map((x) => x.name),
            question: s.confirmBulkQuestion,
            action: s.apply,
            intent: enable ? 'info' : 'warning',
            write: writeTarget(targets),
            onConfirm: async () => {
                let done = 0;
                let failed = false;
                await window.toolboxAPI.preventClose().catch(() => false);
                try {
                    await work(s.saving, async (progress, signal) => {
                        try {
                            for (const step of targets) {
                                if (signal.aborted) throw new StoppedError();
                                progress(s.writingStep(step.name));
                                await setEnabled(step, enable);
                                done++;
                            }
                        } catch (error) {
                            failed = true;
                            throw error;
                        }
                    });
                } finally {
                    await window.toolboxAPI.releasePreventClose().catch(() => false);
                }
                // Part of the batch may be written: the screen must show the real state.
                await reloadDataverse(failed ? undefined : s.bulkDone(done));
                if (failed) setInfo({ text: s.bulkFailed(done, targets.length), tone: 'warning' });
            },
        });
    };

    // #endregion

    // #region Messages

    const maxMessages = () => Math.max(1, Math.min(MaxMessagesLimit, settingsRef.current.maxMessages));

    /** Reads the active messages with the saved connections, then links them to the loaded steps. */
    const readWith = (sources: SbEntity[], steps: StepInfo[]) => async (progress: (text: string) => void, signal: AbortSignal) => {
        const s = stringsRef.current;
        const current = settingsRef.current;
        const batches = await readMessages(
            sources,
            maxMessages(),
            async (ns) => {
                const c = current.connections.find((x) => x.host.toLowerCase() === ns.host.toLowerCase());
                if (!c) throw new AzureRequestError(0, s.alertGhostNamespace(ns.host), undefined, true);
                return createMessageReader(c, current, s);
            },
            progress,
            s,
            signal,
        );
        resolveSteps(batches, steps);
        return batches;
    };

    const readExplorerMessages = async (entity: SbEntity) => {
        const sources = sourcesOf(entity);
        if (sources.length === 0) return;
        const key = entityKey(entity);
        const batches = await work(stringsRef.current.readingMessagesShort, readWith(sources, model?.steps ?? []));
        if (batches) setMessages({ key, batches });
    };

    /** Messages sent by the selected steps, read from the queue or the subscriptions of their endpoints. */
    const showStepMessages = (steps: StepInfo[]) => {
        if (steps.length === 0) return;
        const s = stringsRef.current;
        const targets = [...new Set(steps.map((x) => targetOfStep(x, model)).filter((t): t is SbEntity => !!t))];
        const sources = [...new Set(targets.flatMap(sourcesOf))];
        const title = s.stepMessagesTitle(steps.length);
        if (sources.length === 0) {
            setMessage({ title, text: s.stepMessagesUnavailable(targets[0]?.name ?? steps[0].targetPath ?? ''), intent: 'info' });
            return;
        }
        const names = targets.map((t) => t.name).join(', ');
        setStepMessages({
            title,
            subtitle: steps.length === 1 ? `${steps[0].name} · ${names}` : s.stepMessagesSubtitle(steps.length, targets.length),
            intro: s.messagesIntro(names, sources.length),
            steps: new Set(steps.map((x) => x.id.toLowerCase())),
            read: readWith(sources, model?.steps ?? []),
        });
    };

    // #endregion

    // #region Export, matching, connections, options

    const exportReport = async () => {
        const s = stringsRef.current;
        if (!model) {
            setMessage({ title: s.exportReport, text: s.loadFirst, intent: 'info' });
            return;
        }
        try {
            const path = await saveWorkbook(stampedName(AppTitle), exportModel(model, s));
            if (path) setMessage({ title: s.exportDoneTitle, text: s.exportDone(path), intent: 'success' });
        } catch (error) {
            showError(error);
        }
    };

    const openMatch = (row: MatchRow) => {
        if (!row.entity) return;
        setTreeFilter('');
        setPage('explorer');
        setSelectedKey(entityKey(row.entity));
    };

    const saveOptions = (patch: Partial<PluginSettings>) => {
        updateSettings(patch);
        setOptionsOpen(false);
    };

    // #endregion

    // #region Lifecycle

    // Colors of the tool are defined on <html> so popups and dialogs (portals) follow the theme too.
    useEffect(() => {
        document.documentElement.dataset.sbTheme = theme;
    }, [theme]);

    // Connection changed: the model of the previous organization is dropped (no automatic load).
    useToolboxEvents(async (event) => {
        if (event === 'connection:updated' || event === 'connection:created' || event === 'connection:deleted') {
            await refreshConnection();
            resetCaches();
            setModel(null);
            setMessages(null);
        } else if (event === 'settings:updated') {
            refreshTheme();
        }
    });

    // #endregion

    const selectedItem = useMemo(() => findItem(model, selectedKey), [model, selectedKey]);
    const selectedEntity = selectedItem?.kind === 'entity' ? selectedItem.entity : selectedItem?.kind === 'rule' ? selectedItem.subscription : null;
    const selectedEntityKey = selectedEntity ? entityKey(selectedEntity) : null;
    const currentMessages = selectedEntityKey && messages?.key === selectedEntityKey ? messages.batches : null;

    // Another entity: the messages read before are dropped (they stay while the same entity is selected, even after a reload).
    useEffect(() => {
        setMessages((current) => (current && current.key !== selectedEntityKey ? null : current));
    }, [selectedEntityKey]);

    // Relink the kept messages to the steps of a model read again.
    useEffect(() => {
        if (messages && model) resolveSteps(messages.batches, model.steps);
    }, [model, messages]);

    const errors = model?.namespaces.filter((n) => n.error).length ?? 0;
    const problems = model?.rows.filter((r) => isProblem(r.status)).length ?? 0;
    let summary = '';
    if (info) summary = info.text;
    else if (model && loadedAt)
        summary =
            strings.summary(model.namespaces.length, model.endpoints.filter(isServiceBusEndpoint).length, model.steps.length) +
            (errors > 0 ? strings.summaryErrors(errors) : '') +
            strings.loadedAt(`${String(loadedAt.getHours()).padStart(2, '0')}:${String(loadedAt.getMinutes()).padStart(2, '0')}`);
    const summaryClass = info ? (info.tone === 'warning' ? 'sb-summary sb-summary-warning' : 'sb-summary sb-summary-success') : errors > 0 ? 'sb-summary sb-summary-warning' : 'sb-summary';

    const stepActions = { onEdit: editStep, onEnable: (x: StepInfo[]) => setStepsEnabled(x, true), onDisable: (x: StepInfo[]) => setStepsEnabled(x, false) };
    const missingHosts = model?.namespaces.filter((n) => n.isGhost).map((n) => n.host) ?? [];

    return (
        <FluentProvider theme={theme === 'dark' ? darkTheme : lightTheme} className="sb-provider">
            <I18nContext.Provider value={strings}>
                <div className={`sb-root sb-theme-${theme}`}>
                    <Header
                        connectionName={connection?.name}
                        language={settings.language}
                        busy={!!busy || !settingsLoaded}
                        onLoad={loadAll}
                        onConnections={() => setConnectionsOpen({ host: null })}
                        onExport={exportReport}
                        onOptions={() => setOptionsOpen(true)}
                        onHelp={() => setText({ title: strings.help, subtitle: strings.helpSubtitle, text: strings.helpText })}
                        onLanguage={(language: Language) => updateSettings({ language })}
                    />

                    <div className="sb-tabs-bar">
                        <TabList selectedValue={page} onTabSelect={(_e, d) => setPage(d.value as Page)}>
                            <Tab value="explorer" icon={<CloudRegular />}>
                                {strings.tabExplorer}
                            </Tab>
                            <Tab value="matching" icon={<TargetRegular />}>
                                {strings.tabMatching}
                                <Badge value={model && problems > 0 ? String(problems) : null} danger />
                            </Tab>
                            <Tab value="steps" icon={<PlayRegular />}>
                                {strings.tabSteps}
                                <Badge value={model && model.steps.length > 0 ? String(model.steps.length) : null} />
                            </Tab>
                        </TabList>
                        <span className={summaryClass}>{summary}</span>
                    </div>

                    <main className="sb-main">
                        {page === 'explorer' && (
                            <div className="sb-explorer">
                                <Card title={strings.treeTitle} subtitle={strings.treeSubtitle}>
                                    <div className="sb-tree-tools">
                                        <Input className="sb-tree-filter" contentBefore={<SearchRegular />} placeholder={strings.treeFilterCue} value={treeFilter} onChange={(_e, d) => setTreeFilter(d.value)} />
                                        <Tooltip content={strings.addNamespaceTip} relationship="label">
                                            <Button icon={<AddRegular />} onClick={() => setConnectionsOpen({ host: null })} />
                                        </Tooltip>
                                    </div>
                                    <Checkbox label={strings.onlyWithSteps} checked={onlyLinked} onChange={(_e, d) => setOnlyLinked(!!d.checked)} />
                                    {model && (model.namespaces.length > 0 || treeFilter) ? (
                                        <Tree model={model} filter={treeFilter.trim()} onlyLinked={onlyLinked} selectedKey={selectedKey} onSelect={(key) => setSelectedKey(key)} />
                                    ) : (
                                        <div className="sb-empty sb-tree-empty">{model ? strings.treeNoMatch : strings.treeEmpty}</div>
                                    )}
                                </Card>
                                <Card>
                                    <ExplorerDetail
                                        item={selectedItem}
                                        tab={detailTab}
                                        onTab={setDetailTab}
                                        busy={!!busy}
                                        messages={currentMessages}
                                        onReadMessages={readExplorerMessages}
                                        onConnect={(host) => setConnectionsOpen({ host })}
                                        onShowText={(title, subtitle, body) => setText({ title, subtitle, text: body })}
                                        onStepMessages={showStepMessages}
                                        {...stepActions}
                                    />
                                </Card>
                            </div>
                        )}
                        {page === 'matching' && <MatchingPage model={model} onOpen={openMatch} />}
                        {page === 'steps' && <StepsPage model={model} busy={!!busy} onMessages={showStepMessages} {...stepActions} />}
                    </main>

                    <StepEditor
                        state={editor}
                        writeTarget={(original, deletedImages) => writeTarget([original], deletedImages > 0 ? strings.imagesDeleted(deletedImages) : undefined)}
                        onCancel={() => setEditor(null)}
                        onSave={(original, draft) => saveEditedStep(original, draft)}
                    />
                    <StepMessagesDialog state={stepMessages} onClose={() => setStepMessages(null)} onShowText={(title, subtitle, body) => setText({ title, subtitle, text: body })} />
                    <ConnectionsDialog
                        open={!!connectionsOpen}
                        settings={settings}
                        missing={missingHosts}
                        host={connectionsOpen?.host ?? null}
                        onChange={(connections) => updateSettings({ connections })}
                        onClose={(changed) => {
                            setConnectionsOpen(null);
                            if (changed) setInfo({ text: strings.reloadHint, tone: 'warning' });
                        }}
                    />
                    <OptionsDialog open={optionsOpen} settings={settings} onSave={saveOptions} onCancel={() => setOptionsOpen(false)} />
                    <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
                    <MessageDialog message={message} onClose={() => setMessage(null)} onDetails={(title, details) => setText({ title, text: details })} />
                    <TextViewerDialog text={text} onClose={() => setText(null)} />
                    <DeviceCodeDialog prompt={deviceCode?.prompt ?? null} onCancel={() => deviceCode?.cancel()} />

                    {busy && (
                        <div className="sb-busy" role="status" aria-live="polite">
                            <div className="sb-busy-box">
                                <AppIcon className="sb-busy-logo" />
                                <div className="sb-busy-title">{busy.title}</div>
                                {busy.text && <div className="sb-busy-text">{busy.text}</div>}
                                <div className="sb-busy-elapsed">{Math.floor((Date.now() - busy.started) / 1000)} s</div>
                                <Button className="sb-stop" disabled={busy.stopping} onClick={stopTask}>
                                    {busy.stopping ? `${strings.stop}…` : strings.stop}
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </I18nContext.Provider>
        </FluentProvider>
    );
}

export default App;
