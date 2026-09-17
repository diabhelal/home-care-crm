alter table public.visit_reports
  add column clinical_outcome_8h text,
  add constraint visit_reports_clinical_outcome_8h_check
    check (clinical_outcome_8h in (
      'none',
      'hypoglycemia',
      'severe_hyperglycemia',
      'respiratory_deterioration',
      'hemodynamic_deterioration'
    ));

comment on column public.visit_reports.clinical_outcome_8h is
  'תוצאה קלינית אמיתית שתועדה בדיעבד: האם אירוע חריג קרה בתוך כ-8 שעות מהמדידה הזו. NULL = טרם תועד (שונה מ-none). זהו הדאטה המתויג הדרוש לאימון predictive-service/ml_targets.py TARGET_DEFINITIONS.';
