// File formats come from the generated types (docs/schema -> npm run gen:types).
import type {
  AxelLabels,
  GroundTruth,
  LabelAxle,
  PrelabelAxle,
  Review,
} from './generated/axel-labels.v1.schema';
import type { AxelLabelsExport } from './generated/axel-labels-export.v1.schema';

export type { AxelLabels, AxelLabelsExport, GroundTruth, LabelAxle, PrelabelAxle, Review };

export type AxleType = LabelAxle['type'];
export type ReviewStatus = Review['status'];
export type LabelState = 'none' | 'prelabel_available' | 'prelabeled' | 'edited';
export type GtState = 'missing' | 'invalid' | 'count_mismatch' | 'gap_mismatch' | 'match';

/** A label axle being edited; `key` is a client-side identity, never sent to the server. */
export interface EditAxle extends LabelAxle {
  key: number;
}

export interface VehicleSummary {
  id: string;
  has_pcd: boolean;
  has_prelabel: boolean;
  axle_count: number;
  lift_axle_count: number;
  label_state: LabelState;
  prelabel_updated: boolean;
  review_status: ReviewStatus;
  gt_state: GtState;
  stale: boolean | null;
  updated_at: string | null;
  error: string | null;
}

export interface VehicleResponse {
  doc: AxelLabels;
  summary: VehicleSummary | null;
  stale: boolean;
  prelabel_updated: boolean;
  warnings: string[];
}

export interface SaveResponse {
  doc: AxelLabels;
  summary: VehicleSummary | null;
}

export interface LabelEdit {
  axles: LabelAxle[];
  review: { status: ReviewStatus; comment: string };
}

export interface AppConfig {
  version: string;
  gt_tolerance_m: number;
  max_depth_m: number;
  prelabel_enabled: boolean;
  export_enabled: boolean;
}

export interface Health {
  ok: boolean;
  version: string;
  pcd_dir: boolean;
  pcd_count: number;
  labels_dir_writable: boolean | null;
  prelabel_dir: boolean | null;
  export_dir_writable: boolean | null;
}

export interface DepthFit {
  x_min: number;
  x_max: number;
  n_points: number;
  warning: string | null;
}

export interface ImportResult {
  imported: number;
  failed: { vehicle_id: string; error: string }[];
}

export interface ExportResponse {
  folder: string;
  manifest: AxelLabelsExport;
}

export interface Bounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
  rMin: number;
  rMax: number;
}

/** Interleaved float32 [x, y, z, reflectivity] per point. */
export interface Points {
  data: Float32Array;
  count: number;
  bounds: Bounds;
}

export const STRIDE = 4;
