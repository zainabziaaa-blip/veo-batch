
export enum JobStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface VideoJob {
  id: string;
  file: File;
  status: JobStatus;
  progress?: string; // Description of current step
  videoUrl?: string;
  error?: string;
  thumbnailUrl: string;
}

export interface ProcessingConfig {
  prompt: string;
  resolution: '720p' | '1080p';
  aspectRatio: '16:9' | '9:16';
}

export interface VertexConfig {
  projectId: string;
  location: string;
  accessToken: string;
}
