import { useId } from 'react';

/** Icon of the tool: a message above its queue on a blue gradient tile. Same drawing as public/icon/servicebus-explorer.svg. */
export function AppIcon(props: { className?: string }) {
    // One gradient id per instance: the header and the busy popup can show the icon at the same time.
    const gradient = `sbx-tile-${useId().replace(/:/g, '')}`;
    return (
        <svg className={props.className} viewBox="0 0 48 48" aria-hidden="true">
            <defs>
                <linearGradient id={gradient} x1="0" x2="1" y1="0" y2="1">
                    <stop offset="0" stopColor="#0063B1" />
                    <stop offset=".55" stopColor="#0078D4" />
                    <stop offset="1" stopColor="#00B7C3" />
                </linearGradient>
            </defs>
            <rect x="2" y="2" width="44" height="44" rx="11" fill={`url(#${gradient})`} />
            <g fill="none" stroke="#ffffff" strokeLinecap="round" strokeLinejoin="round">
                <rect x="11" y="9.5" width="26" height="17" rx="3.5" strokeWidth={2.8} />
                <path d="M12.5 11.5 24 20l11.5-8.5" strokeWidth={2.8} />
                <path d="M36.5 34.75h3.5M38.6 32.4l2.3 2.35-2.3 2.35" strokeWidth={2.4} />
            </g>
            <rect x="10" y="31.5" width="6.5" height="6.5" rx="1.6" fill="#ffffff" />
            <rect x="19" y="31.5" width="6.5" height="6.5" rx="1.6" fill="#ffffff" fillOpacity={0.85} />
            <rect x="28" y="31.5" width="6.5" height="6.5" rx="1.6" fill="#ffffff" fillOpacity={0.7} />
        </svg>
    );
}
