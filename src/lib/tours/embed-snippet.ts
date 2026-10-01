export type EmbedSnippetOptions = {
  origin: string;
  slug: string;
  showTitle: boolean;
  showThumbs: boolean;
  showShare: boolean;
  showFullscreen: boolean;
  width?: number;
  height?: number;
};

export function publicTourUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/$/, "")}/tour/${encodeURIComponent(slug)}`;
}

export function embedTourUrl(options: EmbedSnippetOptions): string {
  const url = new URL(
    `${options.origin.replace(/\/$/, "")}/embed/${encodeURIComponent(options.slug)}`,
  );
  if (!options.showTitle) url.searchParams.set("title", "0");
  if (!options.showThumbs) url.searchParams.set("thumbs", "0");
  if (!options.showShare) url.searchParams.set("share", "0");
  if (!options.showFullscreen) url.searchParams.set("fs", "0");
  return url.toString();
}

export function embedIframeSnippet(options: EmbedSnippetOptions): string {
  const width = options.width ?? 800;
  const height = options.height ?? 480;
  const src = embedTourUrl(options);
  return `<iframe src="${src}" title="Virtual tour" width="${width}" height="${height}" style="border:0;max-width:100%" allowfullscreen loading="lazy"></iframe>`;
}
