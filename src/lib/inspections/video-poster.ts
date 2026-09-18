/**
 * Capture a JPEG poster from the first decodable frame of a video Blob.
 * Runs on the capturing device so HEVC/QuickTime that Chrome can't decode
 * still yields a thumbnail (the phone's decoder handles its own recording).
 */

export async function extractVideoPosterFrame(
  file: Blob,
  options?: { seekSeconds?: number; maxEdge?: number; quality?: number },
): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  const seekSeconds = options?.seekSeconds ?? 0.1;
  const maxEdge = options?.maxEdge ?? 720;
  const quality = options?.quality ?? 0.8;

  const objectUrl = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = objectUrl;

    await new Promise<void>((resolve, reject) => {
      const onError = () => reject(new Error("video decode failed"));
      video.addEventListener("loadeddata", () => resolve(), { once: true });
      video.addEventListener("error", onError, { once: true });
    });

    if (!video.videoWidth || !video.videoHeight) return null;

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const target = Math.min(seekSeconds, Math.max(0, duration > 0 ? duration * 0.05 : seekSeconds));

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
    const scale = long > maxEdge ? maxEdge / long : 1;
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
    });
    return blob;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
