import type { BlanketPickerOption } from "./blanket-po";
import type { PoStatus } from "./po-status";

export type NewPoSupplierProduct = {
  id: string;
  supplierId: string;
  title: string;
  sku: string | null;
  unitCost: number | null;
  productVariantId: string | null;
  /** Numeric Shopify variant id (matches product_variants.shopify_variant_id). */
  shopifyVariantId: string | null;
};

/** Synced Shopify catalog variant — primary source when adding PO lines. */
export type NewPoShopifyVariant = {
  id: string;
  shopifyVariantId: string;
  title: string;
  sku: string | null;
};

export type NewPoFormData = {
  suppliers: Array<{ id: string; name: string; paymentTerms: string | null }>;
  locations: Array<{ id: string; name: string; isPrimary: boolean }>;
  /** Vendor price-list rows (used to prefill unit cost when linked). */
  products: NewPoSupplierProduct[];
  /** Synced Shopify product variants for search / add. */
  shopifyVariants: NewPoShopifyVariant[];
  /**
   * Last PO unit cost keyed by:
   * - `${supplierId}:v:${shopifyVariantId}`
   * - `${supplierId}:sku:${normalizedSku}`
   */
  priorCosts: Record<string, number>;
  defaultSupplierId: string | null;
  blankets: BlanketPickerOption[];
};

/** Prefill payload when starting a PO from a template (or edit draft). */
export type CreatePoInitialData = {
  lines?: Array<{
    key: string;
    description: string;
    sku: string;
    qty: string;
    unitCost: string;
    isFreeText: boolean;
    supplierProductId: string | null;
    shopifyVariantId: string | null;
    fromCatalogPrice: boolean;
    costSource?: "catalog" | "prior" | "manual" | null;
  }>;
  supplierId?: string;
  locationId?: string | null;
  shipDate?: string;
  notes?: string;
  paymentTerms?: string;
  referenceNumber?: string;
  taxAmount?: string;
  shippingAmount?: string;
  adjustmentAmount?: string;
  blanketPoId?: string;
};

export type ReceiptCondition =
  | "good"
  | "damaged"
  | "wrong_item"
  | "backorder";

export type ReceiveLine = {
  id: string;
  description: string;
  qty: number;
  alreadyReceived: number;
  remaining: number;
};

export type ReceiveFormData = {
  poId: string;
  poNumber: string;
  supplierName: string;
  locationName: string;
  status: PoStatus;
  lines: ReceiveLine[];
};

export type CorrectReceiptLine = {
  id: string;
  poLineItemId: string;
  description: string;
  orderedQty: number;
  qtyReceived: number;
  condition: ReceiptCondition;
  reasonNote: string | null;
};

export type CorrectReceiptFormData = {
  receiptId: string;
  poId: string;
  poNumber: string;
  supplierName: string;
  locationName: string;
  note: string | null;
  createdAt: string;
  lines: CorrectReceiptLine[];
};

export type DashRow = {
  id: string;
  href: string;
  primary: string;
  secondary: string;
  meta: string;
  status: PoStatus;
  right?: string;
  badgeLabel?: string;
  badgeTone?: "info" | "success" | "warning" | "critical" | "attention";
};
