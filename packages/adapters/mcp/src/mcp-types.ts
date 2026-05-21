// A minimal subset of the Model Context Protocol tool shapes — only what the
// adapter reads. Not a full MCP type definition.

export type JsonSchema = Record<string, unknown>

export interface McpToolAnnotations {
  title?: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface McpTool {
  name: string
  description?: string
  inputSchema?: JsonSchema
  outputSchema?: JsonSchema
  annotations?: McpToolAnnotations
}

export interface McpContentBlock {
  type: string
  text?: string
}

export interface McpToolResult {
  content?: McpContentBlock[]
  structuredContent?: unknown
  isError?: boolean
}

export type McpCallFn = (
  name: string,
  args: Record<string, unknown>
) => Promise<McpToolResult>

/** The subset of an MCP client this adapter relies on — matches the shape of
 *  the official `@modelcontextprotocol/sdk` Client, so one can be passed
 *  directly without this package depending on the SDK. */
export interface McpClientLike {
  listTools(): Promise<{ tools: McpTool[] }>
  callTool(params: {
    name: string
    arguments?: Record<string, unknown>
  }): Promise<McpToolResult>
}
