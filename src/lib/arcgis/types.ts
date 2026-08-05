export type ArcgisPoint = {
  x: number;
  y: number;
};

export type ArcgisRing = number[][];

export type ArcgisPolygonGeometry = {
  rings: ArcgisRing[];
  spatialReference?: {
    wkid?: number;
    latestWkid?: number;
  };
};

export type ArcgisQueryParams = {
  where?: string;
  geometry?: string;
  geometryType?: "esriGeometryPoint" | "esriGeometryPolygon" | "esriGeometryEnvelope";
  inSR?: string | number;
  outSR?: string | number;
  spatialRel?: string;
  outFields?: string;
  returnGeometry?: boolean;
  resultRecordCount?: number;
  orderByFields?: string;
  /** Buffer distance for spatial queries (requires units). */
  distance?: number;
  /** e.g. esriSRUnit_Foot */
  units?: string;
};

export type ArcgisRequestResult<T> = {
  data: T;
  responseTimeMs: number;
  httpStatus: number;
  endpoint: string;
};
