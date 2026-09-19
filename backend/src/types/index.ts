export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  uptime: number;
  version: string;
  dbConnected: boolean;
  timestamp: string;
}

export interface ApiErrorResponse {
  error: {
    message: string;
    code?: string;
    correlationId: string;
    details?: unknown;
  };
}
