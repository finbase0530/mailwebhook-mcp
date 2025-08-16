import { RateLimitConfig, RateLimitRecord, Env } from '../types';

export class RateLimiter {
  private config: RateLimitConfig;
  private records: Map<string, RateLimitRecord> = new Map();
  private cleanupInterval: number;

  constructor(env: Env) {
    this.config = {
      enabled: env.RATE_LIMIT_ENABLED !== 'false', // 默认启用
      windowMs: parseInt(env.RATE_LIMIT_WINDOW || '60000'), // 默认1分钟
      maxRequests: parseInt(env.RATE_LIMIT_MAX_REQUESTS || '60'), // 默认60次/分钟
      skipSuccessfulRequests: false
    };

    // 定期清理过期记录
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredRecords();
    }, Math.min(this.config.windowMs, 300000)); // 最多5分钟清理一次
  }

  // 检查是否超过速率限制
  isRateLimited(clientId: string, endpoint?: string): {
    limited: boolean;
    record: RateLimitRecord;
    retryAfter?: number;
  } {
    if (!this.config.enabled) {
      return {
        limited: false,
        record: { count: 0, resetTime: 0, blocked: false }
      };
    }

    const key = this.generateKey(clientId, endpoint);
    const now = Date.now();
    let record = this.records.get(key);

    // 如果没有记录或记录已过期，创建新记录
    if (!record || now >= record.resetTime) {
      record = {
        count: 0,
        resetTime: now + this.config.windowMs,
        blocked: false
      };
    }

    // 增加请求计数
    record.count++;

    // 检查是否超过限制
    if (record.count > this.config.maxRequests) {
      record.blocked = true;
      this.records.set(key, record);
      
      return {
        limited: true,
        record,
        retryAfter: Math.ceil((record.resetTime - now) / 1000)
      };
    }

    // 更新记录
    this.records.set(key, record);
    
    return {
      limited: false,
      record
    };
  }

  // 获取客户端当前状态
  getClientStatus(clientId: string, endpoint?: string): {
    remaining: number;
    resetTime: number;
    blocked: boolean;
  } {
    const key = this.generateKey(clientId, endpoint);
    const record = this.records.get(key);
    
    if (!record) {
      return {
        remaining: this.config.maxRequests,
        resetTime: Date.now() + this.config.windowMs,
        blocked: false
      };
    }

    return {
      remaining: Math.max(0, this.config.maxRequests - record.count),
      resetTime: record.resetTime,
      blocked: record.blocked
    };
  }

  // 重置客户端限制
  resetClient(clientId: string, endpoint?: string): boolean {
    const key = this.generateKey(clientId, endpoint);
    return this.records.delete(key);
  }

  // 生成缓存键
  private generateKey(clientId: string, endpoint?: string): string {
    if (endpoint) {
      return `${clientId}:${endpoint}`;
    }
    return clientId;
  }

  // 清理过期记录
  private cleanupExpiredRecords(): void {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [key, record] of this.records.entries()) {
      if (now >= record.resetTime) {
        this.records.delete(key);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.debug(`清理了 ${cleanedCount} 个过期的速率限制记录`);
    }
  }

  // 获取不同端点的速率限制配置
  getEndpointConfig(endpoint: string): Partial<RateLimitConfig> {
    // 不同端点的特殊配置
    const endpointConfigs: Record<string, Partial<RateLimitConfig>> = {
      '/admin': {
        maxRequests: Math.floor(this.config.maxRequests / 6), // 管理端点更严格
        windowMs: this.config.windowMs
      },
      '/mcp/tools/call': {
        maxRequests: Math.floor(this.config.maxRequests * 0.8), // 工具调用略微严格
        windowMs: this.config.windowMs
      },
      '/mcp/tools': {
        maxRequests: Math.floor(this.config.maxRequests * 0.3), // 工具列表查询限制
        windowMs: this.config.windowMs
      }
    };

    return endpointConfigs[endpoint] || {};
  }

  // 根据端点调整限制检查
  isRateLimitedByEndpoint(clientId: string, endpoint: string): {
    limited: boolean;
    record: RateLimitRecord;
    retryAfter?: number;
  } {
    const endpointConfig = this.getEndpointConfig(endpoint);
    const originalConfig = { ...this.config };
    
    // 临时应用端点特定配置
    Object.assign(this.config, endpointConfig);
    
    const result = this.isRateLimited(clientId, endpoint);
    
    // 恢复原始配置
    this.config = originalConfig;
    
    return result;
  }

  // 获取统计信息
  getStats(): {
    totalClients: number;
    activeClients: number;
    blockedClients: number;
    config: RateLimitConfig;
  } {
    const now = Date.now();
    let activeClients = 0;
    let blockedClients = 0;
    
    for (const record of this.records.values()) {
      if (now < record.resetTime) {
        activeClients++;
        if (record.blocked) {
          blockedClients++;
        }
      }
    }
    
    return {
      totalClients: this.records.size,
      activeClients,
      blockedClients,
      config: this.config
    };
  }

  // 获取被阻止的客户端列表
  getBlockedClients(): Array<{
    clientId: string;
    count: number;
    resetTime: number;
    endpoint?: string;
  }> {
    const blocked = [];
    const now = Date.now();
    
    for (const [key, record] of this.records.entries()) {
      if (record.blocked && now < record.resetTime) {
        const parts = key.split(':');
        blocked.push({
          clientId: parts[0],
          endpoint: parts[1],
          count: record.count,
          resetTime: record.resetTime
        });
      }
    }
    
    return blocked;
  }

  // 批量重置客户端
  resetAllClients(): number {
    const count = this.records.size;
    this.records.clear();
    return count;
  }

  // 更新配置
  updateConfig(newConfig: Partial<RateLimitConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  // 清理资源
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.records.clear();
  }

  // 健康检查
  healthCheck(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    details: string;
    metrics: {
      memoryUsage: number;
      recordCount: number;
    };
  } {
    const recordCount = this.records.size;
    const memoryUsage = this.estimateMemoryUsage();
    
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    let details = '速率限制器工作正常';
    
    // 检查内存使用情况
    if (recordCount > 10000) {
      status = 'degraded';
      details = '速率限制记录过多，可能影响性能';
    }
    
    if (recordCount > 50000) {
      status = 'unhealthy';
      details = '速率限制记录数量过多，建议重启服务';
    }
    
    return {
      status,
      details,
      metrics: {
        memoryUsage,
        recordCount
      }
    };
  }

  // 估算内存使用
  private estimateMemoryUsage(): number {
    // 粗略估算每个记录的内存使用（字节）
    const avgKeyLength = 20;
    const recordSize = 24; // count + resetTime + blocked
    return this.records.size * (avgKeyLength + recordSize);
  }
}