import {
  Banner,
  BlockStack,
  Checkbox,
  FormLayout,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import {
  firstRunOnOrAfter,
  normalizeKind,
  utcToday,
  type RecurringSchedule,
  type ScheduleKind,
} from "../lib/recurring-po";

type Props = {
  schedule: RecurringSchedule;
  onChange: (next: RecurringSchedule) => void;
  lastError?: string | null;
};

export function RecurringScheduleFields({
  schedule,
  onChange,
  lastError,
}: Props) {
  function patch(partial: Partial<RecurringSchedule>) {
    const next = { ...schedule, ...partial };
    if (partial.enabled && !schedule.enabled) {
      const kind: ScheduleKind =
        next.kind === "off" ? "every_n_days" : next.kind;
      const seeded = { ...next, enabled: true, kind };
      next.enabled = true;
      next.kind = kind;
      if (!next.nextRunOn) {
        next.nextRunOn = firstRunOnOrAfter(seeded, utcToday());
      }
    }
    onChange(next);
  }

  return (
    <BlockStack gap="300">
      <Text as="h2" variant="headingMd">
        Recurring schedule
      </Text>
      <Text as="p" variant="bodySm" tone="subdued">
        On the scheduled day we create a draft purchase order from this
        template. It is never sent — you review and send it yourself.
      </Text>
      {lastError ? (
        <Banner tone="warning" title="Last scheduled draft failed">
          <p>{lastError}</p>
        </Banner>
      ) : null}
      <Checkbox
        label="Turn this into a recurring PO"
        checked={schedule.enabled}
        onChange={(checked) => patch({ enabled: checked })}
      />
      {schedule.enabled ? (
        <FormLayout>
          <Select
            label="Frequency"
            options={[
              { label: "Every N days", value: "every_n_days" },
              { label: "Every N weeks", value: "every_n_weeks" },
              { label: "Specific day of month", value: "day_of_month" },
            ]}
            value={schedule.kind === "off" ? "every_n_days" : schedule.kind}
            onChange={(value) =>
              patch({ kind: normalizeKind(value) })
            }
          />
          {schedule.kind !== "day_of_month" ? (
            <TextField
              label={
                schedule.kind === "every_n_weeks" ? "Every N weeks" : "Every N days"
              }
              type="number"
              min={1}
              max={365}
              value={String(schedule.interval)}
              onChange={(value) =>
                patch({ interval: Number(value) || 1 })
              }
              autoComplete="off"
            />
          ) : (
            <TextField
              label="Day of month"
              type="number"
              min={1}
              max={28}
              value={String(schedule.dayOfMonth ?? 1)}
              onChange={(value) =>
                patch({ dayOfMonth: Number(value) || 1 })
              }
              autoComplete="off"
              helpText="Uses day 1–28 so every month has that date."
            />
          )}
          <TextField
            label="Next draft on"
            type="date"
            value={schedule.nextRunOn ?? ""}
            onChange={(value) => patch({ nextRunOn: value || null })}
            autoComplete="off"
            helpText="The cron creates a draft on this date, then advances to the next occurrence."
          />
          <TextField
            label="Show on Today's Work"
            type="number"
            min={0}
            max={60}
            value={String(schedule.leadDays)}
            onChange={(value) =>
              patch({ leadDays: Number(value) || 0 })
            }
            autoComplete="off"
            suffix="days before"
            helpText="Upcoming recurring POs appear on Today's Work and Calendar before they're drafted."
          />
        </FormLayout>
      ) : null}
    </BlockStack>
  );
}
