import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Button,
    Checkbox,
    Combobox,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Dropdown,
    Field,
    Input,
    MessageBar,
    MessageBarBody,
    Option,
    Radio,
    RadioGroup,
    SpinButton,
    Spinner,
    Textarea,
} from '@fluentui/react-components';
import { AddRegular, DeleteRegular, DismissRegular, EditRegular, SearchRegular, TextBulletListLtrRegular } from '@fluentui/react-icons';
import { useStrings } from '../i18n/I18nContext';
import { allColumns, cloneStep, StepMode, StepStage, type ColumnInfo, type ImageInfo, type MessageOption, type StepInfo } from '../models/types';
import { errorMessage } from '../services/dataverse';
import { loadColumns, loadTables } from '../services/endpointService';
import { allowedImageTypes, describe, normalizeColumns, supportsFilteringAttributes, supportsImages, validate } from '../services/stepRules';
import { Card } from './Common';

const Stages = [StepStage.PreValidation, StepStage.PreOperation, StepStage.PostOperation];
const Modes = [StepMode.Synchronous, StepMode.Asynchronous];

export interface EditorState {
    step: StepInfo;
    messages: MessageOption[];
    tables: Map<string, string>;
}

interface StepEditorProps {
    state: EditorState | null;
    onCancel: () => void;
    /** The reviewed change: the app writes it. */
    onSave: (original: StepInfo, draft: StepInfo, lines: string[]) => void;
}

/** Trigger and images of a step (port of StepEditorDialog.cs). */
export function StepEditor(props: StepEditorProps) {
    if (!props.state) return null;
    return <StepEditorBody key={props.state.step.id} {...props} state={props.state} />;
}

function StepEditorBody(props: StepEditorProps & { state: EditorState }) {
    const s = useStrings();
    const original = props.state.step;
    const readOnly = original.isManaged && !original.isCustomizable;
    const [draft, setDraft] = useState<StepInfo>(() => cloneStep(original));
    const [tables, setTables] = useState(props.state.tables);
    const [messageText, setMessageText] = useState(original.message);
    const [tableText, setTableText] = useState(original.table ?? (props.state.tables.has('') ? s.allTables : ''));
    const [loadingTables, setLoadingTables] = useState(false);
    const [error, setError] = useState<string>();
    const [imageEditor, setImageEditor] = useState<{ image: ImageInfo; index: number; allowed: number[] } | null>(null);
    const [picker, setPicker] = useState(false);
    const [selectedImage, setSelectedImage] = useState<number | null>(null);
    const [review, setReview] = useState<string[] | null>(null);
    const latestMessage = useRef(original.messageId);

    const selectedTable = (text: string) => (!text || text === s.allTables ? null : text.trim());

    /** Same trigger: the existing filter is kept as it is, nothing to write. */
    const withTrigger = (next: StepInfo, currentTables: Map<string, string>): StepInfo => {
        const same = next.messageId === original.messageId && (next.table ?? '').toLowerCase() === (original.table ?? '').toLowerCase();
        return { ...next, filterId: same ? original.filterId : (currentTables.get(next.table ?? '') ?? null), deleteJobOnSuccess: next.deleteJobOnSuccess && next.mode === StepMode.Asynchronous };
    };

    const update = (patch: Partial<StepInfo>) => setDraft((current) => withTrigger({ ...current, ...patch }, tables));

    const onMessage = async (text: string) => {
        setMessageText(text);
        const found = props.state.messages.find((m) => m.name.toLowerCase() === text.trim().toLowerCase());
        if (!found) {
            setDraft((current) => ({ ...current, message: '', messageId: '' }));
            return;
        }
        latestMessage.current = found.id;
        setDraft((current) => ({ ...current, message: found.name, messageId: found.id }));
        setLoadingTables(true);
        try {
            const next = await loadTables(found.id);
            if (latestMessage.current !== found.id) return;
            setTables(next);
            setDraft((current) => {
                const previous = current.table;
                const table = previous && next.has(previous) ? previous : null;
                setTableText(table ?? (next.has('') ? s.allTables : ''));
                const filtering = supportsFilteringAttributes(found.name) && table === original.table ? current.filteringAttributes : '';
                return withTrigger({ ...current, message: found.name, messageId: found.id, table, filteringAttributes: filtering }, next);
            });
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setLoadingTables(false);
        }
    };

    const onTable = (text: string) => {
        setTableText(text);
        const table = selectedTable(text);
        setDraft((current) => {
            // Filtering columns belong to the table: they cannot follow it.
            const filtering = (table ?? '').toLowerCase() !== (original.table ?? '').toLowerCase() && (current.table ?? '').toLowerCase() === (original.table ?? '').toLowerCase() ? '' : current.filteringAttributes;
            return withTrigger({ ...current, table, filteringAttributes: filtering }, tables);
        });
    };

    const issues = useMemo(() => {
        const list = validate(draft, s);
        const hasTrigger = !!draft.filterId || (draft.messageId === original.messageId && draft.table === null && original.table === null);
        if (draft.message && !hasTrigger && !loadingTables) list.unshift(s.tableRequired);
        return list;
    }, [draft, s, original, loadingTables]);

    const notice = readOnly ? s.readOnlyStep : issues.length > 0 ? issues.join('  ·  ') : original.isManaged ? s.managedStepWarning : null;
    const canSave = !readOnly && issues.length === 0 && !loadingTables;
    const filteringAllowed = supportsFilteringAttributes(draft.message) && !readOnly;
    const allowed = allowedImageTypes(draft.message, draft.stage);

    const messageOptions = useMemo(() => {
        const query = messageText.trim().toLowerCase();
        const list = props.state.messages.filter((m) => !query || m.name.toLowerCase().includes(query) || m.name === draft.message);
        return list.slice(0, 200);
    }, [props.state.messages, messageText, draft.message]);

    const tableOptions = useMemo(() => {
        const names = [...tables.keys()].filter((k) => k.length > 0).sort((a, b) => a.localeCompare(b));
        const query = tableText.trim().toLowerCase();
        const list = (tables.has('') ? [s.allTables] : []).concat(names).filter((n) => !query || query === s.allTables.toLowerCase() || n.toLowerCase().includes(query));
        return list.slice(0, 300);
    }, [tables, tableText, s]);

    const save = () => {
        const lines = describe(original, draft, s);
        if (lines.length === 0) {
            setError(s.noChanges);
            return;
        }
        setReview(lines);
    };

    return (
        <>
        <Dialog open onOpenChange={(_e, d) => !d.open && props.onCancel()}>
            <DialogSurface className="sb-dialog-large sb-step-editor">
                <DialogBody>
                    <DialogTitle>
                        <div>{s.editorTitle}</div>
                        <div className="sb-dlg-subtitle">{original.name}</div>
                    </DialogTitle>
                    <DialogContent className="sb-form">
                        <div className="sb-form-row" style={{ alignItems: 'stretch' }}>
                            <Card title={s.triggerTitle} subtitle={s.triggerSubtitle}>
                                <div className="sb-form">
                                    <Field label={s.fieldMessage}>
                                        <Combobox
                                            className="sb-editor-message"
                                            freeform
                                            disabled={readOnly}
                                            value={messageText}
                                            selectedOptions={draft.message ? [draft.message] : []}
                                            onChange={(e) => onMessage((e.target as HTMLInputElement).value)}
                                            onOptionSelect={(_e, d) => d.optionText && onMessage(d.optionText)}
                                        >
                                            {messageOptions.map((m) => (
                                                <Option key={m.id} value={m.name}>
                                                    {m.name}
                                                </Option>
                                            ))}
                                        </Combobox>
                                    </Field>
                                    <Field label={s.fieldTable}>
                                        <Combobox
                                            className="sb-editor-table"
                                            freeform
                                            disabled={readOnly || loadingTables}
                                            value={tableText}
                                            selectedOptions={tableText ? [tableText] : []}
                                            onChange={(e) => onTable((e.target as HTMLInputElement).value)}
                                            onOptionSelect={(_e, d) => d.optionText && onTable(d.optionText)}
                                        >
                                            {tableOptions.map((t) => (
                                                <Option key={t} value={t}>
                                                    {t}
                                                </Option>
                                            ))}
                                        </Combobox>
                                    </Field>
                                    <div className="sb-form-row">
                                        <Field label={s.fieldStage}>
                                            <Dropdown
                                                className="sb-editor-stage"
                                                disabled={readOnly}
                                                value={s.stageLabel(draft.stage)}
                                                selectedOptions={[String(draft.stage)]}
                                                onOptionSelect={(_e, d) => update({ stage: Number(d.optionValue) })}
                                            >
                                                {Stages.map((x) => (
                                                    <Option key={x} value={String(x)}>
                                                        {s.stageLabel(x)}
                                                    </Option>
                                                ))}
                                            </Dropdown>
                                        </Field>
                                        <Field label={s.fieldMode}>
                                            <Dropdown
                                                className="sb-editor-mode"
                                                disabled={readOnly}
                                                value={s.modeLabel(draft.mode)}
                                                selectedOptions={[String(draft.mode)]}
                                                onOptionSelect={(_e, d) => update({ mode: Number(d.optionValue) })}
                                            >
                                                {Modes.map((x) => (
                                                    <Option key={x} value={String(x)}>
                                                        {s.modeLabel(x)}
                                                    </Option>
                                                ))}
                                            </Dropdown>
                                        </Field>
                                    </div>
                                    <Field label={s.fieldRank}>
                                        <SpinButton
                                            className="sb-editor-rank"
                                            disabled={readOnly}
                                            min={0}
                                            max={100000}
                                            value={draft.rank}
                                            onChange={(_e, d) => {
                                                const value = d.value ?? Number(d.displayValue);
                                                if (Number.isFinite(value)) update({ rank: Math.round(value as number) });
                                            }}
                                        />
                                    </Field>
                                    <Field label={s.fieldFiltering} hint={supportsFilteringAttributes(draft.message) ? undefined : s.filteringOnlyUpdate}>
                                        <Textarea className="sb-mono sb-editor-filtering" readOnly value={draft.filteringAttributes} rows={2} />
                                    </Field>
                                    <div className="sb-toolbar">
                                        <Button size="small" icon={<TextBulletListLtrRegular />} disabled={!filteringAllowed || !draft.table} onClick={() => setPicker(true)}>
                                            {s.selectColumns}
                                        </Button>
                                        <Button size="small" appearance="subtle" icon={<DismissRegular />} disabled={!filteringAllowed || !draft.filteringAttributes} onClick={() => update({ filteringAttributes: '' })}>
                                            {s.clearColumns}
                                        </Button>
                                    </div>
                                    <Checkbox
                                        label={s.fieldDeleteJob}
                                        disabled={readOnly || draft.mode !== StepMode.Asynchronous}
                                        checked={draft.deleteJobOnSuccess}
                                        onChange={(_e, d) => update({ deleteJobOnSuccess: !!d.checked })}
                                    />
                                    <Field label={s.fieldName}>
                                        <Input className="sb-editor-name" disabled={readOnly} value={draft.name} onChange={(_e, d) => update({ name: d.value })} />
                                    </Field>
                                    <Field label={s.fieldDescription}>
                                        <Textarea disabled={readOnly} value={draft.description} rows={2} onChange={(_e, d) => update({ description: d.value })} />
                                    </Field>
                                </div>
                            </Card>

                            <Card title={s.imagesTitle} subtitle={s.imagesSubtitle}>
                                <div className="sb-toolbar">
                                    <Button
                                        size="small"
                                        appearance="primary"
                                        className="sb-image-add"
                                        icon={<AddRegular />}
                                        disabled={readOnly || !supportsImages(draft.message) || allowed.length === 0}
                                        onClick={() => setImageEditor({ image: { id: '', name: '', alias: '', imageType: allowed[0], attributes: '' }, index: -1, allowed })}
                                    >
                                        {s.add}
                                    </Button>
                                    <Button
                                        size="small"
                                        icon={<EditRegular />}
                                        disabled={readOnly || selectedImage === null}
                                        onClick={() => {
                                            if (selectedImage === null) return;
                                            const image = draft.images[selectedImage];
                                            // An invalid type stays listed so it can be replaced, not silently changed.
                                            setImageEditor({ image: { ...image }, index: selectedImage, allowed: allowed.length > 0 ? allowed : [image.imageType] });
                                        }}
                                    >
                                        {s.edit}
                                    </Button>
                                    <Button
                                        size="small"
                                        icon={<DeleteRegular />}
                                        disabled={readOnly || selectedImage === null}
                                        onClick={() => {
                                            if (selectedImage === null) return;
                                            update({ images: draft.images.filter((_x, i) => i !== selectedImage) });
                                            setSelectedImage(null);
                                        }}
                                    >
                                        {s.remove}
                                    </Button>
                                </div>
                                <div className="sb-grid-wrapper" style={{ minHeight: 160 }}>
                                    <table className="sb-grid sb-grid-select sb-editor-images">
                                        <thead>
                                            <tr>
                                                <th>{s.colType}</th>
                                                <th>{s.colAlias}</th>
                                                <th>{s.colColumns}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {draft.images.map((image, i) => (
                                                <tr
                                                    key={`${image.id}/${i}`}
                                                    className={i === selectedImage ? 'sb-row-selected' : undefined}
                                                    onClick={() => setSelectedImage(i)}
                                                    onDoubleClick={() => !readOnly && setImageEditor({ image: { ...image }, index: i, allowed: allowed.length > 0 ? allowed : [image.imageType] })}
                                                >
                                                    <td>{s.imageTypeLabel(image.imageType)}</td>
                                                    <td>{image.alias}</td>
                                                    <td className="sb-wrap">{allColumns(image) ? s.allColumns : image.attributes}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="sb-hint">{s.imagesHint}</div>
                            </Card>
                        </div>
                        {loadingTables && <Spinner size="tiny" label={s.loading} />}
                        {notice && <div className="sb-alert sb-editor-issues">{notice}</div>}
                        {error && (
                            <MessageBar intent="warning">
                                <MessageBarBody>{error}</MessageBarBody>
                            </MessageBar>
                        )}
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={props.onCancel}>{s.cancel}</Button>
                        <Button appearance="primary" className="sb-editor-save" disabled={!canSave} onClick={save}>
                            {s.save}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>

            {imageEditor && (
                <ImageEditor
                    image={imageEditor.image}
                    allowed={imageEditor.allowed}
                    table={draft.table}
                    onCancel={() => setImageEditor(null)}
                    onSave={(image) => {
                        const images = [...draft.images];
                        if (imageEditor.index < 0) images.push(image);
                        else images[imageEditor.index] = image;
                        update({ images });
                        setImageEditor(null);
                    }}
                />
            )}
            {picker && draft.table && (
                <ColumnPicker
                    table={draft.table}
                    selected={draft.filteringAttributes}
                    onCancel={() => setPicker(false)}
                    onSave={(columns) => {
                        update({ filteringAttributes: columns });
                        setPicker(false);
                    }}
                />
            )}
            <Dialog open={!!review} onOpenChange={(_e, d) => !d.open && setReview(null)}>
                <DialogSurface className="sb-dialog-medium sb-review-dialog">
                    <DialogBody>
                        <DialogTitle className="sb-dialog-title-warning">{s.reviewTitle}</DialogTitle>
                        <DialogContent className="sb-form">
                            <div>{s.reviewMessage(original.name)}</div>
                            <div className="sb-lines">
                                {review?.map((line, i) => (
                                    <div key={i}>•  {line}</div>
                                ))}
                            </div>
                            <div className="sb-strong">{s.reviewQuestion}</div>
                        </DialogContent>
                        <DialogActions>
                            <Button onClick={() => setReview(null)}>{s.cancel}</Button>
                            <Button appearance="primary" className="sb-review-save" onClick={() => review && props.onSave(original, draft, review)}>
                                {s.save}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </>
    );
}

// #region Image editor

/** Type, alias and columns of an image (port of ImageEditorDialog.cs). */
function ImageEditor(props: { image: ImageInfo; allowed: number[]; table: string | null; onCancel: () => void; onSave: (image: ImageInfo) => void }) {
    const s = useStrings();
    const [image, setImage] = useState(props.image);
    const [all, setAll] = useState(allColumns(props.image));
    const [picker, setPicker] = useState(false);
    const problem = !image.alias.trim() ? s.imageNeedsAlias : !all && !normalizeColumns(image.attributes) ? s.imageNeedsColumns : null;

    return (
        <>
        <Dialog open onOpenChange={(_e, d) => !d.open && props.onCancel()}>
            <DialogSurface className="sb-dialog-small sb-image-editor">
                <DialogBody>
                    <DialogTitle>{props.image.id || props.image.alias ? s.imageEditorEdit : s.imageEditorAdd}</DialogTitle>
                    <DialogContent className="sb-form">
                        <Field label={s.fieldImageType}>
                            <RadioGroup layout="horizontal" value={String(image.imageType)} onChange={(_e, d) => setImage({ ...image, imageType: Number(d.value) })}>
                                {props.allowed.map((t) => (
                                    <Radio key={t} value={String(t)} label={s.imageTypeLabel(t)} />
                                ))}
                            </RadioGroup>
                        </Field>
                        <Field label={s.fieldAlias}>
                            <Input
                                className="sb-image-alias"
                                value={image.alias}
                                onChange={(_e, d) => setImage({ ...image, alias: d.value, name: !image.name || image.name === image.alias ? d.value : image.name })}
                            />
                        </Field>
                        <Field label={s.fieldColumns}>
                            <RadioGroup value={all ? 'all' : 'some'} onChange={(_e, d) => setAll(d.value === 'all')}>
                                <Radio value="all" label={s.columnsAll} />
                                <Radio value="some" label={s.columnsSelected} />
                            </RadioGroup>
                        </Field>
                        {all ? (
                            <div className="sb-hint">{s.allColumnsWarning}</div>
                        ) : (
                            <>
                                <Textarea className="sb-mono" readOnly rows={2} value={image.attributes} />
                                <div className="sb-toolbar">
                                    <Button size="small" icon={<TextBulletListLtrRegular />} disabled={!props.table} onClick={() => setPicker(true)}>
                                        {s.selectColumns}
                                    </Button>
                                </div>
                            </>
                        )}
                        {problem && <div className="sb-hint">{problem}</div>}
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={props.onCancel}>{s.cancel}</Button>
                        <Button
                            appearance="primary"
                            className="sb-image-ok"
                            disabled={!!problem}
                            onClick={() => props.onSave({ ...image, alias: image.alias.trim(), name: (image.name || image.alias).trim(), attributes: all ? '' : normalizeColumns(image.attributes) })}
                        >
                            {s.ok}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
            {picker && props.table && (
                <ColumnPicker
                    table={props.table}
                    selected={image.attributes}
                    onCancel={() => setPicker(false)}
                    onSave={(columns) => {
                        setImage({ ...image, attributes: columns });
                        setPicker(false);
                    }}
                />
            )}
        </>
    );
}

// #endregion

// #region Column picker

/** Searchable list of the readable columns of a table (port of ColumnPickerDialog.cs). */
function ColumnPicker(props: { table: string; selected: string; onCancel: () => void; onSave: (columns: string) => void }) {
    const s = useStrings();
    const [columns, setColumns] = useState<ColumnInfo[] | null>(null);
    const [error, setError] = useState<string>();
    const [checked, setChecked] = useState(() => new Set(normalizeColumns(props.selected).split(',').filter(Boolean)));
    const [search, setSearch] = useState('');
    const [onlySelected, setOnlySelected] = useState(false);

    useEffect(() => {
        let cancelled = false;
        loadColumns(props.table)
            .then((list) => !cancelled && setColumns(list))
            .catch((e) => !cancelled && setError(errorMessage(e)));
        return () => {
            cancelled = true;
        };
    }, [props.table]);

    const query = search.trim().toLowerCase();
    const visible = (columns ?? []).filter(
        (c) => (!onlySelected || checked.has(c.logicalName)) && (!query || c.logicalName.includes(query) || c.displayName.toLowerCase().includes(query)),
    );

    return (
        <Dialog open onOpenChange={(_e, d) => !d.open && props.onCancel()}>
            <DialogSurface className="sb-dialog-medium sb-column-picker">
                <DialogBody>
                    <DialogTitle>
                        <div>{s.pickerTitle}</div>
                        <div className="sb-dlg-subtitle">{props.table}</div>
                    </DialogTitle>
                    <DialogContent className="sb-form">
                        <div className="sb-toolbar">
                            <Input className="sb-search sb-picker-search" contentBefore={<SearchRegular />} placeholder={s.pickerSearchCue} value={search} onChange={(_e, d) => setSearch(d.value)} />
                            <Checkbox label={s.pickerOnlySelected} checked={onlySelected} onChange={(_e, d) => setOnlySelected(!!d.checked)} />
                        </div>
                        {!columns && !error && <Spinner size="small" label={s.pickerLoading} />}
                        {error && <div className="sb-alert">{error}</div>}
                        {columns && (
                            <div className="sb-grid-wrapper" style={{ maxHeight: '46vh' }}>
                                <table className="sb-grid sb-grid-select sb-picker-grid">
                                    <thead>
                                        <tr>
                                            <th />
                                            <th>{s.colDisplayName}</th>
                                            <th>{s.colLogicalName}</th>
                                            <th>{s.colType}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {visible.map((c) => (
                                            <tr
                                                key={c.logicalName}
                                                onClick={() =>
                                                    setChecked((x) => {
                                                        const next = new Set(x);
                                                        if (next.has(c.logicalName)) next.delete(c.logicalName);
                                                        else next.add(c.logicalName);
                                                        return next;
                                                    })
                                                }
                                            >
                                                <td style={{ width: 40 }}>
                                                    <Checkbox checked={checked.has(c.logicalName)} />
                                                </td>
                                                <td>{c.displayName}</td>
                                                <td className="sb-mono">{c.logicalName}</td>
                                                <td>{c.type}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        <span className="sb-muted">{s.pickerCount(checked.size)}</span>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={props.onCancel}>{s.cancel}</Button>
                        <Button appearance="primary" className="sb-picker-ok" onClick={() => props.onSave(normalizeColumns([...checked].join(',')))}>
                            {s.ok}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}

// #endregion
