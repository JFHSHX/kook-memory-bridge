export function createMcpHandler(toolDefinitions, { name = 'kook-memory-bridge', version = '0.2.0' } = {}) {
  const tools = new Map(toolDefinitions.map(def => [def.name, def]));
  return async function handle(message) {
    const { id, method, params } = message || {};
    const response = (result, error) => error
      ? { jsonrpc: '2.0', id: id ?? null, error }
      : { jsonrpc: '2.0', id: id ?? null, result };
    try {
      if (method === 'initialize') {
        return response({
          protocolVersion: params?.protocolVersion || '2025-03-26',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name, version },
          instructions: 'KOOK encrypted memory with Hindsight-style retain/recall/reflect/observations/mental models.',
        });
      }
      if (method === 'ping') return response({});
      if (method === 'tools/list') {
        return response({
          tools: [...tools.values()].map(def => ({
            name: def.name, description: def.description || '',
            inputSchema: def.parameters || { type: 'object', properties: {} },
          })),
        });
      }
      if (method === 'tools/call') {
        const tool = tools.get(params?.name);
        if (!tool) return response(null, { code: -32602, message: `未知工具: ${params?.name}` });
        try {
          const result = await tool.execute(params?.arguments || {});
          const rendered = tool.output?.render?.(params?.arguments || {}, result);
          return response({
            content: rendered || [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent: result,
            isError: false,
          });
        } catch (error) {
          return response({
            content: [{ type: 'text', text: String(error?.message || error) }],
            isError: true,
          });
        }
      }
      if (String(method || '').startsWith('notifications/')) return null;
      return response(null, { code: -32601, message: `不支持的方法: ${method}` });
    } catch (error) {
      return response(null, { code: -32603, message: String(error?.message || error) });
    }
  };
}
