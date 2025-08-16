import { Hono } from 'hono';
import { Env } from './types';
import { McpHandler } from './handlers/mcpHandler';
import { createSecurityMiddleware } from './middleware/security';

// 创建 Hono 应用实例
const app = new Hono<{ Bindings: Env }>();

// 全局错误处理
app.onError((err, c) => {
  console.error('应用错误:', err);
  return c.json({
    error: '服务器内部错误',
    message: '请稍后重试',
    requestId: c.req.header('X-Request-ID')
  }, 500);
});

// 404 处理
app.notFound((c) => {
  return c.json({
    error: '接口不存在',
    message: `路径 ${c.req.path} 未找到`,
    availableEndpoints: [
      'GET /health - 健康检查',
      'POST /mcp/initialize - MCP 初始化',
      'GET /mcp/tools - 获取工具列表',
      'POST /mcp/tools/call - 调用工具'
    ]
  }, 404);
});

// 全局错误处理中间件（跳过健康检查端点）
app.use('*', async (c, next) => {
  // 健康检查端点跳过安全中间件的创建，避免配置验证失败
  if (c.req.path === '/health') {
    try {
      await next();
    } catch (error) {
      console.error('健康检查错误:', error);
      return c.json({
        error: '服务器内部错误',
        message: '请稍后重试',
        requestId: c.req.header('X-Request-ID')
      }, 500);
    }
    return;
  }
  
  const security = createSecurityMiddleware(c.env);
  return await security.errorHandler(c, next);
});

// CORS 中间件（跳过健康检查端点）
app.use('*', (c, next) => {
  if (c.req.path === '/health') {
    return next();
  }
  const security = createSecurityMiddleware(c.env);
  return security.cors(c, next);
});

// 安全头中间件（跳过健康检查端点）
app.use('*', async (c, next) => {
  if (c.req.path === '/health') {
    return next();
  }
  const security = createSecurityMiddleware(c.env);
  return await security.securityHeaders(c, next);
});

// 请求验证中间件（跳过健康检查端点）
app.use('*', async (c, next) => {
  if (c.req.path === '/health') {
    return next();
  }
  const security = createSecurityMiddleware(c.env);
  return await security.requestValidation(c, next);
});

// 速率限制中间件（跳过健康检查端点）
app.use('*', async (c, next) => {
  if (c.req.path === '/health') {
    return next();
  }
  const security = createSecurityMiddleware(c.env);
  return await security.rateLimit(c, next);
});

// 认证中间件 (仅应用于受保护的路由)
app.use('/mcp/*', async (c, next) => {
  const security = createSecurityMiddleware(c.env);
  return await security.auth(c, next);
});

app.use('/admin/*', async (c, next) => {
  const security = createSecurityMiddleware(c.env);
  return await security.auth(c, next);
});

// 健康检查端点（无需认证）
app.get('/health', async (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    server: c.env.MCP_SERVER_NAME || 'QQ Webhook MCP Server',
    version: c.env.MCP_SERVER_VERSION || '1.0.0',
    environment: c.env.ENVIRONMENT || 'production',
    client: {
      type: c.env.QQWEBHOOK_SERVICE ? 'service-binding' : 'http-api',
      cacheEnabled: c.env.CACHE_ENABLED !== 'false'
    }
  });
});

// MCP 协议端点
app.route('/mcp', createMcpRoutes());

// 创建 MCP 路由
function createMcpRoutes() {
  const mcpApp = new Hono<{ Bindings: Env }>();
  
  // MCP 初始化
  mcpApp.post('/initialize', async (c) => {
    const handler = new McpHandler(c.env);
    return await handler.handleInitialize(c);
  });
  
  // 获取工具列表
  mcpApp.get('/tools', async (c) => {
    const handler = new McpHandler(c.env);
    return await handler.handleListTools(c);
  });
  
  // 工具调用
  mcpApp.post('/tools/call', async (c) => {
    const handler = new McpHandler(c.env);
    return await handler.handleCallTool(c);
  });
  
  // 处理 CORS 预检请求
  mcpApp.options('*', async (c) => {
    const handler = new McpHandler(c.env);
    return await handler.handlePreflight(c);
  });
  
  return mcpApp;
}

// API 信息端点
app.get('/', (c) => {
  return c.json({
    name: c.env.MCP_SERVER_NAME || 'QQ Webhook MCP Server',
    version: c.env.MCP_SERVER_VERSION || '1.0.0',
    description: '基于 Cloudflare Workers 的 MCP 服务器，为 AI 助手提供邮件发送功能工具',
    protocol: 'MCP (Model Context Protocol)',
    endpoints: {
      health: 'GET /health',
      mcp: {
        initialize: 'POST /mcp/initialize',
        listTools: 'GET /mcp/tools',
        callTool: 'POST /mcp/tools/call'
      }
    },
    tools: [
      'send_email - 发送邮件',
      'list_email_templates - 列出邮件模板',
      'get_email_template - 获取模板详情',
      'get_email_status - 查询邮件状态'
    ],
    documentation: {
      mcp: 'https://modelcontextprotocol.io/',
      github: 'https://github.com/your-org/mailwebhook-mcp'
    }
  });
});

// 管理端点（需要特殊权限）
app.get('/admin/info', async (c) => {
  const handler = new McpHandler(c.env);
  
  return c.json({
    server: {
      name: c.env.MCP_SERVER_NAME,
      version: c.env.MCP_SERVER_VERSION,
      uptime: process.uptime?.() || 'unknown'
    },
    configuration: {
      corsOrigins: c.env.CORS_ORIGINS,
      hasApiToken: !!c.env.MCP_API_TOKEN,
      hasServiceBinding: !!c.env.QQWEBHOOK_SERVICE,
      hasHttpConfig: !!(c.env.QQWEBHOOK_API_URL && c.env.QQWEBHOOK_API_TOKEN),
      cacheEnabled: c.env.CACHE_ENABLED !== 'false',
      cacheTtl: c.env.CACHE_TTL || '3600',
      rateLimitEnabled: c.env.RATE_LIMIT_ENABLED !== 'false',
      authRequired: c.env.AUTH_REQUIRED !== 'false'
    },
    environment: {
      platform: 'Cloudflare Workers',
      runtime: 'V8',
      timestamp: new Date().toISOString()
    }
  });
});

// 缓存管理端点
app.post('/admin/cache/warmup', async (c) => {
  const handler = new McpHandler(c.env);
  const toolRegistry = handler.getToolRegistry();
  
  try {
    const templateTool = toolRegistry.getTemplateTool();
    const result = await templateTool.warmupTemplatesCache();
    
    return c.json({
      success: true,
      message: '缓存预热完成',
      data: result
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '缓存预热失败'
    }, 500);
  }
});

app.delete('/admin/cache/templates', async (c) => {
  const handler = new McpHandler(c.env);
  const toolRegistry = handler.getToolRegistry();
  
  try {
    const templateTool = toolRegistry.getTemplateTool();
    await templateTool.clearAllTemplatesCache();
    
    return c.json({
      success: true,
      message: '模板缓存已清除'
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '清除缓存失败'
    }, 500);
  }
});

// 安全监控端点
app.get('/admin/security/stats', async (c) => {
  try {
    const security = createSecurityMiddleware(c.env);
    const report = security.getSecurityReport();
    
    return c.json({
      success: true,
      data: report
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '获取安全统计失败'
    }, 500);
  }
});

app.get('/admin/security/blocked', async (c) => {
  try {
    const security = createSecurityMiddleware(c.env);
    const rateLimiter = security.getRateLimiter();
    const blockedClients = rateLimiter.getBlockedClients();
    
    return c.json({
      success: true,
      data: {
        blockedClients,
        total: blockedClients.length,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '获取被阻止客户端列表失败'
    }, 500);
  }
});

app.post('/admin/security/reset-rate-limit', async (c) => {
  try {
    const body = await c.req.json();
    const { clientId, endpoint } = body;
    
    if (!clientId) {
      return c.json({
        success: false,
        error: '缺少 clientId 参数'
      }, 400);
    }
    
    const security = createSecurityMiddleware(c.env);
    const rateLimiter = security.getRateLimiter();
    const success = rateLimiter.resetClient(clientId, endpoint);
    
    return c.json({
      success,
      message: success ? '客户端速率限制已重置' : '客户端不存在或重置失败',
      data: { clientId, endpoint }
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '重置速率限制失败'
    }, 500);
  }
});

app.post('/admin/security/reset-all-rate-limits', async (c) => {
  try {
    const security = createSecurityMiddleware(c.env);
    const rateLimiter = security.getRateLimiter();
    const resetCount = rateLimiter.resetAllClients();
    
    return c.json({
      success: true,
      message: `已重置所有客户端的速率限制`,
      data: { resetCount }
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '重置所有速率限制失败'
    }, 500);
  }
});

// 安全健康检查
app.get('/admin/security/health', async (c) => {
  try {
    const security = createSecurityMiddleware(c.env);
    const rateLimiter = security.getRateLimiter();
    
    const rateLimiterHealth = rateLimiter.healthCheck();
    
    const overallHealth = rateLimiterHealth.status === 'healthy' ? 'healthy' : 
                         rateLimiterHealth.status === 'degraded' ? 'degraded' : 'unhealthy';
    
    return c.json({
      success: true,
      data: {
        overall: overallHealth,
        components: {
          rateLimiter: rateLimiterHealth,
          authentication: {
            status: 'healthy',
            details: '认证系统工作正常'
          }
        },
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '安全健康检查失败'
    }, 500);
  }
});

// 导出默认处理器
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  }
};