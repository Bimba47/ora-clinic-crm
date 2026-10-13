-- ביטול 0021
update dashboard_widgets w set title = 'תורים למחר'
  from dashboards d where d.id = w.dashboard_id and d.name = 'ראשי' and w.title = '{{count:תור אחד:תורים}} מחר';
