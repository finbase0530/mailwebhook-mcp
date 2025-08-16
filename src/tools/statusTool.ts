import { McpTool, EmailStatus, Env, ApiResponse } from '../types';
import { HttpClient } from '../utils/httpClient';

export class StatusTool {
  private httpClient: HttpClient;

  constructor(env: Env) {
    this.httpClient = new HttpClient(env);
  }

  // 获取工具定义
  static getToolDefinition(): McpTool {
    return {
      name: 'get_email_status',
      description: '查询指定邮件的发送状态',
      inputSchema: {
        type: 'object',
        properties: {
          messageId: {
            type: 'string',
            description: '邮件消息ID'
          }
        },
        required: ['messageId']
      }
    };
  }

  // 查询邮件状态
  async getEmailStatus(messageId: string): Promise<ApiResponse<EmailStatus>> {
    try {
      if (!messageId) {
        throw new Error('邮件消息ID不能为空');
      }

      if (!this.isValidMessageId(messageId)) {
        throw new Error('邮件消息ID格式不正确');
      }

      const response = await this.httpClient.get<EmailStatus>(`/status/${encodeURIComponent(messageId)}`);

      if (response.success) {
        return {
          success: true,
          data: response.data,
          message: '查询邮件状态成功'
        };
      } else {
        throw new Error(response.message || response.error || '查询邮件状态失败');
      }
    } catch (error) {
      console.error('查询邮件状态失败:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误'
      };
    }
  }

  // 批量查询邮件状态
  async getBatchEmailStatus(messageIds: string[]): Promise<ApiResponse<EmailStatus[]>> {
    try {
      if (!messageIds || messageIds.length === 0) {
        throw new Error('邮件消息ID列表不能为空');
      }

      if (messageIds.length > 100) {
        throw new Error('批量查询最多支持100个邮件ID');
      }

      // 验证所有消息ID
      for (const messageId of messageIds) {
        if (!this.isValidMessageId(messageId)) {
          throw new Error(`无效的邮件消息ID: ${messageId}`);
        }
      }

      const response = await this.httpClient.post<EmailStatus[]>('/status/batch', {
        messageIds
      });

      if (response.success) {
        return {
          success: true,
          data: response.data || [],
          message: `成功查询${response.data?.length || 0}个邮件状态`
        };
      } else {
        throw new Error(response.message || response.error || '批量查询邮件状态失败');
      }
    } catch (error) {
      console.error('批量查询邮件状态失败:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误'
      };
    }
  }

  // 处理工具调用
  async handleToolCall(args: any): Promise<ApiResponse<EmailStatus>> {
    if (!args.messageId) {
      return {
        success: false,
        error: '邮件消息ID参数缺失'
      };
    }

    return this.getEmailStatus(args.messageId);
  }

  // 验证消息ID格式
  private isValidMessageId(messageId: string): boolean {
    // 消息ID应该是字母数字组合，可能包含连字符和下划线
    const messageIdRegex = /^[a-zA-Z0-9_-]{8,64}$/;
    return messageIdRegex.test(messageId);
  }

  // 格式化状态信息用于显示
  formatStatusInfo(status: EmailStatus): string {
    const statusText = this.getStatusText(status.status);
    const timestamp = new Date(status.timestamp).toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai'
    });

    let result = `邮件状态查询结果:
消息ID: ${status.messageId}
状态: ${statusText}
时间: ${timestamp}`;

    if (status.error) {
      result += `\n错误信息: ${status.error}`;
    }

    return result;
  }

  // 获取状态文本描述
  private getStatusText(status: EmailStatus['status']): string {
    const statusMap = {
      'pending': '等待发送',
      'sent': '已发送',
      'delivered': '已送达',
      'failed': '发送失败'
    };

    return statusMap[status] || '未知状态';
  }

  // 格式化批量状态信息
  formatBatchStatusInfo(statuses: EmailStatus[]): string {
    if (statuses.length === 0) {
      return '没有查询到邮件状态信息';
    }

    const summary = this.generateStatusSummary(statuses);
    
    let result = `批量邮件状态查询结果 (${statuses.length}条记录):\n\n`;
    result += `状态统计: ${summary}\n\n`;
    
    result += '详细信息:\n';
    result += statuses.map((status, index) => 
      `${index + 1}. ${status.messageId}: ${this.getStatusText(status.status)}`
    ).join('\n');

    return result;
  }

  // 生成状态统计
  private generateStatusSummary(statuses: EmailStatus[]): string {
    const counts = statuses.reduce((acc, status) => {
      acc[status.status] = (acc[status.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(counts)
      .map(([status, count]) => `${this.getStatusText(status as EmailStatus['status'])}: ${count}`)
      .join(', ');
  }
}