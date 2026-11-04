import { useMemo, useState } from 'react';
import { Button, Dropdown, Input, Option } from '@fluentui/react-components';
import { SearchRegular, TargetRegular } from '@fluentui/react-icons';
import { useStrings } from '../i18n/I18nContext';
import type { ExplorerModel, MatchRow, MatchStatus, StepInfo } from '../models/types';
import { isProblem } from '../services/matching';
import { Card, Colors, EmptyState, Pill, StatTile } from './Common';
import { StepsTable } from './StepsTable';

/** Statuses of the filter list, after « all » and « to check ». */
const FilterStatuses: MatchStatus[] = ['linked', 'noSteps', 'missingOnAzure', 'typeMismatch', 'notConnected', 'noEndpoint', 'otherType'];

export const statusColor = (status: MatchStatus) =>
    ({
        linked: Colors.success,
        noSteps: Colors.warning,
        missingOnAzure: Colors.danger,
        typeMismatch: Colors.danger,
        notConnected: Colors.warning,
        noEndpoint: Colors.muted,
        otherType: Colors.muted,
    })[status];

/** Every endpoint and every Azure entity with a status (port of the Matching page). */
export function MatchingPage(props: { model: ExplorerModel | null; onOpen: (row: MatchRow) => void }) {
    const s = useStrings();
    const [filter, setFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<MatchRow | null>(null);
    const model = props.model;

    const rows = useMemo(() => {
        const query = search.trim().toLowerCase();
        const has = (v: string | null | undefined) => !!v && v.toLowerCase().includes(query);
        return (model?.rows ?? []).filter((r) => {
            if (filter === 'problems' && !isProblem(r.status)) return false;
            if (filter !== 'all' && filter !== 'problems' && r.status !== filter) return false;
            // Webhooks and relays are noise here: they only show when asked for.
            if (filter === 'all' && r.status === 'otherType') return false;
            return !query || has(r.endpoint?.name) || has(r.path) || has(r.host);
        });
    }, [model, filter, search]);

    const total = model?.rows.filter((r) => r.status !== 'otherType').length ?? 0;
    const tile = (value: number | undefined) => (model ? String(value ?? 0) : '–');
    const options: Array<[string, string]> = [['all', s.matchAll], ['problems', s.matchProblems], ...FilterStatuses.map((st) => [st, s.statusLabel(st)] as [string, string])];

    return (
        <>
            <div className="sb-tiles">
                <StatTile caption={s.tileEndpoints} value={tile(model?.endpoints.filter((e) => e.contract === 2 || e.contract === 5 || e.contract === 6).length)} tint={Colors.accent} />
                <StatTile caption={s.tileLinked} value={tile(model?.rows.filter((r) => r.status === 'linked').length)} tint={Colors.success} />
                <StatTile caption={s.tileProblems} value={tile(model?.rows.filter((r) => isProblem(r.status)).length)} tint={Colors.danger} />
                <StatTile caption={s.tileNotConnected} value={tile(model?.rows.filter((r) => r.status === 'notConnected').length)} tint={Colors.warning} />
                <StatTile caption={s.tileUnused} value={tile(model?.rows.filter((r) => r.status === 'noEndpoint').length)} tint={Colors.muted} />
            </div>
            <Card title={s.matchTitle} subtitle={s.matchSubtitle}>
                <div className="sb-toolbar">
                    <Dropdown className="sb-match-filter" value={options.find((o) => o[0] === filter)?.[1]} selectedOptions={[filter]} onOptionSelect={(_e, d) => setFilter(d.optionValue ?? 'all')}>
                        {options.map(([value, text]) => (
                            <Option key={value} value={value}>
                                {text}
                            </Option>
                        ))}
                    </Dropdown>
                    <Input className="sb-search sb-match-search" contentBefore={<SearchRegular />} placeholder={s.matchSearchCue} value={search} onChange={(_e, d) => setSearch(d.value)} />
                    <Button icon={<TargetRegular />} disabled={!selected?.entity} onClick={() => selected && props.onOpen(selected)}>
                        {s.openInExplorer}
                    </Button>
                    <span className="sb-muted">{model ? s.matchCount(rows.length, total) : ''}</span>
                </div>
                {rows.length === 0 ? (
                    <EmptyState text={model ? s.treeNoMatch : s.treeEmpty} />
                ) : (
                    <div className="sb-grid-wrapper">
                        <table className="sb-grid sb-grid-select sb-matching-grid">
                            <thead>
                                <tr>
                                    <th>{s.colMatch}</th>
                                    <th>{s.colEndpoint}</th>
                                    <th>{s.colContract}</th>
                                    <th>{s.colPath}</th>
                                    <th>{s.colNamespace}</th>
                                    <th className="sb-num">{s.colSteps}</th>
                                    <th className="sb-num">{s.colImages}</th>
                                    <th className="sb-num">{s.colMessages}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r, i) => (
                                    <tr
                                        key={`${r.endpoint?.id ?? ''}/${r.host}/${r.path}/${i}`}
                                        className={r === selected ? 'sb-row-selected' : undefined}
                                        onClick={() => setSelected(r)}
                                        onDoubleClick={() => r.entity && props.onOpen(r)}
                                    >
                                        <td>
                                            <Pill text={s.statusLabel(r.status)} color={statusColor(r.status)} />
                                        </td>
                                        <td className="sb-strong">{r.endpoint?.name}</td>
                                        <td>{r.endpoint ? s.contractLabel(r.endpoint.contract) : r.entity ? s.kindLabel(r.entity.kind) : ''}</td>
                                        <td>{r.path}</td>
                                        <td>{r.host}</td>
                                        <td className="sb-num">{r.endpoint ? r.endpoint.steps.length : ''}</td>
                                        <td className="sb-num">{r.endpoint ? r.endpoint.steps.reduce((sum, x) => sum + x.images.length, 0) : ''}</td>
                                        <td className="sb-num">{r.entity && !r.entity.isGhost ? (r.entity.activeMessages + r.entity.deadLetterMessages).toLocaleString() : ''}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>
        </>
    );
}

interface StepsPageProps {
    model: ExplorerModel | null;
    busy: boolean;
    onEdit: (step: StepInfo) => void;
    onEnable: (steps: StepInfo[]) => void;
    onDisable: (steps: StepInfo[]) => void;
    onMessages: (steps: StepInfo[]) => void;
}

/** Every step bound to a service endpoint. */
export function StepsPage(props: StepsPageProps) {
    const s = useStrings();
    const steps = props.model?.steps ?? [];
    const tile = (value: number) => (props.model ? String(value) : '–');
    return (
        <>
            <div className="sb-tiles">
                <StatTile caption={s.tileAllSteps} value={tile(steps.length)} tint={Colors.accent} />
                <StatTile caption={s.tileEnabledSteps} value={tile(steps.filter((x) => x.enabled).length)} tint={Colors.success} />
                <StatTile caption={s.colImages} value={tile(steps.reduce((sum, x) => sum + x.images.length, 0))} tint={Colors.topic} />
            </div>
            <Card title={s.stepsTitle} subtitle={s.stepsSubtitle}>
                <StepsTable steps={steps} searchable busy={props.busy} onEdit={props.onEdit} onEnable={props.onEnable} onDisable={props.onDisable} onMessages={props.onMessages} />
            </Card>
        </>
    );
}
