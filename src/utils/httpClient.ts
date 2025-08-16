import { ApiResponse, HttpClientOptions, ServiceBindingResponse, Env } from '../types';

export class HttpClient {
  private baseUrl?: string;
  private defaultHeaders: Record<string, string>;
  private timeout: number;
  private retries: number;
  private serviceBinding?: Fetcher;
  private useServiceBinding: boolean;

  constructor(env: Env, options: HttpClientOptions = {}) {
    // 优先使用服务绑定，回退到传统HTTP API
    this.serviceBinding = env.QQWEBHOOK_SERVICE;
    this.useServiceBinding = options.useServiceBinding ?? !!this.serviceBinding;
    
    // 向后兼容：支持传统HTTP API
    if (env.QQWEBHOOK_API_URL) {
      this.baseUrl = env.QQWEBHOOK_API_URL.replace(/\/$/, '');
    }
    
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      'User-Agent': 'MailWebhook-MCP/1.0.0'
    };

    // 如果使用传统HTTP API，添加认证头
    if (env.QQWEBHOOK_API_TOKEN && !this.useServiceBinding) {
      this.defaultHeaders['Authorization'] = `Bearer ${env.QQWEBHOOK_API_TOKEN}`;
    }

    this.timeout = options.timeout || 10000;
    this.retries = options.retries || 2;
  }

  private async makeRequest<T>(
    method: string,
    path: string,
    data?: any,
    attempt = 1
  ): Promise<ApiResponse<T>> {
    try {
      let response: Response;

      if (this.useServiceBinding && this.serviceBinding) {
        // 使用服务绑定调用
        response = await this.makeServiceBindingRequest(method, path, data);
      } else {
        // 使用传统HTTP API
        response = await this.makeHttpRequest(method, path, data);
      }

      const result = await response.json() as ApiResponse<T>;

      if (!response.ok) {
        const errorMessage = result.message || result.error || 'Unknown error';
        const details = result.details ? ` - ${result.details}` : '';
        throw new Error(`${this.useServiceBinding ? 'Service' : 'HTTP'} ${response.status}: ${errorMessage}${details}`);
      }

      return result;
    } catch (error) {
      if (attempt <= this.retries && this.isRetryableError(error)) {
        console.warn(`请求失败，正在重试 (${attempt}/${this.retries}):`, error);
        await this.delay(Math.pow(2, attempt - 1) * 1000);
        return this.makeRequest<T>(method, path, data, attempt + 1);
      }
      
      throw error;
    }
  }

  // 服务绑定请求
  private async makeServiceBindingRequest(
    method: string, 
    path: string, 
    data?: any
  ): Promise<Response> {
    if (!this.serviceBinding) {
      throw new Error('服务绑定未配置');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      // 为服务绑定调用添加内部标识头
      const headers = {
        ...this.defaultHeaders,
        'X-Internal-Service-Binding': 'true',
        'X-Caller-Service': 'mailwebhook-mcp'
      };
      
      // 服务绑定需要构造一个有效的 URL，但域名部分会被忽略
      const url = `https://internal${path}`;
      
      const request = new Request(url, {
        method,
        headers,
        body: data ? JSON.stringify(data) : undefined,
        signal: controller.signal
      });

      const response = await this.serviceBinding.fetch(request);
      
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  // 传统HTTP请求
  private async makeHttpRequest(
    method: string, 
    path: string, 
    data?: any
  ): Promise<Response> {
    if (!this.baseUrl) {
      throw new Error('HTTP API URL 未配置');
    }

    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: this.defaultHeaders,
        body: data ? JSON.stringify(data) : undefined,
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private isRetryableError(error: any): boolean {
    if (error.name === 'AbortError') return false;
    if (error.message?.includes('HTTP 4')) return false;
    return true;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async get<T>(path: string): Promise<ApiResponse<T>> {
    return this.makeRequest<T>('GET', path);
  }

  async post<T>(path: string, data?: any): Promise<ApiResponse<T>> {
    return this.makeRequest<T>('POST', path, data);
  }

  async put<T>(path: string, data?: any): Promise<ApiResponse<T>> {
    return this.makeRequest<T>('PUT', path, data);
  }

  async delete<T>(path: string): Promise<ApiResponse<T>> {
    return this.makeRequest<T>('DELETE', path);
  }

  // 获取客户端信息
  getClientInfo(): {
    type: 'service-binding' | 'http-api';
    endpoint?: string;
    timeout: number;
    retries: number;
  } {
    return {
      type: this.useServiceBinding ? 'service-binding' : 'http-api',
      endpoint: this.baseUrl,
      timeout: this.timeout,
      retries: this.retries
    };
  }

  // 健康检查
  async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    type: 'service-binding' | 'http-api';
    latency?: number;
    error?: string;
  }> {
    const startTime = Date.now();
    
    try {
      // 尝试调用一个简单的端点
      const response = await this.get('/health');
      const latency = Date.now() - startTime;
      
      return {
        status: 'healthy',
        type: this.useServiceBinding ? 'service-binding' : 'http-api',
        latency
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        type: this.useServiceBinding ? 'service-binding' : 'http-api',
        error: error instanceof Error ? error.message : '未知错误'
      };
    }
  }

  // 设置额外的请求头
  setHeader(key: string, value: string): void {
    this.defaultHeaders[key] = value;
  }

  // 移除请求头
  removeHeader(key: string): void {
    delete this.defaultHeaders[key];
  }

  // 批量设置请求头
  setHeaders(headers: Record<string, string>): void {
    Object.assign(this.defaultHeaders, headers);
  }

  // 自定义 JSON 序列化，确保中文字符正确编码
  private stringifyWithUtf8(data: any): string {
    // 深度处理对象，确保所有字符串字段都是正确的 UTF-8 编码
    const processedData = this.normalizeDataForUtf8(data);
    
    // 使用标准 JSON.stringify，但确保 Unicode 字符正确编码
    return JSON.stringify(processedData, (key, value) => {
      if (typeof value === 'string') {
        // 确保字符串正确编码
        try {
          const encoder = new TextEncoder();
          const decoder = new TextDecoder('utf-8', { fatal: true });
          const bytes = encoder.encode(value);
          return decoder.decode(bytes);
        } catch (error) {
          console.warn(`字符串编码规范化失败 [${key}]:`, error);
          return value;
        }
      }
      return value;
    });
  }

  // 深度规范化数据对象
  private normalizeDataForUtf8(obj: any): any {
    if (typeof obj === 'string') {
      // 对字符串进行 UTF-8 规范化
      try {
        const encoder = new TextEncoder();
        const decoder = new TextDecoder('utf-8', { fatal: true });
        const bytes = encoder.encode(obj);
        return decoder.decode(bytes);
      } catch (error) {
        console.warn('字符串 UTF-8 规范化失败:', error);
        return obj;
      }
    } else if (Array.isArray(obj)) {
      return obj.map(item => this.normalizeDataForUtf8(item));
    } else if (obj !== null && typeof obj === 'object') {
      const normalized: any = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          normalized[key] = this.normalizeDataForUtf8(obj[key]);
        }
      }
      return normalized;
    }
    return obj;
  }
}