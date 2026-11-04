import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * Small shared visual pieces (port of UI/Controls: CardPanel, StatTile, pills, properties grid, empty state).
 */

export const Colors = {
    accent: 'var(--sb-accent)',
    queue: 'var(--sb-queue)',
    topic: 'var(--sb-topic)',
    subscription: 'var(--sb-subscription)',
    rule: 'var(--sb-rule)',
    success: 'var(--sb-success)',
    danger: 'var(--sb-danger)',
    warning: 'var(--sb-warning)',
    muted: 'var(--sb-muted)',
};

export function Card(props: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <section className={`sb-card ${props.className ?? ''}`}>
            {(props.title || props.actions) && (
                <header className="sb-card-header">
                    {props.title && <h2>{props.title}</h2>}
                    {props.subtitle && <p>{props.subtitle}</p>}
                    {props.actions && (
                        <>
                            <span className="sb-spacer" />
                            {props.actions}
                        </>
                    )}
                </header>
            )}
            <div className="sb-card-body">{props.children}</div>
        </section>
    );
}

export function StatTile(props: { caption: string; value: string; tint?: string }) {
    return (
        <div className="sb-stat" style={{ '--tint': props.tint ?? Colors.accent, borderLeftColor: props.tint ?? Colors.accent } as CSSProperties}>
            <span className="sb-stat-value">{props.value}</span>
            <span className="sb-stat-caption">{props.caption}</span>
        </div>
    );
}

export function Pill(props: { text: string; color?: string; title?: string }) {
    return (
        <span className="sb-pill" style={{ '--pill': props.color ?? Colors.accent } as CSSProperties} title={props.title}>
            {props.text}
        </span>
    );
}

export function Badge(props: { value?: string | null; danger?: boolean }) {
    if (!props.value) return null;
    return <span className={props.danger ? 'sb-badge sb-badge-danger' : 'sb-badge'}>{props.value}</span>;
}

export function EmptyState(props: { title?: string; text: string; icon?: ReactNode }) {
    return (
        <div className="sb-empty">
            {props.icon}
            {props.title && <span className="sb-empty-title">{props.title}</span>}
            <span>{props.text}</span>
        </div>
    );
}

/** Key / value grid (properties of an entity or of a message). A null value starts a section. */
export function PropertiesGrid(props: { rows: Array<[string, string | null | undefined] | { section: string }>; className?: string }) {
    const rows = props.rows.filter((r) => 'section' in r || (r[1] !== undefined && r[1] !== null && r[1] !== ''));
    return (
        <div className={`sb-grid-wrapper ${props.className ?? ''}`}>
            <table className="sb-grid sb-props">
                <tbody>
                    {rows.map((r, i) =>
                        'section' in r ? (
                            <tr key={i} className="sb-section-row">
                                <td colSpan={2}>{r.section}</td>
                            </tr>
                        ) : (
                            <tr key={i}>
                                <td>{r[0]}</td>
                                <td>{r[1]}</td>
                            </tr>
                        ),
                    )}
                </tbody>
            </table>
        </div>
    );
}

/**
 * Row selection of a grid: click selects one row, Ctrl+click toggles, Shift+click extends (like the DataGridView of the
 * XrmToolBox version). Keys are stable ids.
 */
export function useSelection(multiple: boolean) {
    const [selected, setSelected] = useState<string[]>([]);
    const anchor = useRef<string | null>(null);

    const onRowClick = useCallback(
        (key: string, event: React.MouseEvent, ordered: string[]) => {
            if (!multiple) {
                setSelected([key]);
                return;
            }
            if (event.shiftKey && anchor.current && ordered.includes(anchor.current)) {
                const from = ordered.indexOf(anchor.current);
                const to = ordered.indexOf(key);
                setSelected(ordered.slice(Math.min(from, to), Math.max(from, to) + 1));
                return;
            }
            if (event.ctrlKey || event.metaKey) {
                setSelected((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]));
                anchor.current = key;
                return;
            }
            anchor.current = key;
            setSelected([key]);
        },
        [multiple],
    );

    return { selected, setSelected, onRowClick };
}
