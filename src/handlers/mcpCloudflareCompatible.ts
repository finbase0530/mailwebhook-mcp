/**
 * Cloudflare 兼容的 MCP SSE 传输处理器
 * 完全模仿 Cloudflare 官方实现的行为和响应格式
 */

import { Context } from 'hono';
import { Env, JsonRpcMessage, McpErrorCode } from '../types';
import { McpHandler } from './mcpHandler';

export class McpCloudflareCompatibleHandler extends McpHandler {
  private sessions = new Map<string, {
    writer: WritableStreamDefaultWriter<Uint8Array>;
    encoder: TextEncoder;
    createdAt: number;
    lastActivity: number;
  }>();

  /**
   * 处理 SSE 连接端点
   * 完全模仿 Cloudflare 的行为
   */
  async handleSSEConnection(c: Context): Promise<Response> {
    try {
      // 基本认证检查
      const token = c.req.query('token') || c.req.header('Authorization');
      if (!token || (token !== c.env.MCP_API_TOKEN && !token.endsWith(c.env.MCP_API_TOKEN))) {
        return new Response('Unauthorized', { status: 401 });
      }

      // 生成会话ID（32字符十六进制，模仿 Cloudflare）
      const sessionId = crypto.randomUUID().replace(/-/g, '');
      
      // 创建 SSE 流
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      // 存储会话
      this.sessions.set(sessionId, {
        writer,
        encoder,
        createdAt: Date.now(),
        lastActivity: Date.now()
      });

      // 立即发送端点信息
      const endpoint = `/mcp/sse/message?sessionId=${sessionId}`;
      const eventData = `event: endpoint\ndata: ${endpoint}\n\n`;
      
      // 直接写入流
      writer.write(encoder.encode(eventData));

      console.log(`Cloudflare 兼容 SSE 会话创建: ${sessionId}`);

      // 设置超时清理
      setTimeout(() => {
        this.cleanupSession(sessionId);
      }, 10 * 60 * 1000); // 10分钟

      return new Response(readable, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
        }
      });
    } catch (error) {
      console.error('Cloudflare 兼容 SSE 连接失败:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }

  /**
   * 处理消息端点
   * 模仿 Cloudflare 的消息处理
   */
  async handleSSEMessage(c: Context): Promise<Response> {
    try {
      const sessionId = c.req.query('sessionId');
      if (!sessionId) {
        return new Response('Missing sessionId', { status: 400 });
      }

      const session = this.sessions.get(sessionId);
      if (!session) {
        return new Response('Session not found', { status: 404 });
      }

      // 更新活动时间
      session.lastActivity = Date.now();

      // 解析 JSON-RPC 消息
      const message = await c.req.json();
      
      // 处理消息并生成响应
      const response = await this.processJsonRpcMessage(message, c);
      
      // 如果有响应，通过 SSE 发送
      if (response) {
        const eventData = `event: message\ndata: ${JSON.stringify(response)}\n\n`;
        await session.writer.write(session.encoder.encode(eventData));
      }

      // 返回 Accepted（模仿 Cloudflare）
      return new Response('Accepted', { status: 202 });
    } catch (error) {
      console.error('Cloudflare 兼容消息处理失败:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
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
      return {
        jsonrpc: '2.0',
        id: message?.id || null,
        error: {
          code: McpErrorCode.InvalidRequest,
          message: '无效的 JSON-RPC 格式'
        }
      };
    }

    // 处理通知 (无 id 字段)
    if (message.id === undefined) {
      return null;
    }

    try {
      switch (message.method) {
        case 'initialize':
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
              }
            }
          };

        case 'tools/list':
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

        case 'tools/call':
          if (!message.params?.name) {
            return {
              jsonrpc: '2.0',
              id: message.id,
              error: {
                code: McpErrorCode.InvalidParams,
                message: '缺少工具名称'
              }
            };
          }

          const { name, arguments: args = {} } = message.params;
          const result = await this.toolRegistry.callTool(name, args);
          
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

        case 'ping':
          return {
            jsonrpc: '2.0',
            id: message.id,
            result: { 
              pong: true, 
              timestamp: new Date().toISOString() 
            }
          };

        default:
          return {
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: McpErrorCode.MethodNotFound,
              message: `未知方法: ${message.method}`
            }
          };
      }
    } catch (error) {
      console.error(`方法 ${message.method} 处理错误:`, error);
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: McpErrorCode.InternalError,
          message: '方法执行失败',
          data: error instanceof Error ? error.message : String(error)
        }
      };
    }
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
   * 清理会话
   */
  private cleanupSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      try {
        session.writer.close();
      } catch (error) {
        console.error(`关闭会话 ${sessionId} 时出错:`, error);
      }
      this.sessions.delete(sessionId);
      console.log(`Cloudflare 兼容会话已清理: ${sessionId}`);
    }
  }

  /**
   * 获取会话统计信息
   */
  getSessionStats(): {
    activeSessions: number;
    sessions: Array<{ sessionId: string; createdAt: string; lastActivity: string }>;
  } {
    const sessions = Array.from(this.sessions.entries()).map(([sessionId, session]) => ({
      sessionId,
      createdAt: new Date(session.createdAt).toISOString(),
      lastActivity: new Date(session.lastActivity).toISOString()
    }));

    return {
      activeSessions: this.sessions.size,
      sessions
    };
  }

  /**
   * 清理所有过期会话
   */
  cleanupExpiredSessions(): number {
    const now = Date.now();
    const timeout = 10 * 60 * 1000; // 10分钟
    let cleanedCount = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActivity > timeout) {
        this.cleanupSession(sessionId);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }
}