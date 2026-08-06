/** Read-only on-hand display. Never invents zeros when Shopify isn't synced. */

export type OnHandByLocation = {
  locationId: string;
  locationName: string;
  onHand: number;
};

export function OnHandCell({
  shopConnected,
  linkedToVariant,
  levels,
}: {
  shopConnected: boolean;
  linkedToVariant: boolean;
  levels: OnHandByLocation[] | null;
}) {
  if (!shopConnected) {
    return (
      <span className="small muted" title="Connect Shopify to sync on-hand">
        Not connected
      </span>
    );
  }

  if (!linkedToVariant) {
    return (
      <span className="small muted" title="Link a Shopify variant to see on-hand">
        Not linked
      </span>
    );
  }

  if (!levels || levels.length === 0) {
    return (
      <span className="small muted" title="No inventory sync data for this variant yet">
        No sync data
      </span>
    );
  }

  return (
    <div className="on-hand-stack">
      {levels.map((level) => (
        <div key={level.locationId} className="on-hand-row">
          <span className="on-hand-loc muted">{level.locationName}</span>
          <span className="mono on-hand-qty">{level.onHand}</span>
        </div>
      ))}
    </div>
  );
}
