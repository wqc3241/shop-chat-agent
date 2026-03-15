-- Add new columns first
ALTER TABLE "ChatSettings"
ADD COLUMN "supportHoursText" TEXT NOT NULL DEFAULT '',
ADD COLUMN "supportSchedule" TEXT NOT NULL DEFAULT '';

-- Migrate existing data: convert old structured fields to natural language text and JSON schedule
UPDATE "ChatSettings"
SET
  "supportHoursText" = CASE
    WHEN "supportHoursStart" != '' AND "supportHoursEnd" != '' THEN
      "supportDays" || ' ' || "supportHoursStart" || '-' || "supportHoursEnd" || ' ' ||
      REPLACE(REPLACE("supportTimezone", 'America/', ''), '_', ' ')
    ELSE ''
  END,
  "supportSchedule" = CASE
    WHEN "supportHoursStart" != '' AND "supportHoursEnd" != '' THEN
      '{"timezone":"' || "supportTimezone" || '","windows":[{"days":' ||
      '["' || REPLACE("supportDays", ',', '","') || '"]' ||
      ',"startTime":"' || "supportHoursStart" || '","endTime":"' || "supportHoursEnd" || '"}]' ||
      ',"overrides":[],"alwaysAvailable":false,"displayText":"' ||
      "supportDays" || ' ' || "supportHoursStart" || '-' || "supportHoursEnd" || ' ' ||
      REPLACE(REPLACE("supportTimezone", 'America/', ''), '_', ' ') || '"}'
    ELSE ''
  END
WHERE "supportHoursStart" != '' AND "supportHoursEnd" != '';

-- Drop old columns
ALTER TABLE "ChatSettings"
DROP COLUMN "supportDays",
DROP COLUMN "supportHoursEnd",
DROP COLUMN "supportHoursStart",
DROP COLUMN "supportTimezone";
