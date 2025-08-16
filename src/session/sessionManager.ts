/**
 * SSE会话管理器
 * 负责管理所有活跃的SSE连接会话
 */

import { SSETransport } from '../transports/sseTransport';

export interface SessionInfo {
  id: string;
  transport: SSETransport;
  createdAt: Date;
  lastActivityAt: Date;
  clientInfo?: {
    userAgent?: string;
    ip?: string;
  };
}

export interface SessionStats {
  total: number;
  active: number;
  expired: number;
  oldestSession?: Date;
  newestSession?: Date;
}

export class SSESessionManager {
  private static sessions = new Map<string, SessionInfo>();
  private static readonly SESSION_TIMEOUT = 5 * 60 * 1000; // 5分钟超时
  private static readonly MAX_SESSIONS = 100; // 最大连接数
  private static readonly CLEANUP_INTERVAL = 60 * 1000; // 1分钟清理一次
  private static lastCleanup = Date.now();

  /**
   * 创建新会话
   */
  static createSession(clientInfo?: { userAgent?: string; ip?: string }): string {
    // 清理过期会话
    this.cleanupExpiredSessions();

    // 检查连接数限制
    if (this.sessions.size >= this.MAX_SESSIONS) {
      this.cleanupOldestSessions(Math.floor(this.MAX_SESSIONS * 0.1)); // 清理10%最老的连接
    }

    const sessionId = crypto.randomUUID();
    const now = new Date();

    // 注意：transport 将在 addSession 中设置
    const sessionInfo: SessionInfo = {
      id: sessionId,
      transport: null as any, // 临时设置，稍后会被替换
      createdAt: now,
      lastActivityAt: now,
      clientInfo
    };

    return sessionId;
  }

  /**
   * 添加会话到管理器
   */
  static addSession(sessionId: string, transport: SSETransport, clientInfo?: { userAgent?: string; ip?: string }): void {
    const now = new Date();
    
    const sessionInfo: SessionInfo = {
      id: sessionId,
      transport,
      createdAt: now,
      lastActivityAt: now,
      clientInfo
    };

    this.sessions.set(sessionId, sessionInfo);
    
    console.log(`SSE会话已创建: ${sessionId}, 当前会话数: ${this.sessions.size}`);
  }

  /**
   * 获取会话
   */
  static getSession(sessionId: string): SSETransport | undefined {
    const sessionInfo = this.sessions.get(sessionId);
    
    if (!sessionInfo) {
      return undefined;
    }

    // 检查会话是否过期
    if (this.isSessionExpired(sessionInfo)) {
      this.removeSession(sessionId);
      return undefined;
    }

    // 更新最后活动时间
    sessionInfo.lastActivityAt = new Date();
    
    return sessionInfo.transport;
  }

  /**
   * 移除会话
   */
  static removeSession(sessionId: string): void {
    const sessionInfo = this.sessions.get(sessionId);
    
    if (sessionInfo) {
      // 关闭传输连接
      sessionInfo.transport.close().catch(error => {
        console.error(`关闭会话 ${sessionId} 的传输连接时发生错误:`, error);
      });

      this.sessions.delete(sessionId);
      console.log(`SSE会话已移除: ${sessionId}, 剩余会话数: ${this.sessions.size}`);
    }
  }

  /**
   * 获取所有活跃会话
   */
  static getAllSessions(): Map<string, SessionInfo> {
    this.cleanupExpiredSessions();
    return new Map(this.sessions);
  }

  /**
   * 获取会话统计信息
   */
  static getSessionStats(): SessionStats {
    this.cleanupExpiredSessions();
    
    const sessions = Array.from(this.sessions.values());
    const now = Date.now();
    
    const active = sessions.filter(s => !this.isSessionExpired(s)).length;
    const expired = sessions.length - active;
    
    const createdTimes = sessions.map(s => s.createdAt.getTime());
    const oldestSession = createdTimes.length > 0 ? new Date(Math.min(...createdTimes)) : undefined;
    const newestSession = createdTimes.length > 0 ? new Date(Math.max(...createdTimes)) : undefined;

    return {
      total: sessions.length,
      active,
      expired,
      oldestSession,
      newestSession
    };
  }

  /**
   * 广播消息到所有活跃会话
   */
  static async broadcastToAll(message: any): Promise<number> {
    const sessions = Array.from(this.sessions.values());
    let successCount = 0;

    for (const sessionInfo of sessions) {
      try {
        if (!this.isSessionExpired(sessionInfo) && !sessionInfo.transport.isClosed()) {
          await sessionInfo.transport.sendMessage(message);
          successCount++;
        }
      } catch (error) {
        console.error(`向会话 ${sessionInfo.id} 广播消息失败:`, error);
        // 如果发送失败，移除该会话
        this.removeSession(sessionInfo.id);
      }
    }

    return successCount;
  }

  /**
   * 向特定会话发送心跳
   */
  static async sendHeartbeatToSession(sessionId: string): Promise<boolean> {
    const sessionInfo = this.sessions.get(sessionId);
    
    if (!sessionInfo || this.isSessionExpired(sessionInfo)) {
      return false;
    }

    try {
      await sessionInfo.transport.sendHeartbeat();
      sessionInfo.lastActivityAt = new Date();
      return true;
    } catch (error) {
      console.error(`向会话 ${sessionId} 发送心跳失败:`, error);
      this.removeSession(sessionId);
      return false;
    }
  }

  /**
   * 向所有会话发送心跳
   */
  static async sendHeartbeatToAll(): Promise<number> {
    const sessions = Array.from(this.sessions.values());
    let successCount = 0;

    for (const sessionInfo of sessions) {
      if (await this.sendHeartbeatToSession(sessionInfo.id)) {
        successCount++;
      }
    }

    return successCount;
  }

  /**
   * 检查会话是否过期
   */
  private static isSessionExpired(sessionInfo: SessionInfo): boolean {
    const now = Date.now();
    return (now - sessionInfo.lastActivityAt.getTime()) > this.SESSION_TIMEOUT;
  }

  /**
   * 清理过期会话
   */
  static cleanupExpiredSessions(): number {
    const now = Date.now();
    
    // 限制清理频率，避免过于频繁的清理操作
    if (now - this.lastCleanup < this.CLEANUP_INTERVAL) {
      return 0;
    }

    this.lastCleanup = now;
    
    const expiredSessions: string[] = [];
    
    for (const [sessionId, sessionInfo] of this.sessions) {
      if (this.isSessionExpired(sessionInfo) || sessionInfo.transport.isClosed()) {
        expiredSessions.push(sessionId);
      }
    }

    for (const sessionId of expiredSessions) {
      this.removeSession(sessionId);
    }

    if (expiredSessions.length > 0) {
      console.log(`清理了 ${expiredSessions.length} 个过期的SSE会话`);
    }

    return expiredSessions.length;
  }

  /**
   * 清理最老的会话（当达到连接数限制时）
   */
  private static cleanupOldestSessions(count: number): number {
    const sessions = Array.from(this.sessions.entries())
      .sort(([, a], [, b]) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, count);

    for (const [sessionId] of sessions) {
      this.removeSession(sessionId);
    }

    if (sessions.length > 0) {
      console.log(`清理了 ${sessions.length} 个最老的SSE会话以释放连接`);
    }

    return sessions.length;
  }

  /**
   * 强制清理所有会话（用于关闭服务或紧急情况）
   */
  static cleanupAllSessions(): number {
    const sessionCount = this.sessions.size;
    
    for (const [sessionId] of this.sessions) {
      this.removeSession(sessionId);
    }

    console.log(`强制清理了所有 ${sessionCount} 个SSE会话`);
    return sessionCount;
  }

  /**
   * 健康检查
   */
  static healthCheck(): { status: 'healthy' | 'degraded' | 'unhealthy'; details: any } {
    const stats = this.getSessionStats();
    const utilizationRate = stats.total / this.MAX_SESSIONS;

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    if (utilizationRate > 0.9) {
      status = 'unhealthy';
    } else if (utilizationRate > 0.7 || stats.expired > stats.active) {
      status = 'degraded';
    }

    return {
      status,
      details: {
        ...stats,
        maxSessions: this.MAX_SESSIONS,
        utilizationRate: Math.round(utilizationRate * 100) + '%',
        sessionTimeout: this.SESSION_TIMEOUT,
        lastCleanup: new Date(this.lastCleanup).toISOString()
      }
    };
  }
}