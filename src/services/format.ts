import type { Strings } from '../i18n/strings';

/** Display of the Azure values: ISO 8601 durations, sizes and dates (port of Helpers/Format.cs). */

/** Beyond this, Service Bus means « never » (its default is TimeSpan.MaxValue, 10675199 days). */
const UnlimitedDays = 3650000;

/** Parses an ISO 8601 duration (P14D, PT1M, P10675199DT2H48M5.4775807S) into seconds, null when it is not one. */
export function parseDuration(iso: string): number | null {
    const match = /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso.trim());
    if (!match || iso.trim() === 'P' || iso.trim().endsWith('T')) return null;
    const [, y, mo, w, d, h, mi, s] = match.map((v) => (v === undefined ? 0 : Number(v))) as number[];
    return (((y * 365 + mo * 30 + w * 7 + d) * 24 + h) * 60 + mi) * 60 + s;
}

export function duration(iso: string | undefined, strings: Strings): string {
    if (!iso) return '';
    const seconds = parseDuration(iso);
    if (seconds === null) return iso;
    const days = seconds / 86400;
    if (days >= UnlimitedDays) return strings.unlimited;
    if (days >= 1) return strings.days(days);
    if (seconds >= 3600) return strings.hours(seconds / 3600);
    if (seconds >= 60) return strings.minutes(seconds / 60);
    return strings.seconds(seconds);
}

export function size(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${trim(bytes / 1024, 1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${trim(bytes / 1048576, 1)} MB`;
    return `${trim(bytes / 1073741824, 2)} GB`;
}

const trim = (value: number, digits: number) => String(Number(value.toFixed(digits)));

const pad = (n: number) => String(n).padStart(2, '0');

/** Local date and time, yyyy-MM-dd HH:mm (the same everywhere in the tool). */
export function date(value: Date | undefined, withSeconds = false): string {
    if (!value || Number.isNaN(value.getTime())) return '';
    const text = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
    return withSeconds ? `${text}:${pad(value.getSeconds())}` : text;
}

export const yesNo = (value: boolean, strings: Strings) => (value ? strings.yes : strings.no);

export const number = (value: number, language: string) => value.toLocaleString(language === 'fr' ? 'fr-FR' : 'en-US');
