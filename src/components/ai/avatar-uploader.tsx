"use client";

import { useEffect, useRef, useState } from "react";
import { ImageUp, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AgentAvatar, Notice, aiFetch, errorMessage } from "./ui";

const OUTPUT_SIZE = 512;
const ACCEPT = ["image/png", "image/jpeg", "image/webp"];

/**
 * Choose → square crop (zoom + drag) → preview → upload. Cropping happens in the
 * browser; the server re-validates the image bytes and size.
 */
export function AvatarUploader({
  slug,
  name,
  url,
  color,
  onChanged,
}: {
  slug: string;
  name: string;
  url: string | null;
  color: string | null;
  onChanged: (url: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const size = canvas.width;
    const scale = (size / Math.min(image.width, image.height)) * zoom;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(
      image,
      (size - image.width * scale) / 2 + offset.x,
      (size - image.height * scale) / 2 + offset.y,
      image.width * scale,
      image.height * scale,
    );
  }, [image, zoom, offset]);

  function choose(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (!ACCEPT.includes(file.type)) return setError("Choose a PNG, JPEG, or WebP image.");
    if (file.size > 10 * 1024 * 1024) return setError("That image is larger than 10 MB.");
    const img = new Image();
    img.onload = () => {
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setImage(img);
    };
    img.onerror = () => setError("That file couldn't be read as an image.");
    img.src = URL.createObjectURL(file);
  }

  async function save() {
    if (!image) return;
    setBusy(true);
    setError(null);
    try {
      const out = document.createElement("canvas");
      out.width = OUTPUT_SIZE;
      out.height = OUTPUT_SIZE;
      const ctx = out.getContext("2d")!;
      const preview = canvasRef.current!;
      ctx.drawImage(preview, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      const blob = await new Promise<Blob | null>((resolve) =>
        out.toBlob(resolve, "image/webp", 0.9),
      );
      if (!blob) throw new Error("Couldn't prepare the image.");
      const form = new FormData();
      form.append("file", new File([blob], "portrait.webp", { type: blob.type || "image/png" }));
      const res = await aiFetch<{ avatarUrl: string }>(`/api/ai/agents/${slug}/avatar`, {
        method: "POST",
        body: form,
      });
      onChanged(res.avatarUrl);
      setImage(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      const res = await aiFetch<{ avatarUrl: string | null }>(`/api/ai/agents/${slug}/avatar`, {
        method: "DELETE",
      });
      onChanged(res.avatarUrl);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <AgentAvatar name={name} url={url} size={80} color={color} />
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            <ImageUp className="h-4 w-4" /> Replace portrait
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={reset} disabled={busy}>
            <RotateCcw className="h-4 w-4" /> Use default
          </Button>
        </div>
        <p className="text-xs text-[var(--acton-muted)]">
          PNG, JPEG, or WebP. You can crop before saving.
        </p>
        {error ? <p className="text-xs font-medium text-red-700">{error}</p> : null}
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT.join(",")}
          className="hidden"
          onChange={(e) => {
            choose(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      <Dialog open={Boolean(image)} onClose={() => setImage(null)}>
        <DialogHeader>
          <DialogTitle>Crop portrait</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col items-center gap-4">
            <canvas
              ref={canvasRef}
              width={280}
              height={280}
              className="h-[280px] w-[280px] cursor-move touch-none rounded-full border-4 border-[var(--acton-border)]"
              aria-label="Drag to reposition the portrait"
              onPointerDown={(e) => {
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
              }}
              onPointerMove={(e) => {
                if (drag.current)
                  setOffset({
                    x: drag.current.ox + e.clientX - drag.current.x,
                    y: drag.current.oy + e.clientY - drag.current.y,
                  });
              }}
              onPointerUp={() => (drag.current = null)}
            />
            <label className="flex w-full items-center gap-3 text-sm text-[var(--acton-navy)]">
              Zoom
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1"
              />
            </label>
            {error ? <Notice tone="error">{error}</Notice> : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setImage(null)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save portrait"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
