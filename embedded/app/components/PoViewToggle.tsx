import { Button, ButtonGroup } from "@shopify/polaris";

export type PoView = "list" | "kanban" | "calendar";

export function resolvePoView(value: string | null | undefined): PoView {
  if (value === "kanban") return "kanban";
  if (value === "calendar") return "calendar";
  return "list";
}

export function PoViewToggle({
  view,
  month,
  basePath = "/app/purchase-orders",
}: {
  view: PoView;
  month?: string;
  basePath?: string;
}) {
  const calendarUrl = month
    ? `${basePath}?view=calendar&month=${month}`
    : `${basePath}?view=calendar`;

  return (
    <ButtonGroup variant="segmented">
      <Button
        url={`${basePath}?view=list`}
        pressed={view === "list"}
        accessibilityLabel="List view"
      >
        List
      </Button>
      <Button
        url={calendarUrl}
        pressed={view === "calendar"}
        accessibilityLabel="Calendar view"
      >
        Calendar
      </Button>
      <Button
        url={`${basePath}?view=kanban`}
        pressed={view === "kanban"}
        accessibilityLabel="Kanban view"
      >
        Kanban
      </Button>
    </ButtonGroup>
  );
}
