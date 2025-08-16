import { Context, Next } from 'hono';
import { cors } from 'hono/cors';
import { AuthManager } from '../utils/auth';
import { RateLimiter } from '../utils/rateLimiter';
import { SecurityValidator } from '../utils/securityValidator';
import { Env } from '../types';

// 安全中间件配置
export function createSecurityMiddleware(env: Env) {
  const authManager = new AuthManager(env);
  const rateLimiter = new RateLimiter(env);
  
  // 启动时验证安全配置
  const securityValidation = SecurityValidator.validateStartupSecurity(env);
  if (!securityValidation.valid) {
    console.error('安全配置验证失败:');
    securityValidation.errors.forEach(error => console.error(`- ${error}`));
    throw new Error('服务启动失败：安全配置不符合要求');
  }
  
  if (securityValidation.warnings.length > 0) {
    console.warn('安全配置警告:');
    securityValidation.warnings.forEach(warning => console.warn(`- ${warning}`));
  }

  return {
    // CORS 中间件
    cors: cors({
      origin: (origin) => {
        // 如果没有 Origin 头（如直接访问），允许通过
        if (!origin) return true;
        
        return authManager.verifyOrigin(origin);
      },
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      exposeHeaders: ['X-Request-ID', 'X-RateLimit-Remaining'],
      maxAge: 86400, // 24 小时
      credentials: true
    }),

    // 认证中间件
    auth: async (c: Context, next: Next) => {
      const path = c.req.path;
      
      // 定义公开端点（无需认证）
      const publicEndpoints = ['/health', '/'];
      const isPublicEndpoint = publicEndpoints.some(endpoint => path === endpoint);
      const isOptionsRequest = c.req.method === 'OPTIONS';
      
      // 跳过公开端点和预检请求
      if (isPublicEndpoint || isOptionsRequest) {
        await next();
        return;
      }

      // 检查是否需要认证
      if (!authManager.isAuthRequired()) {
        console.warn('认证已被禁用 - 这在生产环境中不安全');
        await next();
        return;
      }

      // 验证必要的安全配置
      if (!env.MCP_API_TOKEN) {
        return authManager.createConfigurationErrorResponse();
      }

      // 检查是否是SSE连接端点
      const isSSEEndpoint = path.startsWith('/mcp/sse') && c.req.method === 'GET';
      
      if (isSSEEndpoint) {
        // 使用SSE专用的认证验证
        const authResult = authManager.verifySSEAuth(c);
        
        if (!authResult.valid) {
          console.warn(`SSE连接认证失败: ${authResult.reason}, path: ${path}`);
          
          // 对于SSE连接，返回特殊的错误响应
          return new Response(
            JSON.stringify({
              error: 'SSE认证失败',
              message: authResult.reason || '认证失败',
              code: 'SSE_AUTH_FAILED',
              hint: 'SSE连接请在URL查询参数中提供token参数，如: ?token=your-api-token'
            }),
            {
              status: 401,
              headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'WWW-Authenticate': 'Bearer realm="MCP SSE Server"'
              }
            }
          );
        }
      } else {
        // 使用标准的认证验证
        const token = authManager.extractToken(c);
        
        // 验证令牌
        if (!authManager.verifyApiToken(token)) {
          return authManager.createUnauthorizedResponse();
        }
      }

      await next();
    },

    // SSE专用的认证中间件
    sseAuth: async (c: Context, next: Next) => {
      // 检查是否需要认证
      if (!authManager.isAuthRequired()) {
        await next();
        return;
      }

      // 使用SSE专用的认证验证
      const authResult = authManager.verifySSEAuth(c);
      
      if (!authResult.valid) {
        console.warn(`SSE认证失败: ${authResult.reason}, path: ${c.req.path}`);
        
        return new Response(
          JSON.stringify({
            error: 'SSE认证失败',
            message: authResult.reason || '认证失败',
            code: 'SSE_AUTH_FAILED',
            hint: 'SSE连接请在URL查询参数中提供token参数，如: ?token=your-api-token'
          }),
          {
            status: 401,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'WWW-Authenticate': 'Bearer realm="MCP SSE Server"'
            }
          }
        );
      }

      await next();
    },

    // 速率限制中间件
    rateLimit: async (c: Context, next: Next) => {
      const path = c.req.path;
      
      // 跳过健康检查端点的速率限制
      if (path === '/health') {
        await next();
        return;
      }
      
      const clientId = c.req.header('CF-Connecting-IP') || 
                      c.req.header('X-Forwarded-For') || 
                      c.req.header('X-Real-IP') ||
                      'unknown';
      
      // 使用端点特定的速率限制
      const result = rateLimiter.isRateLimitedByEndpoint(clientId, path);
      
      if (result.limited) {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json; charset=utf-8',
          'X-RateLimit-Limit': rateLimiter.getEndpointConfig(path).maxRequests?.toString() || '60',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': result.record.resetTime.toString()
        };
        
        if (result.retryAfter) {
          headers['Retry-After'] = result.retryAfter.toString();
        }
        
        return new Response(
          JSON.stringify({
            error: '请求过于频繁',
            message: `您在 ${path} 端点的请求过于频繁，请稍后再试`,
            code: 'RATE_LIMIT_EXCEEDED',
            details: {
              endpoint: path,
              retryAfter: result.retryAfter,
              resetTime: result.record.resetTime
            }
          }),
          {
            status: 429,
            headers
          }
        );
      }
      
      // 添加速率限制头信息
      const status = rateLimiter.getClientStatus(clientId, path);
      c.header('X-RateLimit-Limit', rateLimiter.getEndpointConfig(path).maxRequests?.toString() || '60');
      c.header('X-RateLimit-Remaining', status.remaining.toString());
      c.header('X-RateLimit-Reset', status.resetTime.toString());

      await next();
    },

    // 安全头中间件
    securityHeaders: async (c: Context, next: Next) => {
      await next();
      
      // 添加安全响应头
      c.header('X-Content-Type-Options', 'nosniff');
      c.header('X-Frame-Options', 'DENY');
      c.header('X-XSS-Protection', '1; mode=block');
      c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
      c.header('Content-Security-Policy', "default-src 'self'; script-src 'none'; object-src 'none';");
      
      // 如果是 HTTPS 环境，添加 HSTS 头
      if (c.req.url.startsWith('https://')) {
        c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      }
      
      // 添加请求ID用于追踪
      const requestId = crypto.randomUUID();
      c.header('X-Request-ID', requestId);
    },

    // 请求验证中间件
    requestValidation: async (c: Context, next: Next) => {
      // 检查 Content-Type
      if (c.req.method === 'POST' || c.req.method === 'PUT') {
        const contentType = c.req.header('Content-Type');
        
        if (!contentType || !contentType.includes('application/json')) {
          return new Response(
            JSON.stringify({
              error: '无效的Content-Type',
              message: '请求必须使用 application/json',
              code: 'INVALID_CONTENT_TYPE'
            }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json; charset=utf-8' }
            }
          );
        }
      }

      // 检查请求体大小（防止过大的载荷）
      const contentLength = c.req.header('Content-Length');
      if (contentLength && parseInt(contentLength) > 1024 * 1024) { // 1MB 限制
        return new Response(
          JSON.stringify({
            error: '请求体过大',
            message: '请求体不能超过 1MB',
            code: 'PAYLOAD_TOO_LARGE'
          }),
          {
            status: 413,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          }
        );
      }

      await next();
    },

    // 错误处理中间件
    errorHandler: async (c: Context, next: Next) => {
      try {
        await next();
      } catch (error) {
        console.error('请求处理错误:', error);
        
        // 不泄露敏感错误信息
        const isDevelopment = env.MCP_SERVER_VERSION?.includes('dev') || 
                             c.req.url.includes('localhost');
        
        const errorMessage = isDevelopment 
          ? (error instanceof Error ? error.message : '服务器内部错误')
          : '服务器内部错误';
        
        return new Response(
          JSON.stringify({
            error: '服务器错误',
            message: errorMessage,
            code: 'INTERNAL_SERVER_ERROR',
            requestId: c.req.header('X-Request-ID')
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          }
        );
      }
    },

    // IP 白名单中间件（可选）
    ipWhitelist: (allowedIPs: string[] = []) => {
      return async (c: Context, next: Next) => {
        if (allowedIPs.length === 0) {
          await next();
          return;
        }

        const clientIP = c.req.header('CF-Connecting-IP') || 
                        c.req.header('X-Forwarded-For') || 
                        c.req.header('X-Real-IP');

        if (!clientIP || !allowedIPs.includes(clientIP)) {
          return new Response(
            JSON.stringify({
              error: 'IP 地址不被允许',
              message: '您的 IP 地址无权访问此服务',
              code: 'IP_NOT_ALLOWED'
            }),
            {
              status: 403,
              headers: { 'Content-Type': 'application/json; charset=utf-8' }
            }
          );
        }

        await next();
      };
    },

    // 获取速率限制器实例（用于管理端点）
    getRateLimiter: () => rateLimiter,
    
    // 获取认证管理器实例
    getAuthManager: () => authManager,
    
    // 生成安全状态报告
    getSecurityReport: () => {
      const runtimeSecurity = SecurityValidator.validateRuntimeSecurity(env);
      const rateLimiterHealth = rateLimiter.healthCheck();
      const rateLimiterStats = rateLimiter.getStats();
      
      return {
        timestamp: new Date().toISOString(),
        authentication: {
          required: authManager.isAuthRequired(),
          tokenConfigured: runtimeSecurity.tokenPresent
        },
        rateLimit: {
          enabled: runtimeSecurity.rateLimitActive,
          health: rateLimiterHealth,
          stats: rateLimiterStats
        },
        cors: {
          secure: runtimeSecurity.corsSecure,
          origins: env.CORS_ORIGINS
        }
      };
    }
  };
}