/**
 * Capture a JPEG poster from the first decodable frame of a video Blob.
 * Runs on the capturing device so HEVC/QuickTime that Chrome can't decode
 * still yields a thumbnail (the phone's decoder handles its own recording).
 *
 * iOS Safari frequently never fires `loadeddata`/`seeked` on detached videos —
 * always bound with a timeout, and never block enqueue on this path.
 */

/** Soft deadline for on-device frame decode. Hung extracts must not stall upload. */
export const VIDEO_POSTER_EXTRACT_TIMEOUT_MS = 4_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function extractVideoPosterFrame(
  file: Blob,
  options?: { seekSeconds?: number; maxEdge?: number; quality?: number; timeoutMs?: number },
): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  const seekSeconds = options?.seekSeconds ?? 0.1;
  const maxEdge = options?.maxEdge ?? 720;
  const quality = options?.quality ?? 0.8;
  const timeoutMs = options?.timeoutMs ?? VIDEO_POSTER_EXTRACT_TIMEOUT_MS;

  try {
    return await withTimeout(
      extractVideoPosterFrameInner(file, { seekSeconds, maxEdge, quality }),
      timeoutMs,
      "video poster extract",
    );
  } catch (error) {
    console.warn("[site-inspection-media] poster extract failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function extractVideoPosterFrameInner(
  file: Blob,
  options: { seekSeconds: number; maxEdge: number; quality: number },
): Promise<Blob | null> {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  // iOS: decode generally requires muted + playsinline, and a DOM-attached element.
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.preload = "auto";
  video.style.cssText =
    "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;";
  document.body.appendChild(video);

  try {
    video.src = objectUrl;

    await new Promise<void>((resolve, reject) => {
      const onError = () => reject(new Error("video decode failed"));
      video.addEventListener("loadeddata", () => resolve(), { once: true });
      video.addEventListener("error", onError, { once: true });
      // Kick decode on iOS — play().catch is fine while muted.
      void video
        .play()
        .then(() => {
          video.pause();
        })
        .catch(() => {
          /* ignore — loadeddata may still fire */
        });
    });

    if (!video.videoWidth || !video.videoHeight) return null;

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const target = Math.min(
      options.seekSeconds,
      Math.max(0, duration > 0 ? duration * 0.05 : options.seekSeconds),
    );

    await new Promise<void>((resolve, reject) => {
      const onSeeked = () => resolve();
      const onError = () => reject(new Error("video seek failed"));
      video.addEventListener("seeked", onSeeked, { once: true });
      video.addEventListener("error", onError, { once: true });
      try {
        video.currentTime = target;
      } catch {
        resolve(); // some browsers refuse seek; draw frame 0
      }
    });

    const long = Math.max(video.videoWidth, video.videoHeight);
    const scale = long > options.maxEdge ? options.maxEdge / long : 1;
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", options.quality);
    });
  } finally {
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch {
      /* ignore */
    }
    video.remove();
    URL.revokeObjectURL(objectUrl);
  }
}
