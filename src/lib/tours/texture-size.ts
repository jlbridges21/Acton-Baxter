let memoized: number | null = null;

/** Read once, drop the context, and reuse the value. Wider panoramas need the compat file. */
export function readMaxTextureSize(): number {
  if (memoized != null) return memoized;
  if (typeof document === "undefined") {
    memoized = 4096;
    return memoized;
  }
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl");
  if (!gl) {
    memoized = 4096;
    return memoized;
  }
  const value = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  memoized = typeof value === "number" && value > 0 ? value : 4096;
  return memoized;
}

export function resetMaxTextureSizeForTests(): void {
  memoized = null;
}
