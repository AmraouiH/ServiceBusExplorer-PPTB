import { Buffer } from 'buffer';

/**
 * The AMQP engine of the Azure SDK (rhea) uses the Node Buffer as soon as it loads, and reads process.env:
 * both are provided before anything else is imported (see main.tsx).
 */
const g = globalThis as any;
g.Buffer ??= Buffer;
g.process ??= { env: {} };
g.process.env ??= {};
