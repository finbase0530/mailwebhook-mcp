import { CacheConfig, CacheKeyOptions } from '../types';

export class CacheManager {
  private cache: Cache;
  private config: CacheConfig;
  private keyPrefix: string;

  constructor(config: CacheConfig, keyPrefix = 'mcp-server') {
    this.cache = caches.default;
    this.config = config;
    this.keyPrefix = keyPrefix;
  }

  // 生成缓存键
  private generateCacheKey(key: string, options?: CacheKeyOptions): string {
    const prefix = options?.prefix || this.keyPrefix;
    const version = options?.version || 'v1';
    
    // 创建基础键
    let cacheKey = `${prefix}:${version}:${key}`;
    
    // 如果需要包含特定头信息，添加到键中
    if (options?.includeHeaders?.length) {
      const headerHash = this.hashHeaders(options.includeHeaders);
      cacheKey += `:${headerHash}`;
    }
    
    return cacheKey;
  }

  // 创建缓存请求对象
  private createCacheRequest(cacheKey: string): Request {
    // 使用虚拟URL来创建缓存请求
    return new Request(`https://cache.example.com/${cacheKey}`, {
      method: 'GET'
    });
  }

  // 从缓存获取数据
  async get<T>(key: string, options?: CacheKeyOptions): Promise<T | null> {
    if (!this.config.enabled) {
      return null;
    }

    try {
      const cacheKey = this.generateCacheKey(key, options);
      const cacheRequest = this.createCacheRequest(cacheKey);
      const response = await this.cache.match(cacheRequest);

      if (!response) {
        console.debug(`缓存未命中: ${cacheKey}`);
        return null;
      }

      // 检查缓存是否过期
      const cacheDate = response.headers.get('Date');
      const maxAge = response.headers.get('Cache-Control')?.match(/max-age=(\d+)/)?.[1];
      
      if (cacheDate && maxAge) {
        const age = (Date.now() - new Date(cacheDate).getTime()) / 1000;
        if (age > parseInt(maxAge)) {
          console.debug(`缓存已过期: ${cacheKey}`);
          await this.delete(key, options);
          return null;
        }
      }

      const data = await response.json();
      console.debug(`缓存命中: ${cacheKey}`);
      return data;
    } catch (error) {
      console.warn('缓存读取失败:', error);
      return null;
    }
  }

  // 设置缓存数据
  async set<T>(
    key: string, 
    data: T, 
    ttl?: number, 
    options?: CacheKeyOptions
  ): Promise<boolean> {
    if (!this.config.enabled) {
      return false;
    }

    try {
      const cacheKey = this.generateCacheKey(key, options);
      const cacheRequest = this.createCacheRequest(cacheKey);
      const cacheTtl = ttl || this.config.defaultTtl;

      // 创建响应头
      const headers = new Headers({
        'Content-Type': 'application/json; charset=utf-8',
        'Date': new Date().toUTCString(),
        'Cache-Control': `max-age=${cacheTtl}, public`,
        'X-Cache-Key': cacheKey,
        'X-Cache-TTL': cacheTtl.toString()
      });

      // 如果配置了 stale-while-revalidate，添加到 Cache-Control
      if (this.config.staleWhileRevalidate) {
        headers.set(
          'Cache-Control', 
          `max-age=${cacheTtl}, stale-while-revalidate=${this.config.staleWhileRevalidate}, public`
        );
      }

      // 创建响应对象
      const response = new Response(JSON.stringify(data), {
        status: 200,
        headers
      });

      // 存储到缓存
      await this.cache.put(cacheRequest, response);
      console.debug(`缓存已设置: ${cacheKey}, TTL: ${cacheTtl}s`);
      return true;
    } catch (error) {
      console.warn('缓存设置失败:', error);
      return false;
    }
  }

  // 删除缓存
  async delete(key: string, options?: CacheKeyOptions): Promise<boolean> {
    try {
      const cacheKey = this.generateCacheKey(key, options);
      const cacheRequest = this.createCacheRequest(cacheKey);
      const success = await this.cache.delete(cacheRequest);
      
      if (success) {
        console.debug(`缓存已删除: ${cacheKey}`);
      }
      
      return success;
    } catch (error) {
      console.warn('缓存删除失败:', error);
      return false;
    }
  }

  // 获取或设置缓存（常用模式）
  async getOrSet<T>(
    key: string,
    fetchFunction: () => Promise<T>,
    ttl?: number,
    options?: CacheKeyOptions
  ): Promise<T> {
    // 首先尝试从缓存获取
    const cached = await this.get<T>(key, options);
    if (cached !== null) {
      return cached;
    }

    // 缓存未命中，调用获取函数
    const data = await fetchFunction();
    
    // 将结果存储到缓存
    await this.set(key, data, ttl, options);
    
    return data;
  }

  // 批量删除缓存（通过前缀）
  async deleteByPrefix(prefix: string): Promise<number> {
    // 注意：Cloudflare Cache API 不支持按前缀删除
    // 这里提供一个基础实现，实际使用中可能需要维护键列表
    console.warn('批量删除缓存需要维护键列表，当前实现有限');
    return 0;
  }

  // 清空所有缓存
  async clear(): Promise<boolean> {
    try {
      // 注意：caches.default.clear() 在 Workers 中不可用
      // 这里只是记录日志
      console.warn('Cloudflare Cache API 不支持清空所有缓存');
      return false;
    } catch (error) {
      console.warn('清空缓存失败:', error);
      return false;
    }
  }

  // 获取缓存统计信息
  async getStats(): Promise<{
    enabled: boolean;
    defaultTtl: number;
    maxAge: number;
  }> {
    return {
      enabled: this.config.enabled,
      defaultTtl: this.config.defaultTtl,
      maxAge: this.config.maxAge
    };
  }

  // 哈希头信息（用于缓存键生成）
  private hashHeaders(headers: string[]): string {
    return headers.sort().join(',').toLowerCase().replace(/\s/g, '');
  }

  // 预热缓存（批量设置）
  async warmup<T>(entries: Array<{ key: string; data: T; ttl?: number }>): Promise<number> {
    let successCount = 0;
    
    for (const entry of entries) {
      const success = await this.set(entry.key, entry.data, entry.ttl);
      if (success) {
        successCount++;
      }
    }
    
    console.log(`缓存预热完成: ${successCount}/${entries.length} 项成功`);
    return successCount;
  }

  // 检查缓存健康状态
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details: string;
  }> {
    try {
      // 尝试设置和获取测试数据
      const testKey = 'health-check';
      const testData = { timestamp: Date.now() };
      
      const setSuccess = await this.set(testKey, testData, 60);
      if (!setSuccess) {
        return {
          status: 'unhealthy',
          details: '无法写入缓存'
        };
      }
      
      const retrieved = await this.get(testKey);
      if (!retrieved) {
        return {
          status: 'degraded',
          details: '可以写入但无法读取缓存'
        };
      }
      
      await this.delete(testKey);
      
      return {
        status: 'healthy',
        details: '缓存工作正常'
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        details: `缓存健康检查失败: ${error}`
      };
    }
  }
}