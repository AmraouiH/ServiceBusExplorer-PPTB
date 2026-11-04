/*
 * End-to-end tests of ServiceBus Explorer against an in-memory Dataverse and ToolBox (tests/e2e/mockHost.js)
 * and an Azure namespace answered by the test (Atom management feeds, Azure Resource Manager).
 * Usage: npm run test:e2e   (builds dist in development mode, serves it, drives Microsoft Edge / Chrome headless)
 * Set SBX_SHOTS=folder to save a screenshot of the main screens.
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..', '..');
const mockPath = path.join(__dirname, 'mockHost.js');
const fixtures = path.join(__dirname, '..', 'fixtures');
const shotsDir = path.join(__dirname, 'screenshots');
const screensDir = process.env.SBX_SHOTS;
const PORT = 5299;
const BASE = `http://localhost:${PORT}/`;
const Host = 'contoso-crm.servicebus.windows.net';
const ConnectionString = `Endpoint=sb://${Host}/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=c2VjcmV0LWtleS1mb3ItdGVzdHM=`;

function findBrowser() {
    const candidates = [
        process.env.PW_BROWSER,
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
    ].filter(Boolean);
    const found = candidates.find((p) => fs.existsSync(p));
    if (!found) throw new Error('No Chromium-based browser found. Set PW_BROWSER to its executable path.');
    return found;
}

// #region Azure answered by the test

const Sb = 'http://schemas.microsoft.com/netservices/2010/10/servicebus/connect';
const Xsi = 'http://www.w3.org/2001/XMLSchema-instance';
const Counts = 'http://schemas.microsoft.com/netservices/2011/06/servicebus';
const feed = (...entries) => `<feed xmlns="http://www.w3.org/2005/Atom"><title type="text">x</title>${entries.join('')}</feed>`;
const entry = (title, content) => `<entry><id>https://ns/${title}</id><title type="text">${title}</title><content type="application/xml">${content}</content></entry>`;
const counts = (active, dead, scheduled) =>
    `<CountDetails xmlns:d2p1="${Counts}"><d2p1:ActiveMessageCount>${active}</d2p1:ActiveMessageCount><d2p1:DeadLetterMessageCount>${dead}</d2p1:DeadLetterMessageCount><d2p1:ScheduledMessageCount>${scheduled}</d2p1:ScheduledMessageCount><d2p1:TransferMessageCount>0</d2p1:TransferMessageCount></CountDetails>`;
const queue = (name, active, dead, status = 'Active') =>
    entry(
        name,
        `<QueueDescription xmlns="${Sb}" xmlns:i="${Xsi}"><LockDuration>PT1M</LockDuration><MaxSizeInMegabytes>1024</MaxSizeInMegabytes><RequiresSession>false</RequiresSession><DefaultMessageTimeToLive>P14D</DefaultMessageTimeToLive><MaxDeliveryCount>10</MaxDeliveryCount><SizeInBytes>${active * 2048}</SizeInBytes><MessageCount>${active + dead}</MessageCount><Status>${status}</Status><CreatedAt>2026-03-04T10:11:12Z</CreatedAt><AccessedAt>0001-01-01T00:00:00Z</AccessedAt>${counts(active, dead, 2)}<AutoDeleteOnIdle>P10675199DT2H48M5.4775807S</AutoDeleteOnIdle></QueueDescription>`,
    );
const topic = (name, subscriptions) =>
    entry(name, `<TopicDescription xmlns="${Sb}" xmlns:i="${Xsi}"><SizeInBytes>4096</SizeInBytes><Status>Active</Status><SubscriptionCount>${subscriptions}</SubscriptionCount>${counts(0, 0, 1)}</TopicDescription>`);
const subscription = (name, active, dead) =>
    entry(name, `<SubscriptionDescription xmlns="${Sb}" xmlns:i="${Xsi}"><LockDuration>PT30S</LockDuration><MaxDeliveryCount>5</MaxDeliveryCount><MessageCount>${active + dead}</MessageCount><Status>Active</Status>${counts(active, dead, 0)}</SubscriptionDescription>`);
const sqlRule = (name, expression, action) =>
    entry(
        name,
        `<RuleDescription xmlns="${Sb}" xmlns:i="${Xsi}"><Filter i:type="SqlFilter"><SqlExpression>${expression}</SqlExpression></Filter>${action ? `<Action i:type="SqlRuleAction"><SqlExpression>${action}</SqlExpression></Action>` : '<Action i:type="EmptyRuleAction"/>'}<Name>${name}</Name></RuleDescription>`,
    );
const trueRule = (name) => entry(name, `<RuleDescription xmlns="${Sb}" xmlns:i="${Xsi}"><Filter i:type="TrueFilter"><SqlExpression>1=1</SqlExpression></Filter><Action i:type="EmptyRuleAction"/><Name>${name}</Name></RuleDescription>`);
const correlationRule = (name, subject, key, value) =>
    entry(
        name,
        `<RuleDescription xmlns="${Sb}" xmlns:i="${Xsi}"><Filter i:type="CorrelationFilter"><Label>${subject}</Label><ContentType>application/json</ContentType><Properties><KeyValueOfstringanyType><Key>${key}</Key><Value i:type="d6p1:string" xmlns:d6p1="http://www.w3.org/2001/XMLSchema">${value}</Value></KeyValueOfstringanyType></Properties></Filter><Action i:type="EmptyRuleAction"/><Name>${name}</Name></RuleDescription>`,
    );

const routes = {
    '$Resources/queues': feed(queue('crm-account-events', 128, 0), queue('crm-invoice-events', 42, 7), queue('erp-outbound', 0, 0), queue('legacy-sync', 3, 0, 'Disabled')),
    '$Resources/topics': feed(topic('crm-contact-changes', 3), topic('crm-opportunity-won', 2), topic('wrong-kind', 0)),
    'crm-contact-changes/Subscriptions': feed(subscription('marketing-platform', 12, 0), subscription('data-warehouse', 310, 4), subscription('support-portal', 0, 0)),
    'crm-contact-changes/Subscriptions/marketing-platform/rules': feed(sqlRule('OptedInOnly', 'doNotBulkEMail = 0 AND statecode = 0', "SET sys.Label = 'marketing'"), correlationRule('ContactCreated', 'Create', 'entity', 'contact')),
    'crm-contact-changes/Subscriptions/data-warehouse/rules': feed(trueRule('$Default')),
    'crm-contact-changes/Subscriptions/support-portal/rules': feed(sqlRule('VipOnly', "tier IN ('gold','platinum')")),
    'crm-opportunity-won/Subscriptions': feed(subscription('sales-analytics', 5, 0), subscription('erp-orders', 0, 1)),
    'crm-opportunity-won/Subscriptions/sales-analytics/rules': feed(trueRule('$Default')),
    'crm-opportunity-won/Subscriptions/erp-orders/rules': feed(sqlRule('LargeDeals', 'estimatedvalue > 100000')),
    'wrong-kind/Subscriptions': feed(),
};

/** Azure state shared by the pages of a test (requests, refusals, delays). */
function azure() {
    return { requests: [], refuse: false, delay: 0, armRequests: [] };
}

async function routeAzure(page, state) {
    await page.route(`https://${Host}/**`, async (route) => {
        const url = new URL(route.request().url());
        const key = decodeURIComponent(url.pathname.substring(1));
        state.requests.push(key);
        const auth = route.request().headers()['authorization'] ?? '';
        if (state.delay) await new Promise((r) => setTimeout(r, state.delay));
        if (state.refuse || !/^SharedAccessSignature sr=https%3A%2F%2Fcontoso-crm\.servicebus\.windows\.net%2F&sig=[^&]+&se=\d+&skn=RootManageSharedAccessKey$/.test(auth)) {
            return route.fulfill({ status: 401, contentType: 'application/xml', body: '<Error><Code>401</Code><Detail>InvalidSignature: The token has an invalid signature.</Detail></Error>' });
        }
        const body = routes[key];
        if (body === undefined) return route.fulfill({ status: 404, body: '<Error><Code>404</Code><Detail>nothing at ' + key + '</Detail></Error>' });
        // Paging: everything fits in the first page.
        const skip = Number(url.searchParams.get('$skip') ?? 0);
        return route.fulfill({ status: 200, contentType: 'application/atom+xml', body: skip > 0 ? feed() : body });
    });

    const ns = '/subscriptions/s1/resourceGroups/rg-crm/providers/Microsoft.ServiceBus/namespaces/contoso-arm';
    const arm = {
        '/tenants': { value: [{ tenantId: '11111111-1111-1111-1111-111111111111' }] },
        '/subscriptions': { value: [{ subscriptionId: 's1', displayName: 'Production' }] },
        '/subscriptions/s1/providers/Microsoft.ServiceBus/namespaces': {
            value: [{ id: ns, name: 'contoso-arm', location: 'West Europe', sku: { name: 'Standard' }, properties: { serviceBusEndpoint: 'https://contoso-arm.servicebus.windows.net:443/' } }],
        },
        [ns]: { id: ns, location: 'West Europe', sku: { name: 'Standard' }, properties: { status: 'Active' } },
        [`${ns}/queues`]: { value: [{ name: 'arm-queue', properties: { status: 'Active', countDetails: { activeMessageCount: 9 } } }] },
        [`${ns}/topics`]: { value: [] },
    };
    await page.route('https://management.azure.com/**', async (route) => {
        const url = new URL(route.request().url());
        state.armRequests.push([url.pathname, route.request().headers()['authorization']]);
        if (route.request().headers()['authorization'] !== 'Bearer az-token') return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":{"message":"bad token"}}' });
        const body = arm[url.pathname];
        if (!body) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"message":"nothing"}}' });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
}

// #endregion

// #region Mini test harness

const results = [];
let browser;

async function test(name, fn) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => {
        // Refusals asked by a test are logged by the browser as failed resources: they are not errors of the tool.
        if (m.type() === 'error' && !m.text().includes('ServiceBus Explorer:') && !m.text().startsWith('Failed to load resource')) pageErrors.push('console.error: ' + m.text());
    });
    const state = azure();
    await routeAzure(page, state);
    await page.addInitScript({ path: mockPath });
    const started = Date.now();
    try {
        await fn(page, state);
        const violations = await page.evaluate(() => window.__mock?.violations ?? []);
        if (violations.length) throw new Error('Host API misuse:\n  ' + violations.join('\n  '));
        if (pageErrors.length) throw new Error('Page errors:\n  ' + pageErrors.join('\n  '));
        results.push({ name, ok: true, ms: Date.now() - started });
        console.log(`  ✔ ${name}`);
    } catch (error) {
        results.push({ name, ok: false, error });
        console.log(`  ✘ ${name}\n      ${String(error.message).split('\n').join('\n      ')}`);
        fs.mkdirSync(shotsDir, { recursive: true });
        await page.screenshot({ path: path.join(shotsDir, name.replace(/[^a-z0-9]+/gi, '_') + '.png') }).catch(() => undefined);
    } finally {
        await page.close();
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${message}\n      expected: ${e}\n      actual:   ${a}`);
}

async function shot(page, name) {
    if (!screensDir) return;
    fs.mkdirSync(screensDir, { recursive: true });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(screensDir, `${name}.png`) });
}

// #endregion

// #region Page helpers

const bytes = (file) => Array.from(fs.readFileSync(path.join(fixtures, file)));

async function open(page, init = {}) {
    await page.addInitScript((data) => Object.assign(window, data), init);
    await page.goto(BASE);
    await page.waitForSelector('.sb-header');
    await page.waitForTimeout(150);
}

async function idle(page) {
    await page.waitForTimeout(60);
    await page.waitForSelector('.sb-busy', { state: 'detached', timeout: 15000 });
    await page.waitForTimeout(60);
}

const dialog = (page) => page.locator('[role=dialog], [role=alertdialog]').last();

/** Returns the open message dialog text (or null) and closes it with OK. */
async function takeDialog(page) {
    const d = dialog(page);
    if (!(await d.count())) return null;
    const text = await d.innerText();
    await d.locator('button', { hasText: /^(OK|Close|Fermer)$/ }).last().click();
    await page.waitForTimeout(150);
    return text;
}

const calls = (page, method) => page.evaluate((m) => window.__mock.calls.filter((c) => c[0] === m), method);
const db = (page) => page.evaluate(() => window.__mock.db);

async function addConnectionString(page, value = ConnectionString, remember = false) {
    await page.locator('.sb-header button', { hasText: 'Azure connections' }).click();
    await page.locator('[role=tab]', { hasText: 'Connection string' }).click();
    await page.fill('.sb-connection-string textarea', value);
    if (remember) await page.locator('.sb-remember input').check();
    await page.locator('.sb-test-add').click();
    await page.waitForSelector('.sb-connections-status');
    await page.waitForTimeout(100);
    const status = await page.locator('.sb-connections-status').innerText();
    await page.locator('.sb-connections-dialog button', { hasText: /^Close$/ }).last().click();
    await page.waitForTimeout(150);
    return status;
}

async function load(page) {
    await page.locator('.sb-load').click();
    await idle(page);
}

/** Connected and loaded: the starting point of most tests. */
async function loaded(page, init) {
    await open(page, init);
    await addConnectionString(page);
    await load(page);
}

async function node(page, title) {
    const locator = page.locator('.sb-node', { has: page.locator('.sb-node-title', { hasText: new RegExp(`^${title.replace(/[$.]/g, '\\$&')}$`) }) }).first();
    await locator.click();
    await page.waitForTimeout(60);
}

const detailTitle = (page) => page.locator('.sb-detail-title h2').innerText();
const tiles = (page) => page.locator('.sb-card .sb-stat-value').allInnerTexts();
const tab = (page, name) => page.locator('[role=tab]', { hasText: name }).first();
const rowsOf = (page, grid) => page.locator(`${grid} tbody tr`);

async function gridTexts(page, grid, column) {
    return page.locator(`${grid} tbody tr td:nth-child(${column})`).allInnerTexts();
}

// #endregion

async function run() {
    console.log('Building (development mode)…');
    execSync('npx vite build --mode development', { cwd: root, stdio: 'ignore' });

    const vite = await import('vite');
    const server = await vite.preview({ root, preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
    browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
    console.log('Running tests…\n');

    const messageData = {
        __mockMessages: {
            [`${Host}/crm-account-events`]: [
                { body: bytes('context.msbin1'), contentType: 'application/msbin1' },
                { body: bytes('context.json'), contentType: 'application/json', deliveryCount: 2 },
                { body: Array.from(Buffer.from('ping from a test tool')), contentType: 'text/plain' },
            ],
            [`${Host}/crm-contact-changes/Subscriptions/data-warehouse`]: [{ body: bytes('context.xml'), contentType: 'application/xml', table: 'contact' }],
            [`${Host}/crm-contact-changes/Subscriptions/marketing-platform`]: [{ body: bytes('context.json'), contentType: 'application/json', table: 'contact' }],
        },
    };

    try {
        await test('Startup: nothing is read before Load', async (page, state) => {
            await open(page);
            assert((await page.locator('.sb-connection').innerText()).includes('Contoso Dev'), 'connection name in the header');
            assertEqual((await calls(page, 'queryData')).length, 0, 'no Dataverse read at startup');
            assertEqual(state.requests.length, 0, 'no Azure read at startup');
            assert((await page.locator('.sb-tree-empty').innerText()).includes('Add a namespace'), 'empty tree explains what to do');
            assert((await page.locator('.sb-empty-title').innerText()) === 'Select an item', 'detail placeholder');
            await shot(page, '01-empty');
        });

        await test('Load without Azure connection: Dataverse namespaces appear greyed out with their steps', async (page, state) => {
            await open(page);
            await load(page);
            assertEqual(state.requests.length, 0, 'Azure not called without connection');
            const titles = await page.locator('.sb-node-title').allInnerTexts();
            assert(titles.includes('contoso-crm') && titles.includes('contoso-legacy'), 'ghost namespaces: ' + titles);
            assert(await page.locator('.sb-node-muted').count(), 'ghosts are muted');
            assertEqual(await page.locator('[role=tab]', { hasText: 'Steps' }).first().locator('.sb-badge').first().innerText(), '11', 'steps badge');
            await node(page, 'contoso-crm');
            assert((await page.locator('.sb-detail-alert').innerText()).includes('is not connected'), 'ghost namespace alert');
            await page.locator('.sb-detail-alert button', { hasText: 'Connect' }).click();
            assert((await page.locator('.sb-connections-status').innerText()).includes(`Paste the connection string of ${Host}`), 'Connect opens the popup on the namespace');
        });

        await test('No Dataverse connection: Load explains it', async (page) => {
            await open(page, { __noConnection: true });
            await page.locator('.sb-load').click();
            const text = await takeDialog(page);
            assert(text && text.includes('Connect to a Dataverse environment first'), 'message: ' + text);
        });

        await test('Connections: a wrong string is refused, a good one is tested and added (kept for the session only)', async (page, state) => {
            await open(page);
            const bad = await addConnectionString(page, 'hello');
            assert(bad.includes('Endpoint=sb://… is missing'), 'invalid string: ' + bad);
            const scoped = await addConnectionString(page, ConnectionString + ';EntityPath=q1');
            assert(scoped.includes('limited to one entity'), 'entity path refused: ' + scoped);
            state.refuse = true;
            const refused = await addConnectionString(page);
            assert(refused.includes('was refused') && refused.includes('InvalidSignature'), 'refused key: ' + refused);
            state.refuse = false;
            const ok = await addConnectionString(page);
            assert(ok.includes(`${Host} was added`), 'added: ' + ok);
            assert(state.requests.includes('$Resources/queues'), 'the string was tested');
            const stored = await page.evaluate(() => window.__mock.settingsStore.settings.connections);
            assertEqual(stored.map((c) => [c.host, c.method, c.connectionString ?? null]), [[Host, 'connectionString', null]], 'the key is not written to the settings');
            assert((await page.locator('.sb-summary').innerText()).includes('click Load'), 'reload hint');

            await page.locator('.sb-header button', { hasText: 'Azure connections' }).click();
            assert((await page.locator('.sb-connections-grid').innerText()).includes('This session only'), 'session-only key shown');
            await page.locator('.sb-connections-dialog button', { hasText: /^Close$/ }).last().click();

            await addConnectionString(page, ConnectionString, true);
            const remembered = await page.evaluate(() => window.__mock.settingsStore.settings.connections);
            assertEqual(remembered[0].connectionString, ConnectionString, 'remembered when asked');
        });

        await test('Load: tree, counters, summary and badges', async (page, state) => {
            await loaded(page);
            assert(state.requests.includes('crm-contact-changes/Subscriptions/marketing-platform/rules'), 'rules read');
            const summary = await page.locator('.sb-summary').innerText();
            assert(summary.startsWith('2 namespace(s) · 8 endpoint(s) · 11 step(s)'), 'summary: ' + summary);
            assertEqual(await tab(page, 'Matching').locator('.sb-badge').first().innerText(), '3', 'problems badge');
            await node(page, 'contoso-crm');
            // Dead-letter: crm-invoice-events 7 + data-warehouse 4 + erp-orders 1.
            assertEqual((await tiles(page)).slice(0, 5), ['4', '3', '5', '12', '10'], 'namespace tiles (queues, topics, subscriptions, dead-letter, steps)');
            await node(page, 'crm-invoice-events');
            assertEqual(await detailTitle(page), 'crm-invoice-events', 'queue title');
            assertEqual((await tiles(page)).slice(0, 2), ['42', '7'], 'queue counters');
            assertEqual(await tab(page, 'Subscriptions and filters').count(), 0, 'a queue has no filters tab');
            await node(page, 'crm-contact-changes');
            assertEqual((await tiles(page))[4], '4', 'topic steps');
            await node(page, 'marketing-platform');
            assert((await page.locator('.sb-hint').first().innerText()).includes('These steps publish to the topic crm-contact-changes'), 'subscription hint');
            const pills = await page.locator('.sb-node', { hasText: 'crm-quote-events' }).locator('.sb-pill').allInnerTexts();
            assert(pills.includes('Missing'), 'missing entity pill: ' + pills);
            assert((await page.locator('.sb-node', { hasText: 'legacy-sync' }).locator('.sb-pill').allInnerTexts()).includes('Disabled'), 'disabled pill');
            await shot(page, '02-explorer-topic');
        });

        await test('Tree: filter, only linked, chevrons, keyboard', async (page) => {
            await loaded(page);
            await page.fill('.sb-tree-filter input', 'invoice');
            let titles = await page.locator('.sb-node-title').allInnerTexts();
            assert(titles.includes('crm-invoice-events') && !titles.includes('crm-account-events'), 'filter: ' + titles);
            await page.fill('.sb-tree-filter input', 'zzz');
            assert((await page.locator('.sb-tree-empty, .sb-tree').innerText()).length >= 0, 'nothing matches');
            assertEqual(await page.locator('.sb-node').count(), 0, 'no node for zzz');
            await page.fill('.sb-tree-filter input', '');
            await page.locator('label', { hasText: 'Only items with Dataverse steps' }).click();
            titles = await page.locator('.sb-node-title').allInnerTexts();
            assert(!titles.includes('erp-outbound') && titles.includes('crm-account-events'), 'only linked hides unused: ' + titles);
            await page.locator('label', { hasText: 'Only items with Dataverse steps' }).click();
            assert((await page.locator('.sb-node-title').allInnerTexts()).includes('erp-outbound'), 'only linked restores');
            const topicNode = page.locator('.sb-node', { hasText: 'crm-contact-changes' }).first();
            await topicNode.locator('.sb-chevron').click();
            assert(!(await page.locator('.sb-node-title').allInnerTexts()).includes('marketing-platform'), 'chevron collapses');
            await topicNode.locator('.sb-chevron').click();
            assert((await page.locator('.sb-node-title').allInnerTexts()).includes('marketing-platform'), 'chevron expands');
            await node(page, 'crm-account-events');
            await page.locator('.sb-tree').press('ArrowDown');
            assertEqual(await detailTitle(page), 'crm-invoice-events', 'arrow down moves to the next item');
        });

        await test('Detail: filters, rule, properties', async (page) => {
            await loaded(page);
            await node(page, 'crm-contact-changes');
            await tab(page, 'Subscriptions and filters').click();
            assertEqual(await rowsOf(page, '.sb-subscriptions-grid').count(), 3, 'subscriptions listed');
            await rowsOf(page, '.sb-subscriptions-grid').nth(1).click();
            assertEqual(await rowsOf(page, '.sb-rules-grid').count(), 2, 'rules follow the subscription');
            await rowsOf(page, '.sb-rules-grid').nth(1).click();
            assert((await page.locator('.sb-rule-detail').innerText()).includes("entity = 'contact'"), 'correlation filter in full');
            await page.locator('.sb-panel-title button', { hasText: 'Copy' }).click();
            assert((await page.evaluate(() => window.__clipboard)).includes("Subject = 'Create'"), 'copy');
            // The rules of a subscription are collapsed until the user opens it.
            assert(!(await page.locator('.sb-node-title').allInnerTexts()).includes('OptedInOnly'), 'rules collapsed by default');
            await page.locator('.sb-node', { hasText: 'marketing-platform' }).first().locator('.sb-chevron').click();
            await node(page, 'OptedInOnly');
            assertEqual(await detailTitle(page), 'marketing-platform', 'a rule opens its subscription');
            assert((await page.locator('.sb-rule-detail').innerText()).includes("Action: SET sys.Label = 'marketing'"), 'rule selected with its action');
            await node(page, 'crm-invoice-events');
            await tab(page, 'Properties').click();
            const props = await page.locator('.sb-props').innerText();
            assert(props.includes('14 day(s)') && props.includes('Unlimited') && props.includes('1 min'), 'durations are readable');
            assert(!props.includes('Last accessed'), 'empty properties are hidden');
            await shot(page, '04-properties');
        });

        await test('Namespace and group titles: no messages tab, no Messages button', async (page) => {
            await loaded(page);
            for (const title of ['contoso-crm', 'Queues', 'Topics']) {
                await node(page, title);
                assertEqual(await tab(page, 'Messages').count(), 0, `${title}: no messages tab`);
                assertEqual(await page.locator('.sb-steps-messages').count(), 0, `${title}: no Messages button`);
            }
            await node(page, 'crm-account-events');
            assertEqual(await tab(page, 'Messages').count(), 1, 'a queue has the messages tab');
            assertEqual(await page.locator('.sb-steps-messages').count(), 1, 'a queue has the Messages button');
        });

        await test('Matching: statuses, filters, search, open in the explorer', async (page) => {
            await loaded(page);
            await tab(page, 'Matching').click();
            assertEqual(await rowsOf(page, '.sb-matching-grid').count(), 9, 'rows, webhook hidden');
            assertEqual((await page.locator('.sb-stat-value').allInnerTexts()).slice(0, 5), ['8', '4', '3', '1', '1'], 'tiles');
            const expected = { 'All statuses': 9, 'To check': 3, Linked: 4, 'No steps': 1, 'Missing on Azure': 1, 'Wrong type': 1, 'Not connected': 1, 'No endpoint': 1, 'Other type': 1 };
            for (const [option, count] of Object.entries(expected)) {
                await page.locator('.sb-match-filter').click();
                await page.locator('[role=option]', { hasText: new RegExp(`^${option}$`) }).click();
                assertEqual(await rowsOf(page, '.sb-matching-grid').count(), count, `filter ${option}`);
            }
            await page.locator('.sb-match-filter').click();
            await page.locator('[role=option]', { hasText: /^All statuses$/ }).click();
            await page.fill('.sb-match-search input', 'invoice');
            assertEqual(await rowsOf(page, '.sb-matching-grid').count(), 1, 'search');
            await page.fill('.sb-match-search input', '');
            await rowsOf(page, '.sb-matching-grid').filter({ hasText: 'Account events' }).dblclick();
            assertEqual(await detailTitle(page), 'crm-account-events', 'double-click opens the entity in the explorer');
            await shot(page, '06-matching');
        });

        await test('Steps page: search, images, managed step', async (page) => {
            await loaded(page);
            await tab(page, 'Steps').click();
            assertEqual(await rowsOf(page, '.sb-steps-grid').count(), 11, 'all steps');
            assertEqual((await page.locator('.sb-stat-value').allInnerTexts()).slice(0, 3), ['11', '10', '4'], 'tiles');
            for (const [text, count] of [['invoice', 2], ['emailaddress1', 1], ['Assign', 1], ['crm-opportunity-won', 1], ['Legacy billing', 1]]) {
                await page.fill('.sb-card .sb-search input', text);
                assertEqual(await rowsOf(page, '.sb-steps-grid').count(), count, `search ${text}`);
            }
            await page.fill('.sb-card .sb-search input', '');
            await rowsOf(page, '.sb-steps-grid').filter({ hasText: 'name,telephone1,creditlimit' }).click();
            assertEqual(await rowsOf(page, '.sb-images-grid').count(), 2, 'images follow the selection');
            await rowsOf(page, '.sb-steps-grid').filter({ hasText: 'Assign' }).click();
            assert((await page.locator('.sb-panel-title').last().innerText()).includes('Managed'), 'managed step flagged');
            await shot(page, '07-steps');
        });

        await test('Bulk enable and disable, with confirmation', async (page) => {
            await loaded(page);
            await tab(page, 'Steps').click();
            const grid = rowsOf(page, '.sb-steps-grid');
            await grid.filter({ hasText: 'name,telephone1,creditlimit' }).click();
            await grid.filter({ hasText: 'statuscode,totalamount' }).click({ modifiers: ['Control'] });
            await page.locator('.sb-card button', { hasText: /^Disable$/ }).click();
            const text = await dialog(page).innerText();
            assert(text.includes('2 step(s) will stop sending messages') && text.includes('Update of account') && text.includes('Update of invoice'), 'confirmation lists the steps');
            await dialog(page).locator('button', { hasText: 'Cancel' }).click();
            assertEqual((await calls(page, 'update')).length, 0, 'cancel writes nothing');
            await page.locator('.sb-card button', { hasText: /^Disable$/ }).click();
            await page.locator('.sb-confirm').click();
            await idle(page);
            await idle(page);
            const updates = await calls(page, 'update');
            assertEqual(updates.map((u) => u[3]), [{ statecode: 1, statuscode: 2 }, { statecode: 1, statuscode: 2 }], 'state and status written');
            assert((await page.locator('.sb-summary').innerText()).includes('2 step(s) updated'), 'done message');
            assertEqual((await page.locator('.sb-stat-value').allInnerTexts())[1], '8', 'reloaded from Dataverse');

            // Managed and not customizable: left out
            await page.fill('.sb-card .sb-search input', 'contact');
            await grid.filter({ hasText: 'Assign' }).click();
            await page.locator('.sb-card button', { hasText: /^Disable$/ }).click();
            assert((await takeDialog(page)).includes('already in this state, or are read-only'), 'nothing to change');
        });

        await test('Step editor: trigger, filtering columns, review, only the changes are written', async (page) => {
            await loaded(page);
            await tab(page, 'Steps').click();
            await rowsOf(page, '.sb-steps-grid').filter({ hasText: 'name,telephone1,creditlimit' }).dblclick();
            await idle(page);
            await page.waitForSelector('.sb-step-editor');
            assertEqual(await page.locator('.sb-editor-message input').inputValue(), 'Update', 'message');
            assertEqual(await page.locator('.sb-editor-table input').inputValue(), 'account', 'table');
            await page.locator('.sb-editor-save').click();
            await page.waitForTimeout(100);
            assert((await page.locator('.sb-step-editor .fui-MessageBar').allInnerTexts()).join(' ').includes('has not changed'), 'nothing to save');

            await page.fill('.sb-editor-rank input', '5');
            await page.locator('.sb-editor-rank input').press('Tab');
            await page.locator('.sb-step-editor button', { hasText: 'Select…' }).first().click();
            await page.waitForSelector('.sb-picker-grid');
            await page.fill('.sb-picker-search input', 'mail');
            await rowsOf(page, '.sb-picker-grid').first().click();
            await page.locator('.sb-picker-ok').click();
            assertEqual(await page.locator('.sb-editor-filtering textarea').inputValue(), 'creditlimit,emailaddress1,name,telephone1', 'picked column added, sorted');

            // Asynchronous on pre-operation is refused before anything is sent
            await page.locator('.sb-editor-stage').click();
            await page.locator('[role=option]', { hasText: 'Pre-operation' }).click();
            assert((await page.locator('.sb-editor-issues').innerText()).includes('An asynchronous step only runs in Post-operation'), 'rule shown');
            assert(await page.locator('.sb-editor-save').isDisabled(), 'save disabled');
            await page.locator('.sb-editor-stage').click();
            await page.locator('[role=option]', { hasText: 'Post-operation' }).click();

            await page.locator('.sb-editor-save').click();
            const review = await page.locator('.sb-review-dialog').innerText();
            assert(/Rank : 1\s+→\s+5/.test(review) && review.includes('Filtering columns'), 'review lines: ' + review);
            await page.locator('.sb-review-save').click();
            await idle(page);
            await idle(page);
            const update = (await calls(page, 'update')).find((u) => u[1] === 'sdkmessageprocessingstep');
            assertEqual(update[3], { rank: 5, filteringattributes: 'creditlimit,emailaddress1,name,telephone1' }, 'only the two changed attributes');
            assert((await page.locator('.sb-summary').innerText()).includes('Update of account was saved'), 'saved message');
        });

        await test('Step editor: message change, images added, edited and removed', async (page) => {
            await loaded(page);
            await tab(page, 'Steps').click();
            await rowsOf(page, '.sb-steps-grid').filter({ hasText: 'name,telephone1,creditlimit' }).dblclick();
            await page.waitForSelector('.sb-step-editor');
            // Remove PostImage, edit PreImage, add Extra
            await rowsOf(page, '.sb-editor-images').filter({ hasText: 'PostImage' }).click();
            await page.locator('.sb-step-editor button', { hasText: /^Remove$/ }).click();
            await rowsOf(page, '.sb-editor-images').filter({ hasText: 'PreImage' }).dblclick();
            await page.waitForSelector('.sb-image-editor');
            await page.fill('.sb-image-alias input', 'Before');
            await page.locator('.sb-image-ok').click();
            await page.locator('.sb-image-add').click();
            await page.waitForSelector('.sb-image-editor');
            assert(await page.locator('.sb-image-ok').isDisabled(), 'an image needs an alias');
            await page.fill('.sb-image-alias input', 'Extra');
            await page.locator('.sb-image-ok').click();
            await page.locator('.sb-editor-save').click();
            const review = await page.locator('.sb-review-dialog').innerText();
            assert(review.includes('Image added: Extra') && review.includes('Image removed: PostImage') && review.includes('Image changed'), 'review: ' + review);
            await page.locator('.sb-review-save').click();
            await idle(page);
            await idle(page);
            const deletes = await calls(page, 'delete');
            const creates = await calls(page, 'create');
            const updates = (await calls(page, 'update')).filter((u) => u[1] === 'sdkmessageprocessingstepimage');
            assertEqual(deletes.length, 1, 'one image deleted');
            assertEqual([creates[0][2].entityalias, creates[0][2].messagepropertyname, /\/sdkmessageprocessingsteps\(/.test(creates[0][2]['sdkmessageprocessingstepid@odata.bind'])], ['Extra', 'Target', true], 'image created on the step');
            assertEqual(updates[0][3].entityalias, 'Before', 'image updated');

            // Changing the message reloads its tables
            await rowsOf(page, '.sb-steps-grid').filter({ hasText: 'statuscode,totalamount' }).dblclick();
            await page.waitForSelector('.sb-step-editor');
            // A typed name that matches a message is taken as it is.
            await page.fill('.sb-editor-message input', 'RetrieveMultiple');
            await page.keyboard.press('Tab');
            await page.waitForTimeout(400);
            assertEqual(await page.locator('.sb-editor-table input').inputValue(), 'All tables', 'tables of the new message');
            assertEqual(await page.locator('.sb-editor-filtering textarea').inputValue(), '', 'filtering cleared with the message');
            assertEqual(await page.locator('.sb-editor-issues').count(), 0, 'no issue left');
            await page.locator('.sb-step-editor button', { hasText: 'Cancel' }).click();
        });

        await test('Step editor: a managed step is read-only', async (page) => {
            await loaded(page);
            await tab(page, 'Steps').click();
            await rowsOf(page, '.sb-steps-grid').filter({ hasText: 'Assign' }).dblclick();
            await page.waitForSelector('.sb-step-editor');
            assert((await page.locator('.sb-editor-issues').innerText()).includes('read-only'), 'read-only notice');
            assert(await page.locator('.sb-editor-save').isDisabled(), 'save disabled');
        });

        await test('Messages of a queue: active only, linked to their step, detail and body', async (page) => {
            await loaded(page, messageData);
            await node(page, 'crm-account-events');
            await tab(page, 'Messages').click();
            assertEqual(await page.evaluate(() => window.__peekCalls.length), 0, 'nothing read before the click');
            assert((await page.locator('.sb-messages .sb-empty').innerText()).includes('Read active messages'), 'intro');
            assert((await page.locator('.sb-messages .sb-hint').innerText()).includes('Active messages only'), 'active only is said');
            await page.locator('.sb-read-messages').click();
            await idle(page);
            assertEqual(await page.evaluate(() => window.__peekCalls), [`${Host}/crm-account-events`], 'only the active messages, never the dead-letter queue');
            assertEqual(await rowsOf(page, '.sb-messages-grid').count(), 3, 'rows');
            const stepsCol = await gridTexts(page, '.sb-messages-grid', 3);
            assertEqual(stepsCol.filter((t) => t === 'Update of account · step not loaded').length, 2, 'binary and JSON contexts read (step of another org)');
            assert(stepsCol.includes('(not a Dataverse message)'), 'other sender');
            assertEqual(await page.locator('.sb-messages-count').innerText(), '3 active message(s)', 'count');
            await rowsOf(page, '.sb-messages-grid').first().click();
            const props = await page.locator('.sb-message-properties').innerText();
            assert(props.includes('6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d') && props.includes('Post-operation') && props.includes('contoso'), 'Dataverse context');
            assert((await page.locator('.sb-body-title').innerText()).includes('.NETBinary'), 'body format');
            assert((await page.locator('.sb-message-body').innerText()).includes('OwningExtension'), 'body text');
            await page.locator('.sb-messages button', { hasText: 'Copy' }).click();
            assert((await page.evaluate(() => window.__clipboard)).includes('Contoso Ltd'), 'copy body');
            await page.locator('.sb-messages button', { hasText: 'Open' }).click();
            assert((await page.locator('.sb-text-viewer').innerText()).includes('RemoteExecutionContext'), 'open in the viewer');
            await page.locator('.sb-text-viewer button', { hasText: 'Close' }).last().click();
            await page.fill('.sb-messages-search input', 'ping');
            assertEqual(await rowsOf(page, '.sb-messages-grid').count(), 1, 'search in the bodies');
            await page.fill('.sb-messages-search input', '');
            await shot(page, '08-messages-queue');
            await tab(page, 'Dataverse steps').click();
            await tab(page, 'Messages').click();
            assertEqual(await rowsOf(page, '.sb-messages-grid').count(), 3, 'kept across the tabs');
            await node(page, 'crm-invoice-events');
            await tab(page, 'Messages').click();
            assertEqual(await rowsOf(page, '.sb-messages-grid').count(), 0, 'another entity clears them');
        });

        await test('Messages of a topic, errors, Stop and ghosts', async (page) => {
            await loaded(page, messageData);
            await node(page, 'crm-contact-changes');
            await tab(page, 'Messages').click();
            assertEqual(await tab(page, 'Messages').locator('.sb-badge').first().innerText(), '322', 'badge sums the active messages of the subscriptions');
            await page.locator('.sb-read-messages').click();
            await idle(page);
            assertEqual(await page.evaluate(() => window.__peekCalls.length), 3, 'each subscription');
            assertEqual(await rowsOf(page, '.sb-messages-grid').count(), 2, 'topic rows');
            assert(await page.locator('.sb-messages-grid th', { hasText: 'Read from' }).count(), 'source column');

            await page.evaluate(() => (window.__peekError = () => Object.assign(new Error('Reading the messages was refused.'), { status: 401, details: "'Listen' claim(s) are required", fatal: true })));
            await page.locator('.sb-read-messages').click();
            await idle(page);
            assert((await page.locator('.sb-messages-alert').innerText()).includes('could not be read'), 'error strip');
            await page.locator('.sb-messages-alert button').click();
            assert((await page.locator('.sb-text-viewer').innerText()).includes("'Listen' claim"), 'details');
            await page.locator('.sb-text-viewer button', { hasText: 'Close' }).last().click();
            await page.evaluate(() => (window.__peekError = undefined));

            await page.evaluate(() => (window.__peekDelay = 4000));
            await page.locator('.sb-read-messages').click();
            await page.waitForSelector('.sb-busy');
            await page.locator('.sb-stop').click();
            await idle(page);
            assert((await page.locator('.sb-summary').innerText()).includes('Stopped'), 'Stop');
            await page.evaluate(() => (window.__peekDelay = 0));

            await node(page, 'crm-quote-events');
            await tab(page, 'Messages').click();
            assert(await page.locator('.sb-read-messages').isDisabled(), 'a ghost cannot be read');
            assert((await page.locator('.sb-messages .sb-empty').innerText()).includes('was not read on Azure'), 'explained');
        });

        await test('Messages of a step: popup, only this step, Stop', async (page) => {
            await loaded(page, messageData);
            await page.evaluate(() => {
                // The demo step that sent the fixtures (same id as tests/fixtures).
                const s = window.__mock.db.steps.find((x) => x.name === 'Update of account');
                s.sdkmessageprocessingstepid = '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
                window.__mock.db.images.forEach((i) => {
                    if (i.entityalias === 'PreImage' && i.attributes === 'name,telephone1,creditlimit') i.sdkmessageprocessingstepid = s.sdkmessageprocessingstepid;
                });
            });
            await load(page);
            await tab(page, 'Steps').click();
            await rowsOf(page, '.sb-steps-grid').filter({ hasText: 'name,telephone1,creditlimit' }).click();
            await page.locator('.sb-steps-messages').click();
            await page.waitForSelector('.sb-step-messages-dialog');
            await page.waitForSelector('.sb-step-messages-dialog .sb-messages-grid');
            const popup = page.locator('.sb-step-messages-dialog');
            assertEqual(await popup.locator('.sb-messages-grid tbody tr').count(), 2, 'only the messages of the step');
            assertEqual(await popup.locator('.sb-messages-grid tbody tr td:nth-child(3)').allInnerTexts(), ['Update of account', 'Update of account'], 'linked to the loaded step');
            await popup.locator('.sb-only-steps input').uncheck();
            assertEqual(await popup.locator('.sb-messages-grid tbody tr').count(), 3, 'all the messages of the queue');
            await shot(page, '09-messages-step');
            await page.evaluate(() => (window.__peekDelay = 4000));
            await popup.locator('.sb-read-messages').click();
            await page.waitForTimeout(200);
            assertEqual(await popup.locator('.sb-read-messages').innerText(), 'Stop', 'the button becomes Stop');
            await popup.locator('.sb-read-messages').click();
            await page.waitForTimeout(300);
            assertEqual(await popup.locator('.sb-read-messages').innerText(), 'Read active messages', 'stopped');
            await popup.locator('button', { hasText: /^Close$/ }).last().click();

            await rowsOf(page, '.sb-steps-grid').filter({ hasText: 'Old quotes' }).first().click();
            await page.fill('.sb-card .sb-search input', 'lead');
            await rowsOf(page, '.sb-steps-grid').filter({ hasText: 'crm-quote-events' }).click();
            await page.locator('.sb-steps-messages').click();
            assert((await takeDialog(page)).includes('crm-quote-events'), 'missing queue explained');
        });

        await test('Microsoft account with the Azure CLI (ToolBox terminal): discovery and load through Resource Manager', async (page, state) => {
            await open(page);
            await page.locator('.sb-header button', { hasText: 'Azure connections' }).click();
            await page.locator('[role=tab]', { hasText: 'Microsoft account' }).click();
            await page.locator('.sb-use-cli').click();
            await page.waitForSelector('.sb-found-grid');
            assert((await page.locator('.sb-found-grid').innerText()).includes('contoso-arm.servicebus.windows.net'), 'namespace found');
            const commands = (await calls(page, 'terminal.execute')).map((c) => c[1]);
            assert(commands.every((c) => c.startsWith('az account get-access-token --resource https://management.azure.com/')), 'az command: ' + commands);
            assert((await calls(page, 'terminal.create')).every((c) => c[2] === false), 'hidden terminal');
            await page.locator('.sb-connections-dialog button', { hasText: 'Add the selected namespaces' }).click();
            await page.locator('.sb-connections-dialog button', { hasText: /^Close$/ }).last().click();
            await load(page);
            await node(page, 'arm-queue');
            assertEqual((await tiles(page))[0], '9', 'read through ARM');
            await node(page, 'contoso-arm');
            await tab(page, 'Properties').click();
            assert((await page.locator('.sb-props').innerText()).includes('West Europe'), 'location from ARM');
            assert(state.armRequests.every(([, auth]) => auth === 'Bearer az-token'), 'bearer token');
        });

        await test('Azure CLI missing: readable message', async (page) => {
            await open(page, { __azMissing: true });
            await page.locator('.sb-header button', { hasText: 'Azure connections' }).click();
            await page.locator('[role=tab]', { hasText: 'Microsoft account' }).click();
            await page.locator('.sb-use-cli').click();
            await page.waitForTimeout(400);
            assert((await page.locator('.sb-connections-status').innerText()).includes('The Azure CLI is not installed'), 'message');
        });

        await test('Load errors: a refused namespace is an error on its node, Stop and Esc', async (page, state) => {
            await open(page);
            await addConnectionString(page);
            state.refuse = true;
            await load(page);
            const pills = await page.locator('.sb-node', { hasText: 'contoso-crm' }).first().locator('.sb-pill').allInnerTexts();
            assert(pills.includes('Error'), 'error pill: ' + pills);
            assert((await page.locator('.sb-summary').innerText()).includes('1 namespace(s) in error'), 'summary');
            await node(page, 'contoso-crm');
            await page.locator('.sb-detail-alert button', { hasText: 'Details' }).click();
            assert((await page.locator('.sb-text-viewer').innerText()).includes('InvalidSignature'), 'details of the refusal');
            await page.locator('.sb-text-viewer button', { hasText: 'Close' }).last().click();
            assertEqual(await tab(page, 'Steps').locator('.sb-badge').first().innerText(), '11', 'steps stay available');
            state.refuse = false;

            state.delay = 800;
            await page.locator('.sb-load').click();
            await page.waitForSelector('.sb-busy');
            await page.locator('.sb-stop').click();
            await idle(page);
            assert((await page.locator('.sb-summary').innerText()).includes('Stopped'), 'Stop');
            await page.locator('.sb-load').click();
            await page.waitForSelector('.sb-busy');
            await page.keyboard.press('Escape');
            await idle(page);
            assert((await page.locator('.sb-summary').innerText()).includes('Stopped'), 'Esc stops');
            state.delay = 0;
        });

        await test('Dataverse refuses a write: error shown, the screen shows the real state', async (page) => {
            await loaded(page);
            await page.evaluate(() => (window.__dvRefuse = { update: 'SecLib::AccessCheckEx failed. prvWriteSdkMessageProcessingStep' }));
            await tab(page, 'Steps').click();
            await rowsOf(page, '.sb-steps-grid').filter({ hasText: 'name,telephone1,creditlimit' }).click();
            await page.locator('.sb-card button', { hasText: /^Disable$/ }).click();
            await page.locator('.sb-confirm').click();
            await page.waitForSelector('.sb-message-dialog');
            assert((await page.locator('.sb-message-dialog').innerText()).includes('prvWriteSdkMessageProcessingStep'), 'privilege in the message');
            await takeDialog(page);
            await idle(page);
            assert((await page.locator('.sb-summary').innerText()).includes('0 of 1 step(s) updated before the error'), 'partial result');
        });

        await test('Export: Excel workbook saved through the ToolBox', async (page) => {
            await open(page);
            await page.locator('.sb-header button', { hasText: 'Export' }).click();
            assert((await takeDialog(page)).includes('Click Load first'), 'export before load');
            await addConnectionString(page);
            await load(page);
            await page.locator('.sb-header button', { hasText: 'Export' }).click();
            await page.waitForTimeout(300);
            const files = await page.evaluate(() => window.__mock.savedFiles);
            assert(/^ServiceBus Explorer \d{4}-\d\d-\d\d \d\d-\d\d\.xlsx$/.test(files[0].name), 'file name ' + files[0].name);
            assertEqual(files[0].bytes.slice(0, 2), [0x50, 0x4b], 'a zip (xlsx)');
            assert((await takeDialog(page)).includes('The report was saved'), 'done');
        });

        await test('Options and language', async (page) => {
            await loaded(page);
            await page.locator('.sb-header button', { hasText: 'Options' }).click();
            await page.fill('.sb-option-messages input', '250');
            await page.locator('.sb-option-messages input').press('Tab');
            await page.fill('.sb-option-tenant input', ' contoso.onmicrosoft.com ');
            await dialog(page).locator('button', { hasText: 'Save' }).click();
            const saved = await page.evaluate(() => window.__mock.settingsStore.settings);
            assertEqual([saved.maxMessages, saved.tenantId, saved.parallelRequests], [250, 'contoso.onmicrosoft.com', 6], 'options saved and trimmed');

            await page.locator('.sb-header button', { hasText: 'English' }).click();
            await page.locator('[role=menuitemradio]', { hasText: 'Français' }).click();
            await page.waitForTimeout(100);
            assert(await page.locator('.sb-header button', { hasText: 'Charger' }).count(), 'French header');
            await node(page, 'crm-account-events');
            assert(await tab(page, 'Steps Dataverse').count(), 'French tabs');
            await tab(page, 'Messages').click();
            assert((await page.locator('.sb-read-messages').innerText()) === 'Lire les messages actifs', 'French messages');
            assertEqual(await page.evaluate(() => window.__mock.settingsStore.settings.language), 'fr', 'language saved');
            await shot(page, '10-explorer-french');
        });

        await test('Help, links and dark theme', async (page) => {
            await open(page, { __mockTheme: 'dark' });
            assert(await page.locator('.sb-theme-dark').count(), 'dark class');
            const background = await page.evaluate(() => getComputedStyle(document.querySelector('.sb-card')).backgroundColor);
            assert(background !== 'rgb(255, 255, 255)', 'dark cards, got ' + background);
            await page.locator('.sb-header button', { hasText: 'Help' }).click();
            assert((await page.locator('.sb-text-viewer').innerText()).includes('6. MESSAGES'), 'help text');
            await page.locator('.sb-text-viewer button', { hasText: 'Close' }).last().click();
        });

        await test('The real AMQP client runs in the browser bundle (WebSockets): an unreachable namespace is a readable error', async (page) => {
            // No traffic leaves the test: the WebSocket of the SDK is answered here and closed.
            const sockets = [];
            await page.routeWebSocket(/servicebus\.windows\.net/, (ws) => {
                sockets.push(ws.url());
                ws.close({ code: 1011, reason: 'test' });
            });
            await loaded(page);
            // The real reader: without the hook of the mock, the tool uses @azure/service-bus.
            await page.evaluate(() => delete window.__SBX_E2E__);
            await node(page, 'crm-account-events');
            await tab(page, 'Messages').click();
            await page.locator('.sb-read-messages').click();
            await idle(page);
            const alert = await page.locator('.sb-messages-alert').innerText();
            assert(alert.includes('could not be read'), 'error strip: ' + alert);
            assert(sockets.length > 0 && sockets.every((u) => u.startsWith(`wss://${Host}`) && u.includes('$servicebus/websocket')), 'AMQP over WebSockets on the namespace: ' + sockets);
        });
    } finally {
        await browser.close();
        await new Promise((resolve) => server.httpServer.close(resolve));
    }

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
    if (failed.length) {
        console.log(`Screenshots of failures: ${shotsDir}`);
        process.exitCode = 1;
    }
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
