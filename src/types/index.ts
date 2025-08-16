// 环境变量类型定义
export interface Env {
  // qqwebhook API 配置（向后兼容）
  QQWEBHOOK_API_URL?: string;
  QQWEBHOOK_API_TOKEN?: string;
  
  // Cloudflare 服务绑定
  QQWEBHOOK_SERVICE: Fetcher;
  
  // MCP 服务配置
  MCP_API_TOKEN?: string;
  MCP_SERVER_NAME: string;
  MCP_SERVER_VERSION: string;
  
  // CORS 配置
  CORS_ORIGINS: string;
  
  // 缓存配置
  CACHE_TTL?: string;
  CACHE_ENABLED?: string;
  
  // 安全配置
  RATE_LIMIT_ENABLED?: string;
  RATE_LIMIT_WINDOW?: string;
  RATE_LIMIT_MAX_REQUESTS?: string;
  AUTH_REQUIRED?: string;
}

// 邮件发送参数
export interface SendEmailParams {
  to: string;
  subject?: string;
  body?: string;
  html?: string;
  template?: string;
  templateData?: Record<string, any>;
  async?: boolean;
  priority?: 'low' | 'normal' | 'high';
}

// 邮件模板
export interface EmailTemplate {
  name: string;
  subject: string;
  body: string;
  variables: string[];
  description?: string;
}

// 邮件状态
export interface EmailStatus {
  messageId: string;
  status: 'pending' | 'sent' | 'delivered' | 'failed';
  timestamp: string;
  error?: string;
}

// API 响应类型
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

// MCP 工具参数
export interface McpToolCall {
  name: string;
  arguments: Record<string, any>;
}

// MCP 工具定义
export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

// HTTP 客户端选项
export interface HttpClientOptions {
  timeout?: number;
  headers?: Record<string, string>;
  retries?: number;
  useServiceBinding?: boolean;
}

// 缓存配置
export interface CacheConfig {
  enabled: boolean;
  defaultTtl: number;
  maxAge: number;
  staleWhileRevalidate?: number;
}

// 缓存键配置
export interface CacheKeyOptions {
  prefix?: string;
  version?: string;
  includeHeaders?: string[];
}

// 服务绑定响应
export interface ServiceBindingResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  status: number;
}

// 速率限制配置
export interface RateLimitConfig {
  enabled: boolean;
  windowMs: number;
  maxRequests: number;
  skipSuccessfulRequests?: boolean;
}

// 速率限制记录
export interface RateLimitRecord {
  count: number;
  resetTime: number;
  blocked: boolean;
}

// 安全配置验证结果
export interface SecurityValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}