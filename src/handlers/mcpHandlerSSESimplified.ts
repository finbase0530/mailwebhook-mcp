/**
 * 简化的MCP SSE处理器
 * 适配Cloudflare Workers环境，避免跨请求状态共享
 */

import { Context } from 'hono';
import { Env } from '../types';
import { McpHandler } from './mcpHandler';
import { SSETransportSimplified } from '../transports/sseTransportSimplified';

export class McpHandlerSSESimplified extends McpHandler {
  
  /**
   * 处理简化的SSE连接
   * 所有逻辑都在单个请求中完成，避免跨请求状态共享
   */
  async handleSimplifiedSSEConnection(c: Context): Promise<Response> {
    try {
      // 获取CORS来源
      const corsOrigin = this.getCorsOrigin(c);
      
      // 创建简化的SSE传输实例
      const transport = new SSETransportSimplified({
        corsOrigin,
        heartbeatInterval: 30000, // 30秒心跳
        timeout: 300000 // 5分钟超时
      });
      
      // 创建包含完整MCP协议处理的SSE响应
      const response = transport.createMcpSSEResponse(
        c.req.raw,
        this.toolRegistry,
        c.env
      );
      
      console.log(`简化SSE连接建立成功, client=${this.getClientInfo(c)}`);
      
      return response;
    } catch (error) {
      console.error('简化SSE连接建立失败:', error);
      return this.createErrorResponse('SSE连接失败', 500);
    }
  }

  /**
   * 处理SSE状态查询（无状态）
   */
  async handleSSEStatus(c: Context): Promise<Response> {
    try {
      return c.json({
        transport: 'sse-simplified',
        status: 'stateless',
        description: 'SSE连接是无状态的，每个连接都是独立的',
        usage: {
          connect: 'GET /mcp/sse?token=your-token',
          sendMessage: 'GET /mcp/sse?token=your-token&method=<method>&params=<json>&id=<id>',
          examples: [
            '/mcp/sse?token=your-token&method=initialize&params={"protocolVersion":"2024-11-05","clientInfo":{"name":"Test","version":"1.0"}}&id=1',
            '/mcp/sse?token=your-token&method=tools/list&id=2',
            '/mcp/sse?token=your-token&method=tools/call&params={"name":"send_email","arguments":{"to":"test@example.com","subject":"Test"}}&id=3'
          ]
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('获取SSE状态失败:', error);
      return this.createErrorResponse('获取状态失败', 500);
    }
  }

  /**
   * 处理SSE健康检查
   */
  async handleSSEHealthCheck(c: Context): Promise<Response> {
    try {
      return c.json({
        status: 'healthy',
        transport: 'sse-simplified',
        features: [
          'Real-time event streaming',
          'JSON-RPC 2.0 protocol support',
          'URL parameter message passing',
          'Automatic heartbeat',
          'Session timeout protection'
        ],
        limitations: [
          'Stateless (no cross-request state)',
          'URL parameter message size limits',
          'Single request lifecycle'
        ],
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('SSE健康检查失败:', error);
      return this.createErrorResponse('健康检查失败', 500);
    }
  }

  /**
   * 获取客户端信息
   */
  private getClientInfo(c: Context): string {
    const ip = c.req.header('CF-Connecting-IP') || 
              c.req.header('X-Forwarded-For') || 
              'unknown';
    const userAgent = c.req.header('User-Agent') || 'unknown';
    return `${ip} (${userAgent.substring(0, 50)})`;
  }

  /**
   * 创建SSE使用说明响应
   */
  async handleSSEInstructions(c: Context): Promise<Response> {
    const baseUrl = new URL(c.req.url).origin;
    
    return c.json({
      title: 'MCP SSE 简化模式使用说明',
      transport: 'sse-simplified',
      description: '通过Server-Sent Events提供实时MCP协议支持',
      
      authentication: {
        method: 'URL parameter',
        parameter: 'token',
        example: `${baseUrl}/mcp/sse?token=your-api-token`
      },

      messageFormat: {
        description: '通过URL参数发送JSON-RPC消息',
        parameters: {
          method: '必需 - JSON-RPC方法名',
          params: '可选 - JSON编码的参数对象',
          id: '可选 - 请求标识符'
        }
      },

      supportedMethods: [
        {
          method: 'initialize',
          description: '初始化MCP连接',
          example: `${baseUrl}/mcp/sse?token=your-token&method=initialize&params=${encodeURIComponent('{"protocolVersion":"2024-11-05","clientInfo":{"name":"Client","version":"1.0"}}')}&id=1`
        },
        {
          method: 'tools/list',
          description: '获取可用工具列表',
          example: `${baseUrl}/mcp/sse?token=your-token&method=tools/list&id=2`
        },
        {
          method: 'tools/call',
          description: '调用工具',
          example: `${baseUrl}/mcp/sse?token=your-token&method=tools/call&params=${encodeURIComponent('{"name":"send_email","arguments":{"to":"test@example.com","subject":"Test"}}')}}&id=3`
        },
        {
          method: 'ping',
          description: '心跳检测',
          example: `${baseUrl}/mcp/sse?token=your-token&method=ping&id=4`
        }
      ],

      events: {
        connected: '连接建立事件',
        message: 'JSON-RPC响应消息',
        heartbeat: '心跳事件',
        timeout: '会话超时事件',
        error: '错误事件'
      },

      clientImplementation: {
        javascript: {
          basic: `
const eventSource = new EventSource('${baseUrl}/mcp/sse?token=your-token');

eventSource.addEventListener('connected', (event) => {
  console.log('Connected:', JSON.parse(event.data));
});

eventSource.addEventListener('message', (event) => {
  const response = JSON.parse(event.data);
  console.log('Response:', response);
});

eventSource.addEventListener('error', (event) => {
  console.error('Error:', JSON.parse(event.data));
});
          `,
          withMessages: `
// Send a message by opening a new EventSource with parameters
function sendMessage(method, params, id) {
  const url = new URL('${baseUrl}/mcp/sse');
  url.searchParams.set('token', 'your-token');
  url.searchParams.set('method', method);
  if (params) url.searchParams.set('params', JSON.stringify(params));
  if (id) url.searchParams.set('id', id.toString());
  
  const eventSource = new EventSource(url.toString());
  
  eventSource.addEventListener('message', (event) => {
    const response = JSON.parse(event.data);
    console.log('Response:', response);
    eventSource.close(); // Close after receiving response
  });
  
  return eventSource;
}

// Example usage
sendMessage('tools/list', null, 1);
sendMessage('tools/call', {name: 'send_email', arguments: {to: 'test@example.com'}}, 2);
          `
        }
      },

      limitations: [
        'URL参数长度限制（通常2048字符）',
        '每个消息需要新的SSE连接',
        '不支持持久化会话状态',
        '适合简单的请求-响应模式'
      ],

      timestamp: new Date().toISOString()
    });
  }
}