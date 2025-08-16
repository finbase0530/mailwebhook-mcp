/**
 * SSE（Server-Sent Events）传输层实现
 * 为MCP协议提供基于SSE的实时通信能力
 */

export interface SSEEventData {
  type: string;
  data: any;
  id?: string;
  retry?: number;
}

export class SSETransport {
  private controller: ReadableStreamController<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private sessionId: string;
  private clientEndpoint: string;
  private closed = false;
  private lastEventId = 0;

  constructor(sessionId: string, baseUrl?: string) {
    this.sessionId = sessionId;
    this.clientEndpoint = `${baseUrl || ''}/mcp/sse/${sessionId}/messages`;
  }

  /**
   * 创建SSE响应流
   */
  createResponse(corsOrigin: string = '*'): Response {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    this.writer = writable.getWriter();

    // 立即发送连接建立事件
    this.sendConnectionEvent().catch(console.error);

    return new Response(readable, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // 禁用代理缓冲
        'Access-Control-Allow-Origin': corsOrigin,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Last-Event-ID',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Max-Age': '86400',
        'Mcp-Session-Id': this.sessionId,
        'Mcp-Transport': 'sse'
      }
    });
  }

  /**
   * 发送连接建立事件
   */
  private async sendConnectionEvent(): Promise<void> {
    await this.sendEvent('endpoint', {
      uri: this.clientEndpoint,
      sessionId: this.sessionId,
      transport: 'sse',
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 发送SSE事件
   */
  async sendEvent(type: string, data: any, id?: string, retry?: number): Promise<void> {
    if (this.closed || !this.writer) {
      console.warn(`尝试向已关闭的SSE连接发送事件: ${type}`);
      return;
    }

    try {
      const eventId = id || (++this.lastEventId).toString();
      const eventData = JSON.stringify(data);
      
      let sseMessage = '';
      
      if (retry !== undefined) {
        sseMessage += `retry: ${retry}\n`;
      }
      
      sseMessage += `event: ${type}\n`;
      sseMessage += `id: ${eventId}\n`;
      sseMessage += `data: ${eventData}\n\n`;

      const encoder = new TextEncoder();
      await this.writer.write(encoder.encode(sseMessage));
    } catch (error) {
      console.error('发送SSE事件失败:', error);
      // 连接可能已断开，标记为关闭
      this.closed = true;
      throw error;
    }
  }

  /**
   * 发送MCP JSON-RPC消息
   */
  async sendMessage(message: any): Promise<void> {
    await this.sendEvent('message', message);
  }

  /**
   * 发送心跳事件
   */
  async sendHeartbeat(): Promise<void> {
    await this.sendEvent('heartbeat', {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId
    });
  }

  /**
   * 发送错误事件
   */
  async sendError(error: any): Promise<void> {
    const errorData = {
      type: 'transport_error',
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId
    };
    
    await this.sendEvent('error', errorData);
  }

  /**
   * 关闭SSE连接
   */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;

    try {
      // 发送关闭事件
      if (this.writer) {
        await this.sendEvent('close', {
          reason: 'server_initiated',
          timestamp: new Date().toISOString(),
          sessionId: this.sessionId
        });
        
        await this.writer.close();
        this.writer = null;
      }
    } catch (error) {
      console.error('关闭SSE连接时发生错误:', error);
    }
  }

  /**
   * 检查连接是否已关闭
   */
  isClosed(): boolean {
    return this.closed;
  }

  /**
   * 获取会话ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * 获取客户端消息端点
   */
  getClientEndpoint(): string {
    return this.clientEndpoint;
  }

  /**
   * 获取连接统计信息
   */
  getStats(): { sessionId: string; lastEventId: number; closed: boolean; endpoint: string } {
    return {
      sessionId: this.sessionId,
      lastEventId: this.lastEventId,
      closed: this.closed,
      endpoint: this.clientEndpoint
    };
  }
}