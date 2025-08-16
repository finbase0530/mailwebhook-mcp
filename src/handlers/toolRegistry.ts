import { Env, McpTool, ApiResponse } from '../types';
import { EmailTool } from '../tools/emailTool';
import { TemplateTool } from '../tools/templateTool';
import { StatusTool } from '../tools/statusTool';

export class ToolRegistry {
  private emailTool: EmailTool;
  private templateTool: TemplateTool;
  private statusTool: StatusTool;
  private tools: Map<string, McpTool>;

  constructor(env: Env) {
    // 初始化工具实例
    this.emailTool = new EmailTool(env);
    this.templateTool = new TemplateTool(env);
    this.statusTool = new StatusTool(env);
    
    // 注册所有工具
    this.tools = new Map();
    this.registerTools();
  }

  // 注册所有可用工具
  private registerTools(): void {
    // 注册邮件发送工具
    const emailToolDef = EmailTool.getToolDefinition();
    this.tools.set(emailToolDef.name, emailToolDef);

    // 注册模板管理工具
    const listTemplatesDef = TemplateTool.getListToolDefinition();
    this.tools.set(listTemplatesDef.name, listTemplatesDef);

    const getTemplateDef = TemplateTool.getGetToolDefinition();
    this.tools.set(getTemplateDef.name, getTemplateDef);

    // 注册状态查询工具
    const statusToolDef = StatusTool.getToolDefinition();
    this.tools.set(statusToolDef.name, statusToolDef);

    console.log(`已注册 ${this.tools.size} 个 MCP 工具:`, Array.from(this.tools.keys()));
  }

  // 获取所有工具列表
  async listTools(): Promise<McpTool[]> {
    return Array.from(this.tools.values());
  }

  // 获取特定工具定义
  getTool(name: string): McpTool | undefined {
    return this.tools.get(name);
  }

  // 调用工具
  async callTool(name: string, args: any): Promise<ApiResponse> {
    try {
      // 检查工具是否存在
      const tool = this.tools.get(name);
      if (!tool) {
        return {
          success: false,
          error: `未知的工具: ${name}`
        };
      }

      // 验证参数
      const validationResult = this.validateToolArgs(tool, args);
      if (!validationResult.valid) {
        return {
          success: false,
          error: validationResult.error
        };
      }

      // 根据工具名称调用相应的处理器
      switch (name) {
        case 'send_email':
          return await this.emailTool.handleToolCall(args);
          
        case 'list_email_templates':
          return await this.templateTool.handleListToolCall();
          
        case 'get_email_template':
          return await this.templateTool.handleGetToolCall(args);
          
        case 'get_email_status':
          return await this.statusTool.handleToolCall(args);
          
        default:
          return {
            success: false,
            error: `未实现的工具: ${name}`
          };
      }
    } catch (error) {
      console.error(`工具调用失败 [${name}]:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '工具调用失败'
      };
    }
  }

  // 验证工具参数
  private validateToolArgs(tool: McpTool, args: any): { valid: boolean; error?: string } {
    const schema = tool.inputSchema;
    
    if (!schema) {
      return { valid: true };
    }

    // 检查必需参数
    if (schema.required) {
      for (const requiredField of schema.required) {
        if (args[requiredField] === undefined || args[requiredField] === null) {
          return {
            valid: false,
            error: `缺少必需参数: ${requiredField}`
          };
        }
      }
    }

    // 基础类型验证
    if (schema.properties) {
      for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
        const value = args[fieldName];
        if (value !== undefined) {
          const typeValidation = this.validateFieldType(fieldName, value, fieldSchema as any);
          if (!typeValidation.valid) {
            return typeValidation;
          }
        }
      }
    }

    return { valid: true };
  }

  // 验证字段类型
  private validateFieldType(fieldName: string, value: any, fieldSchema: any): { valid: boolean; error?: string } {
    const { type, enum: enumValues } = fieldSchema;

    // 检查枚举值
    if (enumValues && !enumValues.includes(value)) {
      return {
        valid: false,
        error: `字段 ${fieldName} 的值必须是以下之一: ${enumValues.join(', ')}`
      };
    }

    // 基础类型检查
    switch (type) {
      case 'string':
        if (typeof value !== 'string') {
          return {
            valid: false,
            error: `字段 ${fieldName} 必须是字符串类型`
          };
        }
        break;
        
      case 'number':
        if (typeof value !== 'number') {
          return {
            valid: false,
            error: `字段 ${fieldName} 必须是数字类型`
          };
        }
        break;
        
      case 'boolean':
        if (typeof value !== 'boolean') {
          return {
            valid: false,
            error: `字段 ${fieldName} 必须是布尔类型`
          };
        }
        break;
        
      case 'object':
        if (typeof value !== 'object' || value === null) {
          return {
            valid: false,
            error: `字段 ${fieldName} 必须是对象类型`
          };
        }
        break;
        
      case 'array':
        if (!Array.isArray(value)) {
          return {
            valid: false,
            error: `字段 ${fieldName} 必须是数组类型`
          };
        }
        break;
    }

    return { valid: true };
  }

  // 获取工具统计信息
  getToolsInfo(): {
    total: number;
    tools: Array<{ name: string; description: string; }>;
  } {
    const tools = Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description
    }));

    return {
      total: this.tools.size,
      tools
    };
  }

  // 检查工具是否存在
  hasTools(name: string): boolean {
    return this.tools.has(name);
  }

  // 获取模板工具实例（用于缓存管理）
  getTemplateTool(): TemplateTool {
    return this.templateTool;
  }

  // 获取工具帮助信息
  getToolHelp(name: string): string | null {
    const tool = this.tools.get(name);
    if (!tool) {
      return null;
    }

    let help = `工具: ${tool.name}\n描述: ${tool.description}\n\n`;
    
    if (tool.inputSchema?.properties) {
      help += '参数:\n';
      for (const [propName, propSchema] of Object.entries(tool.inputSchema.properties)) {
        const prop = propSchema as any;
        const required = tool.inputSchema.required?.includes(propName) ? ' (必需)' : ' (可选)';
        help += `  - ${propName}${required}: ${prop.description || '无描述'}\n`;
        if (prop.type) {
          help += `    类型: ${prop.type}\n`;
        }
        if (prop.enum) {
          help += `    可选值: ${prop.enum.join(', ')}\n`;
        }
      }
    }

    return help;
  }
}