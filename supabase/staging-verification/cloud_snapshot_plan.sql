-- STAGING READ-ONLY: database execution plan for the exact User A hydration
-- shape, without embedding or returning the owner's UUID.
explain (analyze, buffers, format json)
select *
from public.media_library
where user_id = (
  select user_id
  from public.media_library
  group by user_id
  order by count(*) desc
  limit 1
)
order by library_row_id asc
offset 0
limit 1000;
