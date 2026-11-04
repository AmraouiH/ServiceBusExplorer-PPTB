import { strToU8, zipSync } from 'fflate';
import type { Strings } from '../i18n/strings';
import { allColumns, allSubscriptions, entities, type ExplorerModel } from '../models/types';

/**
 * Excel report: the matching, the steps and images, the Azure entities and their filters (port of ExportService.cs).
 * The workbook is written by hand (inline strings, frozen header row, column widths): no Excel library is needed.
 */

type Cell = string | number | boolean | null | undefined;

interface Sheet {
    name: string;
    headers: string[];
    rows: Cell[][];
    widths: number[];
}

const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

const column = (index: number) => {
    let name = '';
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    return name;
};

function sheetXml(sheet: Sheet): string {
    const cell = (value: Cell, ref: string, header: boolean) => {
        const style = header ? ' s="1"' : '';
        if (value === null || value === undefined || value === '') return '';
        if (typeof value === 'number') return `<c r="${ref}"${style}><v>${value}</v></c>`;
        return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(String(value))}</t></is></c>`;
    };
    const rows = [sheet.headers, ...sheet.rows]
        .map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, `${column(c)}${r + 1}`, r === 0)).join('')}</row>`)
        .join('');
    const cols = sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    const last = `${column(sheet.headers.length - 1)}${sheet.rows.length + 1}`;
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
        `<cols>${cols}</cols><sheetData>${rows}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`
    );
}

/** Sheet names: 31 characters at most, without []:*?/\ and unique. */
function sheetName(name: string, used: Set<string>): string {
    let clean = name.replace(/[[\]:*?/\\]/g, ' ').substring(0, 31);
    for (let i = 2; used.has(clean.toLowerCase()); i++) clean = `${name.substring(0, 28)} ${i}`;
    used.add(clean.toLowerCase());
    return clean;
}

export function buildWorkbook(sheets: Sheet[]): Uint8Array {
    const used = new Set<string>();
    const names = sheets.map((s) => sheetName(s.name, used));
    const files: Record<string, Uint8Array> = {
        '[Content_Types].xml': strToU8(
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
                '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
                '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
                sheets.map((_s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
                '</Types>',
        ),
        '_rels/.rels': strToU8(
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        ),
        'xl/workbook.xml': strToU8(
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
                names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
                '</sheets></workbook>',
        ),
        'xl/_rels/workbook.xml.rels': strToU8(
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                sheets.map((_s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
                `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
        ),
        'xl/styles.xml': strToU8(
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
                '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
                '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0078D4"/></patternFill></fill></fills>' +
                '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>' +
                '<cellXfs count="2"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/></cellXfs></styleSheet>',
        ),
    };
    sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s))));
    return zipSync(files, { level: 6 });
}

export function exportModel(model: ExplorerModel, s: Strings): Uint8Array {
    const list = model.namespaces.flatMap(entities).filter((e) => !e.isGhost);
    const subscriptions = model.namespaces.flatMap(allSubscriptions);
    return buildWorkbook([
        {
            name: s.sheetMatching,
            headers: [s.colMatch, s.colEndpoint, s.colContract, s.colPath, s.colNamespace, s.colSteps, s.colEnabledSteps, s.colImages, s.colActive, s.colDeadLetter],
            rows: model.rows.map((r) => [
                s.statusLabel(r.status),
                r.endpoint?.name,
                r.endpoint ? s.contractLabel(r.endpoint.contract) : s.kindLabel(r.entity!.kind),
                r.path,
                r.host,
                r.endpoint?.steps.length ?? 0,
                r.endpoint?.steps.filter((x) => x.enabled).length ?? 0,
                r.endpoint?.steps.reduce((sum, x) => sum + x.images.length, 0) ?? 0,
                r.entity?.activeMessages ?? 0,
                r.entity?.deadLetterMessages ?? 0,
            ]),
            widths: [18, 36, 18, 36, 42, 8, 10, 8, 10, 11],
        },
        {
            name: s.sheetSteps,
            headers: [s.colStep, s.colState, s.colMessage, s.colTable, s.colStage, s.colMode, s.colRank, s.colFiltering, s.colImages, s.colTarget, s.colEndpoint],
            rows: model.steps.map((x) => [
                x.name,
                x.enabled ? s.enabled : s.disabled,
                x.message,
                x.table ?? s.allTables,
                s.stageLabel(x.stage),
                s.modeLabel(x.mode),
                x.rank,
                x.filteringAttributes,
                x.images.length,
                x.targetPath,
                x.endpointName,
            ]),
            widths: [50, 11, 12, 22, 15, 14, 7, 44, 8, 30, 32],
        },
        {
            name: s.sheetImages,
            headers: [s.colStep, s.colType, s.colAlias, s.colName, s.colColumns],
            rows: model.steps.flatMap((x) => x.images.map((i) => [x.name, s.imageTypeLabel(i.imageType), i.alias, i.name, allColumns(i) ? s.allColumns : i.attributes])),
            widths: [50, 11, 20, 24, 70],
        },
        {
            name: s.sheetEntities,
            headers: [s.colNamespace, s.colType, s.colName, s.colStatus, s.colActive, s.colDeadLetter, s.colScheduled, s.colSize, s.colForwardTo],
            rows: list.map((e) => [e.namespace.host, s.kindLabel(e.kind), e.name, e.status, e.activeMessages, e.deadLetterMessages, e.scheduledMessages, e.sizeBytes, e.forwardTo]),
            widths: [42, 10, 36, 10, 9, 11, 10, 13, 30],
        },
        {
            name: s.sheetSubscriptions,
            headers: [s.colNamespace, s.colTopic, s.colSubscription, s.colStatus, s.colActive, s.colDeadLetter, s.colFilters, s.colForwardTo],
            rows: subscriptions.map((x) => [x.namespace.host, x.topic?.name, x.name, x.status, x.activeMessages, x.deadLetterMessages, x.rules.length, x.forwardTo]),
            widths: [42, 30, 34, 10, 9, 11, 8, 30],
        },
        {
            name: s.sheetRules,
            headers: [s.colNamespace, s.colTopic, s.colSubscription, s.colRule, s.colType, s.colExpression, s.colAction],
            rows: subscriptions.flatMap((x) => x.rules.map((r) => [x.namespace.host, x.topic?.name, x.name, r.name, s.filterKindLabel(r.filterKind), r.expression, r.actionExpression])),
            widths: [42, 30, 34, 24, 14, 70, 40],
        },
    ]);
}
