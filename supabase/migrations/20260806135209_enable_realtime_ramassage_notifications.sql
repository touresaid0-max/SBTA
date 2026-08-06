/*
# Enable realtime on ramassage_notifications

## Context
La table ramassage_notifications n'était pas dans la publication realtime,
donc la gare de destination ne recevait jamais la notification en temps réel
(pastille rouge, carte Ramassage). L'application devait recharger manuellement.

## Changement
Ajoute ramassage_notifications à la publication supabase_realtime.
Idempotent.
*/

ALTER PUBLICATION supabase_realtime ADD TABLE public.ramassage_notifications;
