import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  AppConfig,
  Bounds,
  DepthFit,
  ExportResponse,
  Health,
  ImportResult,
  LabelEdit,
  Points,
  ReviewStatus,
  STRIDE,
  SaveResponse,
  VehicleResponse,
  VehicleSummary,
} from './models';

export interface WithEtag<T> {
  body: T;
  etag: string;
}

export function errorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'Server not reachable';
    const detail = err.error?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) return detail.map((d) => d.msg ?? String(d)).join('; ');
    return `${err.status} ${err.statusText}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export function isConflict(err: unknown): boolean {
  return err instanceof HttpErrorResponse && err.status === 409;
}

export function computeBounds(data: Float32Array): Bounds {
  const b: Bounds = {
    xMin: Infinity, xMax: -Infinity, yMin: Infinity, yMax: -Infinity,
    zMin: Infinity, zMax: -Infinity, rMin: Infinity, rMax: -Infinity,
  };
  for (let i = 0; i < data.length; i += STRIDE) {
    const x = data[i], y = data[i + 1], z = data[i + 2], r = data[i + 3];
    if (x < b.xMin) b.xMin = x;
    if (x > b.xMax) b.xMax = x;
    if (y < b.yMin) b.yMin = y;
    if (y > b.yMax) b.yMax = y;
    if (z < b.zMin) b.zMin = z;
    if (z > b.zMax) b.zMax = z;
    if (r < b.rMin) b.rMin = r;
    if (r > b.rMax) b.rMax = r;
  }
  if (data.length === 0) {
    return { xMin: 0, xMax: 1, yMin: 0, yMax: 1, zMin: 0, zMax: 1, rMin: 0, rMax: 1 };
  }
  return b;
}

@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);

  private url(id: string, suffix = ''): string {
    return `/api/vehicles/${encodeURIComponent(id)}${suffix}`;
  }

  config(): Promise<AppConfig> {
    return firstValueFrom(this.http.get<AppConfig>('/api/config'));
  }

  async health(): Promise<Health> {
    try {
      return await firstValueFrom(this.http.get<Health>('/api/health'));
    } catch (err) {
      // 503 still carries the details
      if (err instanceof HttpErrorResponse && err.status === 503 && err.error) return err.error;
      throw err;
    }
  }

  vehicles(rescan = false): Promise<VehicleSummary[]> {
    const params = rescan ? { rescan: 'true' } : undefined;
    return firstValueFrom(this.http.get<VehicleSummary[]>('/api/vehicles', { params }));
  }

  async vehicle(id: string): Promise<WithEtag<VehicleResponse>> {
    const r = await firstValueFrom(
      this.http.get<VehicleResponse>(this.url(id), { observe: 'response' }),
    );
    return { body: r.body!, etag: r.headers.get('ETag') ?? '' };
  }

  async save(id: string, edit: LabelEdit, etag: string): Promise<WithEtag<SaveResponse>> {
    const headers = new HttpHeaders({ 'If-Match': etag });
    const r = await firstValueFrom(
      this.http.put<SaveResponse>(this.url(id), edit, { headers, observe: 'response' }),
    );
    return { body: r.body!, etag: r.headers.get('ETag') ?? '' };
  }

  async points(id: string): Promise<Points> {
    const buffer = await firstValueFrom(
      this.http.get(this.url(id, '/points'), { responseType: 'arraybuffer' }),
    );
    const data = new Float32Array(buffer);
    return { data, count: data.length / STRIDE, bounds: computeBounds(data) };
  }

  autodepth(id: string, y: number, z: number, radius: number): Promise<DepthFit> {
    return firstValueFrom(
      this.http.post<DepthFit>(this.url(id, '/autodepth'), { y, z, radius }),
    );
  }

  async reimport(id: string, keepAxles: boolean): Promise<WithEtag<VehicleResponse>> {
    const r = await firstValueFrom(
      this.http.post<VehicleResponse>(
        this.url(id, '/reimport-prelabel'),
        { keep_axles: keepAxles },
        { observe: 'response' },
      ),
    );
    return { body: r.body!, etag: r.headers.get('ETag') ?? '' };
  }

  async acceptPcd(id: string): Promise<WithEtag<VehicleResponse>> {
    const r = await firstValueFrom(
      this.http.post<VehicleResponse>(this.url(id, '/accept-pcd'), {}, { observe: 'response' }),
    );
    return { body: r.body!, etag: r.headers.get('ETag') ?? '' };
  }

  importPrelabels(): Promise<ImportResult> {
    return firstValueFrom(this.http.post<ImportResult>('/api/prelabels/import', {}));
  }

  export(reviewStatus: ReviewStatus): Promise<ExportResponse> {
    return firstValueFrom(
      this.http.post<ExportResponse>('/api/export', { review_status: reviewStatus }),
    );
  }
}
