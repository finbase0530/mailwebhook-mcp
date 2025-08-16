import { Context } from 'hono';
import { Env } from '../types';

export class AuthManager {
  private env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  // 验证 MCP API 令牌（强制要求）
  verifyApiToken(token: string | null): boolean {
    // 强制要求配置 MCP_API_TOKEN
    if (!this.env.MCP_API_TOKEN) {
      console.error('MCP_API_TOKEN 未配置，这是必需的安全配置');
      return false;
    }

    if (!token) {
      return false;
    }

    // 支持 Bearer token 格式
    const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
    return cleanToken === this.env.MCP_API_TOKEN;
  }

  // 检查是否需要认证（考虑配置选项）
  isAuthRequired(): boolean {
    return this.env.AUTH_REQUIRED !== 'false'; // 默认启用
  }

  // 从请求中提取认证令牌
  extractToken(c: Context): string | null {
    const authHeader = c.req.header('Authorization');
    if (authHeader) {
      return authHeader;
    }

    // 也支持从查询参数中获取
    const tokenParam = c.req.query('token');
    if (tokenParam) {
      return `Bearer ${tokenParam}`;
    }

    return null;
  }

  // 验证请求来源
  verifyOrigin(origin: string | undefined): boolean {
    if (!origin) {
      return true; // 允许无 Origin 的请求（如 Postman）
    }

    const allowedOrigins = this.env.CORS_ORIGINS;
    
    // 如果配置为 "*"，允许所有来源
    if (allowedOrigins === '*') {
      return true;
    }

    // 检查是否在允许的来源列表中
    const origins = allowedOrigins.split(',').map(o => o.trim());
    return origins.includes(origin) || origins.includes('*');
  }

  // 生成安全的错误响应
  createUnauthorizedResponse(): Response {
    return new Response(
      JSON.stringify({
        error: '认证失败',
        message: '无效的 API 令牌',
        code: 'UNAUTHORIZED'
      }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'WWW-Authenticate': 'Bearer realm="MCP Server"'
        }
      }
    );
  }

  // 生成禁止访问的错误响应
  createForbiddenResponse(): Response {
    return new Response(
      JSON.stringify({
        error: '访问被禁止',
        message: '请求来源不被允许',
        code: 'FORBIDDEN'
      }),
      {
        status: 403,
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        }
      }
    );
  }

  // 生成配置缺失的错误响应
  createConfigurationErrorResponse(): Response {
    return new Response(
      JSON.stringify({
        error: '服务配置错误',
        message: '缺少必需的安全配置，服务无法启动',
        code: 'CONFIGURATION_ERROR'
      }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        }
      }
    );
  }
}