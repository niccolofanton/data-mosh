export default function imageLoader({ src, width, quality }: {
  src: string;
  width: number;
  quality?: number;
}) {
  // For static export, return the src as-is since we can't optimize images
  return src;
} 