alter table public.bookings
  add column workflow_status text not null default 'assigned'
    check (workflow_status in ('unassigned','assigned','in_progress'));

comment on column public.bookings.workflow_status is
  'מצב תפעולי לתור העבודה (Admin Work Queue / Staff My Work) — נפרד לגמרי מ-status הקיים (scheduled/completed/cancelled), שלא משתנה. ברירת מחדל assigned כי staff_id כבר תמיד קיים ברגע יצירת ההזמנה (המטופל בוחר צוות בעצמו). unassigned נשאר אפשרי לתרחישי קצה (למשל ניתוק שיוך ע"י מנהל). in_progress נכתב כשצוות פותח Start Visit, ומתאפס עם סיום/ביטול ההזמנה (status הופך completed/cancelled).';
