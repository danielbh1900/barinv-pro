
-- v2.3.8 added warehouse_transfers.item_id → items, but the actual
-- intent (verified in www/index.html:8941) is warehouse_transfers.item_id
-- → warehouse_items.id. The old/wrong FK is dropped first.
ALTER TABLE public.warehouse_transfers
  DROP CONSTRAINT IF EXISTS warehouse_transfers_item_id_fkey;

-- Clean any rows whose item_id doesn't actually match a warehouse_items
-- row (defensive — should be zero based on prior counts).
DELETE FROM public.warehouse_transfers
WHERE item_id IS NOT NULL
  AND item_id NOT IN (SELECT id FROM public.warehouse_items);

ALTER TABLE public.warehouse_transfers
  ADD CONSTRAINT warehouse_transfers_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES public.warehouse_items(id) ON DELETE CASCADE;

NOTIFY pgrst, 'reload schema';
;
