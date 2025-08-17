/**
 * MCP Streamable HTTP 传输处理器
 * 符合 MCP 2024-11-05 协议标准
 */

import { Context } from 'hono';
import { Env, JsonRpcMessage, McpErrorCode } from '../types';
import { McpHandler } from './mcpHandler';

export class McpStreamableHttpHandler extends McpHandler {
  private sessions = new Map<string, { createdAt: number; lastActivity: number }>();
  private readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30 分钟

  /**
   * 处理 MCP Streamable HTTP 端点
   * 支持 POST (客户端到服务器) 和 GET (SSE 流)
   */
  async handleStreamableHttp(c: Context): Promise<Response> {
    const method = c.req.method;
    
    try {
      // 验证 Origin 头 (安全要求)
      if (!this.validateOrigin(c)) {
        return this.createErrorResponse('无效的请求来源', 403);
      }

      if (method === 'POST') {
        return await this.handleHttpPost(c);
      } else if (method === 'GET') {
        return await this.handleHttpGet(c);
      } else {
        return this.createErrorResponse('不支持的 HTTP 方法', 405);
      }
    } catch (error) {
      console.error('Streamable HTTP 处理错误:', error);
      return this.createErrorResponse('服务器内部错误', 500);
    }
  }

  /**
   * 处理 HTTP POST 请求 (客户端到服务器消息)
   */
  private async handleHttpPost(c: Context): Promise<Response> {
    try {
      // 验证 Content-Type
      const contentType = c.req.header('Content-Type');
      if (!contentType?.includes('application/json')) {
        return this.createJsonRpcErrorResponse(null, McpErrorCode.InvalidRequest, '必须使用 application/json');
      }

      // 解析请求体
      const body = await c.req.json();
      
      // 处理单个消息或批量消息
      if (Array.isArray(body)) {
        // 批量 JSON-RPC 请求
        const responses = await Promise.all(
          body.map(message => this.processJsonRpcMessage(message, c))
        );
        return c.json(responses.filter(r => r !== null));
      } else {
        // 单个 JSON-RPC 请求
        const response = await this.processJsonRpcMessage(body, c);
        if (response === null) {
          // 通知消息，无需响应
          return new Response(null, { status: 204 });
        }
        return c.json(response);
      }
    } catch (error) {
      console.error('POST 请求处理错误:', error);
      return this.createJsonRpcErrorResponse(
        null, 
        McpErrorCode.ParseError, 
        '请求解析失败'
      );
    }
  }

  /**
   * 处理 HTTP GET 请求 (SSE 流)
   */
  private async handleHttpGet(c: Context): Promise<Response> {
    // 检查 Accept 头
    const accept = c.req.header('Accept');
    if (!accept?.includes('text/event-stream')) {
      return this.createErrorResponse(
        '必须在 Accept 头中包含 text/event-stream', 
        406
      );
    }

    // 获取或创建会话
    const sessionId = this.getOrCreateSession(c);
    
    // 创建 SSE 响应
    return this.createSSEResponse(c, sessionId);
  }

  /**
   * 处理 JSON-RPC 消息
   */
  private async processJsonRpcMessage(
    message: any, 
    c: Context
  ): Promise<JsonRpcMessage | null> {
    // 验证 JSON-RPC 格式
    if (!message || message.jsonrpc !== '2.0') {
      return this.createJsonRpcError(
        message?.id || null,
        McpErrorCode.InvalidRequest,
        '无效的 JSON-RPC 格式'
      );
    }

    // 处理通知 (无 id 字段)
    if (message.id === undefined) {
      // 通知消息，处理但不返回响应
      await this.handleNotification(message, c);
      return null;
    }

    // 处理请求
    try {
      switch (message.method) {
        case 'initialize':
          return await this.handleInitializeMethod(message, c);
        case 'tools/list':
          return await this.handleListToolsMethod(message, c);
        case 'tools/call':
          return await this.handleCallToolMethod(message, c);
        case 'ping':
          return this.createPingResponse(message);
        default:
          return this.createJsonRpcError(
            message.id,
            McpErrorCode.MethodNotFound,
            `未知方法: ${message.method}`
          );
      }
    } catch (error) {
      console.error(`方法 ${message.method} 处理错误:`, error);
      return this.createJsonRpcError(
        message.id,
        McpErrorCode.InternalError,
        '方法执行失败',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * 处理 initialize 方法
   */
  private async handleInitializeMethod(
    message: JsonRpcMessage,
    c: Context
  ): Promise<JsonRpcMessage> {
    const sessionId = this.getOrCreateSession(c);
    
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
          resources: {},
          prompts: {}
        },
        serverInfo: {
          name: c.env.MCP_SERVER_NAME || 'Mail Webhook MCP Server',
          version: c.env.MCP_SERVER_VERSION || '1.0.0'
        },
        sessionId: sessionId
      }
    };
  }

  /**
   * 处理 tools/list 方法
   */
  private async handleListToolsMethod(
    message: JsonRpcMessage,
    c: Context
  ): Promise<JsonRpcMessage> {
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
      return this.createJsonRpcError(
        message.id,
        McpErrorCode.InternalError,
        '获取工具列表失败',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * 处理 tools/call 方法
   */
  private async handleCallToolMethod(
    message: JsonRpcMessage,
    c: Context
  ): Promise<JsonRpcMessage> {
    if (!message.params?.name) {
      return this.createJsonRpcError(
        message.id,
        McpErrorCode.InvalidParams,
        '缺少工具名称'
      );
    }

    try {
      const { name, arguments: args = {} } = message.params;
      
      // 调用工具
      const result = await this.toolRegistry.callTool(name, args);
      
      // 格式化结果为 MCP 标准格式
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
      return this.createJsonRpcError(
        message.id,
        McpErrorCode.InternalError,
        '工具调用失败',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * 创建 ping 响应
   */
  private createPingResponse(message: JsonRpcMessage): JsonRpcMessage {
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: { 
        pong: true, 
        timestamp: new Date().toISOString() 
      }
    };
  }

  /**
   * 处理通知消息
   */
  private async handleNotification(message: any, c: Context): Promise<void> {
    // 通知消息处理逻辑（如果需要）
    console.log('收到通知消息:', message.method);
  }

  /**
   * 创建 SSE 响应
   */
  private createSSEResponse(c: Context, sessionId: string): Response {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // 启动 SSE 会话
    this.startSSESession(writer, encoder, sessionId, c).catch(error => {
      console.error('SSE 会话错误:', error);
    });

    return new Response(readable, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': this.getCorsOrigin(c),
        'Access-Control-Allow-Headers': 'Accept, Authorization, Content-Type, Last-Event-ID',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Max-Age': '86400',
        'X-Mcp-Transport': 'streamable-http',
        'X-Mcp-Protocol-Version': '2024-11-05'
      }
    });
  }

  /**
   * 启动 SSE 会话
   */
  private async startSSESession(
    writer: WritableStreamDefaultWriter<Uint8Array>,
    encoder: TextEncoder,
    sessionId: string,
    c: Context
  ): Promise<void> {
    let eventId = 0;

    try {
      // 发送连接建立事件
      await this.writeSSEEvent(writer, encoder, {
        event: 'connected',
        id: (++eventId).toString(),
        data: {
          sessionId,
          protocolVersion: '2024-11-05',
          serverInfo: {
            name: c.env.MCP_SERVER_NAME || 'Mail Webhook MCP Server',
            version: c.env.MCP_SERVER_VERSION || '1.0.0'
          },
          timestamp: new Date().toISOString()
        }
      });

      // 启动心跳
      const heartbeatInterval = setInterval(async () => {
        try {
          await this.writeSSEEvent(writer, encoder, {
            event: 'heartbeat',
            id: (++eventId).toString(),
            data: {
              timestamp: new Date().toISOString(),
              sessionId
            }
          });
        } catch (error) {
          console.error('心跳发送失败:', error);
          clearInterval(heartbeatInterval);
        }
      }, 30000); // 30秒心跳

      // 设置会话超时
      setTimeout(() => {
        this.writeSSEEvent(writer, encoder, {
          event: 'timeout',
          id: (++eventId).toString(),
          data: {
            message: '会话超时',
            sessionId,
            timestamp: new Date().toISOString()
          }
        }).then(() => {
          writer.close();
        }).catch(error => {
          console.error('超时处理失败:', error);
        }).finally(() => {
          clearInterval(heartbeatInterval);
          this.cleanupSession(sessionId);
        });
      }, this.SESSION_TIMEOUT);

    } catch (error) {
      console.error('SSE 会话启动失败:', error);
      await this.writeSSEEvent(writer, encoder, {
        event: 'error',
        data: {
          type: 'session_error',
          message: error instanceof Error ? error.message : '会话启动失败',
          timestamp: new Date().toISOString()
        }
      });
      writer.close();
    }
  }

  /**
   * 写入 SSE 事件
   */
  private async writeSSEEvent(
    writer: WritableStreamDefaultWriter<Uint8Array>,
    encoder: TextEncoder,
    event: {
      event?: string;
      id?: string;
      data: any;
      retry?: number;
    }
  ): Promise<void> {
    const lines: string[] = [];

    if (event.event) {
      lines.push(`event: ${event.event}`);
    }

    if (event.id) {
      lines.push(`id: ${event.id}`);
    }

    if (event.retry !== undefined) {
      lines.push(`retry: ${event.retry}`);
    }

    const dataStr = JSON.stringify(event.data);
    lines.push(`data: ${dataStr}`);
    lines.push(''); // 空行结束事件

    const message = lines.join('\n') + '\n';
    await writer.write(encoder.encode(message));
  }

  /**
   * 获取或创建会话
   */
  private getOrCreateSession(c: Context): string {
    const existingSessionId = c.req.header('X-Mcp-Session-Id');
    
    if (existingSessionId && this.sessions.has(existingSessionId)) {
      // 更新会话活动时间
      const session = this.sessions.get(existingSessionId)!;
      session.lastActivity = Date.now();
      return existingSessionId;
    }

    // 创建新会话
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, {
      createdAt: Date.now(),
      lastActivity: Date.now()
    });

    return sessionId;
  }

  /**
   * 清理过期会话
   */
  private cleanupSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * 验证 Origin 头
   */
  private validateOrigin(c: Context): boolean {
    const origin = c.req.header('Origin');
    
    // 如果没有 Origin 头，允许通过（可能是非浏览器客户端）
    if (!origin) {
      return true;
    }

    // 检查是否为本地请求
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return true;
    }

    // 检查配置的 CORS 来源
    const allowedOrigins = c.env.CORS_ORIGINS;
    if (allowedOrigins === '*') {
      return true;
    }

    const origins = allowedOrigins.split(',').map(o => o.trim());
    return origins.includes(origin) || origins.includes('*');
  }

  /**
   * 创建 JSON-RPC 错误对象
   */
  private createJsonRpcError(
    id: any,
    code: McpErrorCode,
    message: string,
    data?: any
  ): JsonRpcMessage {
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
   * 创建 JSON-RPC 错误响应
   */
  private createJsonRpcErrorResponse(
    id: any,
    code: McpErrorCode,
    message: string,
    data?: any
  ): Response {
    return new Response(
      JSON.stringify(this.createJsonRpcError(id, code, message, data)),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        }
      }
    );
  }

  /**
   * 格式化工具调用结果
   */
  private formatToolResult(result: any): string {
    if (result.success) {
      if (result.data) {
        if (Array.isArray(result.data)) {
          return `操作成功，返回 ${result.data.length} 项结果:\n${JSON.stringify(result.data, null, 2)}`;
        } else if (typeof result.data === 'object') {
          return `操作成功:\n${JSON.stringify(result.data, null, 2)}`;
        } else {
          return `操作成功: ${result.data}`;
        }
      } else {
        return result.message || '操作成功完成';
      }
    } else {
      return `错误: ${result.error || '未知错误'}`;
    }
  }

  /**
   * 获取会话统计信息
   */
  getSessionStats(): {
    activeSessions: number;
    totalSessions: number;
    oldestSession?: string;
  } {
    return {
      activeSessions: this.sessions.size,
      totalSessions: this.sessions.size,
      oldestSession: this.sessions.size > 0 ? 
        Array.from(this.sessions.keys())[0] : undefined
    };
  }

  /**
   * 清理所有过期会话
   */
  cleanupExpiredSessions(): number {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActivity > this.SESSION_TIMEOUT) {
        this.sessions.delete(sessionId);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }
}