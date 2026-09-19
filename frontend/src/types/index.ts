export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  uptime: number;
  version: string;
  dbConnected: boolean;
  timestamp: string;
}

export interface ApiError {
  message: string;
  statusCode: number;
  correlationId?: string;
  details?: unknown;
}
