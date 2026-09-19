export interface ApiSuccessResponse<T> {
  data: T;
  correlationId?: string;
}

export interface ApiErrorResponse {
  error: {
    message: string;
    correlationId?: string;
    details?: unknown;
  };
}
