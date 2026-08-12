import type { ImageLoaderProps } from "next/image";

/**
 * Custom image loader wired up in `next.config.mjs` via `images.loaderFile`.
 *
 * The app is built as a static export (`output: 'export'`), so the Next.js
 * image optimization server is not available and the source URL is returned
 * untouched. The loader still receives the full Next.js contract
 * (`{ src, width, quality }`); `width` and `quality` are deliberately ignored.
 */
export default function imageLoader({ src }: ImageLoaderProps): string {
  return src;
}
