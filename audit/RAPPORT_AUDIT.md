# Rapport d'audit de la base de données - coupure du 28 octobre 2026

Périmètre : lecture seule. Aucune donnée n'a été modifiée. Les scripts d'audit (SELECT uniquement) sont dans `audit/`.
Coupure : 2026-10-28 00:00:00 Africa/Abidjan = 2026-10-28 00:00:00 UTC. Le fuseau de la base est UTC, donc la coupure est exacte.
Photographie : les volumes ont été relevés en plusieurs passes. Entre deux passes, le nombre de réservations est passé de 6 122 à 6 136, ce qui montre que la base reçoit encore des écritures en production. Les chiffres ci-dessous sont donc une photographie à l'instant T.
Données personnelles : e-mails et noms masqués, identifiants tronqués à 8 caractères.

---

## 1. Résumé

- **Gares** : 42, toutes marquées actives.
- **Volume** (photographie) : 688 départs, 6 136 réservations, 237 bagages, 66 colis, 301 charges de guichet, 25 convois, 91 réservations mobiles, 1 050 équipes de caisse, 749 utilisateurs, 22 fichiers stockés.
- **Gare de Divo** : 84 départs, 3 501 réservations, 36 bagages, 52 charges de guichet. Presque toute l'activité date d'après la coupure : 3 492 réservations sur 3 501 (28 oct : 1 794 ; 29 oct : 1 698). Toutes sont saisies par un seul compte guichetier (« ad***@sbta.ci », créé le 11 octobre). Un second compte guichetier (« an***@sbta.ci ») n'a saisi que 9 réservations, le 27 octobre.
- **Point critique** : l'activité réelle de Divo repose entièrement sur des données créées avant la coupure (bus, chauffeurs, lignes). Un nettoyage par date casserait la production.

Correction par rapport à mes notes précédentes : Divo compte 3 492 réservations après la coupure, et non 3 486.

---

## 2. Cartographie du schéma

Le schéma public compte 171 tables. Le tableau ci-dessous détaille les tables liées à une gare ou à des données de vente. La classification complète des 171 tables figure en annexe.

| Table | Catégorie | Lien vers la gare | Date de création | Utilisateur qui saisit |
|---|---|---|---|---|
| schedules (départs) | Transactionnelle | `departure_station_id` | `created_at` | `created_by` |
| reservations | Transactionnelle | via `schedule_id` puis `schedules.departure_station_id` | `created_at` | `booked_by` |
| payments | Transactionnelle | via `reservation_id` puis `schedule` | `created_at` | `processed_by` |
| baggage_tickets | Transactionnelle | `station_id` | `created_at` | `sold_by` |
| parcels (colis) | Transactionnelle | `origin_station_id` | `created_at` | `registered_by` |
| parcel_tracking_events | Transactionnelle | `station_id` (et `parcel_id`) | `event_at` | à confirmer |
| counter_charges | Transactionnelle | `station_id` | `created_at` | `created_by` |
| convoys | Transactionnelle | via `schedule_id` | `created_at` | `created_by` |
| mobile_bookings | Transactionnelle | via `schedule_id` | `created_at` | `user_id` (client) |
| counter_shifts (équipes de caisse) | Transactionnelle | `station_id` | `created_at` | `user_id` |
| ramassage_collections | Transactionnelle | `station_id` et `schedule_id` | `created_at` | à confirmer |
| station_daily_reports | Transactionnelle | `station_id` | `created_at` | à confirmer |
| kiosk_tickets | Transactionnelle | `station_id` et `schedule_id` | `created_at` | non (canal kiosque) |
| sms_logs | Transactionnelle (journal) | `station_id` et `parcel_id` | `created_at` | à confirmer |
| stations | Configuration | - | `created_at` | `station_manager_id` |
| users | Configuration | `station_id` | `created_at` | `created_by` |
| counters (guichets) | Configuration | `station_id` | `created_at` | `manager_id` |
| routes (lignes) | Configuration | `origin_station_id`, `destination_station_id` | `created_at` | à confirmer |
| buses, drivers (users) | Configuration | pas de gare directe | `created_at` | à confirmer |
| station_managers, station_agents, station_baggage_handlers, station_cities | Configuration | `station_id` | `created_at` | à confirmer |
| schedule_breakdowns, pending_ticket_transfers, departure_sequence, station_daily_expenses, parcel_service_expenses | À confirmer | `station_id` ou `schedule_id` | `created_at` | à confirmer |

Clés étrangères importantes pour le nettoyage (ON DELETE) :
- **Départs (schedules)** : suppression en CASCADE vers `reservations` (et de là vers `payments`), `seat_locks`, `seat_cancellations`, `ramassage_collections`, `schedule_breakdowns`, `ticket_transfer_logs`. SET NULL vers `baggage_tickets`, `kiosk_tickets`, `incidents`, `driver_reviews`, `fuel_vouchers`.
- **Bloquants (NO ACTION)** : `convoys`, `counter_charges`, `parcels`, `mobile_bookings`, `driver_daily_logs`, `departure_sequence` pointent vers `schedules` sans règle de suppression. Un DELETE sur un départ référencé par l'une de ces tables échouera.
- **Gares (stations)** : CASCADE vers `counters`, `station_agents`, `station_managers`, `station_daily_reports`, `digital_kiosks`, `counter_shifts`, `parcel_service_expenses`. NO ACTION vers `users`, `employees`, `counter_charges`, `parcels`, `parcel_tracking_events`, `garages`, `schedule_breakdowns`, `ramassage_collections`. SET NULL vers `baggage_tickets`, `sms_logs`, `kiosk_tickets`, `routes`, `schedules` (origine/destination).
- **Colis (parcels)** : CASCADE vers `parcel_tracking_events` et `sms_logs`.
- **Utilisateurs** : CASCADE vers `reservations.customer_id`, `driver_reviews`, `loyalty_*`. SET NULL vers `reservations.booked_by`, `schedules.created_by`, `payments.processed_by`. NO ACTION vers `users.station_id`, `deactivated_by`.

Fuseau horaire : le fuseau de session est UTC (SHOW timezone). La coupure en +00 est donc correcte.

---

## 3. Volumes par table et par gare (avant / après la coupure)

Lecture : « avant » = créé avant le 28 oct 00:00 UTC ; « après » = créé à partir du 28 oct 00:00 UTC.

| Table | Gare | Avant | Après | Dates |
|---|---|---|---|---|
| schedules | Divo | 11 | 73 | - |
| reservations | Divo | 9 | 3 492 | 27 oct - 29 oct |
| baggage_tickets | Divo | 0 | 36 | 28 - 29 oct |
| counter_charges | Divo | 2 | 50 | 27 - 28 oct |
| counter_shifts | Divo | 18 | 31 | 26 oct - 29 oct |
| parcel_tracking_events | Divo | 6 | 0 | - |
| schedules | Adjamé Gagnoa | 469 | 4 | - |
| reservations | Adjamé Gagnoa | 2 133 | 9 | - |
| baggage_tickets | Adjamé Gagnoa | 161 | 7 | jusqu'au 28 oct |
| counter_shifts | Adjamé Gagnoa | 694 | 19 | - |
| schedules | Yopougon | 64 | 2 | - |
| reservations | Yopougon | 178 | 0 | - |
| schedules | Agboville Yopougon | 5 | 1 | - |
| reservations | Agboville Yopougon | 26 | 3 | - |
| schedules | Mirador Agboville | 0 | 1 | - |
| reservations | Mirador Agboville | 0 | 6 | - |
| parcels | Mirador Agboville | 0 | 2 | - |
| reservations | Bondoukou | 138 | 0 | - |
| schedules | Bondoukou | 10 | 0 | - |
| reservations | Bouaké | 23 | 0 | - |
| reservations | GARE SBTA MAN | 11 | 0 | - |
| schedules | Adjamé Divo | 4 | 0 | - |
| reservations | Adjamé Divo | 8 | 0 | - |
| counter_charges | Adjamé Divo | 2 | 0 | 22 oct |
| (sans gare) | - | schedules 2, baggage 2 | schedules 1 | - |

Autres tables (baggage, parcels, convoys, mobile_bookings, counter_charges, ramassage, daily_reports, kiosk_tickets, sms_logs, payments) : sur les autres gares, rien d'après la coupure, sauf Adjamé Gagnoa (baggage 7, convoys 0) et Mirador (sms 2, parcel_events 6). Pour Divo : aucun colis, aucun convoi, aucune réservation mobile, aucun ramassage, aucun billet kiosque, aucun SMS.

Plages de dates (min - max, à titre indicatif) : les données de test commencent en avril-mai 2026 (counter_charges depuis le 30 avril, bagages depuis le 25 mai), les gares Divo et Agboville datent de juin-août.

---

## 4. Activité de Divo depuis la coupure

Réservations par jour (saisies par compte masqué) :
- 27 oct : 9 (« an***@sbta.ci », compte créé le 11 oct)
- 28 oct : 1 794 (« ad***@sbta.ci »)
- 29 oct : 1 698 (« ad***@sbta.ci »)

Activité de caisse par jour :
- Bagages : 21 le 28 oct, 15 le 29 oct (tous par « ad***@sbta.ci »).
- Charges de guichet : 2 le 27 oct, 50 le 28 oct (tous par « ad***@sbta.ci »).
- Équipes de caisse : 18 avant la coupure (dont 10 par « an***@sbta.ci » le 27 oct), 31 après (20 par « ad***@sbta.ci », 6 par « an***@sbta.ci », 2 par « sa***@ », 1 par « po***@ », 2 par d'autres).

Départs de Divo créés après la coupure : 73. Pour chacun :
- le bus existe depuis avant la coupure (73 sur 73) ;
- le chauffeur existe depuis avant la coupure (73 sur 73) ;
- la ligne existe depuis avant la coupure (73 sur 73).
Parmi eux, 10 bus et 13 chauffeurs sont aussi utilisés par des départs d'autres gares.

Lignes utilisées par Divo : 4 lignes, toutes créées avant la coupure (juin et août 2026). L'une, « Divo - Abidjan », a été créée le 14 août et n'a pas de gare de destination.

---

## 5. Anomalies classées par gravité

### Critique

1. **Données de production qui dépendent de données de test.** Les 73 départs de Divo créés après la coupure utilisent des bus, chauffeurs et lignes créés avant. Ces ressources ne doivent surtout pas être supprimées.
2. **Deux gares « Divo ».** « Gare SBTA Divo » (id 7d889096) porte toute l'activité de production. « Gare SBTA Adjamé Divo » (id 2cb7917f, créée le 22 oct) n'a que des données d'avant la coupure (8 réservations, 4 départs, 2 charges, 11 équipes de caisse) : c'est probablement une gare de test, à confirmer.
3. **Deux comptes au même préfixe e-mail.** « ad***@sbta.ci » existe en deux exemplaires : l'administrateur (id adb65952, créé le 16 avril, sans gare, actif le 29 oct, 55 départs créés et 432 réservations saisies) et le guichetier de Divo (id 5cf3a792, créé le 11 oct, actif, 3 492 réservations). Ils doivent être distingués par identifiant, pas par e-mail.
4. **Compte test encore actif à Divo.** « an***@sbta.ci » (id 940e6562, créé le 11 oct) a saisi 9 réservations et 7 départs avant la coupure, et il est revenu se connecter le 29 oct. Il a aussi des équipes de caisse le 28 et le 29 oct.

### Élevée

5. **Compte guichetier de Divo jamais connecté.** « an***@gmail.com » (id 6c7e1400, créé le 30 juin, « Gare SBTA Divo », jamais vu). Probablement un compte de test oublié, mais il n'a saisi aucune donnée.
6. **Gares actives après la coupure, autres que Divo.** Adjamé Gagnoa (9 réservations, 4 départs, 7 bagages, 19 équipes de caisse), Mirador Agboville (6 réservations, 2 colis, 1 départ, 2 SMS, toutes données après la coupure), Agboville Yopougon (3 réservations, 1 départ) et Yopougon (2 départs). Ce sont peut-être de vraies saisies, à confirmer.
7. **Lignes sans gare d'origine.** 116 lignes n'ont pas de gare d'origine (toutes créées avant la coupure). Elles ne sont pas nécessairement liées à Divo, mais elles faussent tout filtrage « par gare » fondé sur les lignes.
8. **Numéros de guichet en double.** 3 couples (gare, numéro) sont en double, et 1 guichet a un numéro vide ou « 0000000000 ». Les 4 guichets de Divo (noms hérités de Bouaké lors de la passe précédente, à reconfirmer) doivent être vérifiés.

### Moyenne

9. **Données sans gare.** 2 départs sans gare de départ avant la coupure et 1 après ; 2 bagages sans gare (avant) ; 61 réservations mobiles sans départ (toutes avant la coupure).
10. **Événements de suivi de colis dans une gare différente de l'origine du colis.** 37 événements. C'est peut-être normal (passage dans une gare intermédiaire), à confirmer.
11. **Divo : 6 événements de suivi avant la coupure, sans aucun colis de Divo.** Données orphelines de test probables.
12. **Réservations de Divo avant la coupure (9).** Elles sont rattachées à un départ de Divo utilisé peut-être en production. À trancher.

### Faible ou sans anomalie

- Pas de doublon sur les références de réservation, les numéros de bagage ou les codes de colis.
- Pas de réservation sans départ.
- Profils test par motif (test, demo, essai, admin1, etc.) : une seule correspondance nette dans la dernière passe (agent de colis de Yopougon, nom commençant par « tes », créé le 7 oct, « co***@sbta.ci »). Les 4 profils identifiés lors de la passe précédente n'ont pas tous pu être reconfirmés, à vérifier.

### Fichiers stockés

- 22 fichiers au total, aucun créé après la coupure.
- Répartition : hr-documents 4, tickets 7, parcel-photos 6, insurance-docs 1, employee-avatars 4.
- Impossible de rattacher un fichier à Divo ou à une gare sans lire le chemin des fichiers (non fait). Le bucket « tickets » (7 fichiers) est le seul susceptible d'être lié aux réservations.

---

## 6. Risques pour un futur nettoyage

1. **Suppression par date.** Supprimer « tout ce qui est avant le 28 oct » casserait Divo : les bus, chauffeurs et lignes de production ont été créés avant la coupure.
2. **Blocages par clés étrangères.** Un départ référencé par des convois, des charges de guichet, des colis ou des réservations mobiles ne peut pas être supprimé tel quel. Il faudra d'abord traiter ces lignes dépendantes.
3. **Cascades.** Supprimer un départ efface en cascade ses réservations et leurs paiements. Supprimer une réservation efface ses paiements. Supprimer un colis efface son suivi et ses SMS.
4. **Tables sans gare ni date directe.** Bus, chauffeurs, lignes, catégories de sièges et paramètres n'ont pas de colonne de gare. Ils doivent être classés à la main.
5. **Utilisateurs partagés.** 10 bus et 13 chauffeurs servent à la fois à Divo et à d'autres gares. Les supprimer touche des données réelles d'autres gares.
6. **Stockage.** Les fichiers ne portent pas d'identifiant de gare. Le lien doit passer par les enregistrements qui les référencent, ce qui n'a pas été vérifié.
7. **Numérotation.** Aucun doublon de référence de réservation ou de bagage à ce jour. Renuméroter serait risqué : les numéros peuvent déjà figurer sur des billets ou reçus émis (à confirmer auprès de l'exploitation).
8. **Accès.** Désactiver des comptes de test n'efface pas leurs données, mais peut bloquer une connexion légitime si le compte est partagé.

---

## 7. Questions nécessitant votre décision

1. Confirmez-vous que « Gare SBTA Divo » (7d889096-5807-4bc5-9a2b-9aa6e4f74d5c) est la gare de production ? Et que « Gare SBTA Adjamé Divo » (2cb7917f-480e-4b1f-8c33-e1d650cfac56) est un test ?
2. Quel compte « ad***@sbta.ci » est le guichetier de production : id 5cf3a792 (le plus probable) ou l'administrateur adb65952 ?
3. Les comptes « an***@sbta.ci » (940e6562) et « an***@gmail.com » (6c7e1400) sont-ils des comptes de test ?
4. Les 9 réservations de Divo du 27 octobre sont-elles de vraies ventes ou des tests ?
5. Les activités de Mirador Agboville, Adjamé Gagnoa, Agboville Yopougon et Yopougon après la coupure sont-elles de vraies saisies ?
6. Les 73 bus, chauffeurs et 4 lignes utilisés par Divo doivent-ils être conservés dans tous les cas ?
7. Faut-il vérifier le lien entre les fichiers du bucket « tickets » et les réservations avant toute décision sur le stockage ?

---

## 8. Recommandation de stratégie de nettoyage (non exécutée)

1. **Sauvegarde d'abord.** Exporter une copie complète de la base avant toute action.
2. **Ne pas nettoyer par date.** Construire la liste des données de test par identifiants validés par vous (gares, comptes, départs), pas par date de création.
3. **Préférer l'archivage au effacement.** Marquer les données de test (colonne ou table d'archive) ou désactiver les comptes de test. C'est réversible. L'effacement définitif vient en dernier, si nécessaire.
4. **Protéger les ressources partagées.** Ne jamais supprimer un bus, un chauffeur ou une ligne utilisé par une gare de production.
5. **Ordre d'effacement si l'on supprime.** Feuilles d'abord (paiements, suivi de colis, SMS, équipes de caisse), puis réservations, puis départs, en traitant les dépendances bloquantes au préalable.
6. **Tester sur une copie.** Rejouer toute opération sur une copie de la base et vérifier les compteurs de Divo avant et après.
7. **Stockage à part.** Traiter les fichiers après la base, une fois les liens vérifiés.
8. **Points de contrôle.** Après chaque étape, comparer les compteurs de Divo (3 492 réservations, 73 départs après coupure) avec la photographie de cet audit : ils doivent rester identiques.
