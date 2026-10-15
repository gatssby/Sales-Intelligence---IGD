-- Read-only selection query for a stratified reference/evaluation corpus.
-- Run against an isolated export or production in read-only mode; never writes rows.
with per_call as (
  select
    ar.call_id,
    ar.transcript_id,
    count(*) as analysis_run_count,
    count(*) filter (where ar.status = 'completed') as completed_run_count,
    coalesce(max(length(t.normalized_text)), max(length(t.raw_text)), 0) as transcript_chars,
    max(c.duration_seconds) as duration_seconds,
    max(c.commercial_status) as commercial_status,
    max(c.product_key) as product_key
  from analysis_runs ar
  left join transcripts t on t.id = ar.transcript_id
  left join calls c on c.id = ar.call_id
  group by ar.call_id, ar.transcript_id
), ranked as (
  select *,
    case
      when transcript_chars < 5000 then 'short'
      when transcript_chars < 50000 then 'medium'
      when transcript_chars < 150000 then 'long'
      else 'very_long'
    end as size_bucket,
    row_number() over (
      partition by case
        when transcript_chars < 5000 then 'short'
        when transcript_chars < 50000 then 'medium'
        when transcript_chars < 150000 then 'long'
        else 'very_long'
      end
      order by completed_run_count desc, transcript_chars
    ) as bucket_rank
  from per_call
)
select * from ranked where bucket_rank <= 5 order by size_bucket, bucket_rank;
