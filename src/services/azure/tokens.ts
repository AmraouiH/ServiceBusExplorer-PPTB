import type { Strings } from '../../i18n/strings';
import { AzureRequestError, postForm, StoppedError, throwIfStopped } from './http';

/** Resources the tool asks a Microsoft Entra token for. */
export const TokenResource = {
    /** Azure Resource Manager: reads the namespaces and their entities. */
    Management: 'https://management.azure.com/',
    /** Service Bus data plane: peeks the messages. */
    ServiceBus: 'https://servicebus.azure.net/',
} as const;

export type TokenResourceValue = (typeof TokenResource)[keyof typeof TokenResource];

/** Gives Microsoft Entra tokens for a tenant (undefined = default tenant of the account) and a resource. */
export interface TokenProvider {
    getToken(tenantId: string | undefined, resource: TokenResourceValue, signal?: AbortSignal): Promise<string>;
}

// #region Device code

/** Public client of the Azure CLI, already consented in most tenants; can be replaced in the options. */
export const DefaultClientId = '04b07795-8ddb-461a-bbee-02f9e1bf7b46';
export const Authority = { root: 'https://login.microsoftonline.com/' };

export interface DeviceCodePrompt {
    userCode: string;
    verificationUri: string;
    expiresAt: number;
}

/**
 * Shown by the app while a sign-in waits for the user: it displays the code and resolves when the user cancels.
 * Set once by the UI (the provider has no UI of its own).
 */
export const DeviceCodeUi: { show?: (prompt: DeviceCodePrompt) => { cancelled: Promise<void>; close: () => void } } = {};

interface Session {
    accessToken: string;
    refreshToken?: string;
    expiresOn: number;
}

/** Sessions shared by every provider instance (the tool tab lives as long as the sign-in). */
const sessions = new Map<string, Session>();

/**
 * Microsoft Entra sign-in with a device code (the ToolBox gives tools no browser redirect and no token of its own).
 * Tokens stay in memory only. A refresh token of the account is tried first for another tenant or resource.
 */
export class DeviceCodeProvider implements TokenProvider {
    private readonly clientId: string;
    private readonly defaultTenant: string;

    constructor(
        clientId: string | undefined,
        defaultTenant: string | undefined,
        private readonly strings: Strings,
    ) {
        this.clientId = clientId?.trim() || DefaultClientId;
        this.defaultTenant = defaultTenant?.trim() || 'organizations';
    }

    async getToken(tenantId: string | undefined, resource: TokenResourceValue, signal?: AbortSignal): Promise<string> {
        const tenant = tenantId?.trim() || this.defaultTenant;
        const scope = `${resource}.default offline_access`;
        const key = `${this.clientId}|${tenant}|${scope}`;
        const cached = sessions.get(key);
        if (cached && cached.expiresOn > Date.now() + 120000) return cached.accessToken;

        // A refresh token of any tenant or resource of the account can be exchanged without a new prompt.
        const refreshTokens = new Set([...sessions.entries()].filter(([k]) => k.startsWith(`${this.clientId}|`)).map(([, s]) => s.refreshToken).filter(Boolean) as string[]);
        for (const refreshToken of refreshTokens) {
            try {
                return this.store(key, await this.redeem(tenant, { grant_type: 'refresh_token', refresh_token: refreshToken, scope }, signal));
            } catch (error) {
                if (error instanceof StoppedError) throw error;
                // Expired, MFA required for this tenant, or refused by the service: sign in again below.
            }
        }
        return this.store(key, await this.signIn(tenant, scope, signal));
    }

    private async signIn(tenant: string, scope: string, signal?: AbortSignal): Promise<any> {
        const code = JSON.parse(await postForm(`${Authority.root}${encodeURIComponent(tenant)}/oauth2/v2.0/devicecode`, { client_id: this.clientId, scope }, this.strings, signal).catch((e) => this.fail(e)));
        const prompt: DeviceCodePrompt = { userCode: code.user_code, verificationUri: code.verification_uri, expiresAt: Date.now() + (code.expires_in ?? 900) * 1000 };
        const ui = DeviceCodeUi.show?.(prompt);
        let cancelled = false;
        ui?.cancelled.then(() => (cancelled = true));
        try {
            let interval = Math.max(1, code.interval ?? 5) * 1000;
            for (;;) {
                await wait(interval, signal);
                if (cancelled) throw new AzureRequestError(0, this.strings.signInCancelled);
                if (Date.now() > prompt.expiresAt) throw new AzureRequestError(0, this.strings.signInExpired);
                try {
                    return await this.redeem(tenant, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: code.device_code }, signal);
                } catch (error) {
                    if (!(error instanceof AzureRequestError)) throw error;
                    const reason = oauthError(error.details);
                    if (reason === 'authorization_pending') continue;
                    if (reason === 'slow_down') {
                        interval += 5000;
                        continue;
                    }
                    if (reason === 'expired_token') throw new AzureRequestError(0, this.strings.signInExpired);
                    throw new AzureRequestError(0, this.strings.signInFailed, oauthDescription(error.details));
                }
            }
        } finally {
            ui?.close();
        }
    }

    private async redeem(tenant: string, form: Record<string, string>, signal?: AbortSignal): Promise<any> {
        return JSON.parse(await postForm(`${Authority.root}${encodeURIComponent(tenant)}/oauth2/v2.0/token`, { ...form, client_id: this.clientId }, this.strings, signal));
    }

    private fail(error: unknown): never {
        if (error instanceof AzureRequestError && error.status > 0) throw new AzureRequestError(error.status, this.strings.signInFailed, oauthDescription(error.details));
        throw error;
    }

    private store(key: string, response: any): string {
        sessions.set(key, { accessToken: response.access_token, refreshToken: response.refresh_token, expiresOn: Date.now() + (response.expires_in ?? 3000) * 1000 });
        return response.access_token;
    }
}

const oauthError = (body: string | undefined) => {
    try {
        return JSON.parse(body ?? '{}').error as string | undefined;
    } catch {
        return undefined;
    }
};

const oauthDescription = (body: string | undefined) => {
    try {
        return (JSON.parse(body ?? '{}').error_description as string | undefined) ?? body;
    } catch {
        return body;
    }
};

function wait(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new StoppedError());
        });
    });
}

/** Forgets the Microsoft sign-ins (tests). */
export const clearSessions = () => sessions.clear();

// #endregion

// #region Azure CLI

const cliCache = new Map<string, { token: string; until: number }>();
const CliCacheMs = 20 * 60000;

/**
 * Token of the account signed in with « az login », read through the ToolBox terminal
 * (the tool itself cannot start a process). Cached because starting az takes more than a second.
 */
export class AzureCliProvider implements TokenProvider {
    constructor(private readonly strings: Strings) {}

    async getToken(tenantId: string | undefined, resource: TokenResourceValue, signal?: AbortSignal): Promise<string> {
        const key = `${tenantId ?? ''}|${resource}`;
        const cached = cliCache.get(key);
        if (cached && cached.until > Date.now()) return cached.token;
        throwIfStopped(signal);

        // Only known values reach the command line.
        const target = resource === TokenResource.ServiceBus ? TokenResource.ServiceBus : TokenResource.Management;
        const tenant = tenantId && /^[0-9a-f-]{36}$/i.test(tenantId) ? ` --tenant ${tenantId}` : '';
        const terminal = await window.toolboxAPI.terminal.create({ name: 'ServiceBus Explorer - az', visible: false });
        try {
            const result = await window.toolboxAPI.terminal.execute(terminal.id, `az account get-access-token --resource ${target} --output json${tenant}`);
            throwIfStopped(signal);
            const output = `${result.output ?? ''}`;
            const json = /\{[\s\S]*"accessToken"[\s\S]*\}/.exec(output)?.[0];
            if (!json) {
                const missing = /not recognized|command not found|introuvable|n'est pas reconnu/i.test(`${output} ${result.error ?? ''}`);
                throw new AzureRequestError(0, missing ? this.strings.azureCliMissing : this.strings.azureCliFailed, (result.error || output).trim() || undefined, true);
            }
            const token = JSON.parse(json).accessToken as string;
            cliCache.set(key, { token, until: Date.now() + CliCacheMs });
            return token;
        } finally {
            window.toolboxAPI.terminal.close(terminal.id).catch(() => undefined);
        }
    }
}

// #endregion
