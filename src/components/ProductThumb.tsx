import { ImageIcon } from "lucide-react";

/** Small square product image, or a plain placeholder when Shopify hasn't synced yet. */
export function ProductThumb({
  imageUrl,
  alt,
}: {
  imageUrl: string | null | undefined;
  alt: string;
}) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Shopify CDN URLs; no remotePatterns yet
      <img src={imageUrl} alt={alt} className="product-thumb" />
    );
  }

  return (
    <span className="product-thumb product-thumb-placeholder" aria-hidden>
      <ImageIcon size={16} strokeWidth={1.5} />
    </span>
  );
}
