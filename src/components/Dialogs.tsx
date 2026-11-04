import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, SpinButton } from '@fluentui/react-components';
import { CopyRegular, OpenRegular } from '@fluentui/react-icons';
import { useStrings } from '../i18n/I18nContext';
import { MaxMessagesLimit, type MessageBatch, type PluginSettings } from '../models/types';
import type { DeviceCodePrompt } from '../services/azure/tokens';
import { isStopped } from '../services/azure/http';
import { errorMessage } from '../services/dataverse';
import { openUrl } from './Header';
import { MessagesPanel } from './MessagesPanel';

// #region Message box

export interface MessageState {
    title: string;
    text: string;
    intent: 'info' | 'success' | 'warning' | 'error';
    details?: string;
}

/** Replacement of MessageDialog.Show. */
export function MessageDialog(props: { message: MessageState | null; onClose: () => void; onDetails: (title: string, text: string) => void }) {
    const s = useStrings();
    const { message } = props;
    return (
        <Dialog open={!!message} onOpenChange={(_e, d) => !d.open && props.onClose()}>
            <DialogSurface className="sb-dialog-small sb-message-dialog">
                <DialogBody>
                    <DialogTitle className={`sb-dialog-title-${message?.intent ?? 'info'}`}>{message?.title}</DialogTitle>
                    <DialogContent>
                        <div className="sb-pre">{message?.text}</div>
                    </DialogContent>
                    <DialogActions>
                        {message?.details && <Button onClick={() => props.onDetails(message.title, message.details!)}>{s.details}</Button>}
                        <Button appearance="primary" onClick={props.onClose}>
                            {s.ok}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}

// #endregion

// #region Confirmation

export interface ConfirmState {
    title: string;
    text: string;
    lines?: string[];
    question: string;
    action: string;
    intent?: 'info' | 'warning';
    onConfirm: () => void;
}

/** Question with the list of what will change (bulk enable / disable, review of a step). */
export function ConfirmDialog(props: { confirm: ConfirmState | null; onClose: () => void }) {
    const s = useStrings();
    const c = props.confirm;
    return (
        <Dialog open={!!c} onOpenChange={(_e, d) => !d.open && props.onClose()}>
            <DialogSurface className="sb-dialog-medium sb-confirm-dialog">
                <DialogBody>
                    <DialogTitle className={c?.intent === 'warning' ? 'sb-dialog-title-warning' : undefined}>{c?.title}</DialogTitle>
                    <DialogContent className="sb-form">
                        <div className="sb-pre">{c?.text}</div>
                        {c?.lines && c.lines.length > 0 && (
                            <div className="sb-lines">
                                {c.lines.map((line, i) => (
                                    <div key={i}>{line}</div>
                                ))}
                            </div>
                        )}
                        <div className="sb-strong">{c?.question}</div>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={props.onClose}>{s.cancel}</Button>
                        <Button
                            appearance="primary"
                            className="sb-confirm"
                            onClick={() => {
                                props.onClose();
                                c?.onConfirm();
                            }}
                        >
                            {c?.action}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}

// #endregion

// #region Text viewer

export interface TextState {
    title: string;
    subtitle?: string;
    text: string;
}

/** Large window to read a long error, a body or the help comfortably. */
export function TextViewerDialog(props: { text: TextState | null; onClose: () => void }) {
    const s = useStrings();
    const [wrap, setWrap] = useState(true);
    const [copied, setCopied] = useState(false);
    useEffect(() => setCopied(false), [props.text]);
    const t = props.text;
    return (
        <Dialog open={!!t} onOpenChange={(_e, d) => !d.open && props.onClose()}>
            <DialogSurface className="sb-dialog-large sb-text-viewer">
                <DialogBody>
                    <DialogTitle>
                        <div>{t?.title}</div>
                        {t?.subtitle && <div className="sb-dlg-subtitle">{t.subtitle}</div>}
                    </DialogTitle>
                    <DialogContent>
                        <pre className={wrap ? 'sb-code sb-code-wrap' : 'sb-code'} style={{ maxHeight: '62vh', minHeight: 200 }}>
                            {t?.text}
                        </pre>
                    </DialogContent>
                    <DialogActions position="start">
                        <Checkbox label={s.wordWrap} checked={wrap} onChange={(_e, d) => setWrap(!!d.checked)} />
                    </DialogActions>
                    <DialogActions>
                        <Button
                            icon={<CopyRegular />}
                            onClick={async () => {
                                await window.toolboxAPI.utils.copyToClipboard(t?.text ?? '').catch(() => undefined);
                                setCopied(true);
                            }}
                        >
                            {copied ? s.copied : s.copy}
                        </Button>
                        <Button appearance="primary" onClick={props.onClose}>
                            {s.close}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}

// #endregion

// #region Options

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value)));

/** Settings of the tool (port of OptionsDialog.cs). */
export function OptionsDialog(props: { open: boolean; settings: PluginSettings; onSave: (patch: Partial<PluginSettings>) => void; onCancel: () => void }) {
    const s = useStrings();
    const [draft, setDraft] = useState(props.settings);

    useEffect(() => {
        if (props.open) setDraft(props.settings);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.open]);

    const number = (key: 'parallelRequests' | 'maxMessages', min: number, max: number) => (_e: unknown, d: { value?: number | null; displayValue?: string }) => {
        const value = d.value ?? Number(d.displayValue);
        if (Number.isFinite(value)) setDraft((x) => ({ ...x, [key]: clamp(value as number, min, max) }));
    };

    return (
        <Dialog open={props.open} onOpenChange={(_e, d) => !d.open && props.onCancel()}>
            <DialogSurface className="sb-dialog-medium sb-options-dialog">
                <DialogBody>
                    <DialogTitle>
                        <div>{s.options}</div>
                        <div className="sb-dlg-subtitle">{s.optionsSubtitle}</div>
                    </DialogTitle>
                    <DialogContent className="sb-form">
                        <Field label={s.optionParallel} hint={s.optionParallelHint}>
                            <SpinButton className="sb-option-parallel" min={1} max={16} value={draft.parallelRequests} onChange={number('parallelRequests', 1, 16)} />
                        </Field>
                        <Field label={s.optionMaxMessages} hint={s.optionMaxMessagesHint}>
                            <SpinButton className="sb-option-messages" min={1} max={MaxMessagesLimit} step={50} value={draft.maxMessages} onChange={number('maxMessages', 1, MaxMessagesLimit)} />
                        </Field>
                        <Field label={s.optionTenant} hint={s.optionTenantHint}>
                            <Input className="sb-option-tenant" value={draft.tenantId} onChange={(_e, d) => setDraft((x) => ({ ...x, tenantId: d.value }))} />
                        </Field>
                        <Field label={s.optionClient} hint={s.optionClientHint}>
                            <Input className="sb-option-client" value={draft.clientId} onChange={(_e, d) => setDraft((x) => ({ ...x, clientId: d.value }))} />
                        </Field>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={props.onCancel}>{s.cancel}</Button>
                        <Button
                            appearance="primary"
                            onClick={() =>
                                props.onSave({ parallelRequests: draft.parallelRequests, maxMessages: draft.maxMessages, tenantId: draft.tenantId.trim(), clientId: draft.clientId.trim() })
                            }
                        >
                            {s.save}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}

// #endregion

// #region Sign-in code

/** Shown while a Microsoft sign-in waits: the code to enter in the browser. */
export function DeviceCodeDialog(props: { prompt: DeviceCodePrompt | null; onCancel: () => void }) {
    const s = useStrings();
    const [copied, setCopied] = useState(false);
    useEffect(() => setCopied(false), [props.prompt]);
    const p = props.prompt;
    return (
        <Dialog open={!!p} modalType="alert">
            <DialogSurface className="sb-dialog-small sb-device-code-dialog">
                <DialogBody>
                    <DialogTitle>{s.deviceCodeTitle}</DialogTitle>
                    <DialogContent className="sb-form">
                        <div>{p && s.deviceCodeText(p.verificationUri)}</div>
                        <div className="sb-device-code">{p?.userCode}</div>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={props.onCancel}>{s.cancel}</Button>
                        <Button
                            icon={<CopyRegular />}
                            onClick={async () => {
                                await window.toolboxAPI.utils.copyToClipboard(p?.userCode ?? '').catch(() => undefined);
                                setCopied(true);
                            }}
                        >
                            {copied ? s.copied : s.copyCode}
                        </Button>
                        <Button appearance="primary" icon={<OpenRegular />} onClick={() => p && openUrl(p.verificationUri)}>
                            {s.openSignInPage}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}

// #endregion

// #region Messages of steps

export interface StepMessagesState {
    title: string;
    subtitle: string;
    intro: string;
    steps: Set<string>;
    read: (progress: (text: string) => void, signal: AbortSignal) => Promise<MessageBatch[]>;
}

/**
 * Messages sent by one or more steps, read from the queue or the subscriptions of their endpoint.
 * The read starts when the popup opens (the user asked for it) and can be stopped or run again.
 */
export function StepMessagesDialog(props: { state: StepMessagesState | null; onClose: () => void; onShowText: (title: string, subtitle: string, text: string) => void }) {
    const s = useStrings();
    const [batches, setBatches] = useState<MessageBatch[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<string>();
    const [error, setError] = useState<string>();
    const controller = useRef<AbortController | null>(null);
    const state = props.state;

    const read = async () => {
        if (!state || controller.current) return;
        const stop = new AbortController();
        controller.current = stop;
        setBusy(true);
        setError(undefined);
        setProgress(undefined);
        try {
            const result = await state.read(setProgress, stop.signal);
            if (!stop.signal.aborted) setBatches(result);
        } catch (e) {
            if (!isStopped(e) && !stop.signal.aborted) setError(errorMessage(e));
        } finally {
            if (controller.current === stop) {
                controller.current = null;
                setBusy(false);
            }
        }
    };

    /** Stop gives the popup back at once: a call that does not stop by itself is abandoned and its result ignored. */
    const stopReading = () => {
        controller.current?.abort();
        controller.current = null;
        setBusy(false);
    };

    useEffect(() => {
        setBatches(null);
        if (state) read();
        return () => controller.current?.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state]);

    const close = () => {
        controller.current?.abort();
        props.onClose();
    };

    return (
        <Dialog open={!!state} onOpenChange={(_e, d) => !d.open && close()}>
            <DialogSurface className="sb-dialog-full sb-step-messages-dialog">
                <DialogBody>
                    <DialogTitle>
                        <div>{state?.title}</div>
                        <div className="sb-dlg-subtitle">{state?.subtitle}</div>
                    </DialogTitle>
                    <DialogContent>
                        {error && <div className="sb-alert">{error}</div>}
                        <MessagesPanel
                            batches={batches}
                            intro={state?.intro ?? null}
                            canRead
                            stepFilter={state?.steps}
                            busy={busy}
                            progress={progress}
                            onRead={read}
                            onStop={stopReading}
                            onShowText={props.onShowText}
                        />
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

// #endregion
