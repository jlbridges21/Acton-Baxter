export class UploadAbortedError extends DOMException {
  constructor() {
    super("Upload cancelled.", "AbortError");
  }
}

export function isUploadAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * PUT the original bytes to a signed upload URL.
 * supabase-js has no upload progress callback, so the transfer is XHR.
 */
export function putSignedObject(input: {
  signedUrl: string;
  body: Blob;
  contentType: string;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  if (input.signal?.aborted) return Promise.reject(new UploadAbortedError());
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const finish = (run: () => void) => {
      if (settled) return;
      settled = true;
      input.signal?.removeEventListener("abort", onAbort);
      run();
    };
    const onAbort = () => {
      xhr.abort();
    };
    xhr.open("PUT", input.signedUrl);
    xhr.setRequestHeader("Content-Type", input.contentType);
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      input.onProgress?.(event.loaded, event.total);
    };
    xhr.onload = () => {
      finish(() => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(xhr.responseText || `Upload failed (${xhr.status}).`));
      });
    };
    xhr.onerror = () => finish(() => reject(new Error("Upload failed.")));
    xhr.onabort = () => finish(() => reject(new UploadAbortedError()));
    input.signal?.addEventListener("abort", onAbort, { once: true });
    xhr.send(input.body);
  });
}

export function formatUploadBytes(loaded: number, total: number): string {
  const text = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  return `${text(loaded)} / ${text(total)} · ${percent}%`;
}
