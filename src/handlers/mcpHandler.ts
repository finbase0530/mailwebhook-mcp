import { Context } from 'hono';
import { Env, McpTool, McpToolCall, ApiResponse } from '../types';
import { ToolRegistry } from './toolRegistry';

export class McpHandler {
  private toolRegistry: ToolRegistry;

  constructor(env: Env) {
    this.toolRegistry = new ToolRegistry(env);
  }

  // 获取工具注册器（用于管理端点）
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  // 处理 MCP 初始化请求
  async handleInitialize(c: Context): Promise<Response> {
    try {
      const serverInfo = {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: c.env.MCP_SERVER_NAME || "QQ Webhook MCP Server",
          version: c.env.MCP_SERVER_VERSION || "1.0.0"
        }
      };

      return this.createJsonResponse(serverInfo);
    } catch (error) {
      console.error('MCP 初始化失败:', error);
      return this.createErrorResponse('服务器初始化失败', 500);
    }
  }

  // 处理工具列表请求
  async handleListTools(c: Context): Promise<Response> {
    try {
      const tools = await this.toolRegistry.listTools();
      
      const response = {
        tools: tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        }))
      };

      return this.createJsonResponse(response);
    } catch (error) {
      console.error('获取工具列表失败:', error);
      return this.createErrorResponse('获取工具列表失败', 500);
    }
  }

  // 处理工具调用请求
  async handleCallTool(c: Context): Promise<Response> {
    try {
      const body = await c.req.json();
      
      // 验证请求格式
      if (!this.isValidToolCallRequest(body)) {
        return this.createErrorResponse('无效的工具调用请求格式', 400);
      }

      const { name, arguments: args } = body.params;
      
      // 调用工具
      const result = await this.toolRegistry.callTool(name, args);
      
      // 构建 MCP 响应
      const response = {
        content: [
          {
            type: "text",
            text: this.formatToolResult(result)
          }
        ],
        isError: !result.success
      };

      return this.createJsonResponse(response);
    } catch (error) {
      console.error('工具调用失败:', error);
      return this.createErrorResponse('工具调用失败', 500);
    }
  }

  // 处理健康检查
  async handleHealthCheck(c: Context): Promise<Response> {
    return this.createJsonResponse({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      server: c.env.MCP_SERVER_NAME || "QQ Webhook MCP Server",
      version: c.env.MCP_SERVER_VERSION || "1.0.0"
    });
  }

  // 验证工具调用请求格式
  private isValidToolCallRequest(body: any): boolean {
    return body && 
           body.params && 
           typeof body.params.name === 'string' && 
           body.params.arguments !== undefined;
  }

  // 格式化工具结果
  private formatToolResult(result: ApiResponse): string {
    if (result.success) {
      if (result.data) {
        // 如果有具体数据，尝试格式化
        if (Array.isArray(result.data)) {
          return this.formatArrayData(result.data);
        } else if (typeof result.data === 'object') {
          return this.formatObjectData(result.data);
        } else {
          return String(result.data);
        }
      } else {
        return result.message || '操作成功完成';
      }
    } else {
      return `错误: ${result.error || '未知错误'}`;
    }
  }

  // 格式化数组数据
  private formatArrayData(data: any[]): string {
    if (data.length === 0) {
      return '没有找到相关数据';
    }

    // 如果是模板列表
    if (data[0]?.name && data[0]?.subject) {
      return `找到 ${data.length} 个邮件模板:\n\n` +
        data.map((template, index) => 
          `${index + 1}. ${template.name}\n   主题: ${template.subject}\n   描述: ${template.description || '无'}`
        ).join('\n\n');
    }

    // 如果是状态列表
    if (data[0]?.messageId && data[0]?.status) {
      return `邮件状态查询结果 (${data.length} 条):\n\n` +
        data.map((status, index) => 
          `${index + 1}. ${status.messageId}: ${status.status} (${status.timestamp})`
        ).join('\n');
    }

    // 默认格式化
    return JSON.stringify(data, null, 2);
  }

  // 格式化对象数据
  private formatObjectData(data: any): string {
    // 如果是邮件发送结果
    if (data.messageId) {
      return `邮件发送成功!\n消息ID: ${data.messageId}\n状态: ${data.status || '已发送'}`;
    }

    // 如果是模板详情
    if (data.name && data.subject && data.body) {
      let result = `模板详情:\n名称: ${data.name}\n主题: ${data.subject}\n`;
      if (data.variables?.length > 0) {
        result += `变量: ${data.variables.join(', ')}\n`;
      }
      if (data.description) {
        result += `描述: ${data.description}\n`;
      }
      result += `\n模板内容:\n${data.body}`;
      return result;
    }

    // 如果是状态详情
    if (data.messageId && data.status) {
      let result = `邮件状态:\n消息ID: ${data.messageId}\n状态: ${data.status}\n时间: ${data.timestamp}`;
      if (data.error) {
        result += `\n错误: ${data.error}`;
      }
      return result;
    }

    // 默认格式化
    return JSON.stringify(data, null, 2);
  }

  // 创建 JSON 响应
  private createJsonResponse(data: any, status: number = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      }
    });
  }

  // 创建错误响应
  private createErrorResponse(message: string, status: number = 400): Response {
    return this.createJsonResponse({
      error: {
        code: status,
        message
      }
    }, status);
  }

  // 处理 CORS 预检请求
  async handlePreflight(c: Context): Promise<Response> {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': this.getCorsOrigin(c),
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  // 获取 CORS 来源
  private getCorsOrigin(c: Context): string {
    const origin = c.req.header('Origin');
    const allowedOrigins = c.env.CORS_ORIGINS || '*';
    
    if (allowedOrigins === '*') {
      return '*';
    }
    
    const origins = allowedOrigins.split(',').map(o => o.trim());
    if (origin && origins.includes(origin)) {
      return origin;
    }
    
    return origins[0] || '*';
  }
}