import type { Strings } from '../i18n/strings';
import { allColumns, ImageKind, StepMode, StepStage, type ImageInfo, type StepInfo } from '../models/types';

/**
 * Registration rules of a step, checked before anything is sent to Dataverse so the user gets a clear message
 * instead of a platform error (port of Services/Dataverse/StepRules.cs).
 */

/** Input parameter holding the image, per message (same table as the Plugin Registration Tool). */
const ImageProperties: Record<string, string> = {
    assign: 'Target',
    create: 'id',
    delete: 'Target',
    deliverincoming: 'emailid',
    deliverpromote: 'emailid',
    merge: 'Target',
    route: 'Target',
    send: 'emailid',
    setstate: 'entityMoniker',
    setstatedynamicentity: 'entityMoniker',
    update: 'Target',
};

const is = (message: string | undefined, name: string) => (message ?? '').toLowerCase() === name;

export const supportsFilteringAttributes = (message: string | undefined) => is(message, 'update');

export const imageProperty = (message: string | undefined): string | undefined => (message ? ImageProperties[message.toLowerCase()] : undefined);

export const supportsImages = (message: string | undefined) => imageProperty(message) !== undefined;

export const supportsPreImage = (message: string | undefined) => supportsImages(message) && !is(message, 'create');

export const supportsPostImage = (message: string | undefined, stage: number) => supportsImages(message) && stage === StepStage.PostOperation && !is(message, 'delete');

/** Image types allowed for a message and a stage. */
export function allowedImageTypes(message: string | undefined, stage: number): number[] {
    const types: number[] = [];
    const pre = supportsPreImage(message);
    const post = supportsPostImage(message, stage);
    if (pre) types.push(ImageKind.Pre);
    if (post) types.push(ImageKind.Post);
    if (pre && post) types.push(ImageKind.Both);
    return types;
}

/** Blocking problems of a step; empty when it can be saved. */
export function validate(step: StepInfo, s: Strings): string[] {
    const issues: string[] = [];
    if (!step.message.trim()) issues.push(s.ruleMessageRequired);
    if (step.mode === StepMode.Asynchronous && step.stage !== StepStage.PostOperation) issues.push(s.ruleAsyncPostOnly);
    if (step.rank < 1) issues.push(s.ruleRank);
    if (step.filteringAttributes && !supportsFilteringAttributes(step.message)) issues.push(s.ruleFilteringUpdateOnly);

    if (step.images.length > 0 && !supportsImages(step.message)) {
        issues.push(s.ruleNoImages(step.message));
        return issues;
    }

    const allowed = allowedImageTypes(step.message, step.stage);
    for (const image of step.images) {
        if (!image.alias.trim()) issues.push(s.ruleImageAlias(image.name));
        if (!allowed.includes(image.imageType)) issues.push(s.ruleImageType(image.alias || image.name, s.imageTypeLabel(image.imageType), step.message, s.stageLabel(step.stage)));
    }

    const counts = new Map<string, number>();
    for (const image of step.images) {
        const key = image.alias.trim().toLowerCase();
        if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [alias, count] of counts) if (count > 1) issues.push(s.ruleImageDuplicate(step.images.find((i) => i.alias.trim().toLowerCase() === alias)!.alias));
    return issues;
}

/** Lines describing what a save changes, for the review popup. */
export function describe(original: StepInfo, draft: StepInfo, s: Strings): string[] {
    const lines: string[] = [];
    const display = (value: string | null | undefined) => (value ? value : s.empty);
    const compare = (label: string, before: string | null | undefined, after: string | null | undefined) => {
        if ((before ?? '') !== (after ?? '')) lines.push(`${label} : ${display(before)}  →  ${display(after)}`);
    };

    compare(s.fieldMessage, original.message, draft.message);
    compare(s.fieldTable, original.table, draft.table);
    compare(s.fieldStage, s.stageLabel(original.stage), s.stageLabel(draft.stage));
    compare(s.fieldMode, s.modeLabel(original.mode), s.modeLabel(draft.mode));
    compare(s.fieldRank, String(original.rank), String(draft.rank));
    compare(s.fieldFiltering, original.filteringAttributes, draft.filteringAttributes);
    compare(s.fieldDeleteJob, original.deleteJobOnSuccess ? s.yes : s.no, draft.deleteJobOnSuccess ? s.yes : s.no);
    compare(s.fieldName, original.name, draft.name);
    compare(s.fieldDescription, original.description, draft.description);

    const summary = (image: ImageInfo) => `${image.alias} (${s.imageTypeLabel(image.imageType)}, ${allColumns(image) ? s.allColumns : image.attributes})`;
    for (const image of draft.images.filter((i) => !i.id)) lines.push(s.changeImageAdded(summary(image)));
    for (const image of draft.images.filter((i) => i.id)) {
        const before = original.images.find((i) => i.id === image.id);
        if (before && !sameImage(before, image)) lines.push(s.changeImageUpdated(summary(before), summary(image)));
    }
    for (const image of original.images.filter((i) => !draft.images.some((x) => x.id === i.id))) lines.push(s.changeImageRemoved(summary(image)));
    return lines;
}

export const sameImage = (a: ImageInfo, b: ImageInfo) =>
    a.imageType === b.imageType && a.name === b.name && a.alias === b.alias && normalizeColumns(a.attributes) === normalizeColumns(b.attributes);

/** Sorted, trimmed, lower-case, comma-separated list, with no duplicates. */
export function normalizeColumns(columns: string | null | undefined): string {
    const items = new Set(
        (columns ?? '')
            .split(',')
            .map((c) => c.trim().toLowerCase())
            .filter((c) => c.length > 0),
    );
    return [...items].sort().join(',');
}
