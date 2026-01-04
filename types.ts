export interface ProcessedPointCloud {
  positions: Float32Array;
  colors: Float32Array;
  count: number;
  width: number;
  height: number;
}

export interface HandGestures {
  rotation: { x: number; y: number };
  scale: number;
  isTracking: boolean;
  isExploding: boolean;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

export type ViewMode = 'points' | 'voxels' | 'scene';