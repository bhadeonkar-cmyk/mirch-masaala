\set ON_ERROR_STOP on

DO $qa$
DECLARE
  v_result jsonb;
  v_backup jsonb;
  v_status jsonb;
  v_waiter1 text;
  v_waiter2 text;
  v_order_count integer;
  v_menu_count integer;
  v_table_count integer;
  v_rejected boolean := false;
BEGIN
  PERFORM set_config('app.qa_uid','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',false);
  INSERT INTO auth.users(id) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
  ON CONFLICT (id) DO NOTHING;
  PERFORM set_config('app.qa_role','admin',false);

  -- Stable IDs are generated from names and can be renamed without changing the ID.
  v_result := public.mm_admin_save_waiter('Priya',NULL);
  v_waiter1 := v_result->>'waiter_code';
  IF v_waiter1 <> 'W01' OR v_result->>'display_name' <> 'Priya' THEN
    RAISE EXCEPTION 'QA failed: first waiter was not assigned W01 automatically: %',v_result;
  END IF;
  v_result := public.mm_admin_save_waiter('Amol',NULL);
  v_waiter2 := v_result->>'waiter_code';
  IF v_waiter2 <> 'W02' THEN
    RAISE EXCEPTION 'QA failed: second waiter was not assigned W02 automatically: %',v_result;
  END IF;
  v_result := public.mm_admin_save_waiter('Priya Shah',v_waiter1);
  IF v_result->>'waiter_code' <> 'W01' OR v_result->>'display_name' <> 'Priya Shah' THEN
    RAISE EXCEPTION 'QA failed: renaming a waiter changed or lost their stable ID: %',v_result;
  END IF;
  PERFORM public.mm_admin_set_waiter_active(v_waiter2,false);
  IF EXISTS (SELECT 1 FROM public.mm_list_waiters(false) WHERE waiter_code=v_waiter2) THEN
    RAISE EXCEPTION 'QA failed: inactive waiter appeared in the active name list';
  END IF;
  PERFORM public.mm_admin_set_waiter_active(v_waiter2,true);
  IF NOT EXISTS (SELECT 1 FROM public.mm_list_waiters(false) WHERE waiter_code=v_waiter2 AND active) THEN
    RAISE EXCEPTION 'QA failed: restored waiter was not returned as active';
  END IF;

  -- Non-admin staff must not be able to alter roster or reset restaurant data.
  PERFORM set_config('app.qa_role','waiter',false);
  v_rejected := false;
  BEGIN
    PERFORM public.mm_admin_save_waiter('Should Not Be Added',NULL);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Only the Owner/Admin can manage waiter names%' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'QA failed: waiter role managed the roster'; END IF;
  v_rejected := false;
  BEGIN
    PERFORM public.mm_admin_reset_business_data('RESET MIRCH MASAALA',false);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Only the Owner/Admin can reset restaurant data%' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'QA failed: waiter role was able to reset data'; END IF;

  PERFORM set_config('app.qa_role','admin',false);
  SELECT count(*) INTO v_order_count
  FROM public.orders WHERE restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid;
  IF v_order_count < 1 THEN RAISE EXCEPTION 'QA failed: reset test expected some seeded orders'; END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.mm_admin_reset_business_data('NOT THE CONFIRMATION',true);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Reset confirmation did not match%' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'QA failed: reset accepted a missing/incorrect typed confirmation'; END IF;
  IF (SELECT count(*) FROM public.orders WHERE restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid) <> v_order_count THEN
    RAISE EXCEPTION 'QA failed: incorrect reset confirmation changed business data';
  END IF;

  v_backup := public.mm_admin_export_backup();
  IF v_backup->>'application' <> 'Mirch Masaala'
     OR v_backup->>'restaurant_id' <> 'a3702d10-6673-4c06-9783-1d61c945ecd5'
     OR jsonb_typeof(v_backup->'data'->'orders') <> 'array'
     OR jsonb_typeof(v_backup->'data'->'order_items') <> 'array'
     OR jsonb_typeof(v_backup->'data'->'order_payments') <> 'array' THEN
    RAISE EXCEPTION 'QA failed: JSON backup did not include the expected restaurant/order/payment data: %',v_backup;
  END IF;
  PERFORM public.mm_admin_record_backup_export();

  SELECT count(*) INTO v_menu_count
  FROM public.menu_items WHERE restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid;
  SELECT count(*) INTO v_table_count
  FROM public.restaurant_tables WHERE restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid;
  IF v_menu_count < 1 OR v_table_count < 1 THEN
    RAISE EXCEPTION 'QA failed: fixture menu/table setup was missing before reset';
  END IF;
  UPDATE public.menu_items SET is_available=false
  WHERE restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid;

  v_result := public.mm_admin_reset_business_data('RESET MIRCH MASAALA',true);
  IF coalesce((v_result->>'ok')::boolean,false) IS NOT TRUE
     OR coalesce((v_result->>'backup_made')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'QA failed: owner reset did not confirm backup and reset: %',v_result;
  END IF;

  IF EXISTS (SELECT 1 FROM public.orders WHERE restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid) THEN
    RAISE EXCEPTION 'QA failed: orders remained after reset';
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_items) THEN
    RAISE EXCEPTION 'QA failed: order line items remained after reset';
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_payments WHERE restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid) THEN
    RAISE EXCEPTION 'QA failed: payment records remained after reset';
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_management_audit WHERE restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid) THEN
    RAISE EXCEPTION 'QA failed: transaction audit records remained after reset';
  END IF;
  IF EXISTS (SELECT 1 FROM public.restaurant_table_visits WHERE restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid) THEN
    RAISE EXCEPTION 'QA failed: old table visits remained after reset';
  END IF;
  IF EXISTS (SELECT 1 FROM public.mm_restaurant_notifications WHERE restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid) THEN
    RAISE EXCEPTION 'QA failed: old notifications remained after reset';
  END IF;
  IF (SELECT count(*) FROM public.menu_items WHERE restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid) <> v_menu_count THEN
    RAISE EXCEPTION 'QA failed: reset deleted menu records';
  END IF;
  IF EXISTS (SELECT 1 FROM public.menu_items WHERE restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid AND NOT is_available) THEN
    RAISE EXCEPTION 'QA failed: reset did not restore sold-out menu items to available';
  END IF;
  IF (SELECT count(*) FROM public.restaurant_tables WHERE restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid) <> v_table_count THEN
    RAISE EXCEPTION 'QA failed: reset deleted table configuration';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mm_waiter_directory
                 WHERE restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
                   AND waiter_code=v_waiter1 AND display_name='Priya Shah' AND active) THEN
    RAISE EXCEPTION 'QA failed: reset deleted named waiters or altered their stable IDs';
  END IF;

  v_status := public.mm_admin_maintenance_status();
  IF v_status->>'last_backup_at' IS NULL OR v_status->>'last_reset_at' IS NULL THEN
    RAISE EXCEPTION 'QA failed: last backup/reset timestamps were not recorded: %',v_status;
  END IF;
  IF (v_status->>'last_backup_at')::timestamptz < (v_status->>'last_reset_at')::timestamptz THEN
    RAISE EXCEPTION 'QA failed: the backed-up reset did not start a fresh 10-day reminder period: %',v_status;
  END IF;

  RAISE NOTICE 'QA passed: named waiter IDs, role permissions, JSON data export, guarded reset, retained menu/table/waiter setup, and reminder timestamps.';
END
$qa$;
