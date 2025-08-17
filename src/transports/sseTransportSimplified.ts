/**
 * 简化的SSE传输层实现
 * 适配Cloudflare Workers环境限制，避免跨请求I/O对象共享
 */

import { JsonRpcMessage, McpErrorCode } from '../types';

export interface SSEConfig {
  heartbeatInterval?: number;
  timeout?: number;
  corsOrigin?: string;
}

export class SSETransportSimplified {
  private encoder = new TextEncoder();
  private eventId = 0;
  private config: SSEConfig;

  constructor(config: SSEConfig = {}) {
    this.config = {
      heartbeatInterval: 30000, // 30秒心跳
      timeout: 300000, // 5分钟超时
      corsOrigin: '*',
      ...config
    };
  }

  /**
   * 创建SSE响应，包含完整的MCP协议处理逻辑
   */
  createMcpSSEResponse(
    request: Request,
    toolRegistry: any,
    env: any
  ): Response {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();

    // 启动SSE处理逻辑
    this.handleMcpSSESession(request, writer, toolRegistry, env).catch(error => {
      console.error('SSE会话处理错误:', error);
    });

    return new Response(readable, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': this.config.corsOrigin!,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Last-Event-ID',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Max-Age': '86400',
        'X-Mcp-Transport': 'sse-simplified'
      }
    });
  }

  /**
   * 处理MCP SSE会话的完整生命周期
   */
  private async handleMcpSSESession(
    request: Request,
    writer: WritableStreamDefaultWriter<Uint8Array>,
    toolRegistry: any,
    env: any
  ): Promise<void> {
    const url = new URL(request.url);
    const sessionId = crypto.randomUUID();
    
    try {
      // 发送连接建立事件
      await this.writeEvent(writer, 'connected', {
        sessionId,
        timestamp: new Date().toISOString(),
        supportedMethods: ['initialize', 'tools/list', 'tools/call', 'ping'],
        instructions: 'Send JSON-RPC messages via URL parameters: ?method=<method>&params=<json-encoded-params>&id=<id>'
      });

      // 检查是否有初始消息要处理
      const method = url.searchParams.get('method');
      if (method) {
        await this.processUrlMessage(url, writer, toolRegistry, env);
      }

      // 设置心跳和超时
      const heartbeatTimer = setInterval(() => {
        this.writeEvent(writer, 'heartbeat', {
          timestamp: new Date().toISOString(),
          sessionId
        }).catch(error => {
          console.error('心跳发送失败:', error);
          clearInterval(heartbeatTimer);
        });
      }, this.config.heartbeatInterval);

      // 设置会话超时
      const timeoutTimer = setTimeout(() => {
        this.writeEvent(writer, 'timeout', {
          message: '会话超时',
          sessionId,
          timestamp: new Date().toISOString()
        }).then(() => {
          writer.close();
        }).catch(error => {
          console.error('超时处理失败:', error);
        }).finally(() => {
          clearInterval(heartbeatTimer);
        });
      }, this.config.timeout);

      // 监听连接关闭（在实际使用中，这需要根据客户端断开来触发）
      // 在当前的简化实现中，我们依赖超时机制

    } catch (error) {
      console.error('SSE会话初始化失败:', error);
      await this.writeEvent(writer, 'error', {
        type: 'session_error',
        message: error instanceof Error ? error.message : '会话初始化失败',
        timestamp: new Date().toISOString()
      });
      writer.close();
    }
  }

  /**
   * 处理通过URL参数传递的消息
   */
  private async processUrlMessage(
    url: URL,
    writer: WritableStreamDefaultWriter<Uint8Array>,
    toolRegistry: any,
    env: any
  ): Promise<void> {
    try {
      const method = url.searchParams.get('method');
      const paramsStr = url.searchParams.get('params');
      const id = url.searchParams.get('id') || this.eventId++;

      if (!method) {
        await this.writeJsonRpcError(writer, id, McpErrorCode.InvalidRequest, '缺少method参数');
        return;
      }

      // 解析参数
      let params: any = {};
      if (paramsStr) {
        try {
          params = JSON.parse(decodeURIComponent(paramsStr));
        } catch (error) {
          await this.writeJsonRpcError(writer, id, McpErrorCode.ParseError, '参数解析失败');
          return;
        }
      }

      // 构建JSON-RPC消息
      const message: JsonRpcMessage = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      // 处理不同的方法
      let response: JsonRpcMessage;

      switch (method) {
        case 'initialize':
          response = await this.handleInitialize(message, env);
          break;
        case 'tools/list':
          response = await this.handleListTools(message, toolRegistry);
          break;
        case 'tools/call':
          response = await this.handleCallTool(message, toolRegistry);
          break;
        case 'ping':
          response = {
            jsonrpc: '2.0',
            id: message.id,
            result: { pong: true, timestamp: new Date().toISOString() }
          };
          break;
        default:
          response = {
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: McpErrorCode.MethodNotFound,
              message: `未知方法: ${method}`
            }
          };
      }

      // 发送响应
      await this.writeEvent(writer, 'message', response);

    } catch (error) {
      console.error('URL消息处理失败:', error);
      await this.writeEvent(writer, 'error', {
        type: 'message_error',
        message: error instanceof Error ? error.message : '消息处理失败',
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * 处理MCP初始化
   */
  private async handleInitialize(message: JsonRpcMessage, env: any): Promise<JsonRpcMessage> {
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
          name: env.MCP_SERVER_NAME || 'Mail Webhook MCP Server',
          version: env.MCP_SERVER_VERSION || '1.0.0'
        }
      }
    };
  }

  /**
   * 处理工具列表请求
   */
  private async handleListTools(message: JsonRpcMessage, toolRegistry: any): Promise<JsonRpcMessage> {
    try {
      const tools = await toolRegistry.listTools();
      
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          tools: tools.map((tool: any) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema
          }))
        }
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: McpErrorCode.InternalError,
          message: '获取工具列表失败',
          data: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  /**
   * 处理工具调用请求
   */
  private async handleCallTool(message: JsonRpcMessage, toolRegistry: any): Promise<JsonRpcMessage> {
    try {
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
      
      // 调用工具
      const result = await toolRegistry.callTool(name, args);
      
      // 格式化结果
      const formattedResult = this.formatToolResult(result);
      
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [
            {
              type: 'text',
              text: formattedResult
            }
          ],
          isError: !result.success
        }
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: McpErrorCode.InternalError,
          message: '工具调用失败',
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
   * 写入SSE事件
   */
  private async writeEvent(
    writer: WritableStreamDefaultWriter<Uint8Array>,
    type: string,
    data: any,
    id?: string
  ): Promise<void> {
    const eventId = id || (++this.eventId).toString();
    const eventData = JSON.stringify(data);
    
    const sseMessage = [
      `event: ${type}`,
      `id: ${eventId}`,
      `data: ${eventData}`,
      '', // 空行结束事件
      ''
    ].join('\n');

    await writer.write(this.encoder.encode(sseMessage));
  }

  /**
   * 写入JSON-RPC错误响应
   */
  private async writeJsonRpcError(
    writer: WritableStreamDefaultWriter<Uint8Array>,
    id: any,
    code: McpErrorCode,
    message: string,
    data?: any
  ): Promise<void> {
    const errorResponse: JsonRpcMessage = {
      jsonrpc: '2.0',
      id: id || null,
      error: {
        code,
        message,
        ...(data && { data })
      }
    };

    await this.writeEvent(writer, 'message', errorResponse);
  }
}