export type EmbedChrome = {
  showTitle: boolean;
  showThumbs: boolean;
  showShare: boolean;
  showFullscreen: boolean;
};

function rawParam(
  search: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = search[key];
  return Array.isArray(value) ? value[0] : value;
}

/** `=0` hides a control. Any other value, including a missing one, leaves it on. */
export function embedChrome(search: Record<string, string | string[] | undefined>): EmbedChrome {
  const hidden = (key: string) => rawParam(search, key) === "0";
  return {
    showTitle: !hidden("title"),
    showThumbs: !hidden("thumbs"),
    showShare: !hidden("share"),
    showFullscreen: !hidden("fs"),
  };
}
