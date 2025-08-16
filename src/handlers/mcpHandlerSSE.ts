/**
 * 扩展的MCP处理器，支持SSE（Server-Sent Events）传输模式
 * 基于现有的McpHandler，添加JSON-RPC 2.0协议支持
 */

import { Context } from 'hono';
import { 
  Env, 
  JsonRpcMessage, 
  McpInitializeRequest, 
  McpInitializeResponse,
  McpListToolsRequest,
  McpListToolsResponse,
  McpCallToolRequest,
  McpCallToolResponse,
  McpErrorResponse,
  McpErrorCode,
  SSEEventType
} from '../types';
import { McpHandler } from './mcpHandler';
import { SSETransport } from '../transports/sseTransport';
import { SSESessionManager } from '../session/sessionManager';

export class McpHandlerSSE extends McpHandler {
  
  /**
   * 处理SSE连接建立
   */
  async handleSSEConnection(c: Context): Promise<Response> {
    try {
      // 提取客户端信息
      const clientInfo = {
        userAgent: c.req.header('User-Agent'),
        ip: c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'
      };

      // 创建会话
      const sessionId = SSESessionManager.createSession(clientInfo);
      
      // 获取CORS来源
      const corsOrigin = this.getCorsOrigin(c);
      
      // 创建SSE传输实例
      const transport = new SSETransport(sessionId);
      
      // 添加到会话管理器
      SSESessionManager.addSession(sessionId, transport, clientInfo);
      
      // 创建SSE响应
      const response = transport.createResponse(corsOrigin);
      
      console.log(`SSE连接建立成功: session=${sessionId}, client=${clientInfo.ip}`);
      
      return response;
    } catch (error) {
      console.error('SSE连接建立失败:', error);
      return this.createErrorResponse('SSE连接失败', 500);
    }
  }

  /**
   * 处理通过POST发送的客户端消息（SSE双向通信中的上行通道）
   */
  async handleSSEMessage(c: Context): Promise<Response> {
    try {
      const sessionId = c.req.param('sessionId');
      
      if (!sessionId) {
        return this.createErrorResponse('缺少会话ID', 400);
      }

      const session = SSESessionManager.getSession(sessionId);
      
      if (!session) {
        return this.createErrorResponse('会话不存在或已过期', 404);
      }

      // 解析JSON-RPC消息
      let message: JsonRpcMessage;
      try {
        message = await c.req.json();
      } catch (error) {
        console.error('解析JSON-RPC消息失败:', error);
        const errorResponse = this.createJsonRpcError(null, McpErrorCode.ParseError, '解析JSON失败');
        await session.sendMessage(errorResponse);
        return new Response(null, { status: 204 });
      }

      // 验证JSON-RPC格式
      if (!this.isValidJsonRpcMessage(message)) {
        const errorResponse = this.createJsonRpcError(message.id, McpErrorCode.InvalidRequest, '无效的JSON-RPC请求格式');
        await session.sendMessage(errorResponse);
        return new Response(null, { status: 204 });
      }

      // 处理不同类型的JSON-RPC消息
      let response: JsonRpcMessage | null = null;
      
      if (message.method === 'initialize') {
        response = await this.handleInitializeSSE(message as McpInitializeRequest, c);
      } else if (message.method === 'tools/list') {
        response = await this.handleListToolsSSE(message as McpListToolsRequest);
      } else if (message.method === 'tools/call') {
        response = await this.handleCallToolSSE(message as McpCallToolRequest);
      } else if (message.method === 'notifications/initialized') {
        // 初始化完成通知，无需响应
        console.log(`客户端初始化完成: session=${sessionId}`);
        return new Response(null, { status: 204 });
      } else if (message.method === 'ping') {
        // 心跳检测
        response = {
          jsonrpc: '2.0',
          id: message.id,
          result: { pong: true, timestamp: new Date().toISOString() }
        };
      } else {
        response = this.createJsonRpcError(
          message.id, 
          McpErrorCode.MethodNotFound, 
          `未知方法: ${message.method}`
        );
      }

      // 通过SSE发送响应（如果有响应的话）
      if (response) {
        await session.sendMessage(response);
      }
      
      return new Response(null, { status: 204 });
    } catch (error) {
      console.error('SSE消息处理失败:', error);
      return this.createErrorResponse('消息处理失败', 500);
    }
  }

  /**
   * 获取SSE会话状态
   */
  async handleSSESessionStatus(c: Context): Promise<Response> {
    try {
      const sessionId = c.req.param('sessionId');
      
      if (!sessionId) {
        return this.createErrorResponse('缺少会话ID', 400);
      }

      const session = SSESessionManager.getSession(sessionId);
      const exists = !!session;
      
      return c.json({
        exists,
        sessionId,
        timestamp: new Date().toISOString(),
        stats: exists ? session!.getStats() : null
      });
    } catch (error) {
      console.error('获取SSE会话状态失败:', error);
      return this.createErrorResponse('获取会话状态失败', 500);
    }
  }

  /**
   * SSE模式下的初始化处理
   */
  private async handleInitializeSSE(request: McpInitializeRequest, c: Context): Promise<McpInitializeResponse> {
    const serverInfo = {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      },
      serverInfo: {
        name: c.env.MCP_SERVER_NAME || 'Mail Webhook MCP Server',
        version: c.env.MCP_SERVER_VERSION || '1.0.0'
      }
    };

    console.log(`MCP初始化: client=${request.params.clientInfo.name} v${request.params.clientInfo.version}`);

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: serverInfo
    };
  }

  /**
   * SSE模式下的工具列表处理
   */
  private async handleListToolsSSE(message: McpListToolsRequest): Promise<McpListToolsResponse> {
    try {
      const tools = await this.toolRegistry.listTools();
      
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          tools: tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema
          }))
        }
      };
    } catch (error) {
      console.error('获取工具列表失败:', error);
      throw error;
    }
  }

  /**
   * SSE模式下的工具调用处理
   */
  private async handleCallToolSSE(message: McpCallToolRequest): Promise<McpCallToolResponse | McpErrorResponse> {
    try {
      if (!message.params?.name) {
        return this.createJsonRpcError(message.id, McpErrorCode.InvalidParams, '缺少工具名称');
      }

      const { name, arguments: args = {} } = message.params;
      
      // 调用工具
      const result = await this.toolRegistry.callTool(name, args);
      
      // 构建MCP响应
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [
            {
              type: 'text',
              text: this.formatToolResult(result)
            }
          ],
          isError: !result.success
        }
      };
    } catch (error) {
      console.error('工具调用失败:', error);
      return this.createJsonRpcError(
        message.id,
        McpErrorCode.InternalError,
        '工具调用失败',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * 验证JSON-RPC消息格式
   */
  private isValidJsonRpcMessage(message: any): message is JsonRpcMessage {
    return message && 
           message.jsonrpc === '2.0' && 
           (message.method !== undefined || message.result !== undefined || message.error !== undefined);
  }

  /**
   * 创建JSON-RPC错误响应
   */
  private createJsonRpcError(
    id: string | number | null | undefined, 
    code: McpErrorCode, 
    message: string, 
    data?: any
  ): McpErrorResponse {
    return {
      jsonrpc: '2.0',
      id: id || null,
      error: {
        code,
        message,
        ...(data && { data })
      }
    };
  }

  /**
   * 广播消息到所有SSE会话
   */
  async broadcastToAllSessions(message: any): Promise<{ sent: number; failed: number }> {
    try {
      const sentCount = await SSESessionManager.broadcastToAll(message);
      const stats = SSESessionManager.getSessionStats();
      
      return {
        sent: sentCount,
        failed: stats.active - sentCount
      };
    } catch (error) {
      console.error('广播消息失败:', error);
      return { sent: 0, failed: 1 };
    }
  }

  /**
   * 向特定会话发送消息
   */
  async sendToSession(sessionId: string, message: any): Promise<boolean> {
    try {
      const session = SSESessionManager.getSession(sessionId);
      if (!session) {
        return false;
      }

      await session.sendMessage(message);
      return true;
    } catch (error) {
      console.error(`向会话 ${sessionId} 发送消息失败:`, error);
      return false;
    }
  }

  /**
   * 发送心跳到所有会话
   */
  async sendHeartbeatToAll(): Promise<{ sent: number; failed: number }> {
    try {
      const sentCount = await SSESessionManager.sendHeartbeatToAll();
      const stats = SSESessionManager.getSessionStats();
      
      return {
        sent: sentCount,
        failed: stats.active - sentCount
      };
    } catch (error) {
      console.error('发送心跳失败:', error);
      return { sent: 0, failed: 1 };
    }
  }

  /**
   * 获取所有会话统计信息
   */
  getSessionStats() {
    return SSESessionManager.getSessionStats();
  }

  /**
   * 清理过期会话
   */
  cleanupExpiredSessions(): number {
    return SSESessionManager.cleanupExpiredSessions();
  }

  /**
   * 获取SSE健康状态
   */
  getSSEHealthCheck() {
    return SSESessionManager.healthCheck();
  }
}