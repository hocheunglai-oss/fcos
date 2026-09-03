-- Venue supplier Accounts are accounting identities. Keep the service-only
-- setting aligned with the runtime invariant without replacing unrelated
-- Hedge Salesforce configuration.
with normalized as (
  select
    id,
    jsonb_set(
      jsonb_set(
        value,
        '{venues}',
        coalesce(value->'venues', '{}'::jsonb)
          || jsonb_build_object(
            'ICE',
            coalesce(value#>'{venues,ICE}', '{}'::jsonb)
              || jsonb_build_object(
                'supplierId', '001fu00000Zo8eHAAR',
                'supplierName', 'STRAITS FINANCIAL SERVICES PTE LTD',
                'paymentTerm', '7 I'
              ),
            'FCBS',
            coalesce(value#>'{venues,FCBS}', '{}'::jsonb)
              || jsonb_build_object(
                'supplierId', '0012x00000LGhzUAAT',
                'supplierName', 'FRATELLI COSULICH BUNKERS (S) PTE LTD',
                'supplierClKey', 'HKFCBS',
                'paymentTerm', '7 I'
              )
          ),
        true
      ),
      '{mappingRevision}',
      to_jsonb(5),
      true
    ) as next_value
  from public.hedge_settings
  where key = 'salesforce_mapping'
)
update public.hedge_settings as setting
set value = normalized.next_value
from normalized
where setting.id = normalized.id
  and setting.value is distinct from normalized.next_value;
