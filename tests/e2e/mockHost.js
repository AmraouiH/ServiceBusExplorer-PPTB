/*
 * In-memory Dataverse + ToolBox host used by the end-to-end tests. Injected in the page before the tool loads.
 * It mimics the Power Platform ToolBox desktop app (queryData / create / update / delete, settings, terminal, files)
 * and the Dataverse Web API for what the tool reads: service endpoints, steps (FetchXML with a link-entity alias),
 * images, messages, message filters and columns. Writes are validated (@odata.bind navigation properties, types),
 * and any additionalHeaders argument is recorded as a violation (it would trigger a consent prompt in the ToolBox).
 * The same demo organization as the XrmToolBox tests (tests/ServiceBusExplorer.Tests/SampleData.cs).
 */
(() => {
    const FV = '@OData.Community.Display.V1.FormattedValue';
    const guid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
    const clone = (v) => JSON.parse(JSON.stringify(v));
    const calls = [];
    const violations = [];
    const notifications = [];
    const savedFiles = [];
    const settingsStore = {};
    const delay = () => new Promise((r) => setTimeout(r, window.__mockDelay ?? 5));
    const Host = 'contoso-crm.servicebus.windows.net';

    // #region Organization

    const messages = { Update: guid(9001), Create: guid(9002), Delete: guid(9003), Assign: guid(9004), RetrieveMultiple: guid(9005) };
    const filters = [];
    let next = 100;
    for (const table of ['account', 'contact', 'invoice', 'opportunity', 'lead']) {
        for (const [name, id] of Object.entries(messages)) {
            if (name === 'RetrieveMultiple') continue;
            filters.push({ sdkmessagefilterid: guid(next++), message: id, table });
        }
    }
    filters.push({ sdkmessagefilterid: guid(next++), message: messages.RetrieveMultiple, table: 'none' });
    const filterOf = (message, table) => filters.find((f) => f.message === messages[message] && f.table === table).sdkmessagefilterid;

    const endpoints = [];
    const endpoint = (name, contract, address, path) => {
        const id = guid(next++);
        endpoints.push({ serviceendpointid: id, name, contract, namespaceaddress: address, path, saskeyname: 'dataverse-send', authtype: 2, messageformat: 2, ismanaged: false, description: null });
        return id;
    };
    const steps = [];
    const images = [];
    const step = (ep, message, table, stage, mode, filtering, extra = {}) => {
        const id = guid(next++);
        steps.push({
            sdkmessageprocessingstepid: id,
            name: `${message} of ${table}`,
            description: null,
            eventhandler: ep,
            sdkmessageid: messages[message],
            sdkmessagefilterid: filterOf(message, table),
            stage,
            mode,
            rank: extra.rank ?? 1,
            statecode: extra.enabled === false ? 1 : 0,
            statuscode: extra.enabled === false ? 2 : 1,
            filteringattributes: filtering,
            asyncautodelete: true,
            ismanaged: !!extra.managed,
            iscustomizable: { Value: !extra.managed, CanBeChanged: true },
        });
        return id;
    };
    const image = (stepId, alias, type, attributes) =>
        images.push({ sdkmessageprocessingstepimageid: guid(next++), name: alias, entityalias: alias, imagetype: type, attributes, messagepropertyname: 'Target', sdkmessageprocessingstepid: stepId });

    const address = `sb://${Host}/`;
    const account = endpoint('Account events', 2, address, 'crm-account-events');
    const invoice = endpoint('Invoice events', 6, address, '/crm-invoice-events/');
    const contact = endpoint('Contact changes', 5, address, 'CRM-Contact-Changes');
    const won = endpoint('Opportunity won', 5, address, 'crm-opportunity-won');
    endpoint('ERP outbound (unused)', 2, address, 'erp-outbound');
    const missing = endpoint('Old quotes queue', 2, address, 'crm-quote-events');
    const kind = endpoint('Wrong kind', 2, address, 'wrong-kind');
    const legacy = endpoint('Legacy billing', 5, 'sb://contoso-legacy.servicebus.windows.net/', 'billing-events');
    endpoint('Teams webhook', 8, null, null);

    const s1 = step(account, 'Update', 'account', 40, 1, 'name,telephone1,creditlimit');
    image(s1, 'PreImage', 0, 'name,telephone1,creditlimit');
    image(s1, 'PostImage', 1, null);
    image(step(account, 'Create', 'account', 40, 1, null), 'PostImage', 1, 'name,accountnumber');
    step(invoice, 'Update', 'invoice', 40, 1, 'statuscode,totalamount');
    step(contact, 'Create', 'contact', 40, 1, null);
    image(step(contact, 'Update', 'contact', 40, 1, 'emailaddress1,donotbulkemail,statecode', { rank: 2 }), 'PreImage', 0, 'emailaddress1');
    step(contact, 'Delete', 'contact', 40, 0, null, { enabled: false });
    step(contact, 'Assign', 'contact', 40, 1, null, { managed: true });
    step(won, 'Update', 'opportunity', 40, 1, 'statuscode');
    step(missing, 'Create', 'lead', 40, 1, null);
    step(kind, 'Update', 'lead', 40, 1, 'statuscode');
    step(legacy, 'Update', 'invoice', 40, 1, 'paymenttermscode');

    const columns = {
        account: [
            ['name', 'Account Name', 'String'],
            ['telephone1', 'Main Phone', 'String'],
            ['creditlimit', 'Credit Limit', 'Money'],
            ['accountnumber', 'Account Number', 'String'],
            ['emailaddress1', 'Email', 'String'],
            ['primarycontactid', 'Primary Contact', 'Lookup'],
            ['primarycontactidname', 'Primary Contact name', 'String', 'primarycontactid'],
            ['entityimage', 'Entity Image', 'Virtual'],
        ],
        contact: [
            ['fullname', 'Full Name', 'String'],
            ['emailaddress1', 'Email', 'String'],
            ['donotbulkemail', 'Do not allow Bulk Emails', 'Boolean'],
            ['statecode', 'Status', 'State'],
        ],
        invoice: [
            ['statuscode', 'Status Reason', 'Status'],
            ['totalamount', 'Total Amount', 'Money'],
        ],
    };

    const db = { endpoints, steps, images };

    // #endregion

    // #region Web API

    const isGuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v));
    const messageName = (id) => Object.entries(messages).find(([, v]) => v === id)?.[0];

    function fetchValues(xml, attribute) {
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        const condition = [...doc.getElementsByTagName('condition')].find((c) => c.getAttribute('attribute') === attribute);
        if (!condition) throw new Error(`FetchXML without a condition on ${attribute}`);
        return [...condition.getElementsByTagName('value')].map((v) => v.textContent);
    }

    function stepRow(x) {
        const f = filters.find((y) => y.sdkmessagefilterid === x.sdkmessagefilterid);
        return {
            sdkmessageprocessingstepid: x.sdkmessageprocessingstepid,
            name: x.name,
            description: x.description,
            stage: x.stage,
            mode: x.mode,
            rank: x.rank,
            statecode: x.statecode,
            filteringattributes: x.filteringattributes,
            asyncautodelete: x.asyncautodelete,
            ismanaged: x.ismanaged,
            iscustomizable: x.iscustomizable,
            _eventhandler_value: x.eventhandler,
            [`_eventhandler_value${FV}`]: endpoints.find((e) => e.serviceendpointid === x.eventhandler)?.name,
            _sdkmessageid_value: x.sdkmessageid,
            [`_sdkmessageid_value${FV}`]: messageName(x.sdkmessageid),
            _sdkmessagefilterid_value: x.sdkmessagefilterid,
            'f.primaryobjecttypecode': f?.table,
        };
    }

    function getRequest(path) {
        const [resource, query = ''] = path.split('?');
        const params = new URLSearchParams(query);
        const fetchXml = params.get('fetchXml');
        if (resource === 'serviceendpoints') {
            if (!/^\$select=/.test(query)) throw new Error('serviceendpoints without $select');
            return { value: endpoints.map(clone) };
        }
        if (resource === 'sdkmessageprocessingsteps' && fetchXml) {
            if (!fetchXml.includes('alias="f"')) throw new Error('steps without the filter link');
            const ids = fetchValues(fetchXml, 'eventhandler');
            return { value: steps.filter((x) => ids.includes(x.eventhandler)).map(stepRow) };
        }
        if (resource === 'sdkmessageprocessingstepimages' && fetchXml) {
            const ids = fetchValues(fetchXml, 'sdkmessageprocessingstepid');
            return { value: images.filter((x) => ids.includes(x.sdkmessageprocessingstepid)).map((x) => ({ ...clone(x), sdkmessageprocessingstepid: undefined, _sdkmessageprocessingstepid_value: x.sdkmessageprocessingstepid })) };
        }
        if (resource === 'sdkmessages' && fetchXml) {
            if (!fetchXml.includes('distinct="true"')) throw new Error('sdkmessages without distinct');
            return { value: Object.entries(messages).map(([name, id]) => ({ sdkmessageid: id, name })) };
        }
        if (resource === 'sdkmessagefilters') {
            const match = /_sdkmessageid_value eq ([0-9a-f-]{36})/i.exec(params.get('$filter') ?? '');
            if (!match) throw new Error('sdkmessagefilters without a message');
            return { value: filters.filter((f) => f.message === match[1]).map((f) => ({ sdkmessagefilterid: f.sdkmessagefilterid, primaryobjecttypecode: f.table })) };
        }
        const entity = /^EntityDefinitions\(LogicalName='([^']+)'\)\/Attributes$/.exec(resource);
        if (entity) {
            const list = columns[entity[1]];
            if (!list) throw new Error(`Could not find an entity with name ${entity[1]}`);
            return {
                value: list.map(([logical, display, type, of]) => ({ LogicalName: logical, DisplayName: { UserLocalizedLabel: { Label: display } }, AttributeType: type, IsValidForRead: true, AttributeOf: of ?? null })),
            };
        }
        throw new Error(`Unexpected query: ${path}`);
    }

    const stepAttributes = { stage: 'number', mode: 'number', rank: 'number', filteringattributes: 'string|null', asyncautodelete: 'boolean', name: 'string', description: 'string|null', statecode: 'number', statuscode: 'number' };
    const imageAttributes = { name: 'string', entityalias: 'string', imagetype: 'number', attributes: 'string|null', messagepropertyname: 'string|null' };

    function checkTypes(table, record, allowed) {
        for (const [key, value] of Object.entries(record)) {
            if (key.endsWith('@odata.bind')) continue;
            const expected = allowed[key];
            if (!expected) throw new Error(`'${key}' is not a valid attribute of ${table}`);
            const type = value === null ? 'null' : typeof value;
            if (!expected.split('|').includes(type)) throw new Error(`${table}.${key} expects ${expected}, got ${type}`);
        }
    }

    function bind(value, set) {
        if (value === null) return null;
        const match = new RegExp(`^/${set}\\(([0-9a-f-]{36})\\)$`, 'i').exec(value);
        if (!match) throw new Error(`Invalid @odata.bind ${value}`);
        return match[1];
    }

    const checkHeaders = (method, headers) => {
        if (headers !== undefined) violations.push(`${method} called with additional headers ${JSON.stringify(headers)}`);
    };

    // #endregion

    window.__mock = { db, calls, violations, notifications, savedFiles, settingsStore, guid, messages, filters };

    window.toolboxAPI = {
        settings: {
            get: async (key) => clone(settingsStore[key] ?? window.__seedSettings?.[key] ?? null) ?? undefined,
            set: async (key, value) => {
                settingsStore[key] = clone(value);
            },
            getAll: async () => clone(settingsStore),
            setAll: async (all) => Object.assign(settingsStore, clone(all)),
        },
        utils: {
            getCurrentTheme: async () => window.__mockTheme ?? 'light',
            showNotification: async (n) => notifications.push(n),
            copyToClipboard: async (text) => {
                window.__clipboard = text;
            },
            openInConnectionBrowser: async (url) => calls.push(['openInConnectionBrowser', url]),
            executeParallel: async (...ops) => Promise.all(ops.map((o) => (typeof o === 'function' ? o() : o))),
        },
        connections: {
            getActiveConnection: async () => (window.__noConnection ? null : { id: 'c1', name: 'Contoso Dev', url: 'https://contoso.crm4.dynamics.com', environment: 'Dev' }),
            getConnection: async () => null,
            getConnections: async () => [],
            getSecondaryConnection: async () => null,
        },
        fileSystem: {
            saveFile: async (name, content) => {
                savedFiles.push({ name, bytes: Array.from(content.slice(0, 4)), length: content.length, data: Array.from(content) });
                return `C:\\Users\\me\\Documents\\${name}`;
            },
        },
        terminal: {
            create: async (options) => {
                calls.push(['terminal.create', options.name, options.visible]);
                return { id: 't1', name: options.name };
            },
            execute: async (_id, command) => {
                calls.push(['terminal.execute', command]);
                if (window.__azMissing) return { terminalId: 't1', commandId: 'c', output: "'az' is not recognized as an internal or external command", exitCode: 1 };
                return { terminalId: 't1', commandId: 'c', output: `PS> ${command}\n{\n  "accessToken": "az-token",\n  "expiresOn": "2026-11-04 12:00:00"\n}\n`, exitCode: 0 };
            },
            close: async () => calls.push(['terminal.close']),
            list: async () => [],
        },
        events: { on: () => {}, off: () => {}, getHistory: async () => [] },
        preventClose: async () => {
            calls.push(['preventClose']);
            return true;
        },
        releasePreventClose: async () => {
            calls.push(['releasePreventClose']);
            return true;
        },
        getToolContext: async () => ({ toolId: 'servicebus-explorer', connectionUrl: 'https://contoso.crm4.dynamics.com' }),
    };

    const wrap = async (method, args, action) => {
        calls.push([method, ...args]);
        await delay();
        if (window.__dvRefuse?.[method]) throw new Error(window.__dvRefuse[method]);
        return action();
    };

    window.dataverseAPI = {
        queryData: (path, target, headers) =>
            wrap('queryData', [path], () => {
                checkHeaders('queryData', headers);
                return clone(getRequest(path));
            }),
        update: (table, id, record, target, headers) =>
            wrap('update', [table, id, clone(record)], () => {
                checkHeaders('update', headers);
                if (!isGuid(id)) throw new Error(`update: invalid id ${id}`);
                if (table === 'sdkmessageprocessingstep') {
                    const row = steps.find((x) => x.sdkmessageprocessingstepid === id);
                    if (!row) throw new Error('step not found');
                    checkTypes(table, record, stepAttributes);
                    for (const [key, value] of Object.entries(record)) {
                        if (key === 'sdkmessageid@odata.bind') row.sdkmessageid = bind(value, 'sdkmessages');
                        else if (key === 'sdkmessagefilterid@odata.bind') row.sdkmessagefilterid = bind(value, 'sdkmessagefilters');
                        else if (key.endsWith('@odata.bind')) throw new Error(`Unknown navigation property ${key}`);
                        else row[key] = value;
                    }
                    return;
                }
                if (table === 'sdkmessageprocessingstepimage') {
                    const row = images.find((x) => x.sdkmessageprocessingstepimageid === id);
                    if (!row) throw new Error('image not found');
                    checkTypes(table, record, imageAttributes);
                    Object.assign(row, record);
                    return;
                }
                throw new Error(`update of ${table} is not expected`);
            }),
        create: (table, record, target, headers) =>
            wrap('create', [table, clone(record)], () => {
                checkHeaders('create', headers);
                if (table !== 'sdkmessageprocessingstepimage') throw new Error(`create of ${table} is not expected`);
                const { ['sdkmessageprocessingstepid@odata.bind']: owner, ...rest } = record;
                checkTypes(table, rest, imageAttributes);
                const stepId = bind(owner, 'sdkmessageprocessingsteps');
                if (!steps.some((x) => x.sdkmessageprocessingstepid === stepId)) throw new Error('step of the image not found');
                const id = guid(next++);
                images.push({ ...rest, sdkmessageprocessingstepimageid: id, sdkmessageprocessingstepid: stepId });
                return { id };
            }),
        delete: (table, id, target, headers) =>
            wrap('delete', [table, id], () => {
                checkHeaders('delete', headers);
                if (table !== 'sdkmessageprocessingstepimage') throw new Error(`delete of ${table} is not expected`);
                const index = images.findIndex((x) => x.sdkmessageprocessingstepimageid === id);
                if (index < 0) throw new Error('image not found');
                images.splice(index, 1);
            }),
    };

    // #region Messages (the tests cannot open AMQP WebSockets: the reader asks this hook)

    window.__mockMessages = window.__mockMessages ?? {};
    window.__peekCalls = [];
    if (!window.__realAmqp) {
        window.__SBX_E2E__ = {
            peek: async (host, path, max) => {
                window.__peekCalls.push(`${host}/${path}`);
                const wait = window.__peekDelay ?? 0;
                for (let waited = 0; waited < wait; waited += 50) await new Promise((r) => setTimeout(r, 50));
                if (window.__peekError) throw window.__peekError();
                const list = (window.__mockMessages[`${host}/${path}`] ?? []).slice(0, max);
                return list.map((m, i) => ({
                    sequenceNumber: m.sequenceNumber ?? i + 1,
                    messageId: m.messageId ?? `msg-${i + 1}`,
                    contentType: m.contentType,
                    enqueuedOn: new Date(Date.UTC(2026, 10, 3, 9, i, 0)),
                    deliveryCount: m.deliveryCount ?? 0,
                    properties: [['http://schemas.microsoft.com/xrm/2011/Claims/EntityLogicalName', m.table ?? 'account']],
                    body: m.body,
                    bodyText: '',
                }));
            },
        };
    }

    // #endregion
})();
