-- Revoke column-level read access on internal curation fields for regular users.
-- Admin edge/server functions using service_role continue to see all columns.
REVOKE SELECT (source_url, confidence_notes) ON public.events FROM authenticated;
REVOKE SELECT (source_url, confidence_notes) ON public.events FROM anon;