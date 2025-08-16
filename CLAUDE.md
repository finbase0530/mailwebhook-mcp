# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此代码仓库中工作提供指导。

## 项目概述

这是一个基于 Cloudflare Workers 的 MCP (Model Context Protocol) 服务器，为 AI 助手提供邮件发送功能工具。项目通过调用 qqwebhook 邮件服务的 REST API，将邮件功能封装为 MCP 工具，使 AI 助手能够发送邮件、管理模板和查询邮件状态。

## 开发命令

### 核心命令
- `npm run dev` - 使用 Wrangler 启动本地开发服务器
- `npm run deploy` - 部署到默认环境
-  优先使用 npx wrangler deploy --env production  进行生产环境部署
- `npm run deploy:prod` - 部署到生产环境 ✅ **已成功部署**

### 初次部署设置

#### 生产环境部署（已完成）✅
**当前生产环境状态**：
- **部署地址**：`https://mailwebhook-mcp.finbase.win/`
- **Worker 名称**：`mailwebhook-mcp-prod`
- **版本 ID**：`92435730-f263-4097-a372-49c5a307d348`
- **部署时间**：2025-08-13
- **日志功能**：已启用

**成功部署命令**：
```bash
npm install                    # 安装依赖
npm run deploy:prod           # 部署到生产环境
```

**当前配置状态**：
- ✅ 环境变量已配置
- ✅ 自定义域名路由已配置
- ✅ 安全中间件已启用
- ✅ 日志功能已启用
- ⚠️ 服务绑定暂时禁用（等待 qqwebhook-prod 服务）
- ⚠️ **需要手动添加 DNS 记录**

**DNS 配置要求**：
需要在 Cloudflare 控制台的 `finbase.win` 域名 DNS 设置中添加：
```
类型: AAAA
名称: mailwebhook-mcp
内容: 100::
代理状态: 已代理（橙色云朵）
TTL: 自动
```

**部署验证步骤**：
1. 添加上述 DNS 记录
2. 等待 DNS 传播（1-5 分钟）
3. 测试域名解析：`nslookup mailwebhook-mcp.finbase.win`
4. 测试服务访问：`curl https://mailwebhook-mcp.finbase.win/health`

#### 优先方式：服务绑定（推荐）
1. 确保 `wrangler.toml` 中已配置服务绑定：
   ```toml
   [[services]]
   binding = "QQWEBHOOK_SERVICE"
   service = "qqwebhook"  # qqwebhook Worker 名称
   ```

2. **设置必需的安全密钥**：
   ```bash
   wrangler secret put MCP_API_TOKEN --env production    # 生产环境 MCP 服务认证令牌
   ```

   ⚠️ **安全要求**：
   - `MCP_API_TOKEN` 现在是**强制要求**的，不能为空
   - 推荐令牌长度至少 32 个字符
   - 应包含大写字母、小写字母、数字和特殊字符

3. 启用服务绑定（当 qqwebhook-prod 可用时）：
   ```bash
   # 在 wrangler.toml 中取消注释服务绑定配置
   # 然后重新部署
   npm run deploy:prod
   ```

#### 备选方式：HTTP API（向后兼容）
1. 设置密钥：
   ```bash
   wrangler secret put QQWEBHOOK_API_URL     # qqwebhook API 地址
   wrangler secret put QQWEBHOOK_API_TOKEN   # qqwebhook API 令牌
   wrangler secret put MCP_API_TOKEN         # MCP 服务认证令牌
   ```

2. 部署到 Cloudflare：
   ```bash
   npm run deploy
   ```

### 测试命令

#### 生产环境测试 ✅
- 测试健康检查：`curl -X GET https://mailwebhook-mcp.finbase.win/health`
- 测试 MCP 工具连接：`curl -X GET https://mailwebhook-mcp.finbase.win/mcp/tools -H "Authorization: Bearer your-token"`
- 测试邮件发送工具：使用 MCP 客户端调用 `send_email` 工具
- 测试缓存预热：`curl -X POST https://mailwebhook-mcp.finbase.win/admin/cache/warmup -H "Authorization: Bearer your-token"`
- 清除模板缓存：`curl -X DELETE https://mailwebhook-mcp.finbase.win/admin/cache/templates -H "Authorization: Bearer your-token"`

#### 开发环境测试
- 测试健康检查：`curl -X GET https://mailwebhook-mcp-dev.finbase.win/health`
- 测试 MCP 工具连接：`curl -X GET https://mailwebhook-mcp-dev.finbase.win/mcp/tools -H "Authorization: Bearer your-token"`
- 测试邮件发送工具：使用 MCP 客户端调用 `send_email` 工具
- 测试缓存预热：`curl -X POST https://mailwebhook-mcp-dev.finbase.win/admin/cache/warmup -H "Authorization: Bearer your-token"`
- 清除模板缓存：`curl -X DELETE https://mailwebhook-mcp-dev.finbase.win/admin/cache/templates -H "Authorization: Bearer your-token"`

### 安全监控命令

#### 生产环境监控 ✅
- 查看安全统计：`curl -X GET https://mailwebhook-mcp.finbase.win/admin/security/stats -H "Authorization: Bearer your-token"`
- 查看被阻止的客户端：`curl -X GET https://mailwebhook-mcp-prod.finbase.win/admin/security/blocked -H "Authorization: Bearer your-token"`
- 重置特定客户端速率限制：`curl -X POST https://mailwebhook-mcp-prod.finbase.win/admin/security/reset-rate-limit -H "Authorization: Bearer your-token" -d '{"clientId":"1.2.3.4"}'`
- 安全健康检查：`curl -X GET https://mailwebhook-mcp-prod.finbase.win/admin/security/health -H "Authorization: Bearer your-token"`
- 查看实时日志：`wrangler tail mailwebhook-mcp-prod`

#### 开发环境监控
- 查看安全统计：`curl -X GET https://mailwebhook-mcp.finbase.win/admin/security/stats -H "Authorization: Bearer your-token"`
- 查看被阻止的客户端：`curl -X GET https://mailwebhook-mcp.finbase.win/admin/security/blocked -H "Authorization: Bearer your-token"`
- 重置特定客户端速率限制：`curl -X POST https://mailwebhook-mcp.finbase.win/admin/security/reset-rate-limit -H "Authorization: Bearer your-token" -d '{"clientId":"1.2.3.4"}'`
- 安全健康检查：`curl -X GET https://mailwebhook-mcp.finbase.win/admin/security/health -H "Authorization: Bearer your-token"`

## 架构

### 核心组件

**MCP 服务器主入口 (src/index.ts)**
- 基于 Hono 的 REST API，实现 MCP 协议
- 处理 MCP 客户端连接和工具调用请求
- 集成邮件发送、模板管理、状态查询等工具

**邮件发送工具 (src/tools/emailTool.ts)**
- 实现 `send_email` MCP 工具
- 支持同步和异步邮件发送
- 调用 qqwebhook `/send` 和 `/send/async` API

**模板管理工具 (src/tools/templateTool.ts)**
- 实现 `list_email_templates` 和 `get_email_template` MCP 工具
- 管理邮件模板的查询功能
- 调用 qqwebhook `/templates` API

**状态查询工具 (src/tools/statusTool.ts)**
- 实现 `get_email_status` MCP 工具
- 查询邮件发送状态和历史记录
- 调用 qqwebhook `/status` API

**MCP 协议处理器 (src/handlers/mcpHandler.ts)**
- 处理 MCP 协议的标准消息格式
- 实现工具列表、工具调用、错误处理等功能
- 管理与 MCP 客户端的通信

**工具注册管理 (src/handlers/toolRegistry.ts)**
- 统一管理所有可用的 MCP 工具
- 处理工具的注册、发现和调用路由
- 提供工具元数据和参数验证

**缓存管理器 (src/utils/cacheManager.ts)**
- 基于 Cloudflare Cache API 的智能缓存系统
- 支持 TTL、stale-while-revalidate 等缓存策略
- 提供缓存预热、清除和健康检查功能

**HTTP 客户端 (src/utils/httpClient.ts)**
- 支持服务绑定和传统 HTTP API 双模式
- 自动重试、超时控制和错误处理
- 智能选择最佳通信方式

### 关键依赖
- `@modelcontextprotocol/sdk` - MCP 协议 SDK
- `hono` - Cloudflare Workers 的 Web 框架
- `@cloudflare/workers-types` - Workers API 的 TypeScript 类型

## 配置要求

### 服务绑定（推荐）
- `QQWEBHOOK_SERVICE` - 绑定到 qqwebhook Worker 的服务绑定
  - 提供更好的性能和安全性
  - 降低延迟和成本
  - 在 `wrangler.toml` 中配置

### 环境变量
- `MCP_SERVER_NAME` - MCP 服务器名称（默认："QQ Webhook MCP Server"）
- `MCP_SERVER_VERSION` - 服务器版本（默认："1.0.0"）
- `CORS_ORIGINS` - 允许的跨域来源，逗号分隔或 "*"

### 缓存配置
- `CACHE_ENABLED` - 是否启用缓存（默认："true"）
- `CACHE_TTL` - 缓存生存时间，秒为单位（默认："3600"）

### 安全配置（强制要求）
- `MCP_API_TOKEN` - MCP 服务器的认证令牌（**强制要求**）
- `RATE_LIMIT_ENABLED` - 是否启用速率限制（默认："true"）
- `RATE_LIMIT_WINDOW` - 速率限制窗口时间，毫秒为单位（默认："60000"）
- `RATE_LIMIT_MAX_REQUESTS` - 窗口期内最大请求数（默认："60"）
- `AUTH_REQUIRED` - 是否强制要求认证（默认："true"）

### 安全要求和限制
#### API 令牌要求
- **强制配置**：未配置 `MCP_API_TOKEN` 将导致服务启动失败
- **复杂度要求**：推荐至少 32 个字符，包含多种字符类型
- **安全存储**：必须使用 `wrangler secret` 命令设置

#### 速率限制策略
- **全局限制**：默认每分钟 60 次请求
- **端点特定限制**：
  - `/admin/*` 端点：每分钟 10 次请求
  - `/mcp/tools/call` 端点：每分钟 48 次请求
  - `/mcp/tools` 端点：每分钟 18 次请求
- **客户端识别**：基于 IP 地址进行限制

### 向后兼容配置（备选）
- `QQWEBHOOK_API_URL` - qqwebhook 邮件服务的 API 地址
- `QQWEBHOOK_API_TOKEN` - qqwebhook 服务的认证令牌

### 资源绑定
- **服务绑定优先**：优先使用 Cloudflare 服务绑定进行 Worker 间通信
- **HTTP API 备选**：支持传统 HTTP API 调用作为备选方案
- **缓存支持**：使用 Cloudflare Cache API 进行智能缓存
- **无需 KV/DB**：缓存使用 Cache API，无需额外数据库

## MCP 工具清单

### 1. send_email - 发送邮件
**描述**：发送邮件（支持同步/异步、模板/自定义内容）
**参数**：
- `to` (string): 收件人邮箱
- `subject` (string, 可选): 邮件主题
- `body` (string, 可选): 邮件正文
- `html` (string, 可选): HTML 格式邮件
- `template` (string, 可选): 模板名称
- `templateData` (object, 可选): 模板变量数据
- `async` (boolean, 可选): 是否异步发送
- `priority` (string, 可选): 邮件优先级

### 2. list_email_templates - 列出邮件模板
**描述**：获取所有可用的邮件模板列表
**参数**：无

### 3. get_email_template - 获取模板详情
**描述**：获取指定邮件模板的详细信息
**参数**：
- `name` (string): 模板名称

### 4. get_email_status - 查询邮件状态
**描述**：查询指定邮件的发送状态
**参数**：
- `messageId` (string): 邮件消息ID

## 与 qqwebhook 服务的集成

### 服务绑定调用流程（推荐）
1. **MCP 客户端** 调用 MCP 工具
2. **MCP 服务器** 解析工具调用请求
3. **服务绑定** 直接调用 qqwebhook Worker（内部通信）
4. **缓存检查** 对模板数据优先检查缓存
5. **响应处理** 将响应转换为 MCP 格式并可能缓存结果
6. **返回结果** 发送给 MCP 客户端

### HTTP API 调用流程（备选）
1. **MCP 客户端** 调用 MCP 工具
2. **MCP 服务器** 解析工具调用请求
3. **HTTP 客户端** 调用 qqwebhook REST API（外部请求）
4. **缓存检查** 对模板数据优先检查缓存
5. **响应处理** 将 API 响应转换为 MCP 格式并缓存
6. **返回结果** 发送给 MCP 客户端

### 缓存策略
- **模板列表**：缓存 1 小时，支持后台更新
- **模板详情**：缓存 1 小时，按模板名称单独缓存
- **自动失效**：使用 Cloudflare Cache API 的 TTL 机制
- **预热功能**：支持管理接口预热常用模板缓存

### 错误处理策略
- 服务绑定调用失败时自动降级到 HTTP API
- API 调用失败时返回详细错误信息
- 缓存读取失败时直接调用后端服务
- 网络超时和重试机制
- 参数验证和格式化错误提示

## 重要说明

- MCP 服务器不存储任何邮件数据，仅作为工具代理
- 所有邮件功能依赖 qqwebhook 后端服务
- 支持标准 MCP 协议，可与任何兼容的 AI 助手集成
- 认证信息通过环境变量安全管理

## 开发规则

### 代码规范
- 项目文档和注释使用中文
- 变量名和函数名使用英文，遵循驼峰命名法
- 错误消息和用户提示使用中文
- MCP 工具描述使用中文，便于AI助手理解

### 文件组织
- MCP 工具代码位于 `src/tools/` 目录
- 协议处理代码位于 `src/handlers/` 目录
- 类型定义位于 `src/types/` 目录
- 配置文件位于根目录

### 安全最佳实践
- 敏感信息（API 令牌等）必须使用 Wrangler secrets 管理
- 验证所有 MCP 工具的输入参数
- 实施适当的认证和授权检查
- HTTP 调用使用 HTTPS 和令牌认证

## 部署配置示例

### wrangler.toml 配置
```toml
name = "mailwebhook-mcp"
main = "src/index.ts"
compatibility_date = "2024-10-02"

# 启用日志
[observability]
enabled = true

# 自定义域名路由 (默认环境)
routes = [
  { pattern = "mailwebhook-mcp-dev.finbase.win/*", zone_name = "finbase.win" }
]

# 环境变量
[vars]
MCP_SERVER_NAME = "Mail Webhook MCP Server"
MCP_SERVER_VERSION = "1.0.0"
CORS_ORIGINS = "*"
RATE_LIMIT_ENABLED = "true"
RATE_LIMIT_WINDOW = "60000"
RATE_LIMIT_MAX_REQUESTS = "60"
AUTH_REQUIRED = "true"

# 生产环境配置
[env.production]
name = "mailwebhook-mcp-prod"
routes = [
  { pattern = "mailwebhook-mcp.finbase.win/*", zone_name = "finbase.win" }
]
# 生产环境变量
[env.production.vars]
MCP_SERVER_NAME = "QQ Webhook MCP Server"
MCP_SERVER_VERSION = "1.0.0"
CORS_ORIGINS = "*"
RATE_LIMIT_ENABLED = "true"
RATE_LIMIT_WINDOW = "60000"
RATE_LIMIT_MAX_REQUESTS = "60"
AUTH_REQUIRED = "true"
```

### 部署后验证

#### 生产环境验证清单 ✅
1. **健康检查**：访问 `https://mailwebhook-mcp-prod.finbase.win/health` 确认部署成功
2. **域名绑定**：确认自定义域名 `mailwebhook-mcp-prod.finbase.win` 正常工作
3. **环境变量**：验证所有必需的环境变量已正确配置
4. **安全配置**：确认认证、速率限制和 CORS 设置正常工作
5. **MCP 工具连接**：使用 MCP 客户端测试工具连接
6. **邮件功能**：发送测试邮件验证端到端功能（需要配置服务绑定）

#### 当前部署状态
- ✅ **Worker 部署成功**：`mailwebhook-mcp-prod`
- ✅ **域名路由配置**：`mailwebhook-mcp.finbase.win/*`
- ✅ **环境变量配置**：所有必需变量已设置
- ✅ **安全中间件启用**：认证、速率限制、CORS 已配置
- ✅ **日志功能启用**：observability 已配置
- ⚠️ **DNS 记录待添加**：需要手动在 Cloudflare 控制台添加
- ⚠️ **服务绑定待配置**：等待 `qqwebhook-prod` 服务可用后启用

#### 下一步操作

1. **添加 DNS 记录**（必需）：
   - 登录 Cloudflare 控制台
   - 选择 `finbase.win` 域名
   - 进入 DNS 设置
   - 添加记录：
     ```
     类型: AAAA
     名称: mailwebhook-mcp
     内容: 100::
     代理状态: 已代理（橙色云朵）
     ```

2. **配置 API 令牌**：
   ```bash
   wrangler secret put MCP_API_TOKEN --env production
   ```

3. **启用服务绑定**（当 qqwebhook-prod 可用时）：
   - 在 `wrangler.toml` 中取消注释服务绑定配置
   - 重新部署：`npm run deploy:prod`

4. **功能测试**：
   ```bash
   # 测试域名解析
   nslookup mailwebhook-mcp.finbase.win
   
   # 测试健康检查
   curl https://mailwebhook-mcp.finbase.win/health
   
   # 测试 MCP 工具（需要先设置 API 令牌）
   curl -H "Authorization: Bearer YOUR_TOKEN" https://mailwebhook-mcp.finbase.win/mcp/tools
   
   # 查看实时日志
   wrangler tail mailwebhook-mcp-prod
   ```