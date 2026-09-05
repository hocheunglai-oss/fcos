-- Cover immutable preset history and editor references without browser access.
CREATE INDEX IF NOT EXISTS account_insight_report_preset_events_preset
  ON public.account_insight_report_preset_events (preset_id);
CREATE INDEX IF NOT EXISTS account_insight_report_presets_editor
  ON public.account_insight_report_presets (updated_by);
