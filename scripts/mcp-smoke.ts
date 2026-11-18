// Starts the MCP server over stdio, lists its tools and calls two of them.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['tsx', 'src/mcp/server.ts'],
  env: { ...(process.env as Record<string, string>), GRAVEYARD_OFFLINE: process.env.GRAVEYARD_OFFLINE ?? '1' },
});
const client = new Client({ name: 'graveyard-smoke', version: '0.1.0' });
await client.connect(transport);
const { tools } = await client.listTools();
console.log(`tools: ${tools.map((t) => t.name).join(', ')}`);
const call = async (name: string, args: Record<string, unknown>) => {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as Array<{ text: string }>)[0].text;
  return text.startsWith('Error') ? text : JSON.parse(text);
};
const d = await call('graveyard_diagnose', { dir: 'examples/haunted-app', package: 'trim' });
console.log(`graveyard_diagnose(trim): ${d.route}, automated=${d.automated}, recipe=${d.recipe}`);
const a = await call('osv_advisories', { packages: [{ name: 'trim', version: '0.0.1' }] });
console.log(`osv_advisories(trim@0.0.1): ${a['trim@0.0.1'].map((x: { id: string }) => x.id).join(', ')}`);
await client.close();
