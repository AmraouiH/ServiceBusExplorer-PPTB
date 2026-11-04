import type { Strings } from '../../i18n/strings';

/** An Azure call that failed, with a readable message and the raw details of the service. */
export class AzureRequestError extends Error {
    constructor(
        public readonly status: number,
        message: string,
        public readonly details?: string,
        /** Refused or unreachable: the other entities of the namespace would fail the same way. */
        public readonly fatal = false,
    ) {
        super(message);
        this.name = 'AzureRequestError';
    }
}

/** Cancellation of a task by the user (Stop). */
export class StoppedError extends Error {
    constructor() {
        super('Stopped');
        this.name = 'StoppedError';
    }
}

export const throwIfStopped = (signal?: AbortSignal) => {
    if (signal?.aborted) throw new StoppedError();
};

export const isStopped = (error: unknown) => error instanceof StoppedError || (error as any)?.name === 'AbortError';

/** GET returning the body; refused or failed calls raise a readable AzureRequestError. */
export async function getText(url: string, headers: Record<string, string>, strings: Strings, signal?: AbortSignal): Promise<string> {
    return send(url, { method: 'GET', headers }, strings, signal);
}

export async function postForm(url: string, form: Record<string, string>, strings: Strings, signal?: AbortSignal): Promise<string> {
    return send(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() }, strings, signal, true);
}

async function send(url: string, init: RequestInit, strings: Strings, signal: AbortSignal | undefined, rawErrors = false): Promise<string> {
    throwIfStopped(signal);
    const host = safeHost(url);
    let response: Response;
    try {
        response = await fetch(url, { ...init, signal });
    } catch (error) {
        if (isStopped(error) || signal?.aborted) throw new StoppedError();
        // A blocked CSP and an unknown host both end here as a TypeError.
        throw new AzureRequestError(0, strings.azureBlocked(host), (error as Error)?.message, true);
    }
    const body = await response.text();
    if (response.ok) return body;
    if (rawErrors) throw new AzureRequestError(response.status, describe(response.status, host, strings), body);
    throw new AzureRequestError(response.status, describe(response.status, host, strings), clean(body), response.status === 401 || response.status === 403);
}

function describe(status: number, host: string, strings: Strings): string {
    switch (status) {
        case 401:
        case 403:
            return strings.azureAccessDenied(host);
        case 404:
            return strings.azureNotFound;
        case 429:
            return strings.azureThrottled;
        default:
            return strings.azureFailed(status);
    }
}

/** Message of a JSON or XML error, else the raw body. */
function clean(body: string): string | undefined {
    if (!body.trim()) return undefined;
    try {
        const json = JSON.parse(body);
        return json?.error?.message ?? json?.error_description ?? body;
    } catch {
        const detail = /<Detail>([\s\S]*?)<\/Detail>/i.exec(body);
        return detail ? detail[1].trim() : body;
    }
}

export function safeHost(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
}
