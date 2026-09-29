alter table serving_csat_assignments
  add column if not exists payload_json jsonb;
