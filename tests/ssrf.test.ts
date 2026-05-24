import { mock } from 'bun:test';
import path from 'node:path';
import dns from 'node:dns';

// Mock @agendajs/mongo-backend globally to completely suppress any MongoBackend connection attempts
mock.module('@agendajs/mongo-backend', () => {
  return {
    MongoBackend: class {
      constructor() {}
      async connect() {
        return this;
      }
      async database() {
        return {
          collection: () => ({
            findOne: () => Promise.resolve(null),
            find: () => ({
              toArray: () => Promise.resolve([]),
            }),
            insertOne: () => Promise.resolve({}),
            updateOne: () => Promise.resolve({}),
            createIndex: () => Promise.resolve({}),
          }),
        };
      }
    }
  };
});

// Mock agenda globally using all possible path permutations to guarantee resolution matching
const mockAgenda = {
  define: () => {},
  on: () => {},
  start: async () => {},
  schedule: async () => {},
  now: async () => {},
  cancel: async () => {},
};

const agendaPath = path.resolve(import.meta.dir, '../src/@lib/queue/agenda');
const pathsToMock = [
  agendaPath,
  `${agendaPath}.ts`,
  agendaPath.replace(/\\/g, '/'),
  `${agendaPath.replace(/\\/g, '/')}.ts`,
  agendaPath.toLowerCase(),
  `${agendaPath.toLowerCase()}.ts`,
  '../src/@lib/queue/agenda.ts',
  '../src/@lib/queue/agenda',
  '@lib/queue/agenda',
];

for (const p of pathsToMock) {
  mock.module(p, () => ({
    agenda: mockAgenda
  }));
}

// Silence background MongoDB connection rejections during offline unit tests
process.on('unhandledRejection', (reason) => {
  const reasonStr = String(reason);
  if (reasonStr.includes('mongodb') || reasonStr.includes('ECONNREFUSED') || reasonStr.includes('querySrv')) {
    return; // Silently swallow background connection failures
  }
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  const errStr = String(err);
  if (errStr.includes('mongodb') || errStr.includes('ECONNREFUSED') || errStr.includes('querySrv')) {
    return; // Silently swallow background connection failures
  }
  console.error('Uncaught Exception:', err);
});

import { describe, it, expect } from 'bun:test';
import { isSafeUrl } from '../src/@lib/utils/ssrf';

describe('SSRF Guard isSafeUrl Helper Tests', () => {
  it('should enforce https:// scheme only', async () => {
    // Valid domain but insecure scheme
    expect(await isSafeUrl('http://google.com')).toBe(false);
    expect(await isSafeUrl('ftp://google.com')).toBe(false);
    expect(await isSafeUrl('gopher://google.com')).toBe(false);
    expect(await isSafeUrl('http://1.1.1.1')).toBe(false);

    // Secure scheme
    expect(await isSafeUrl('https://google.com')).toBe(true);
  });

  it('should reject known cloud metadata hostnames', async () => {
    expect(await isSafeUrl('https://metadata.google.internal')).toBe(false);
    expect(await isSafeUrl('https://metadata')).toBe(false);
    expect(await isSafeUrl('https://my-server.local')).toBe(false);
  });

  it('should reject IPv4 loopback and link-local ranges', async () => {
    // Loopback
    expect(await isSafeUrl('https://127.0.0.1')).toBe(false);
    expect(await isSafeUrl('https://127.255.0.1')).toBe(false);
    expect(await isSafeUrl('https://localhost')).toBe(false);

    // Link-local / AWS metadata IP
    expect(await isSafeUrl('https://169.254.169.254')).toBe(false);
    expect(await isSafeUrl('https://169.254.1.2')).toBe(false);
  });

  it('should reject RFC 1918 Private IPv4 address spaces', async () => {
    // 10.0.0.0/8
    expect(await isSafeUrl('https://10.0.0.1')).toBe(false);
    expect(await isSafeUrl('https://10.255.255.255')).toBe(false);

    // 172.16.0.0/12
    expect(await isSafeUrl('https://172.16.0.1')).toBe(false);
    expect(await isSafeUrl('https://172.31.255.255')).toBe(false);

    // 192.168.0.0/16
    expect(await isSafeUrl('https://192.168.0.1')).toBe(false);
    expect(await isSafeUrl('https://192.168.255.254')).toBe(false);
  });

  it('should reject reserved and unspecified IPv4 addresses', async () => {
    expect(await isSafeUrl('https://0.0.0.0')).toBe(false);
    expect(await isSafeUrl('https://224.0.0.1')).toBe(false); // Multicast
    expect(await isSafeUrl('https://255.255.255.255')).toBe(false); // Broadcast
  });

  it('should reject unsafe IPv6 addresses', async () => {
    // Loopback & Unspecified
    expect(await isSafeUrl('https://[::1]')).toBe(false);
    expect(await isSafeUrl('https://[::]')).toBe(false);

    // Link-local fe80::/10
    expect(await isSafeUrl('https://[fe80::1]')).toBe(false);
    expect(await isSafeUrl('https://[febf::ffff]')).toBe(false);

    // Unique Local Addresses fc00::/7
    expect(await isSafeUrl('https://[fc00::1]')).toBe(false);
    expect(await isSafeUrl('https://[fd00:ec2::254]')).toBe(false); // AWS metadata IPv6

    // Multicast ff00::/8
    expect(await isSafeUrl('https://[ff02::1]')).toBe(false);
  });

  it('should allow secure, public domains and IP addresses', async () => {
    expect(await isSafeUrl('https://google.com')).toBe(true);
    expect(await isSafeUrl('https://github.com')).toBe(true);
    expect(await isSafeUrl('https://1.1.1.1')).toBe(true); // Public Cloudflare DNS
    expect(await isSafeUrl('https://8.8.8.8')).toBe(true); // Public Google DNS
  });

  it('should handle malformed URLs gracefully', async () => {
    expect(await isSafeUrl('not-a-url')).toBe(false);
    expect(await isSafeUrl('')).toBe(false);
    expect(await isSafeUrl('https://')).toBe(false);
  });
});
