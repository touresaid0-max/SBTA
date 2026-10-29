-- Audit read-only (SELECT uniquement). Fichiers liés aux données (buckets Storage).
-- Les noms de fichiers ne sont pas exposés, seulement les volumes par bucket.

SELECT b.id AS bucket,
       count(o.id) AS nb_fichiers,
       count(o.id) FILTER (WHERE o.created_at < timestamptz '2026-10-28 00:00:00+00') AS avant_coupure,
       count(o.id) FILTER (WHERE o.created_at >= timestamptz '2026-10-28 00:00:00+00') AS apres_coupure,
       min(o.created_at)::date AS date_min,
       max(o.created_at)::date AS date_max
FROM storage.buckets b
LEFT JOIN storage.objects o ON o.bucket_id = b.id
GROUP BY b.id
ORDER BY b.id;
