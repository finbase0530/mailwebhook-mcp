import { Env, SecurityValidation } from '../types';

export class SecurityValidator {
  // 验证启动时的安全配置
  static validateStartupSecurity(env: Env): SecurityValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 强制检查 MCP_API_TOKEN
    if (!env.MCP_API_TOKEN || env.MCP_API_TOKEN.trim().length === 0) {
      errors.push('MCP_API_TOKEN 是必需的安全配置，不能为空');
    } else {
      // 验证令牌强度
      const tokenValidation = this.validateTokenStrength(env.MCP_API_TOKEN);
      if (!tokenValidation.isStrong) {
        warnings.push(`API 令牌安全强度不足: ${tokenValidation.recommendations.join(', ')}`);
      }
    }

    // 检查认证要求配置
    const authRequired = env.AUTH_REQUIRED !== 'false'; // 默认启用
    if (!authRequired) {
      warnings.push('认证已被禁用，这在生产环境中不推荐');
    }

    // 验证速率限制配置
    const rateLimitValidation = this.validateRateLimitConfig(env);
    if (!rateLimitValidation.valid) {
      errors.push(...rateLimitValidation.errors);
      warnings.push(...rateLimitValidation.warnings);
    }

    // 验证 CORS 配置安全性
    if (env.CORS_ORIGINS === '*') {
      warnings.push('CORS 配置为允许所有来源，在生产环境中应限制为特定域名');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  // 验证令牌强度
  private static validateTokenStrength(token: string): {
    isStrong: boolean;
    recommendations: string[];
  } {
    const recommendations: string[] = [];
    let isStrong = true;

    // 检查长度
    if (token.length < 32) {
      isStrong = false;
      recommendations.push('令牌长度应至少为 32 个字符');
    }

    // 检查复杂性
    const hasUppercase = /[A-Z]/.test(token);
    const hasLowercase = /[a-z]/.test(token);
    const hasNumbers = /\d/.test(token);
    const hasSpecialChars = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(token);

    const complexityScore = [hasUppercase, hasLowercase, hasNumbers, hasSpecialChars].filter(Boolean).length;

    if (complexityScore < 3) {
      isStrong = false;
      recommendations.push('令牌应包含大写字母、小写字母、数字和特殊字符中的至少三种');
    }

    // 检查常见弱令牌模式
    const weakPatterns = [
      /^[a-z]+$/i, // 只有字母
      /^\d+$/, // 只有数字
      /^(test|demo|admin|password|secret|key)/i, // 常见弱词汇开头
    ];

    if (weakPatterns.some(pattern => pattern.test(token))) {
      isStrong = false;
      recommendations.push('避免使用常见的弱令牌模式');
    }

    return { isStrong, recommendations };
  }

  // 验证速率限制配置
  private static validateRateLimitConfig(env: Env): SecurityValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    const enabled = env.RATE_LIMIT_ENABLED !== 'false'; // 默认启用
    
    if (enabled) {
      // 验证窗口时间
      const windowMs = parseInt(env.RATE_LIMIT_WINDOW || '60000'); // 默认1分钟
      if (isNaN(windowMs) || windowMs < 1000) {
        errors.push('RATE_LIMIT_WINDOW 必须是有效的毫秒数，且不少于1000');
      } else if (windowMs < 10000) {
        warnings.push('速率限制窗口时间过短，可能影响正常使用');
      }

      // 验证请求限制数
      const maxRequests = parseInt(env.RATE_LIMIT_MAX_REQUESTS || '60');
      if (isNaN(maxRequests) || maxRequests < 1) {
        errors.push('RATE_LIMIT_MAX_REQUESTS 必须是大于0的整数');
      } else if (maxRequests < 10) {
        warnings.push('速率限制过于严格，可能影响正常使用');
      } else if (maxRequests > 1000) {
        warnings.push('速率限制过于宽松，可能无法有效防止滥用');
      }
    } else {
      warnings.push('速率限制已被禁用，这在生产环境中不推荐');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  // 生成安全启动报告
  static generateSecurityReport(validation: SecurityValidation): string {
    let report = '=== MCP 服务器安全配置报告 ===\n\n';

    if (validation.valid) {
      report += '✅ 安全配置验证通过\n\n';
    } else {
      report += '❌ 安全配置验证失败\n\n';
      report += '错误:\n';
      validation.errors.forEach((error, index) => {
        report += `${index + 1}. ${error}\n`;
      });
      report += '\n';
    }

    if (validation.warnings.length > 0) {
      report += '⚠️  安全警告:\n';
      validation.warnings.forEach((warning, index) => {
        report += `${index + 1}. ${warning}\n`;
      });
      report += '\n';
    }

    report += '=== 报告结束 ===';
    return report;
  }

  // 验证运行时安全状态
  static validateRuntimeSecurity(env: Env): {
    tokenPresent: boolean;
    rateLimitActive: boolean;
    corsSecure: boolean;
  } {
    return {
      tokenPresent: !!(env.MCP_API_TOKEN && env.MCP_API_TOKEN.trim().length > 0),
      rateLimitActive: env.RATE_LIMIT_ENABLED !== 'false',
      corsSecure: env.CORS_ORIGINS !== '*'
    };
  }
}