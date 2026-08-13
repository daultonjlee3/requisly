/**
 * Shopify CDN illustrations for Polaris EmptyState `image` prop.
 * Official docs use emptystate-files.png; companion SVGs are from Shopify's public CDN.
 * No custom artwork — Polaris EmptyState only accepts a URL string.
 */
export const EMPTY_STATE_IMAGE = {
  /** Orders / work queues / first PO */
  orders:
    "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png",
  /** Catalog / products / sync */
  products:
    "https://cdn.shopify.com/s/files/1/0757/9955/files/empty-state.svg",
  /** Suppliers / contacts / history */
  suppliers:
    "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png",
  /** Analytics / AI insights / charts */
  insights:
    "https://cdn.shopify.com/s/files/1/0757/9955/files/empty-state.svg",
} as const;
