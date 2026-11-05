/** Icon of the tool: a message above the queue it waits in. Same drawing as public/icon/servicebus-explorer.svg; follows the text color. */
export function AppIcon(props: { className?: string }) {
    return (
        <svg
            className={props.className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <rect x="4" y="2.75" width="16" height="10" rx="1.8" />
            <path d="M4.8 3.9 12 9l7.2-5.1" />
            <rect x="3" y="15.75" width="3.5" height="3.5" rx="0.8" fill="currentColor" stroke="none" />
            <rect x="8" y="15.75" width="3.5" height="3.5" rx="0.8" fill="currentColor" stroke="none" />
            <rect x="13" y="15.75" width="3.5" height="3.5" rx="0.8" fill="currentColor" stroke="none" />
            <path d="M18 17.5h3M19.3 15.65l1.8 1.85-1.8 1.85" />
        </svg>
    );
}
