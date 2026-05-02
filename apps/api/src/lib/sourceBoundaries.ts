/**
 * Side-channel for passing per-source boundaries from videoCompilation
 * → videoProcessing → clipAnalyzer in the same process. Lives in its
 * own module to avoid the circular import that occurs when
 * videoCompilation imports VideoProcessingService (default export) and
 * videoProcessing tries to import a named function back from
 * videoCompilation — the named binding is undefined during
 * partial-evaluation and the map is never populated.
 */
export type SourceBoundary = { start: number; end: number; fileName: string }

const sourceBoundariesByUploadId = new Map<string, SourceBoundary[]>()

export function setSourceBoundariesForUpload(uploadId: string, boundaries: SourceBoundary[]): void {
  sourceBoundariesByUploadId.set(uploadId, boundaries)
}

export function takeSourceBoundariesForUpload(uploadId: string): SourceBoundary[] | undefined {
  const v = sourceBoundariesByUploadId.get(uploadId)
  if (v) sourceBoundariesByUploadId.delete(uploadId)
  return v
}
