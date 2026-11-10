// End-to-end: spawn the built server over stdio and call the tool like a real MCP client.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("MCP: lists fetch tool and returns structured error", async () => {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({ command: "node", args: [new URL("../dist/index.js", import.meta.url).pathname] }));
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((t) => t.name), ["fetch"]);
  const r: any = await client.callTool({ name: "fetch", arguments: { url: "http://127.0.0.1:1/" } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /error_category: upstream_unavailable/);
  await client.close();
});
