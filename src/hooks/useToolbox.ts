import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultSettings, type PluginSettings } from '../models/types';

const SettingsKey = 'settings';

/** What is written to the ToolBox settings: a connection string only when the user asked to remember it. */
export const storable = (settings: PluginSettings): PluginSettings => ({
    ...settings,
    connections: settings.connections.map((c) => (c.remember ? c : { ...c, connectionString: undefined })),
});

/**
 * Plugin preferences persisted through toolboxAPI.settings (replaces the XrmToolBox SettingsManager).
 */
export function useSettings() {
    const [settings, setSettings] = useState<PluginSettings>(defaultSettings);
    const [loaded, setLoaded] = useState(false);
    const settingsRef = useRef(settings);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const stored = (await window.toolboxAPI.settings.get(SettingsKey)) as Partial<PluginSettings> | undefined;
                if (!cancelled && stored && typeof stored === 'object') {
                    const merged: PluginSettings = { ...defaultSettings, ...stored, connections: Array.isArray(stored.connections) ? stored.connections : [] };
                    settingsRef.current = merged;
                    setSettings(merged);
                }
            } catch (error) {
                console.error('ServiceBus Explorer: unable to load settings', error);
            } finally {
                if (!cancelled) setLoaded(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    /** Applies a change and saves it. Returns the new settings so callers can use them right away. */
    const updateSettings = useCallback((patch: Partial<PluginSettings>) => {
        const next = { ...settingsRef.current, ...patch };
        settingsRef.current = next;
        setSettings(next);
        window.toolboxAPI.settings.set(SettingsKey, storable(next)).catch((error) => console.error('ServiceBus Explorer: unable to save settings', error));
        return next;
    }, []);

    return { settings, settingsRef, loaded, updateSettings };
}

/** Light / dark theme of the ToolBox. */
export function useToolboxTheme() {
    const [theme, setTheme] = useState<'light' | 'dark'>('light');

    const refresh = useCallback(async () => {
        try {
            const current = await window.toolboxAPI.utils.getCurrentTheme();
            setTheme(current === 'dark' ? 'dark' : 'light');
        } catch (error) {
            console.error('ServiceBus Explorer: unable to read the theme', error);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    return { theme, refreshTheme: refresh };
}

/** Active Dataverse connection. */
export function useConnection() {
    const [connection, setConnection] = useState<ToolBoxAPI.Connection | null>(null);

    const refreshConnection = useCallback(async () => {
        try {
            const current = await window.toolboxAPI.connections.getActiveConnection();
            setConnection(current);
            return current;
        } catch (error) {
            console.error('ServiceBus Explorer: unable to read the connection', error);
            return null;
        }
    }, []);

    useEffect(() => {
        refreshConnection();
    }, [refreshConnection]);

    return { connection, refreshConnection };
}

/** Subscribes to ToolBox events (unsubscribes on unmount). */
export function useToolboxEvents(onEvent: (event: ToolBoxAPI.ToolBoxEvent, data: unknown) => void) {
    const handlerRef = useRef(onEvent);
    handlerRef.current = onEvent;

    useEffect(() => {
        const handler = (_event: unknown, payload: ToolBoxAPI.ToolBoxEventPayload) => handlerRef.current(payload.event, payload.data);
        window.toolboxAPI.events.on(handler);
        return () => {
            try {
                window.toolboxAPI.events.off(handler);
            } catch {
                // Older hosts may not support off().
            }
        };
    }, []);
}
