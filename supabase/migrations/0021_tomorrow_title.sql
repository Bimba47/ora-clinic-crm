-- 0021: כותרת הווידג'ט "תורים למחר" עם המספר, כמו באפיון ("4 תורים מחר"). {{count:יחיד:רבים}} מחושב בממשק.
update dashboard_widgets w set title = '{{count:תור אחד:תורים}} מחר'
  from dashboards d where d.id = w.dashboard_id and d.name = 'ראשי' and w.title = 'תורים למחר';
