/*
 * The real AMQP path against the Microsoft Service Bus emulator (docker), in Node over TCP: in the ToolBox the same SDK
 * goes over WebSockets. Messages are sent the way Dataverse does (the three formats), one is abandoned once, then the tool
 * peeks twice. Expects the queue « dataverse-queue » and the topic « dataverse-topic » with the subscriptions « all » and
 * « accounts » (the latter filtered on the table account).
 * Usage: npm run test:emulator [-- "<connection string>"]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import { ServiceBusClient } from '@azure/service-bus';

(globalThis as any).DOMParser = XmlDomParser;

const { getStrings } = await import('../../src/i18n/strings');
const { parseConnectionString } = await import('../../src/services/azure/connectionString');
const { AmqpMessageReader } = await import('../../src/services/azure/messageReader');
const { SasReader, loadNamespace } = await import('../../src/services/azure/readers');
const { readMessages, resolveSteps, sourcesOf } = await import('../../src/services/messageService');
const { FormatBinary, FormatJson, FormatXml } = await import('../../src/services/messageDecoder');
const types = await import('../../src/models/types');

const connectionString = process.argv[2] ?? 'Endpoint=sb://localhost;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;';
const en = getStrings('en');
const fixtures = join(import.meta.dirname, '..', 'fixtures');
const Queue = 'dataverse-queue';
const Topic = 'dataverse-topic';
const StepId = '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const EntityProperty = 'http://schemas.microsoft.com/xrm/2011/Claims/EntityLogicalName';

let passed = 0;
const failures: string[] = [];
const ok = (name: string, condition: boolean) => {
    if (condition) passed++;
    else failures.push(name);
    console.log(`${condition ? '  ok   ' : '  FAIL '}${name}`);
};

const bus = new ServiceBusClient(connectionString);
const sent = new Set<string>();

async function purge(entity: string, subscription?: string) {
    const receiver = subscription ? bus.createReceiver(entity, subscription, { receiveMode: 'receiveAndDelete' }) : bus.createReceiver(entity, { receiveMode: 'receiveAndDelete' });
    let count = 0;
    for (;;) {
        const batch = await receiver.receiveMessages(50, { maxWaitTimeInMs: 2000 });
        if (batch.length === 0) break;
        count += batch.length;
    }
    await receiver.close();
    console.log(`purged ${count} from ${subscription ? `${entity}/${subscription}` : entity}`);
}

async function send(entity: string, file: string | null, contentType: string, table: string, text?: string) {
    const messageId = crypto.randomUUID();
    sent.add(messageId);
    const sender = bus.createSender(entity);
    await sender.sendMessages({
        messageId,
        contentType,
        // A Data section, as Dataverse sends it.
        body: file ? new Uint8Array(readFileSync(join(fixtures, file))) : new TextEncoder().encode(text ?? ''),
        applicationProperties: { 'http://schemas.microsoft.com/xrm/2011/Claims/Organization': 'contoso.crm4.dynamics.com', [EntityProperty]: table },
    });
    await sender.close();
}

for (const [entity, subscription] of [[Queue], [Topic, 'all'], [Topic, 'accounts']] as const) await purge(entity, subscription);
await send(Queue, 'context.msbin1', 'application/msbin1', 'account');
await send(Queue, 'context.json', 'application/json', 'account');
await send(Queue, 'context.xml', 'application/xml', 'account');
await send(Queue, null, 'text/plain', 'none', 'plain text from another sender');

// A consumer that failed once: the first message comes back with a delivery count of 1.
const consumer = bus.createReceiver(Queue);
const [taken] = await consumer.receiveMessages(1, { maxWaitTimeInMs: 5000 });
ok('abandon by a consumer', !!taken);
if (taken) await consumer.abandonMessage(taken);
await consumer.close();

await send(Topic, 'context.msbin1', 'application/msbin1', 'account');
await send(Topic, 'context.json', 'application/json', 'contact');
await new Promise((r) => setTimeout(r, 1000));

const info = parseConnectionString(connectionString, en);
const ns: types.SbNamespace = { host: info.host, readWithKey: true, isGhost: false, queues: [], topics: [] };
const queue = types.newEntity('queue', Queue, ns);
const topic = types.newEntity('topic', Topic, ns);
for (const name of ['all', 'accounts']) topic.subscriptions.push(types.newEntity('subscription', name, ns, { topic }));
ns.queues.push(queue);
ns.topics.push(topic);
const step = { id: StepId.toUpperCase(), name: 'Update of account' } as types.StepInfo;

async function read(sources: types.SbEntity[], max = 100) {
    const batches = await readMessages(sources, max, async () => AmqpMessageReader.withKey(info, en), (p) => console.log(`  … ${p}`), en);
    resolveSteps(batches, [step]);
    for (const b of batches.filter((x) => x.error)) console.log(`  error on ${b.source.name}: ${b.error} ${b.errorDetails ?? ''}`);
    return batches;
}

const first = await read([queue]);
const ours = first[0].messages.filter((m) => sent.has(m.messageId ?? ''));
for (const m of ours) console.log(`  #${m.sequenceNumber} delivery=${m.deliveryCount} ${m.bodyFormat} step=${m.step?.name ?? '-'} ${m.context?.messageName ?? ''} ${m.context?.table ?? ''}`);
ok('no error on the queue', first.every((b) => !b.error));
ok('four messages still there', ours.length === 4);
ok('binary message linked to its step', ours.some((m) => m.bodyFormat === FormatBinary && m.step === step));
ok('JSON message linked to its step', ours.some((m) => m.bodyFormat === FormatJson && m.step === step));
ok('XML message linked to its step', ours.some((m) => m.bodyFormat === FormatXml && m.step === step));
ok('other sender is not Dataverse', ours.some((m) => !m.context && m.bodyText === 'plain text from another sender'));
ok('abandoned message counts one delivery', ours.some((m) => m.deliveryCount === 1));
ok('sequence numbers', ours.every((m) => m.sequenceNumber > 0));
ok('enqueued time', ours.every((m) => !!m.enqueuedOn && Math.abs(Date.now() - m.enqueuedOn.getTime()) < 10 * 60000));
ok('content type', ours.some((m) => m.contentType === 'application/json'));
ok('application properties', ours.some((m) => m.properties.some(([k, v]) => k === EntityProperty && v === 'account')));

const second = (await read([queue]))[0].messages.filter((m) => sent.has(m.messageId ?? ''));
ok('peek again: nothing was taken', second.length === 4);
const deliveries = (list: types.SbMessage[]) => [...list].sort((a, b) => a.sequenceNumber - b.sequenceNumber).map((m) => m.deliveryCount).join(',');
ok('peek again: delivery counts did not move', deliveries(second) === deliveries(ours));

const limited = (await read([queue], 2))[0];
ok('limit of 2', limited.messages.length === 2 && limited.truncated);

const subscriptions = await read(sourcesOf(topic));
const toAll = subscriptions.find((b) => b.source.name === 'all')!.messages.filter((m) => sent.has(m.messageId ?? ''));
const toAccounts = subscriptions.find((b) => b.source.name === 'accounts')!.messages.filter((m) => sent.has(m.messageId ?? ''));
ok('topic: each subscription has its copy', toAll.length === 2);
ok('topic: the SQL filter kept the account only', toAccounts.length === 1 && toAccounts[0].properties.some(([, v]) => v === 'account'));

const missing = await read([types.newEntity('queue', 'does-not-exist', ns)]);
console.log(`  missing queue: ${missing[0].error} ${missing[0].errorDetails ?? ''}`);
ok('missing queue is an error, not a crash', !!missing[0].error);

// The management endpoint with the key: informational, the emulator may not serve every Atom feed.
try {
    const loaded = await loadNamespace(new SasReader(info, en), 4, () => undefined, en);
    console.log(`  management endpoint: ${loaded.queues.length} queue(s), ${loaded.topics.length} topic(s), ${loaded.topics.flatMap((t) => t.subscriptions).length} subscription(s)`);
} catch (error) {
    console.log(`  management endpoint not available on the emulator: ${(error as Error).message}`);
}

await bus.close();
console.log(`${passed} emulator checks passed, ${failures.length} failed`);
for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
