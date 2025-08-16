import { McpTool, EmailTemplate, Env, ApiResponse, CacheConfig } from '../types';
import { HttpClient } from '../utils/httpClient';
import { CacheManager } from '../utils/cacheManager';

export class TemplateTool {
  private httpClient: HttpClient;
  private cacheManager: CacheManager;
  private cacheConfig: CacheConfig;

  constructor(env: Env) {
    this.httpClient = new HttpClient(env);
    
    // 配置缓存
    this.cacheConfig = {
      enabled: env.CACHE_ENABLED !== 'false', // 默认启用缓存
      defaultTtl: parseInt(env.CACHE_TTL || '3600'), // 默认1小时
      maxAge: 7200, // 最大2小时
      staleWhileRevalidate: 1800 // 30分钟后台更新
    };
    
    this.cacheManager = new CacheManager(this.cacheConfig, 'mcp-templates');
  }

  // 获取列表工具定义
  static getListToolDefinition(): McpTool {
    return {
      name: 'list_email_templates',
      description: '获取所有可用的邮件模板列表',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    };
  }

  // 获取详情工具定义
  static getGetToolDefinition(): McpTool {
    return {
      name: 'get_email_template',
      description: '获取指定邮件模板的详细信息',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '模板名称'
          }
        },
        required: ['name']
      }
    };
  }

  // 获取模板列表（带缓存）
  async listTemplates(): Promise<ApiResponse<EmailTemplate[]>> {
    const cacheKey = 'templates-list';
    
    try {
      // 使用缓存获取或设置模式
      const templates = await this.cacheManager.getOrSet(
        cacheKey,
        async () => {
          console.debug('从后端获取模板列表');
          const response = await this.httpClient.get<EmailTemplate[]>('/templates');
          
          if (!response.success) {
            throw new Error(response.message || response.error || '获取模板列表失败');
          }
          
          return response.data || [];
        },
        this.cacheConfig.defaultTtl
      );

      return {
        success: true,
        data: templates,
        message: '获取模板列表成功'
      };
    } catch (error) {
      console.error('获取模板列表失败:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误'
      };
    }
  }

  // 获取模板详情（带缓存）
  async getTemplate(name: string): Promise<ApiResponse<EmailTemplate>> {
    try {
      if (!name) {
        throw new Error('模板名称不能为空');
      }

      const cacheKey = `template-${name}`;
      
      // 使用缓存获取或设置模式
      const template = await this.cacheManager.getOrSet(
        cacheKey,
        async () => {
          console.debug(`从后端获取模板详情: ${name}`);
          const response = await this.httpClient.get<EmailTemplate>(`/templates/${encodeURIComponent(name)}`);
          
          if (!response.success) {
            throw new Error(response.message || response.error || '获取模板详情失败');
          }
          
          return response.data;
        },
        this.cacheConfig.defaultTtl
      );

      return {
        success: true,
        data: template,
        message: '获取模板详情成功'
      };
    } catch (error) {
      console.error('获取模板详情失败:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误'
      };
    }
  }

  // 处理列表工具调用
  async handleListToolCall(): Promise<ApiResponse<EmailTemplate[]>> {
    return this.listTemplates();
  }

  // 处理获取工具调用
  async handleGetToolCall(args: any): Promise<ApiResponse<EmailTemplate>> {
    if (!args.name) {
      return {
        success: false,
        error: '模板名称参数缺失'
      };
    }

    return this.getTemplate(args.name);
  }

  // 验证模板名称格式
  private isValidTemplateName(name: string): boolean {
    // 模板名称应该是字母、数字、下划线和连字符
    const nameRegex = /^[a-zA-Z0-9_-]+$/;
    return nameRegex.test(name) && name.length <= 50;
  }

  // 格式化模板信息用于显示
  formatTemplateInfo(template: EmailTemplate): string {
    const variables = template.variables.length > 0 
      ? template.variables.join(', ') 
      : '无';
    
    return `模板名称: ${template.name}
主题: ${template.subject}
变量: ${variables}
描述: ${template.description || '暂无描述'}`;
  }

  // 格式化模板列表用于显示
  formatTemplateList(templates: EmailTemplate[]): string {
    if (templates.length === 0) {
      return '当前没有可用的邮件模板';
    }

    return `可用邮件模板 (${templates.length}个):\n\n` +
      templates.map(template => 
        `• ${template.name}: ${template.description || template.subject}`
      ).join('\n');
  }

  // 缓存管理方法

  // 清除模板列表缓存
  async clearTemplatesListCache(): Promise<boolean> {
    return await this.cacheManager.delete('templates-list');
  }

  // 清除特定模板缓存
  async clearTemplateCache(name: string): Promise<boolean> {
    return await this.cacheManager.delete(`template-${name}`);
  }

  // 清除所有模板相关缓存
  async clearAllTemplatesCache(): Promise<void> {
    await Promise.all([
      this.clearTemplatesListCache(),
      // 注意：这里无法批量清除所有模板详情缓存，因为我们不知道所有模板名称
      // 实际使用中可以考虑维护一个模板名称列表
    ]);
    console.log('已清除模板列表缓存');
  }

  // 预热模板缓存
  async warmupTemplatesCache(): Promise<{
    listCached: boolean;
    templatesCached: number;
    errors: string[];
  }> {
    const result = {
      listCached: false,
      templatesCached: 0,
      errors: [] as string[]
    };

    try {
      // 预热模板列表
      const listResponse = await this.listTemplates();
      if (listResponse.success && listResponse.data) {
        result.listCached = true;
        
        // 预热前10个模板的详情（避免过多请求）
        const templatesToWarmup = listResponse.data.slice(0, 10);
        
        for (const template of templatesToWarmup) {
          try {
            await this.getTemplate(template.name);
            result.templatesCached++;
          } catch (error) {
            result.errors.push(`预热模板 ${template.name} 失败: ${error}`);
          }
        }
      }
    } catch (error) {
      result.errors.push(`预热模板列表失败: ${error}`);
    }

    console.log(`模板缓存预热完成: 列表=${result.listCached}, 模板=${result.templatesCached}, 错误=${result.errors.length}`);
    return result;
  }

  // 获取缓存统计信息
  async getCacheStats(): Promise<{
    config: CacheConfig;
    health: any;
  }> {
    return {
      config: this.cacheConfig,
      health: await this.cacheManager.healthCheck()
    };
  }

  // 检查模板是否在缓存中
  async isTemplateCached(name: string): Promise<boolean> {
    const cached = await this.cacheManager.get(`template-${name}`);
    return cached !== null;
  }

  // 检查模板列表是否在缓存中
  async isTemplatesListCached(): Promise<boolean> {
    const cached = await this.cacheManager.get('templates-list');
    return cached !== null;
  }
}