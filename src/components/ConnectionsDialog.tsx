import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, MessageBar, MessageBarBody, Spinner, Tab, TabList, Textarea } from '@fluentui/react-components';
import { DeleteRegular, KeyRegular, PersonAccountsRegular, SearchRegular } from '@fluentui/react-icons';
import { useStrings } from '../i18n/I18nContext';
import type { DiscoveredNamespace, PluginSettings, SavedConnection } from '../models/types';
import { forgetSecret, hasSecret, rememberSecret } from '../services/azure/connectionFactory';
import { parseConnectionString } from '../services/azure/connectionString';
import { AzureRequestError, isStopped } from '../services/azure/http';
import { ArmClient, SasReader } from '../services/azure/readers';
import { AzureCliProvider, DeviceCodeProvider, type TokenProvider } from '../services/azure/tokens';
import { errorMessage } from '../services/dataverse';
import { Badge, EmptyState } from './Common';

type ConnectionsTab = 'connected' | 'key' | 'microsoft';

interface ConnectionsDialogProps {
    open: boolean;
    settings: PluginSettings;
    /** Namespaces used by Dataverse and not connected. */
    missing: string[];
    /** Namespace to connect, when the user comes from the tree. */
    host: string | null;
    onChange: (connections: SavedConnection[]) => void;
    onClose: (changed: boolean) => void;
}

const describeError = (error: unknown) => (error instanceof AzureRequestError && error.details ? `${error.message}\n${error.details}` : errorMessage(error));

/** The namespaces read by the tool (port of ConnectionsDialog.cs). */
export function ConnectionsDialog(props: ConnectionsDialogProps) {
    const s = useStrings();
    const [tab, setTab] = useState<ConnectionsTab>('connected');
    const [connectionString, setConnectionString] = useState('');
    const [remember, setRemember] = useState(false);
    const [status, setStatus] = useState<{ text: string; intent: 'info' | 'success' | 'error' | 'warning' } | null>(null);
    const [working, setWorking] = useState<string | null>(null);
    const [found, setFound] = useState<Array<DiscoveredNamespace & { method: 'microsoft' | 'azureCli' }> | null>(null);
    const [checked, setChecked] = useState<Set<string>>(new Set());
    const changed = useRef(false);
    const controller = useRef<AbortController | null>(null);
    const connections = props.settings.connections;

    useEffect(() => {
        if (!props.open) return;
        changed.current = false;
        setStatus(props.host ? { text: s.connectHost(props.host), intent: 'info' } : null);
        setTab(props.host ? 'key' : connections.length === 0 ? 'key' : 'connected');
        setConnectionString('');
        setRemember(false);
        setFound(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.open]);

    const save = (next: SavedConnection[]) => {
        changed.current = true;
        props.onChange(next);
    };

    const close = () => {
        controller.current?.abort();
        props.onClose(changed.current);
    };

    const run = async (text: string, action: (signal: AbortSignal) => Promise<void>) => {
        const stop = new AbortController();
        controller.current = stop;
        setWorking(text);
        setStatus(null);
        try {
            await action(stop.signal);
        } catch (error) {
            if (!isStopped(error)) setStatus({ text: describeError(error), intent: 'error' });
        } finally {
            controller.current = null;
            setWorking(null);
        }
    };

    const testAndAdd = () =>
        run(s.testingConnection, async (signal) => {
            const info = parseConnectionString(connectionString, s);
            if (info.entityPath) throw new Error(s.connectionStringEntityScoped);
            // A read proves the key has the Manage right on the namespace.
            await new SasReader(info, s).readQueues({ host: info.host, readWithKey: true, isGhost: false, queues: [], topics: [] }, signal);
            const value = connectionString.trim();
            if (!remember) rememberSecret(info.host, value);
            else forgetSecret(info.host);
            const entry: SavedConnection = { host: info.host, method: 'connectionString', remember, connectionString: remember ? value : undefined };
            save([...connections.filter((c) => c.host.toLowerCase() !== info.host), entry]);
            setConnectionString('');
            setStatus({ text: s.connectionAdded(info.host), intent: 'success' });
        });

    const discover = (method: 'microsoft' | 'azureCli') =>
        run(method === 'azureCli' ? s.searchingNamespaces : s.signingIn, async (signal) => {
            const provider: TokenProvider = method === 'azureCli' ? new AzureCliProvider(s) : new DeviceCodeProvider(props.settings.clientId, props.settings.tenantId, s);
            const result = await new ArmClient(provider, s).discoverNamespaces(props.settings.tenantId || undefined, (text) => setWorking(text), signal);
            const already = new Set(connections.map((c) => c.host.toLowerCase()));
            setFound(result.map((r) => ({ ...r, method })));
            setChecked(new Set(result.filter((r) => !already.has(r.host) || props.missing.includes(r.host)).map((r) => r.host)));
            setStatus({ text: result.length > 0 ? s.foundNamespaces(result.length) : s.noNamespaceFound, intent: result.length > 0 ? 'info' : 'warning' });
        });

    const addSelected = () => {
        if (!found) return;
        const picked = found.filter((f) => checked.has(f.host));
        const hosts = new Set(picked.map((p) => p.host));
        save([
            ...connections.filter((c) => !hosts.has(c.host.toLowerCase())),
            ...picked.map((p) => ({ host: p.host, method: p.method, resourceId: p.resourceId, tenantId: p.tenantId, subscriptionName: p.subscriptionName })),
        ]);
        setFound(null);
        setStatus({ text: s.connectionsAdded(picked.length), intent: 'success' });
        setTab('connected');
    };

    const keyState = (c: SavedConnection) => (c.method !== 'connectionString' ? c.subscriptionName ?? '' : c.remember ? s.keyRemembered : hasSecret(c) ? s.keySession : s.keyMissing);

    return (
        <Dialog open={props.open} onOpenChange={(_e, d) => !d.open && close()}>
            <DialogSurface className="sb-dialog-large sb-connections-dialog">
                <DialogBody>
                    <DialogTitle>
                        <div>{s.connectionsTitle}</div>
                        <div className="sb-dlg-subtitle">{s.connectionsSubtitle}</div>
                    </DialogTitle>
                    <DialogContent className="sb-form" style={{ minHeight: 380 }}>
                        <TabList selectedValue={tab} onTabSelect={(_e, d) => setTab(d.value as ConnectionsTab)}>
                            <Tab value="connected">
                                {s.tabConnected}
                                <Badge value={String(connections.length)} />
                            </Tab>
                            <Tab value="key" icon={<KeyRegular />}>
                                {s.tabConnectionString}
                            </Tab>
                            <Tab value="microsoft" icon={<PersonAccountsRegular />}>
                                {s.tabMicrosoft}
                            </Tab>
                        </TabList>

                        {props.missing.length > 0 && (
                            <MessageBar intent="warning">
                                <MessageBarBody>{s.neededByDataverse(props.missing.join(', '))}</MessageBarBody>
                            </MessageBar>
                        )}
                        {status && (
                            <MessageBar intent={status.intent} className="sb-connections-status">
                                <MessageBarBody className="sb-pre">{status.text}</MessageBarBody>
                            </MessageBar>
                        )}
                        {working && (
                            <div className="sb-toolbar">
                                <Spinner size="tiny" />
                                <span className="sb-muted">{working}</span>
                                <Button size="small" onClick={() => controller.current?.abort()}>
                                    {s.stop}
                                </Button>
                            </div>
                        )}

                        {tab === 'connected' &&
                            (connections.length === 0 ? (
                                <EmptyState text={s.noConnection} />
                            ) : (
                                <div className="sb-grid-wrapper">
                                    <table className="sb-grid sb-connections-grid">
                                        <thead>
                                            <tr>
                                                <th>{s.colHost}</th>
                                                <th>{s.colMethod}</th>
                                                <th>{s.colDetail}</th>
                                                <th />
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {connections.map((c) => (
                                                <tr key={c.host}>
                                                    <td className="sb-strong">{c.host}</td>
                                                    <td>{s.methodLabel(c.method)}</td>
                                                    <td>{keyState(c)}</td>
                                                    <td style={{ width: 60 }}>
                                                        <Button
                                                            size="small"
                                                            appearance="subtle"
                                                            icon={<DeleteRegular />}
                                                            title={s.remove}
                                                            onClick={() => {
                                                                forgetSecret(c.host);
                                                                save(connections.filter((x) => x !== c));
                                                            }}
                                                        />
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ))}

                        {tab === 'key' && (
                            <>
                                <Field label={s.connectionStringLabel} hint={s.connectionStringHint}>
                                    <Textarea
                                        className="sb-mono sb-connection-string"
                                        resize="vertical"
                                        rows={3}
                                        placeholder="Endpoint=sb://…;SharedAccessKeyName=…;SharedAccessKey=…"
                                        value={connectionString}
                                        onChange={(_e, d) => setConnectionString(d.value)}
                                    />
                                </Field>
                                <Checkbox className="sb-remember" label={s.rememberKey} checked={remember} onChange={(_e, d) => setRemember(!!d.checked)} />
                                <div className="sb-hint">{s.rememberKeyHint}</div>
                                <div className="sb-toolbar">
                                    <Button appearance="primary" className="sb-test-add" disabled={!connectionString.trim() || !!working} onClick={testAndAdd}>
                                        {s.testAndAdd}
                                    </Button>
                                </div>
                            </>
                        )}

                        {tab === 'microsoft' && (
                            <>
                                <div className="sb-hint">{s.microsoftHint}</div>
                                <div className="sb-toolbar">
                                    <Button appearance="primary" icon={<PersonAccountsRegular />} disabled={!!working} onClick={() => discover('microsoft')}>
                                        {s.signInMicrosoft}
                                    </Button>
                                    <Button className="sb-use-cli" icon={<SearchRegular />} disabled={!!working} onClick={() => discover('azureCli')}>
                                        {s.useAzureCli}
                                    </Button>
                                </div>
                                {found && found.length > 0 && (
                                    <>
                                        <div className="sb-grid-wrapper">
                                            <table className="sb-grid sb-found-grid">
                                                <thead>
                                                    <tr>
                                                        <th />
                                                        <th>{s.colHost}</th>
                                                        <th>{s.colSubscriptionAzure}</th>
                                                        <th>{s.colResourceGroup}</th>
                                                        <th>{s.colTier}</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {found.map((f) => (
                                                        <tr key={f.host}>
                                                            <td style={{ width: 40 }}>
                                                                <Checkbox
                                                                    checked={checked.has(f.host)}
                                                                    onChange={(_e, d) =>
                                                                        setChecked((x) => {
                                                                            const next = new Set(x);
                                                                            if (d.checked) next.add(f.host);
                                                                            else next.delete(f.host);
                                                                            return next;
                                                                        })
                                                                    }
                                                                />
                                                            </td>
                                                            <td className="sb-strong">{f.host}</td>
                                                            <td>{f.subscriptionName}</td>
                                                            <td>{f.resourceGroup}</td>
                                                            <td>{f.sku}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        <div className="sb-toolbar">
                                            <Button appearance="primary" disabled={checked.size === 0} onClick={addSelected}>
                                                {s.addSelected}
                                            </Button>
                                        </div>
                                    </>
                                )}
                            </>
                        )}
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="primary" onClick={close}>
                            {s.close}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}
