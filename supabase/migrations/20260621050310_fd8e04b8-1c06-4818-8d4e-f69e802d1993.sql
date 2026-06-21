
CREATE POLICY "Authenticated can view destination covers"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'destination-covers');

CREATE POLICY "Authenticated can upload destination covers"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'destination-covers' AND owner = auth.uid());

CREATE POLICY "Owners can update their destination covers"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'destination-covers' AND owner = auth.uid());

CREATE POLICY "Owners can delete their destination covers"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'destination-covers' AND owner = auth.uid());
