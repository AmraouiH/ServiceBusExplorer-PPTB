/*
 * Logic tests (no browser): parsers, SAS signature, matching, step rules, decoders, export, message reading.
 * Usage: npm run test:logic
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import { unzipSync, strFromU8 } from 'fflate';

// The parsers use the browser DOMParser: xmldom stands in for it in Node.
(globalThis as any).DOMParser = XmlDomParser;

const { getStrings } = await import('../../src/i18n/strings');
const { parseEntities, parseRules, countEntries } = await import('../../src/services/azure/atomParser');
const { armEntity, armRule, armHost, segment } = await import('../../src/services/azure/readers');
const { parseConnectionString, createSasToken } = await import('../../src/services/azure/connectionString');
const { AzureRequestError } = await import('../../src/services/azure/http');
const { normalizeHost, stepUpdate } = await import('../../src/services/endpointService');
const { buildModel } = await import('../../src/services/matching');
const rules = await import('../../src/services/stepRules');
const { duration, size, parseDuration } = await import('../../src/services/format');
const { decodeMessage, FormatBinary, FormatJson, FormatXml, FormatText, FormatRaw } = await import('../../src/services/messageDecoder');
const { decodeNbfx, serialize } = await import('../../src/services/nbfx');
const { exportModel } = await import('../../src/services/exportService');
const { readMessages, resolveSteps, sourcesOf, pathOf } = await import('../../src/services/messageService');
const types = await import('../../src/models/types');

const en = getStrings('en');
const fixtures = join(import.meta.dirname, '..', 'fixtures');

let passed = 0;
const failures: string[] = [];
const check = (name: string, condition: boolean) => (condition ? passed++ : failures.push(name));
const same = (name: string, expected: unknown, actual: unknown) => check(`${name}: expected <${JSON.stringify(expected)}>, got <${JSON.stringify(actual)}>`, JSON.stringify(expected) === JSON.stringify(actual));

async function run(name: string, test: () => void | Promise<void>) {
    try {
        await test();
    } catch (error) {
        failures.push(`${name} crashed: ${(error as Error)?.stack ?? error}`);
    }
}

// #region Atom samples (same as the C# tests)

const Sb = 'http://schemas.microsoft.com/netservices/2010/10/servicebus/connect';
const Xsi = 'http://www.w3.org/2001/XMLSchema-instance';
const Counts = 'http://schemas.microsoft.com/netservices/2011/06/servicebus';
const feed = (...entries: string[]) => `<feed xmlns="http://www.w3.org/2005/Atom"><title type="text">x</title>${entries.join('')}</feed>`;
const entry = (title: string, content: string) => `<entry><id>https://ns/${title}</id><title type="text">${title}</title><content type="application/xml">${content}</content></entry>`;
const countDetails = (active: number, dead: number, scheduled: number) =>
    `<CountDetails xmlns:d2p1="${Counts}"><d2p1:ActiveMessageCount>${active}</d2p1:ActiveMessageCount><d2p1:DeadLetterMessageCount>${dead}</d2p1:DeadLetterMessageCount><d2p1:ScheduledMessageCount>${scheduled}</d2p1:ScheduledMessageCount><d2p1:TransferMessageCount>0</d2p1:TransferMessageCount></CountDetails>`;
const queue = (name: string, active: number, dead: number, forwardTo?: string) =>
    entry(
        name,
        `<QueueDescription xmlns="${Sb}" xmlns:i="${Xsi}"><LockDuration>PT1M</LockDuration><RequiresSession>true</RequiresSession><DefaultMessageTimeToLive>P14D</DefaultMessageTimeToLive><MaxDeliveryCount>10</MaxDeliveryCount><SizeInBytes>${active * 2048}</SizeInBytes><MessageCount>${active + dead}</MessageCount><Status>Active</Status>${forwardTo ? `<ForwardTo>${forwardTo}</ForwardTo>` : ''}<CreatedAt>2026-03-04T10:11:12.1Z</CreatedAt><AccessedAt>0001-01-01T00:00:00Z</AccessedAt>${countDetails(active, dead, 2)}</QueueDescription>`,
    );
const topic = (name: string, subscriptions: number) =>
    entry(name, `<TopicDescription xmlns="${Sb}" xmlns:i="${Xsi}"><SizeInBytes>4096</SizeInBytes><Status>Active</Status><SubscriptionCount>${subscriptions}</SubscriptionCount>${countDetails(0, 0, 1)}<EnablePartitioning>true</EnablePartitioning></TopicDescription>`);
const sqlRule = (name: string, expression: string, action?: string) =>
    entry(
        name,
        `<RuleDescription xmlns="${Sb}" xmlns:i="${Xsi}"><Filter i:type="SqlFilter"><SqlExpression>${expression}</SqlExpression></Filter>${action ? `<Action i:type="SqlRuleAction"><SqlExpression>${action}</SqlExpression></Action>` : '<Action i:type="EmptyRuleAction"/>'}<Name>${name}</Name></RuleDescription>`,
    );
const trueRule = (name: string) => entry(name, `<RuleDescription xmlns="${Sb}" xmlns:i="${Xsi}"><Filter i:type="TrueFilter"><SqlExpression>1=1</SqlExpression></Filter><Action i:type="EmptyRuleAction"/><Name>${name}</Name></RuleDescription>`);
const correlationRule = (name: string, subject: string, key: string, value: string) =>
    entry(
        name,
        `<RuleDescription xmlns="${Sb}" xmlns:i="${Xsi}"><Filter i:type="CorrelationFilter"><Label>${subject}</Label><ContentType>application/json</ContentType><Properties><KeyValueOfstringanyType><Key>${key}</Key><Value i:type="d6p1:string" xmlns:d6p1="http://www.w3.org/2001/XMLSchema">${value}</Value></KeyValueOfstringanyType></Properties></Filter><Action i:type="EmptyRuleAction"/><Name>${name}</Name></RuleDescription>`,
    );

// #endregion

const ns = (): types.SbNamespace => ({ host: 'a.servicebus.windows.net', readWithKey: true, isGhost: false, queues: [], topics: [] });

await run('atom', () => {
    const q = parseEntities(feed(queue('q1', 5, 2, 'next')), 'queue', ns())[0];
    same('name', 'q1', q.name);
    same('active through the other XML namespace', 5, q.activeMessages);
    same('dead-letter', 2, q.deadLetterMessages);
    same('scheduled', 2, q.scheduledMessages);
    same('forward', 'next', q.forwardTo);
    check('session', q.requiresSession);
    same('0001 date is empty', undefined, q.lastAccessedOn);
    same('created is UTC', '2026-03-04T10:11:12.100Z', q.createdOn?.toISOString());
    const t = parseEntities(feed(topic('t1', 3)), 'topic', ns())[0];
    same('subscription count', 3, t.subscriptionCount);
    check('partitioned', t.partitioned);
    const r = parseRules(feed(sqlRule('a', 'x = 1', 'SET y = 2'), trueRule('$Default'), correlationRule('c', 'Create', 'entity', 'contact')));
    same('rule count', 3, r.length);
    same('sql', ['sql', 'x = 1', 'SET y = 2'], [r[0].filterKind, r[0].expression, r[0].actionExpression]);
    same('true filter', 'true', r[1].filterKind);
    same('empty action', undefined, r[1].actionExpression);
    same('correlation', "Subject = 'Create' AND ContentType = 'application/json' AND entity = 'contact'", r[2].expression);
    same('count entries', 2, countEntries(feed(queue('a', 0, 0), queue('b', 0, 0))));
});

await run('arm', () => {
    const rule = armRule({ name: 'sdk-Rules-6571', properties: { action: {}, filterType: 'SqlFilter', sqlFilter: { compatibilityLevel: 20, sqlExpression: '1=1' } } });
    same('arm true', ['sdk-Rules-6571', 'true'], [rule.name, rule.filterKind]);
    same('arm correlation', "CorrelationId = '42' AND Subject = 'Create' AND entity = 'contact'", armRule({ name: 'c', properties: { filterType: 'CorrelationFilter', correlationFilter: { label: 'Create', correlationId: '42', properties: { entity: 'contact' } } } }).expression);
    const q = armEntity({ name: 'q', properties: { status: 'Active', messageCount: 7, countDetails: { activeMessageCount: 5, deadLetterMessageCount: 2 }, createdAt: '2026-01-02T03:04:05Z', accessedAt: '0001-01-01T00:00:00', forwardTo: '' } }, 'queue', ns());
    same('arm counts', [5, 2], [q.activeMessages, q.deadLetterMessages]);
    same('arm created', 2026, q.createdOn?.getUTCFullYear());
    same('arm empty date', undefined, q.lastAccessedOn);
    same('arm empty forward', undefined, q.forwardTo);
    same('segment', 'rg1', segment('/subscriptions/1/resourceGroups/rg1/providers/x', 'resourcegroups'));
    same('host', 'ns.servicebus.windows.net', armHost({ properties: { serviceBusEndpoint: 'https://NS.servicebus.windows.net:443/' } }));
});

await run('connection string', async () => {
    const info = parseConnectionString('Endpoint=sb://NS.servicebus.windows.net/;SharedAccessKeyName=Root;SharedAccessKey=abc=def=', en);
    same('host', 'ns.servicebus.windows.net', info.host);
    same('key keeps its equal signs', 'abc=def=', info.key);
    same('https', 'https://ns.servicebus.windows.net/', info.managementUrl);
    same('entity path', 'q1', parseConnectionString('Endpoint=sb://n.servicebus.windows.net/;SharedAccessKeyName=a;SharedAccessKey=b;EntityPath=q1', en).entityPath);
    same('emulator', 'http://localhost:5300/', parseConnectionString('Endpoint=sb://localhost;SharedAccessKeyName=a;SharedAccessKey=b;UseDevelopmentEmulator=true', en).managementUrl);
    let thrown = 0;
    for (const bad of ['hello', 'Endpoint=sb://n.servicebus.windows.net/;SharedAccessKeyName=a']) {
        try {
            parseConnectionString(bad, en);
        } catch {
            thrown++;
        }
    }
    same('invalid strings refused', 2, thrown);
    // Vector computed independently (Python hmac/sha256/base64), the same as the C# tests.
    same(
        'sas token',
        'SharedAccessSignature sr=https%3A%2F%2Fns.servicebus.windows.net%2F&sig=0h9w6ZwzGVEBfLeg4Que0uobKoXFmHnfJrX4aq3RN2U%3D&se=1700000000&skn=Root',
        await createSasToken('https://ns.servicebus.windows.net/', 'Root', 'abc', new Date(1700000000 * 1000)),
    );
});

await run('hosts', () => {
    same('address', 'ns.servicebus.windows.net', normalizeHost('sb://NS.servicebus.windows.net/', null));
    same('https address', 'ns.servicebus.windows.net', normalizeHost('https://ns.servicebus.windows.net:443/', null));
    same('no scheme', 'ns.servicebus.windows.net', normalizeHost('ns.servicebus.windows.net', null));
    same('namespace name', 'ns.servicebus.windows.net', normalizeHost(null, 'NS'));
    same('full name', 'ns.servicebus.usgovcloudapi.net', normalizeHost(' ', 'ns.servicebus.usgovcloudapi.net'));
    same('blank', null, normalizeHost(null, ' '));
});

const endpoint = (name: string, contract: number, host: string | null, path: string): types.EndpointInfo => ({
    id: `e-${name}`,
    name,
    contract,
    host,
    path,
    authType: 0,
    messageFormat: 2,
    isManaged: false,
    steps: [],
});
const stepOn = (e: types.EndpointInfo, extra: Partial<types.StepInfo> = {}): types.StepInfo => ({
    id: `s-${e.name}-${Math.random()}`,
    name: 's',
    description: '',
    endpointId: e.id,
    messageId: 'm',
    message: 'Update',
    filterId: null,
    table: 'account',
    stage: 40,
    mode: 1,
    rank: 1,
    enabled: true,
    filteringAttributes: '',
    deleteJobOnSuccess: false,
    isManaged: false,
    isCustomizable: true,
    images: [],
    ...extra,
});

await run('matching', () => {
    const a = ns();
    const q = types.newEntity('queue', 'Q1', a);
    const unused = types.newEntity('queue', 'unused', a);
    const t = types.newEntity('topic', 't1', a);
    a.queues.push(q, unused);
    a.topics.push(t);
    const failed: types.SbNamespace = { host: 'broken.servicebus.windows.net', readWithKey: true, isGhost: false, error: '401', queues: [], topics: [] };
    const linked = endpoint('linked', 2, 'a.servicebus.windows.net', 'q1');
    const noSteps = endpoint('nosteps', 5, a.host, 't1');
    const missing = endpoint('missing', 2, a.host, 'gone');
    const kind = endpoint('kind', 5, a.host, 'q1');
    const ghost = endpoint('ghost', 5, 'other.servicebus.windows.net', 'x');
    const broken = endpoint('broken', 2, failed.host, 'y');
    const hook = endpoint('hook', 8, null, '');
    const all = [linked, noSteps, missing, kind, ghost, broken, hook];
    const steps = [stepOn(linked), stepOn(kind), stepOn(ghost)];
    const model = buildModel([a, failed], all, steps);
    const status = (name: string) => model.rows.find((r) => r.endpoint?.name === name)?.status;
    same('statuses', ['linked', 'noSteps', 'missingOnAzure', 'typeMismatch', 'notConnected', 'notConnected', 'otherType'], all.map((e) => status(e.name)));
    same('azure without endpoint', 'unused', model.rows.find((r) => r.status === 'noEndpoint')?.entity?.name);
    same('two endpoints on one entity', 2, q.endpoints.length);
    check('ghost namespace', model.namespaces.some((n) => n.isGhost && n.host === 'other.servicebus.windows.net'));
    check('ghost entity on connected namespace', a.queues.some((e) => e.isGhost && e.name === 'gone'));
    const again = buildModel(model.namespaces, all, steps);
    same('rebuild keeps the rows', model.rows.length, again.rows.length);
    same('rebuild keeps one ghost', 1, a.queues.filter((e) => e.isGhost).length);
    same('rebuild keeps the steps', 1, linked.steps.length);
    const sub = types.newEntity('subscription', 's', a, { topic: t });
    same('subscription shows its topic steps', types.stepsOf(t).length, types.stepsOf(sub).length);
});

await run('rules', () => {
    const valid = () => stepOn(endpoint('x', 2, 'h', 'p'));
    same('valid', 0, rules.validate(valid(), en).length);
    let s = valid();
    s.stage = 20;
    check('async is post only', rules.validate(s, en).includes(en.ruleAsyncPostOnly));
    s = valid();
    s.message = 'Create';
    s.filteringAttributes = 'name';
    check('filtering is Update only', rules.validate(s, en).includes(en.ruleFilteringUpdateOnly));
    s = valid();
    s.message = 'Create';
    s.images.push({ id: '', name: 'a', alias: 'a', imageType: 0, attributes: '' });
    same('no pre image on Create', 1, rules.validate(s, en).length);
    s = valid();
    s.message = 'Delete';
    s.images.push({ id: '', name: 'a', alias: 'a', imageType: 1, attributes: '' });
    same('no post image on Delete', 1, rules.validate(s, en).length);
    s = valid();
    s.message = 'RetrieveMultiple';
    s.images.push({ id: '', name: 'a', alias: 'a', imageType: 0, attributes: '' });
    same('no images on this message', 1, rules.validate(s, en).length);
    s = valid();
    s.images.push({ id: '', name: 'A', alias: 'A', imageType: 0, attributes: '' }, { id: '', name: 'a', alias: 'a', imageType: 0, attributes: '' });
    same('duplicate alias', 1, rules.validate(s, en).length);
    same('create property', 'id', rules.imageProperty('Create'));
    same('setstate property', 'entityMoniker', rules.imageProperty('SetState'));
    same('allowed on Update post', 3, rules.allowedImageTypes('Update', 40).length);
    same('columns', 'a,b', rules.normalizeColumns(' B, a ,,b'));

    const original = valid();
    original.images.push({ id: 'i1', name: 'old', alias: 'old', imageType: 0, attributes: '' });
    const draft = types.cloneStep(original);
    same('no change', 0, rules.describe(original, draft, en).length);
    same('no update', {}, stepUpdate(original, draft));
    draft.filteringAttributes = 'name';
    draft.rank = 5;
    draft.images = [{ id: '', name: 'new', alias: 'new', imageType: 1, attributes: 'name' }];
    same('filtering, rank, image added, image removed', 4, rules.describe(original, draft, en).length);
    same('only the changed attributes', { rank: 5, filteringattributes: 'name' }, stepUpdate(original, draft));
    draft.filterId = null;
    original.filterId = 'f1';
    same('all tables unbinds the filter', null, stepUpdate(original, draft)['sdkmessagefilterid@odata.bind']);
});

await run('formats', () => {
    same('infinite', en.unlimited, duration('P10675199DT2H48M5.4775807S', en));
    same('days', en.days(14), duration('P14D', en));
    same('minutes', en.minutes(1), duration('PT1M', en));
    same('seconds', en.seconds(30), duration('PT30S', en));
    same('garbage', 'soon', duration('soon', en));
    same('not a duration', null, parseDuration('P'));
    same('size', '2 KB', size(2048));
});

// #region Messages

const message = (body: Uint8Array, contentType?: string): types.SbMessage => ({ source: undefined as any, sequenceNumber: 1, deliveryCount: 0, properties: [], body, bodyText: '', contentType });

await run('decoding', () => {
    const step = '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
    for (const [file, format, type] of [
        ['context.msbin1', FormatBinary, 'application/msbin1'],
        ['context.xml', FormatXml, 'application/xml'],
        ['context.json', FormatJson, 'application/json'],
        ['context.msbin1', FormatBinary, undefined],
    ] as const) {
        const m = message(new Uint8Array(readFileSync(join(fixtures, file))), type);
        decodeMessage(m);
        const name = `${file} (${type ?? 'no content type'})`;
        same(`${name} format`, format, m.bodyFormat);
        same(`${name} step`, step, m.context?.stepId);
        same(`${name} step name`, 'Update of account', m.context?.stepName);
        same(`${name} message`, 'Update', m.context?.messageName);
        same(`${name} table`, 'account', m.context?.table);
        same(`${name} record`, '0a1b2c3d-1111-2222-3333-444455556666', m.context?.recordId);
        same(`${name} stage / mode / depth`, [40, 1, 1], [m.context?.stage, m.context?.mode, m.context?.depth]);
        same(`${name} organization`, 'contoso', m.context?.organization);
        same(`${name} created on`, '2026-11-03T09:30:15.000Z', m.context?.operationCreatedOn?.toISOString());
        check(`${name} body is readable`, m.bodyText.includes('Contoso Ltd') && m.bodyText.includes('OwningExtension'));
    }

    // The binary decoder against the rendering of .NET itself: same elements, same text values.
    const tree = decodeNbfx(new Uint8Array(readFileSync(join(fixtures, 'context.msbin1'))));
    const reference = new XmlDomParser().parseFromString(readFileSync(join(fixtures, 'context.msbin1.xml'), 'utf8'), 'text/xml');
    const values = (node: any, out: string[] = []): string[] => {
        for (let c = node.firstChild; c; c = c.nextSibling) {
            if (c.nodeType === 1) {
                out.push(`<${c.localName}>`);
                values(c, out);
            } else if (c.nodeType === 3 && c.nodeValue.trim()) out.push(c.nodeValue.trim());
        }
        return out;
    };
    const ours = values(new XmlDomParser().parseFromString(serialize(tree), 'text/xml'));
    const theirs = values(reference);
    same('binary decoder: element and value count', theirs.length, ours.length);
    const firstDifference = theirs.findIndex((v, i) => v !== ours[i]);
    same('binary decoder: same values as .NET', -1, firstDifference === -1 ? -1 : `${firstDifference}: .NET ${theirs[firstDifference]} / ours ${ours[firstDifference]}`);
    check('decimal value', serialize(tree).includes('1500.25'));

    const other = message(new TextEncoder().encode('{"orderId": 42, "MessageName": null}'), 'application/json');
    decodeMessage(other);
    same('other JSON format', FormatJson, other.bodyFormat);
    check('other JSON is not a context', other.context === undefined);
    check('JSON is indented', other.bodyText.includes('\n'));

    const text = message(new TextEncoder().encode('﻿hello world'));
    decodeMessage(text);
    same('text without BOM', [FormatText, 'hello world'], [text.bodyFormat, text.bodyText]);
    const raw = message(new Uint8Array([0x00, 0xff, 0x10, 0x80, 0x41]));
    decodeMessage(raw);
    same('raw', FormatRaw, raw.bodyFormat);
    check('hex dump', raw.bodyText.startsWith('000000  00 FF 10 80 41'));
    const broken = message(new TextEncoder().encode('<not xml'));
    decodeMessage(broken);
    same('broken XML stays text', FormatText, broken.bodyFormat);
    const empty = message(new Uint8Array(0));
    decodeMessage(empty);
    same('empty', undefined, empty.bodyFormat);
});

await run('message reading', async () => {
    const a = ns();
    const t = types.newEntity('topic', 'crm', a);
    const all = types.newEntity('subscription', 'all', a, { topic: t });
    const dw = types.newEntity('subscription', 'dw', a, { topic: t });
    t.subscriptions.push(dw, all);
    a.topics.push(t);
    const q = types.newEntity('queue', 'q', a);
    a.queues.push(q);
    same('a topic is read through its subscriptions', ['all', 'dw'], sourcesOf(t).map((s) => s.name));
    same('a ghost has no source', 0, sourcesOf(types.newEntity('queue', 'g', a, { isGhost: true })).length);
    same('subscription path', 'crm/Subscriptions/all', pathOf(all));

    const binary = new Uint8Array(readFileSync(join(fixtures, 'context.msbin1')));
    const calls: string[] = [];
    let closed = 0;
    const reader = (error?: Error) => async () => ({
        host: a.host,
        peek: async (path: string, max: number) => {
            calls.push(path);
            if (error) throw error;
            return Array.from({ length: Math.min(max, path.endsWith('all') ? 5 : 0) }, (_v, i) => ({ ...message(binary), sequenceNumber: i + 1 }));
        },
        close: async () => void closed++,
    });
    const progress: string[] = [];
    const batches = await readMessages(sourcesOf(t), 3, reader(), (p) => progress.push(p), en);
    same('one batch per subscription, active only', ['crm/Subscriptions/all', 'crm/Subscriptions/dw'], calls);
    const active = batches.find((b) => b.source === all)!;
    same('limit applied and reported', [3, true], [active.messages.length, active.truncated]);
    check('decoded and placed', active.messages.every((m) => m.context?.messageName === 'Update' && m.source === all));
    same('progress', 2, progress.length);
    same('reader closed', 1, closed);

    const step = stepOn(endpoint('x', 2, 'h', 'p'), { id: '6F1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D' });
    resolveSteps(batches, [step]);
    check('step found from the context, whatever the case', active.messages.every((m) => m.step === step));

    calls.length = 0;
    const refused = await readMessages(sourcesOf(t), 10, reader(new AzureRequestError(401, 'refused', undefined, true)), undefined, en);
    check('refusal on every batch', refused.every((b) => b.error === 'refused'));
    same('a refused namespace is asked once', 1, calls.length);
    calls.length = 0;
    await readMessages(sourcesOf(t), 10, reader(new AzureRequestError(404, 'missing')), undefined, en);
    same('a missing entity does not stop the others', 2, calls.length);
    const noConnection = await readMessages([q], 10, async () => Promise.reject(new AzureRequestError(0, 'not connected', undefined, true)), undefined, en);
    check('no connection fills the batch', noConnection.length === 1 && noConnection[0].error === 'not connected');
});

// #endregion

await run('export', () => {
    const a = ns();
    const q = types.newEntity('queue', 'q1', a, { activeMessages: 3 });
    a.queues.push(q);
    const e = endpoint('Account <events>', 2, a.host, 'q1');
    const s = stepOn(e, { name: 'Update of account' });
    s.images.push({ id: 'i', name: 'img', alias: 'PreImage', imageType: 0, attributes: 'name' });
    const zip = unzipSync(exportModel(buildModel([a], [e], [s]), en));
    same('six sheets', 6, Object.keys(zip).filter((k) => k.startsWith('xl/worksheets/sheet')).length);
    const first = strFromU8(zip['xl/worksheets/sheet1.xml']);
    check('escaped text', first.includes('Account &lt;events&gt;'));
    check('numbers stay numbers', /<c r="I2"><v>3<\/v><\/c>/.test(first));
    check('workbook lists the sheets', strFromU8(zip['xl/workbook.xml']).includes('name="Queues and topics"'));
});

console.log(`${passed} checks passed, ${failures.length} failed`);
for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
