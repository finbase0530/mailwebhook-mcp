# MailWebhook MCP 服务器

基于 Cloudflare Workers 的 MCP (Model Context Protocol) 服务器，为 AI 助手提供邮件发送功能工具。

## 功能特性

- ✅ **邮件发送**: 支持同步/异步发送，支持纯文本和 HTML 格式
- ✅ **模板管理**: 查询和使用邮件模板，带智能缓存
- ✅ **状态跟踪**: 查询邮件发送状态和历史记录
- ✅ **多传输协议**: 支持 HTTP REST、SSE 实时流和 Streamable HTTP
- ✅ **MCP 协议兼容**: 完全符合 Model Context Protocol 2024-11-05 标准
- ✅ **安全认证**: API 令牌认证，CORS 保护，Bearer Token 支持
- ✅ **服务绑定**: 使用 Cloudflare 服务绑定实现高性能 Worker 间通信
- ✅ **智能缓存**: 基于 Cloudflare Cache API 的模板缓存系统
- ✅ **错误处理**: 完善的错误处理和重试机制
- ✅ **类型安全**: 完整的 TypeScript 类型定义

## 快速开始

### 1. 环境准备

```bash
# 克隆项目
git clone <repository-url>
cd mailwebhook-mcp

# 安装依赖
npm install
```

### 2. 配置通信方式

#### 方式一：服务绑定（推荐）
在 `wrangler.toml` 中配置服务绑定：

```toml
[[services]]
binding = "QQWEBHOOK_SERVICE"
service = "qqwebhook"  # 您的 qqwebhook Worker 名称
```

设置可选的认证密钥：
```bash
wrangler secret put MCP_API_TOKEN         # MCP 服务认证令牌（可选）
```

#### 方式二：HTTP API（备选）
如果无法使用服务绑定，设置传统 HTTP API 配置：

```bash
# qqwebhook API 配置
wrangler secret put QQWEBHOOK_API_URL     # qqwebhook API 地址
wrangler secret put QQWEBHOOK_API_TOKEN   # qqwebhook API 令牌

# MCP 服务认证（可选）
wrangler secret put MCP_API_TOKEN         # MCP 服务认证令牌
```

### 3. 本地开发

```bash
# 启动开发服务器
npm run dev
```

### 4. 部署

```bash
# 部署到默认环境
npm run deploy

# 部署到生产环境
npm run deploy:prod
```

## MCP 工具

### send_email - 发送邮件
发送邮件（支持同步/异步、模板/自定义内容）

**参数：**
- `to` (string, 必需): 收件人邮箱
- `subject` (string, 可选): 邮件主题
- `body` (string, 可选): 邮件正文
- `html` (string, 可选): HTML 格式邮件
- `template` (string, 可选): 模板名称
- `templateData` (object, 可选): 模板变量数据
- `async` (boolean, 可选): 是否异步发送
- `priority` (string, 可选): 邮件优先级 (low/normal/high)

### list_email_templates - 列出邮件模板
获取所有可用的邮件模板列表

### get_email_template - 获取模板详情
获取指定邮件模板的详细信息

**参数：**
- `name` (string, 必需): 模板名称

### get_email_status - 查询邮件状态
查询指定邮件的发送状态

**参数：**
- `messageId` (string, 必需): 邮件消息ID

## MCP 传输协议

本服务器支持多种 MCP 传输协议，可根据需要选择最适合的方式：

### 🔥 推荐：Streamable HTTP（最稳定）

**最符合 MCP 2024-11-05 标准，支持批量请求和双向通信**

```bash
# 初始化连接
curl -X POST "https://your-domain.com/mcp/v1" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"initialize","params":{"protocolVersion":"2024-11-05","clientInfo":{"name":"Client","version":"1.0"}}}'

# 获取工具列表
curl -X POST "https://your-domain.com/mcp/v1" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"2","method":"tools/list"}'

# 调用工具
curl -X POST "https://your-domain.com/mcp/v1" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"3","method":"tools/call","params":{"name":"send_email","arguments":{"to":"test@example.com","subject":"Test"}}}'
```

### 📡 SSE 实时流传输

**适合需要实时通信的 MCP 客户端，双端点架构**

```bash
# 1. 建立 SSE 连接（获取会话ID）
curl "https://your-domain.com/mcp/sse?token=YOUR_TOKEN" \
  -H "Accept: text/event-stream"
# 返回: event: endpoint\ndata: /mcp/sse/message?sessionId=xxx

# 2. 发送消息到会话端点
curl -X POST "https://your-domain.com/mcp/sse/message?sessionId=SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"initialize","params":{"protocolVersion":"2024-11-05"}}'
```

### 🔧 传统 HTTP 端点（兼容性）

**向后兼容的独立端点**

```bash
# MCP 初始化
curl -X POST "https://your-domain.com/mcp/initialize" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"

# 获取工具列表  
curl -X GET "https://your-domain.com/mcp/tools" \
  -H "Authorization: Bearer YOUR_TOKEN"

# 调用工具
curl -X POST "https://your-domain.com/mcp/tools/call" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"params":{"name":"send_email","arguments":{"to":"test@example.com","subject":"Test"}}}'
```

## MCP 客户端配置

### HTTP 模式配置（推荐）

```json
{
  "mcpServers": {
    "mailwebhook-mcp": {
      "transport": {
        "type": "http",
        "url": "https://your-domain.com/mcp/v1"
      },
      "auth": {
        "type": "bearer",
        "token": "YOUR_API_TOKEN"
      },
      "description": "邮件发送 MCP 服务器"
    }
  }
}
```

### SSE 模式配置

```json
{
  "mcpServers": {
    "mailwebhook-mcp-sse": {
      "transport": {
        "type": "sse",
        "url": "https://your-domain.com/mcp/sse?token=YOUR_API_TOKEN"
      },
      "description": "邮件发送 MCP 服务器 (SSE模式)"
    }
  }
}
```

## API 端点参考

### 核心 MCP 端点
- `POST/GET /mcp/v1` - **Streamable HTTP 端点**（推荐）
- `GET /mcp/sse` - **SSE 连接端点**
- `POST /mcp/sse/message` - **SSE 消息端点**
- `POST /mcp/initialize` - MCP 初始化（兼容性）
- `GET /mcp/tools` - 获取工具列表（兼容性）
- `POST /mcp/tools/call` - 调用工具（兼容性）

### 系统端点
- `GET /health` - 健康检查
- `GET /` - API 信息和端点列表

### 管理端点（需认证）
- `GET /admin/info` - 系统信息和配置状态
- `GET /admin/mcp/stats` - MCP 传输协议统计信息
- `POST /admin/cache/warmup` - 预热模板缓存
- `DELETE /admin/cache/templates` - 清除模板缓存

### 安全监控端点（需认证）
- `GET /admin/security/stats` - 安全统计和状态报告
- `GET /admin/security/blocked` - 查看被速率限制阻止的客户端
- `POST /admin/security/reset-rate-limit` - 重置特定客户端的速率限制
- `POST /admin/security/reset-all-rate-limits` - 重置所有客户端的速率限制
- `GET /admin/security/health` - 安全系统健康检查

## 安全配置

### 认证（强制要求）

⚠️ **重要变更**：`MCP_API_TOKEN` 现在是**强制要求**的，服务器启动时会验证其存在。

**认证方式**：
- 请求头：`Authorization: Bearer <token>`
- 查询参数：`?token=<token>`

**令牌要求**：
- 最少 32 个字符
- 包含大写字母、小写字母、数字和特殊字符中的至少三种
- 避免使用常见的弱令牌模式

### CORS

配置 `CORS_ORIGINS` 环境变量：
- `*` - 允许所有来源（开发环境）
- `https://example.com,https://app.example.com` - 允许特定域名

### 安全特性

- ✅ **强制 API 令牌认证**：所有受保护端点必需认证
- ✅ **多层速率限制**：不同端点有不同的限制阈值
- ✅ **智能客户端识别**：基于 IP 地址进行追踪
- ✅ **安全配置验证**：启动时检查安全配置完整性
- ✅ **实时安全监控**：提供安全状态和被阻止客户端的监控
- ✅ **请求体大小限制**：防止过大载荷攻击（1MB）
- ✅ **全面安全响应头**：包括 CSP、HSTS 等
- ✅ **输入验证和清理**：防止注入攻击
- ✅ **错误信息安全处理**：不泄露敏感信息

## 部署配置

### wrangler.toml 示例

```toml
name = "mailwebhook-mcp"
main = "src/index.ts"
compatibility_date = "2024-10-02"

# 自定义域名路由
routes = [
  { pattern = "mailwebhook-mcp.finbase.win/*", zone_name = "finbase.win" }
]

# 服务绑定（推荐）
[[services]]
binding = "QQWEBHOOK_SERVICE"
service = "qqwebhook"  # qqwebhook Worker 名称

# 环境变量
[vars]
MCP_SERVER_NAME = "QQ Webhook MCP Server"
MCP_SERVER_VERSION = "1.0.0"
CORS_ORIGINS = "*"
CACHE_ENABLED = "true"
CACHE_TTL = "3600"
# 安全配置
RATE_LIMIT_ENABLED = "true"
RATE_LIMIT_WINDOW = "60000"
RATE_LIMIT_MAX_REQUESTS = "60"
AUTH_REQUIRED = "true"

# 生产环境配置
[env.production]
name = "mailwebhook-mcp-prod"
routes = [
  { pattern = "mailwebhook-mcp-prod.finbase.win/*", zone_name = "finbase.win" }
]

[[env.production.services]]
binding = "QQWEBHOOK_SERVICE"
service = "qqwebhook-prod"
```

### 环境变量

**服务绑定配置（推荐）：**
- `QQWEBHOOK_SERVICE` - qqwebhook Worker 的服务绑定（在 wrangler.toml 中配置）

**缓存配置：**
- `CACHE_ENABLED` - 是否启用缓存（默认："true"）
- `CACHE_TTL` - 缓存生存时间，秒（默认："3600"）

**安全配置（必需）：**
- `MCP_API_TOKEN` - MCP 服务器的认证令牌（**强制要求**）

**速率限制配置：**
- `RATE_LIMIT_ENABLED` - 是否启用速率限制（默认："true"）
- `RATE_LIMIT_WINDOW` - 限制窗口时间，毫秒（默认："60000"）
- `RATE_LIMIT_MAX_REQUESTS` - 窗口期内最大请求数（默认："60"）
- `AUTH_REQUIRED` - 是否强制认证（默认："true"）

**可选配置：**
- `MCP_SERVER_NAME` - 服务器名称（默认："QQ Webhook MCP Server"）
- `MCP_SERVER_VERSION` - 服务器版本（默认："1.0.0"）
- `CORS_ORIGINS` - 允许的跨域来源

**备选 HTTP API 配置：**
- `QQWEBHOOK_API_URL` - qqwebhook 邮件服务的 API 地址
- `QQWEBHOOK_API_TOKEN` - qqwebhook 服务的认证令牌

## 开发

### 项目结构

```
src/
├── handlers/          # MCP 协议处理
├── tools/            # MCP 工具实现
├── middleware/       # 安全中间件
├── utils/           # 工具函数
├── types/           # TypeScript 类型
└── index.ts         # 主入口文件
```

### 代码规范

- 使用 TypeScript 进行类型检查
- 使用 ESLint 进行代码检查
- 遵循项目内的命名约定
- 所有 API 调用需要错误处理

### 测试

#### 代码检查和构建测试
```bash
# 类型检查
npm run type-check

# 代码检查
npm run lint

# 测试部署
npm run dev
```

#### 功能测试

**使用 Python 测试脚本（推荐）**

本项目包含完整的 Python 测试脚本，用于验证 MCP 服务和 qqwebhook 服务的中文邮件处理功能。

1. **配置测试环境**：
   ```bash
   # 安装测试依赖
   pip install requests python-dotenv

   # 复制配置模板
   cp .env.example .env
   
   # 编辑 .env 文件，填入您的配置
   ```

2. **配置 .env 文件**：
   ```env
   # 必需配置
   TEST_EMAIL=your_test_email@example.com
   MCP_API_TOKEN=your_mcp_token_here
   QQWEBHOOK_API_TOKEN=your_qqwebhook_token_here
   
   # 可选配置
   DEBUG_VERBOSE=true
   SAVE_TEST_RESULTS=true
   ```

3. **运行测试**：
   ```bash
   # 运行完整测试套件
   python test_encoding_new.py
   
   # 或使用旧版简化脚本
   python test_encoding.py
   ```

**测试功能**：
- ✅ **编码分析**：分析 UTF-8 编码处理
- ✅ **MCP 工具列表**：验证所有 MCP 工具可用性
- ✅ **直接 qqwebhook 测试**：验证后端服务正常
- ✅ **MCP 服务测试**：验证通过 MCP 发送邮件
- ✅ **中文字符测试**：确保中文邮件正确显示
- ✅ **结果保存**：可选择保存测试结果到 JSON 文件

**使用 curl 测试（基础测试）**

```bash
# 健康检查
curl -X GET https://mailwebhook-mcp.finbase.win/health

# 获取工具列表
curl -X GET https://mailwebhook-mcp.finbase.win/mcp/tools \
  -H "Authorization: Bearer your-token"

# 发送测试邮件
curl -X POST https://mailwebhook-mcp.finbase.win/mcp/tools/call \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "name": "send_email",
      "arguments": {
        "to": "test@example.com",
        "subject": "测试邮件",
        "body": "这是一封测试邮件"
      }
    }
  }'
```

**注意事项**：
- Windows 用户使用 curl 可能遇到中文编码问题，建议使用 Python 脚本
- Python 脚本正确处理 UTF-8 编码，确保中文邮件显示正常
- 测试前请确保已正确配置 API 令牌和邮箱地址

## 故障排除

### 常见问题

1. **认证失败** - 检查 `MCP_API_TOKEN` 配置
2. **CORS 错误** - 检查 `CORS_ORIGINS` 配置
3. **邮件发送失败** - 检查 qqwebhook API 配置和网络连接

### 调试

```bash
# 查看实时日志
wrangler tail

# 检查部署状态
wrangler deployments list
```

## 许可证

MIT License