ALTER TABLE public.business_profile
  ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.business_profile
SET capabilities = jsonb_build_object(
  'supportsShifts',         false,
  'supportsNights',         true,
  'supportsBars',           true,
  'supportsStations',       true,
  'supportsDepartments',    false,
  'supportsTables',         true,
  'supportsMenuItems',      true,
  'supportsIngredients',    true,
  'supportsRecipes',        true,
  'supportsSKUs',           true,
  'supportsSuppliers',      true,
  'supportsPurchaseOrders', true,
  'supportsReceiving',      true,
  'supportsTransfers',      false,
  'supportsCycleCounts',    false,
  'supportsWasteTracking',  true,
  'supportsPAR',            true,
  'supportsParPerLocation', true,
  'supportsParPerSKU',      false,
  'supportsPourCost',       true,
  'supportsDispatch',       true,
  'supportsAccountability', true,
  'supportsVariance',       true,
  'supportsGiveaways',      true,
  'supportsVIP',            true,
  'supportsRoomService',    false,
  'supportsMinibar',         false,
  'supportsBLEWeigh',       true
)
WHERE capabilities = '{}'::jsonb;;
