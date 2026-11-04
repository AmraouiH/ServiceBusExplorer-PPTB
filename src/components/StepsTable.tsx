import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Tooltip } from '@fluentui/react-components';
import { EditRegular, MailMultipleRegular, PlayRegular, SearchRegular, StopRegular } from '@fluentui/react-icons';
import { useStrings } from '../i18n/I18nContext';
import { allColumns, type StepInfo } from '../models/types';
import { Colors, EmptyState, Pill, useSelection } from './Common';

interface StepsTableProps {
    steps: StepInfo[];
    /** Steps page: search box, queue / topic column and counter. */
    searchable?: boolean;
    /** Messages live in a queue or a subscription: no button for the steps of a whole namespace. */
    showMessages?: boolean;
    hint?: string;
    busy?: boolean;
    onEdit: (step: StepInfo) => void;
    onEnable: (steps: StepInfo[]) => void;
    onDisable: (steps: StepInfo[]) => void;
    onMessages: (steps: StepInfo[]) => void;
}

/** List of steps with their images and actions (port of UI/Controls/StepsPanel.cs). */
export function StepsTable(props: StepsTableProps) {
    const s = useStrings();
    const [search, setSearch] = useState('');
    const { selected, setSelected, onRowClick } = useSelection(true);

    const visible = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return props.steps;
        const has = (v: string | null | undefined) => !!v && v.toLowerCase().includes(query);
        return props.steps.filter((x) => has(x.table) || has(x.message) || has(x.filteringAttributes) || has(x.endpointName) || has(x.targetPath) || has(x.name));
    }, [props.steps, search]);

    // The first step is selected when nothing is (like the grid of the XrmToolBox version).
    useEffect(() => {
        setSelected((current) => {
            const kept = current.filter((id) => visible.some((x) => x.id === id));
            return kept.length > 0 ? kept : visible.length > 0 ? [visible[0].id] : [];
        });
    }, [visible, setSelected]);

    const chosen = visible.filter((x) => selected.includes(x.id));
    const single = chosen.length === 1 ? chosen[0] : null;
    const ids = visible.map((x) => x.id);
    const filtering = (step: StepInfo) => step.filteringAttributes || (step.message.toLowerCase() === 'update' ? s.allColumnsTrigger : '');

    return (
        <div className="sb-detail-page">
            <div className="sb-toolbar">
                {props.searchable && <Input className="sb-search" contentBefore={<SearchRegular />} placeholder={s.stepsSearchCue} value={search} onChange={(_e, d) => setSearch(d.value)} />}
                <Tooltip content={s.editStepTip} relationship="description">
                    <Button appearance="primary" icon={<EditRegular />} disabled={!single || props.busy} onClick={() => single && props.onEdit(single)}>
                        {s.edit}
                    </Button>
                </Tooltip>
                <Button icon={<PlayRegular />} disabled={!chosen.some((x) => !x.enabled) || props.busy} onClick={() => props.onEnable(chosen)}>
                    {s.enable}
                </Button>
                <Button icon={<StopRegular />} disabled={!chosen.some((x) => x.enabled) || props.busy} onClick={() => props.onDisable(chosen)}>
                    {s.disable}
                </Button>
                {props.showMessages !== false && (
                    <Tooltip content={s.messagesButtonTip} relationship="description">
                        <Button className="sb-steps-messages" icon={<MailMultipleRegular />} disabled={chosen.length === 0 || props.busy} onClick={() => props.onMessages(chosen)}>
                            {s.messagesButton}
                        </Button>
                    </Tooltip>
                )}
                {props.searchable && <span className="sb-muted">{s.stepCount(visible.length, props.steps.length)}</span>}
            </div>
            {props.hint && <div className="sb-hint">{props.hint}</div>}

            <div className="sb-split sb-split-rows">
                {visible.length === 0 ? (
                    <EmptyState text={s.noSteps} />
                ) : (
                    <div className="sb-grid-wrapper">
                        <table className="sb-grid sb-grid-select sb-steps-grid">
                            <thead>
                                <tr>
                                    <th>{s.colState}</th>
                                    <th>{s.colMessage}</th>
                                    <th>{s.colTable}</th>
                                    <th>{s.colStage}</th>
                                    <th>{s.colMode}</th>
                                    <th className="sb-num">{s.colRank}</th>
                                    <th>{s.colFiltering}</th>
                                    <th className="sb-num">{s.colImages}</th>
                                    {props.searchable && <th>{s.colTarget}</th>}
                                    <th>{s.colEndpoint}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visible.map((x) => (
                                    <tr
                                        key={x.id}
                                        data-id={x.id}
                                        className={selected.includes(x.id) ? 'sb-row-selected' : undefined}
                                        title={x.name}
                                        onClick={(e) => onRowClick(x.id, e, ids)}
                                        onDoubleClick={() => props.onEdit(x)}
                                    >
                                        <td>
                                            <Pill text={x.enabled ? s.enabled : s.disabled} color={x.enabled ? Colors.success : Colors.muted} />
                                        </td>
                                        <td>{x.message}</td>
                                        <td className="sb-strong">{x.table ?? s.allTables}</td>
                                        <td>{s.stageLabel(x.stage)}</td>
                                        <td>{s.modeLabel(x.mode)}</td>
                                        <td className="sb-num">{x.rank}</td>
                                        <td title={filtering(x)}>{filtering(x)}</td>
                                        <td className="sb-num">{x.images.length}</td>
                                        {props.searchable && <td>{x.targetPath}</td>}
                                        <td>{x.endpointName}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                <div className="sb-panel">
                    <div className="sb-panel-title">
                        {single ? s.imagesOfStep(single.name) : s.imagesNoStep}
                        {single?.isManaged && <Pill text={s.managed} color={Colors.muted} />}
                    </div>
                    <div className="sb-grid-wrapper">
                        <table className="sb-grid sb-images-grid">
                            <thead>
                                <tr>
                                    <th>{s.colType}</th>
                                    <th>{s.colAlias}</th>
                                    <th>{s.colColumns}</th>
                                    <th>{s.colName}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(single?.images ?? []).map((image) => (
                                    <tr key={image.id || image.alias}>
                                        <td>{s.imageTypeLabel(image.imageType)}</td>
                                        <td>{image.alias}</td>
                                        <td className="sb-wrap">{allColumns(image) ? s.allColumns : image.attributes}</td>
                                        <td>{image.name}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
