#!/usr/bin/env node
// errdown-mcp: an MCP server with one tool, `fetch`. Success returns the page (HTML converted to
// Markdown); any failure returns one line (~20 tokens) saying what failed and whether to retry,
// instead of an HTML dump.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fetchTool } from "./fetchTool.ts";

const server = new McpServer({ name: "errdown-mcp", version: "0.1.0-alpha.2" });

server.registerTool(
  "fetch",
  {
    title: "Fetch URL",
    description:
      "Fetch a URL and return its content as Markdown. If the request fails (HTTP error, bot challenge, " +
      "DNS/TLS/connection failure), returns one line saying what failed and whether to retry, e.g. " +
      "'Error: HTTP 503 upstream_unavailable (nginx). Retryable: wait 5s, then retry (attempt 1 of 3); if it " +
      "keeps failing, tell the user.' Follow it: retry only when it says retryable; never try to bypass a challenge.",
    inputSchema: {
      url: z.string().describe("The http(s) URL to fetch"),
      max_length: z.number().int().positive().max(1_000_000).optional().describe("Max characters to return (default 20000)"),
      start_index: z.number().int().min(0).optional().describe("Start at this character, to continue truncated content"),
      raw: z.boolean().optional().describe("Return raw HTML instead of Markdown"),
    },
  },
  async (args) => {
    const r = await fetchTool(args);
    return { content: [{ type: "text", text: r.text }], isError: r.isError };
  },
);

await server.connect(new StdioServerTransport());
