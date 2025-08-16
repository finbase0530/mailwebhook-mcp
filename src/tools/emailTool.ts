import { McpTool, SendEmailParams, Env, ApiResponse } from '../types';
import { HttpClient } from '../utils/httpClient';

export class EmailTool {
  private httpClient: HttpClient;

  constructor(env: Env) {
    this.httpClient = new HttpClient(env);
  }

  // 获取工具定义
  static getToolDefinition(): McpTool {
    return {
      name: 'send_email',
      description: '发送邮件（支持同步/异步、模板/自定义内容）',
      inputSchema: {
        type: 'object',
        properties: {
          to: {
            type: 'string',
            description: '收件人邮箱地址'
          },
          subject: {
            type: 'string',
            description: '邮件主题'
          },
          body: {
            type: 'string',
            description: '邮件纯文本内容'
          },
          html: {
            type: 'string',
            description: '邮件HTML内容'
          },
          template: {
            type: 'string',
            description: '邮件模板名称'
          },
          templateData: {
            type: 'object',
            description: '模板变量数据'
          },
          async: {
            type: 'boolean',
            description: '是否异步发送'
          },
          priority: {
            type: 'string',
            enum: ['low', 'normal', 'high'],
            description: '邮件优先级'
          }
        },
        required: ['to']
      }
    };
  }

  // 发送邮件
  async sendEmail(params: SendEmailParams): Promise<ApiResponse> {
    try {
      // 参数验证
      this.validateEmailParams(params);

      // 构建请求数据
      const requestData = {
        to: params.to,
        subject: params.subject,
        body: params.body,
        html: params.html,
        template: params.template,
        templateData: params.templateData,
        priority: params.priority || 'normal'
      };

      // 调试信息（不包含敏感数据）
      console.log(`=== 邮件发送请求 ===`);
      console.log(`收件人: ${params.to}`);
      console.log(`主题: ${params.subject || '(使用模板)'}`);
      console.log(`内容类型: ${params.template ? '模板' : params.html ? 'HTML' : '纯文本'}`);
      console.log(`发送方式: ${params.async ? '异步' : '同步'}`);
      console.log(`优先级: ${params.priority || 'normal'}`);
      console.log('===================');

      // 选择同步或异步发送端点
      const endpoint = params.async ? '/send/async' : '/send';
      
      // 发送请求
      const response = await this.httpClient.post(endpoint, requestData);

      if (response.success) {
        return {
          success: true,
          data: response.data,
          message: params.async ? '邮件已加入发送队列' : '邮件发送成功'
        };
      } else {
        throw new Error(response.message || response.error || '邮件发送失败');
      }
    } catch (error) {
      console.error('邮件发送失败:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误'
      };
    }
  }

  // 验证邮件参数
  private validateEmailParams(params: SendEmailParams): void {
    if (!params.to) {
      throw new Error('收件人邮箱地址不能为空');
    }

    if (!this.isValidEmail(params.to)) {
      throw new Error('收件人邮箱地址格式不正确');
    }

    // 检查内容参数
    const hasContent = params.body || params.html || params.template;
    if (!hasContent) {
      throw new Error('必须提供邮件内容（body、html 或 template）');
    }

    // 如果使用模板，检查模板参数
    if (params.template) {
      if (!params.subject && !params.templateData?.subject) {
        console.warn('使用模板时建议提供邮件主题');
      }
    } else {
      // 不使用模板时，建议提供主题
      if (!params.subject) {
        console.warn('建议提供邮件主题');
      }
    }

    // 验证优先级
    if (params.priority && !['low', 'normal', 'high'].includes(params.priority)) {
      throw new Error('邮件优先级必须是 low、normal 或 high');
    }
  }

  // 验证邮箱格式
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  // 处理工具调用
  async handleToolCall(args: any): Promise<ApiResponse> {
    const params: SendEmailParams = {
      to: args.to,
      subject: args.subject,
      body: args.body,
      html: args.html,
      template: args.template,
      templateData: args.templateData,
      async: args.async || false,
      priority: args.priority
    };

    return this.sendEmail(params);
  }
}