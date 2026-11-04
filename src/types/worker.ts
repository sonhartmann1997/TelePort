export interface CfProperties {
  country: string;
  city: string;
  colo: string;
  asn: number;
  rayId: string;
  clientTrustScore: number;
  tlsVersion: string;
  botManagement?: {
    score: number;
    verifiedBot: boolean;
  };
}

export interface WorkerRequestData {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  cf: CfProperties;
}

export interface WorkerResponseData {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
  timestamp: string;
  error?: string;
}

export interface ConsoleLogEntry {
  id: string;
  level: 'log' | 'info' | 'warn' | 'error';
  args: string[];
  time: string;
}

export interface KVItem {
  key: string;
  value: string;
  expirationTtl?: number;
  createdAt: number;
}

export interface WorkerEnvVar {
  key: string;
  value: string;
  isSecret: boolean;
}

export interface WorkerTemplate {
  id: string;
  title: string;
  category: 'API & Routing' | 'Security & Auth' | 'Caching & Storage' | 'Traffic & Geo' | 'Transformation';
  description: string;
  recommendedMethod: string;
  recommendedPath: string;
  recommendedHeaders?: Record<string, string>;
  recommendedBody?: string;
  kvSeed?: Record<string, string>;
  envSeed?: Record<string, string>;
  code: string;
}

export interface TestCase {
  id: string;
  name: string;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
  expectedStatus: number;
  expectedHeader?: { name: string; valuePattern: string };
  expectedBodySubstring?: string;
}

export interface TestResult {
  testId: string;
  passed: boolean;
  durationMs: number;
  actualStatus?: number;
  message?: string;
}
