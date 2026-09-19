import { api } from './client';
import { HealthStatus } from '../types';

export async function fetchHealth(): Promise<HealthStatus> {
  return api.get<HealthStatus>('/health');
}
