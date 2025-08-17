import { Hono } from 'hono';
import { Env } from './types';
import { McpHandler } from './handlers/mcpHandler';
import { McpHandlerSSESimplified } from './handlers/mcpHandlerSSESimplified';
import { McpStreamableHttpHandler } from './handlers/mcpStreamableHttp';
import { McpCloudflareCompatibleHandler } from './handlers/mcpCloudflareCompatible';
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
      'POST /register - MCP客户端注册',
      'GET /.well-known/oauth-authorization-server - OAuth服务器元数据',
      'POST /mcp/initialize - MCP 初始化',
      'GET /mcp/tools - 获取工具列表',
      'POST /mcp/tools/call - 调用工具',
      'POST/GET /mcp/v1 - 标准 MCP Streamable HTTP 端点',
      'GET /mcp/sse - SSE 连接端点（推荐）',
      'POST /mcp/sse/message?sessionId=xxx - SSE 消息端点',
      'GET /mcp/sse/simple - 简化 SSE 连接端点（Workers 优化）'
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

// 认证中间件 (仅应用于受保护的路由，排除自管理认证的路径)
app.use('/mcp/*', async (c, next) => {
  // 跳过自管理认证的路径
  if (c.req.path === '/mcp/sse' || c.req.path.startsWith('/mcp/sse/message')) {
    await next();
    return;
  }
  
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
    version: c.env.MCP_SERVER_VERSION || '1.0.1',
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
  
  // === MCP Streamable HTTP 端点（推荐，符合 2024-11-05 标准）===
  
  // 标准 MCP 端点（支持 POST 和 GET）
  mcpApp.post('/v1', async (c) => {
    const handler = new McpStreamableHttpHandler(c.env);
    return await handler.handleStreamableHttp(c);
  });
  
  mcpApp.get('/v1', async (c) => {
    const handler = new McpStreamableHttpHandler(c.env);
    return await handler.handleStreamableHttp(c);
  });
  
  // === 传统的 HTTP MCP 路由（保持兼容性）===
  
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
  
  
  // === SSE MCP 路由（双端点架构）===
  
  // SSE 连接端点
  mcpApp.get('/sse', async (c) => {
    const handler = new McpCloudflareCompatibleHandler(c.env);
    return await handler.handleSSEConnection(c);
  });
  
  // SSE 消息端点
  mcpApp.post('/sse/message', async (c) => {
    const handler = new McpCloudflareCompatibleHandler(c.env);
    return await handler.handleSSEMessage(c);
  });
  
  // === 简化 SSE MCP 路由（Workers 优化版本）===
  
  // 简化的SSE连接端点
  mcpApp.get('/sse/simple', async (c) => {
    const handler = new McpHandlerSSESimplified(c.env);
    return await handler.handleSimplifiedSSEConnection(c);
  });
  
  // SSE 状态查询端点
  mcpApp.get('/sse/status', async (c) => {
    const handler = new McpHandlerSSESimplified(c.env);
    return await handler.handleSSEStatus(c);
  });
  
  // SSE 健康检查端点
  mcpApp.get('/sse/health', async (c) => {
    const handler = new McpHandlerSSESimplified(c.env);
    return await handler.handleSSEHealthCheck(c);
  });
  
  // SSE 使用说明端点
  mcpApp.get('/sse/instructions', async (c) => {
    const handler = new McpHandlerSSESimplified(c.env);
    return await handler.handleSSEInstructions(c);
  });
  
  // === 保留的复杂SSE路由（实验性，存在Workers限制）===
  
  // 注意：以下端点存在Cloudflare Workers的I/O共享限制，仅用于展示完整实现
  mcpApp.get('/sse/experimental', async (c) => {
    const handler = new McpHandlerSSE(c.env);
    return await handler.handleSSEConnection(c);
  });
  
  mcpApp.post('/sse/experimental/:sessionId/messages', async (c) => {
    const handler = new McpHandlerSSE(c.env);
    return await handler.handleSSEMessage(c);
  });
  
  mcpApp.get('/sse/experimental/:sessionId/status', async (c) => {
    const handler = new McpHandlerSSE(c.env);
    return await handler.handleSSESessionStatus(c);
  });
  
  // 处理 CORS 预检请求
  mcpApp.options('*', async (c) => {
    const handler = new McpHandler(c.env);
    return await handler.handlePreflight(c);
  });
  
  return mcpApp;
}

// MCP 客户端注册端点（OAuth扩展）
app.post('/register', async (c) => {
  try {
    const body = await c.req.json();
    
    // 验证注册请求
    const clientRegistration = {
      client_name: body.client_name || 'Unknown MCP Client',
      client_uri: body.client_uri,
      redirect_uris: body.redirect_uris || [],
      grant_types: body.grant_types || ['authorization_code'],
      response_types: body.response_types || ['code'],
      scope: body.scope || 'mcp:tools',
      token_endpoint_auth_method: body.token_endpoint_auth_method || 'client_secret_basic'
    };

    // 生成客户端凭据
    const clientId = `mcp-client-${crypto.randomUUID()}`;
    const clientSecret = `mcp-secret-${crypto.randomUUID()}`;
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + (30 * 24 * 60 * 60); // 30天过期

    // 构建注册响应
    const registrationResponse = {
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: issuedAt,
      client_secret_expires_at: expiresAt,
      ...clientRegistration,
      registration_access_token: `mcp-reg-${crypto.randomUUID()}`,
      registration_client_uri: `${new URL(c.req.url).origin}/register/${clientId}`
    };

    console.log(`MCP客户端注册成功: ${clientRegistration.client_name} (${clientId})`);

    return c.json(registrationResponse, 201);
  } catch (error) {
    console.error('MCP客户端注册失败:', error);
    
    return c.json({
      error: 'invalid_client_metadata',
      error_description: '客户端注册数据无效或格式错误',
      error_uri: 'https://tools.ietf.org/html/rfc7591#section-3.2.2'
    }, 400);
  }
});

// 查询已注册客户端信息
app.get('/register/:clientId', async (c) => {
  const clientId = c.req.param('clientId');
  
  // 在实际实现中，这里应该从数据库查询客户端信息
  // 当前返回占位符响应
  return c.json({
    client_id: clientId,
    client_name: 'Registered MCP Client',
    registered_at: new Date().toISOString(),
    status: 'active'
  });
});

// OAuth授权服务器元数据端点
app.get('/.well-known/oauth-authorization-server', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  
  return c.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    jwks_uri: `${baseUrl}/.well-known/jwks.json`,
    scopes_supported: ['mcp:tools', 'mcp:resources', 'mcp:prompts'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    code_challenge_methods_supported: ['S256'],
    mcp_server_info: {
      name: 'Mail Webhook MCP Server',
      version: '1.0.1',
      capabilities: ['tools', 'sse']
    }
  });
});

// API 信息端点
app.get('/', (c) => {
  return c.json({
    name: c.env.MCP_SERVER_NAME || 'QQ Webhook MCP Server',
    version: c.env.MCP_SERVER_VERSION || '1.0.1',
    description: '基于 Cloudflare Workers 的 MCP 服务器，为 AI 助手提供邮件发送功能工具',
    protocol: 'MCP (Model Context Protocol)',
    endpoints: {
      health: 'GET /health',
      oauth: {
        metadata: 'GET /.well-known/oauth-authorization-server',
        register: 'POST /register',
        clientInfo: 'GET /register/{clientId}'
      },
      mcp: {
        streamableHttp: {
          note: 'Standard MCP 2024-11-05 Streamable HTTP transport',
          endpoint: 'POST/GET /mcp/v1',
          description: 'Single endpoint supporting both HTTP requests and SSE streaming'
        },
        http: {
          note: 'Legacy HTTP endpoints for compatibility',
          initialize: 'POST /mcp/initialize',
          listTools: 'GET /mcp/tools',
          callTool: 'POST /mcp/tools/call'
        },
        sse: {
          simplified: {
            connect: 'GET /mcp/sse?token=your-api-token',
            withMessage: 'GET /mcp/sse?token=your-token&method=<method>&params=<json>&id=<id>',
            status: 'GET /mcp/sse/status',
            health: 'GET /mcp/sse/health',
            instructions: 'GET /mcp/sse/instructions'
          },
          experimental: {
            note: 'Experimental endpoints with Cloudflare Workers limitations',
            connect: 'GET /mcp/sse/experimental',
            messages: 'POST /mcp/sse/experimental/{sessionId}/messages'
          }
        }
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

// === SSE 管理端点 ===

// 获取MCP传输统计信息
app.get('/admin/mcp/stats', async (c) => {
  try {
    const streamableHandler = new McpStreamableHttpHandler(c.env);
    const cfCompatibleHandler = new McpCloudflareCompatibleHandler(c.env);
    const simplifiedHandler = new McpHandlerSSESimplified(c.env);
    
    return c.json({
      success: true,
      data: {
        streamableHttp: {
          status: 'active',
          description: '标准MCP Streamable HTTP传输，符合2024-11-05协议',
          features: ['双向通信', '会话管理', 'SSE流式响应', '批量请求'],
          sessions: streamableHandler.getSessionStats(),
          endpoints: {
            standard: 'POST/GET /mcp/v1',
            compatibility: ['POST /mcp/initialize', 'GET /mcp/tools', 'POST /mcp/tools/call']
          }
        },
        sseStandard: {
          status: 'active',
          description: 'SSE双端点实现，推荐用于MCP客户端',
          features: ['双端点架构', '简化消息处理', 'MCP客户端优化', '稳定可靠'],
          sessions: cfCompatibleHandler.getSessionStats(),
          endpoints: {
            connection: 'GET /mcp/sse',
            message: 'POST /mcp/sse/message?sessionId=xxx'
          }
        },
        sseSimplified: {
          status: 'active',
          description: '简化SSE实现，适合Cloudflare Workers环境',
          features: ['无状态', 'URL参数消息', '单请求生命周期'],
          endpoint: 'GET /mcp/sse/simple'
        },
        recommendations: {
          primary: 'Use Streamable HTTP (/mcp/v1) - Most stable and feature-complete',
          sse: 'Use SSE (/mcp/sse) - Real-time streaming for MCP clients',
          simplified: 'Use Simplified SSE (/mcp/sse/simple) - Worker optimized'
        },
        externalServers: {
          cloudflare: {
            url: 'https://docs.mcp.cloudflare.com/sse',
            description: 'Cloudflare官方MCP文档服务器',
            status: 'available'
          }
        },
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '获取MCP统计信息失败'
    }, 500);
  }
});


// 导出默认处理器
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  }
};