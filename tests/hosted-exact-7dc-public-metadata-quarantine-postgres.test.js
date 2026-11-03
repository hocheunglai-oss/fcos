import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {createNotificationChallenge} from '../supabase/functions/release-coordinator/core.mjs';
import {digest} from '../scripts/lib/hosted-release/json-contract.mjs';
import {BOOTSTRAP_SOURCE,bootstrapActions,bootstrapSql} from '../scripts/lib/hosted-release/cutover-bootstrap.mjs';
const load=n=>readFile(new URL(`../supabase/migrations/${n}`,import.meta.url),'utf8');
const names=['20261016190509_release_coordination.sql','20261018112914_auth_maintenance_coordination.sql','20261019171349_legacy_release_effect_containment.sql','20261020080001_hosted_cutover_bootstrap.sql'];
const migrationName='20261021101811_exact_7dc_public_metadata_quarantine.sql',sql=await load(migrationName);
const H='a'.repeat(64),J='b'.repeat(64),OWNER='01a0f08b-7fcb-7870-9edc-343e16052b62',ID='replacement-template-7dc21331fe45';
const hash=v=>createHash('sha256').update(v).digest('hex');
// Exact historical PUBLIC GitHub variable request and prepared local intent.
// Public fixture bytes bind the incident; all new receipts, imports and authority
// below are synthetic test data. Nothing in this test calls a provider.
const originalIntentJson="{\n  \"lease\": {\n    \"epoch\": \"production-reconciliation-20261005\",\n    \"objective\": \"production\",\n    \"ownerThreadId\": \"01a0f08b-7fcb-7870-9edc-343e16052b62\",\n    \"operationId\": \"replacement-template-7dc21331fe45\",\n    \"bindingSha256\": \"5ccc27b86d0d2e203191df41491e9d2e5412543936a2b270d205c7e111f9c4e1\",\n    \"leaseId\": \"84eca9c7-80fe-4976-bcf3-13a62f2e31a2\",\n    \"coordinationOnly\": true,\n    \"providerAuthorityGranted\": false,\n    \"uncertainOutcomeRequiresReadback\": true\n  },\n  \"state\": \"prepared\",\n  \"durable\": true,\n  \"at\": \"2026-10-20T17:26:24.166460+00:00\"\n}";
const originalRequestJson="{\"name\":\"FCOS_XERO_ORIGINAL_CARRIER_TEMPLATE_BASE64\",\"value\":\"eyJhcnRpZmFjdENhcHR1cmVBdXRob3JpdHlTaGEyNTYiOiIwOTRjZGZkNzg1NjRiODQ5ZmYzMGMxMWUzYmZkNDFmZWM1YWUzOGI2ZjgzYjliMGUzMTE1MzNjYjRmNzk2NmRkIiwiY2FsbGVyIjp7ImVudmlyb25tZW50IjoiZmNvcy1ob3N0ZWQtdmVyaWZpY2F0aW9uIiwiam9iTmFtZSI6Inhlcm8tcmVjb3ZlcnktY2FycmllciIsImpvYldvcmtmbG93UmVmIjoiaG9jaGV1bmdsYWktb3NzL2Zjb3MvLmdpdGh1Yi93b3JrZmxvd3MvaG9zdGVkLXhlcm8tcmVjb3ZlcnktY2Fycmllci55bWxANjgyNzA2Zjc2NmI5MzMyOWViODhjMzNjODhlMWY2NTk5MzNkOWI5MSIsImpvYldvcmtmbG93U2hhIjoiNjgyNzA2Zjc2NmI5MzMyOWViODhjMzNjODhlMWY2NTk5MzNkOWI5MSIsInJlZiI6InJlZnMvaGVhZHMvY29kZXgvaG9zdGVkLXF1YWxpZmljYXRpb24tNjgyNzA2ZjctdjMtMjAyNjEwMjEiLCJzaGEiOiI3YTVlM2M0MGM3MTMxZDAxNTE5OWRkYTFhZmRkYjk3YzUzMmVjZjc2Iiwic3ViamVjdCI6InJlcG86aG9jaGV1bmdsYWktb3NzL2Zjb3M6ZW52aXJvbm1lbnQ6ZmNvcy1ob3N0ZWQtdmVyaWZpY2F0aW9uIiwid29ya2Zsb3dSZWYiOiJob2NoZXVuZ2xhaS1vc3MvZmNvcy8uZ2l0aHViL3dvcmtmbG93cy9hdXRoZW50aWNhdGVkLXJlbGVhc2UueW1sQHJlZnMvaGVhZHMvY29kZXgvaG9zdGVkLXF1YWxpZmljYXRpb24tNjgyNzA2ZjctdjMtMjAyNjEwMjEiLCJ3b3JrZmxvd1NoYSI6IjdhNWUzYzQwYzcxMzFkMDE1MTk5ZGRhMWFmZGRiOTdjNTMyZWNmNzYifSwiY29udHJvbGxlclNoYSI6IjY4MjcwNmY3NjZiOTMzMjllYjg4YzMzYzg4ZTFmNjU5OTMzZDliOTEiLCJob3N0Q29uZmlndXJhdGlvbiI6eyJhY3RvckJpbmRpbmciOnsiYWNjZXNzUmV2aXNpb24iOjUsImFjdG9ySWQiOiI1YmYwNjk1Yy03MDAxLTQ0YzgtYmNlYi1kNjE5YjJhMjA2YjgiLCJlbWFpbFNoYTI1NiI6ImExMDA4NTIxMGIwODAxZGY5YTcwYWVhZGIxNDI5MTcyZWE2YjI2Y2JhNGE2MjU5N2ExMzFiYzBmOTViY2ExNGMifSwiY2FsbGVyIjp7ImVudmlyb25tZW50IjoiZmNvcy1ob3N0ZWQtdmVyaWZpY2F0aW9uIiwiam9iV29ya2Zsb3dSZWYiOiJob2NoZXVuZ2xhaS1vc3MvZmNvcy8uZ2l0aHViL3dvcmtmbG93cy9ob3N0ZWQteGVyby1yZWNvdmVyeS1jYXJyaWVyLnltbEA2ODI3MDZmNzY2YjkzMzI5ZWI4OGMzM2M4OGUxZjY1OTkzM2Q5YjkxIiwiam9iV29ya2Zsb3dTaGEiOiI2ODI3MDZmNzY2YjkzMzI5ZWI4OGMzM2M4OGUxZjY1OTkzM2Q5YjkxIiwicmVmIjoicmVmcy9oZWFkcy9jb2RleC9ob3N0ZWQtcXVhbGlmaWNhdGlvbi02ODI3MDZmNy12My0yMDI2MTAyMSIsInJ1bklkIjpudWxsLCJzaGEiOiI3YTVlM2M0MGM3MTMxZDAxNTE5OWRkYTFhZmRkYjk3YzUzMmVjZjc2Iiwic3ViamVjdCI6InJlcG86aG9jaGV1bmdsYWktb3NzL2Zjb3M6ZW52aXJvbm1lbnQ6ZmNvcy1ob3N0ZWQtdmVyaWZpY2F0aW9uIiwid29ya2Zsb3dSZWYiOiJob2NoZXVuZ2xhaS1vc3MvZmNvcy8uZ2l0aHViL3dvcmtmbG93cy9hdXRoZW50aWNhdGVkLXJlbGVhc2UueW1sQHJlZnMvaGVhZHMvY29kZXgvaG9zdGVkLXF1YWxpZmljYXRpb24tNjgyNzA2ZjctdjMtMjAyNjEwMjEiLCJ3b3JrZmxvd1NoYSI6IjdhNWUzYzQwYzcxMzFkMDE1MTk5ZGRhMWFmZGRiOTdjNTMyZWNmNzYifSwia2luZCI6ImZjb3NfY29tcGlsZWRfeGVyb192ZXJjZWxfaG9zdF92MSIsIm93bmVyc2hpcCI6eyJhcHByb3ZhbFNoYTI1NiI6ImNjYjJlYmU2OTk3ZDVlYjEwOTA1YzYyNWM3NWIxOTBlN2MzYWFhZDE5MjgwYWVmMGJmMTIzYWJhMWM5ZWI3NWIiLCJjb250cm9sbGVyU2hhIjoiNjgyNzA2Zjc2NmI5MzMyOWViODhjMzNjODhlMWY2NTk5MzNkOWI5MSIsImZlYXR1cmVzT3duZXJUaHJlYWRJZCI6IjAxYTBmMDhiLTdmY2ItNzg3MC05ZWRjLTM0M2UxNjA1MmI2MiIsImhpc3RvcmljYWxPd25lclRocmVhZElkcyI6WyIwMWEwYjBlMi1iMWFmLTdiZjAtOTYzZC0zMTM4YzQyNjQ4ZTMiXSwic291cmNlU2hhMjU2IjoiM2IzYmJmMmNiMzhmNGEyMzI2NTYyOWNjM2U1YTk3YzViMmRiZDZmMzIyOWNjZDNjOTk5ZDIxNDViNzM5MjgxZiJ9LCJwbGFuSnNvbiI6IntcImJpbmRpbmdcIjp7XCJhYnNvbHV0ZU5vdEFmdGVyXCI6MTc5MjUyMjQ5MDcyNixcImFjdG9ySWRcIjpcIjViZjA2OTVjLTcwMDEtNDRjOC1iY2ViLWQ2MTliMmEyMDZiOFwiLFwiYXBwcm92YWxTaGEyNTZcIjpcImNjYjJlYmU2OTk3ZDVlYjEwOTA1YzYyNWM3NWIxOTBlN2MzYWFhZDE5MjgwYWVmMGJmMTIzYWJhMWM5ZWI3NWJcIixcImFybUJlZm9yZVwiOjE3OTI1MTg1OTA3MjYsXCJiaW5kaW5nU2hhMjU2XCI6XCI5MjkzNzY1YjdkMGQ4ZTg5MjYwYjI0ODU4OTk5ODFiZGU5MmM1ZjViNzZkZWQyMzViODQ2NzkxM2Q2NjIzNGMwXCIsXCJjcmVkZW50aWFsUHJlc2VydmF0aW9uQ29tcG9zaXRlQXBwcm92ZWRcIjp0cnVlLFwiZXhlY3V0aW9uV2luZG93TXNcIjoxODAwMDAwLFwiZXhwZWN0ZWRWZXJzaW9uXCI6NDU1LFwib3BlcmF0aW9uSWRcIjpcIjdkYzIxMzMxZmU0NWZlNjFhNjVhZTRkNDY0NTUxNTIzNDgxNzM3MmMyMDMwMDQwMTA2NDY1YWI3ZTQwNjNjZGNcIixcIm9yZ2FuaXNhdGlvbklkZW50aXR5U2hhMjU2XCI6bnVsbCxcIm93bmVyVGhyZWFkSWRcIjpcIjAxYTBiMGUyLWIxYWYtN2JmMC05NjNkLTMxMzhjNDI2NDhlM1wiLFwicHJlcGFyZWRBdFwiOjE3OTI1MTcwOTA3MjYsXCJwcm9iZUlkXCI6XCI5ZDAwMGM3OS1kMTIwLTRkNGUtYTBhOS1mMjdkZDU4OGM0M2ZcIixcInJlZnJlc2hMZWFzZUlkXCI6XCI3MzhmZGZkZi1mOGJkLTRjYzgtYTMyNi1lYjBiMTg5MTY3YTVcIixcInJlcXVlc3RJZFwiOlwiOTQ1ZjQ0YzAtZTExMi00ZjU4LWIwNmQtYzllMTg1YzI2NTI0XCIsXCJzb3VyY2VTaGEyNTZcIjpcIjNiM2JiZjJjYjM4ZjRhMjMyNjU2MjljYzNlNWE5N2M1YjJkYmQ2ZjMyMjljY2QzYzk5OWQyMTQ1YjczOTI4MWZcIixcInRlbmFudElkXCI6XCJhYThjMDhlMi0xN2ZkLTQ4NzQtYjdiYy0xMGZmZDgyZGI5ZDBcIn0sXCJraW5kXCI6XCJmY29zX3hlcm9fcmVjb3Zlcnlfc3RlcF9wbGFuX3YzXCIsXCJzY2hlbWFWZXJzaW9uXCI6M30iLCJyZXF1ZXN0Tm9uY2VTaGEyNTYiOiI0MWI1NTc5NjU1NjBhOGNkNjczMTg3MWNmMzQyZGU1NDdhN2I2YmMzNDBiMzFlNTA1YmJlNGVmNGFlNGRhMzMwIiwic2NoZW1hVmVyc2lvbiI6MSwidGFyZ2V0Ijp7ImNvbnRyb2xsZXJTaGEiOiI2ODI3MDZmNzY2YjkzMzI5ZWI4OGMzM2M4OGUxZjY1OTkzM2Q5YjkxIiwiY3VzdG9tRW52aXJvbm1lbnQiOiJmY29zLXhlcm8tcmVjb3ZlcnktMWM3YmI1NjEwZDg3IiwiaG9zdFNvdXJjZVNoYTI1NiI6IjNiM2JiZjJjYjM4ZjRhMjMyNjU2MjljYzNlNWE5N2M1YjJkYmQ2ZjMyMjljY2QzYzk5OWQyMTQ1YjczOTI4MWYiLCJwcm9qZWN0SWQiOiJwcmpfMHBVT1JQR2ZGUHlLdFloS3I2ZWN3Sjl5ZHZFcyIsInRlYW1JZCI6InRlYW1fTWJLRGF6ekNyb3UzZUtUdWF1c1B2NFgyIn19LCJpc3N1ZWRBdCI6MTc5MjUxNzA5MDcyNiwia2luZCI6ImZjb3NfeGVyb19yZWNvdmVyeV9jYXJyaWVyX3RlbXBsYXRlX3YzIiwibG9naW4iOnsib3JpZ2luIjoiaHR0cHM6Ly9mY29zLTNudDM2Z3FvdC1ob2NoZXVuZ2xhaS02NTM1cy1wcm9qZWN0cy52ZXJjZWwuYXBwIiwicHVibGljQXV0aCI6eyJpZGVudGl0eSI6eyJhY2Nlc3NSZXZpc2lvbiI6NSwiZW1haWwiOiJ2aW5jZW50QGNvc3VsaWNoLmNvbS5oayIsImZjdW5vU3ViamVjdFNoYTI1NiI6IjRiYmQ4OGNhYjE0YjM5MTNkMjJhYWMyMWZiMGZlZWMxNjY2ODdiMDI3NDNmOGQxZTYxZTZiYzFiMDBmNDNmZTYiLCJwcm9maWxlSWQiOiI1YmYwNjk1Yy03MDAxLTQ0YzgtYmNlYi1kNjE5YjJhMjA2YjgiLCJyb2xlIjoiZ2VuZXJhbF9tYW5hZ2VyIn0sImlzc3VlckF1dGhvcml6YXRpb25QYXRoIjoiL2FwaS9vaWRjL2F1dGhvcml6ZSIsImtpbmQiOiJmY29zX2xlZ2FjeV9ydW50aW1lX293bl9wcm9maWxlX2F1dGhfdjEiLCJwcmVmbGlnaHQiOnsiYWNjZXB0ZWQiOnRydWUsImF1dGhlbnRpY2F0ZWRTZWxlY3RPbmx5Ijp0cnVlLCJjYXB0dXJlZEF0IjoiMjAyNi0xMC0yMFQxNzoyMzoyMi4xNjQ0NTYrMDA6MDAiLCJkZXBsb3ltZW50SWQiOiJkcGxfS215VmJOa2c3b2tqVzRQUGpSOFpKWFJ6MTlBTCIsImVmZmVjdGl2ZUFjY2Vzc1NvdXJjZVNoYTI1NiI6ImY1ZTI2NzgwOThlYjk3NDVlNjkxNWM5ZjIzOTg5Y2I3ZDQ2YWE5ZGU0ODQxMzIzOTBkY2JkYWI1MGNiYmY0ZDkiLCJlZmZlY3RpdmVBY2Nlc3NTb3VyY2VWZXJpZmllZCI6dHJ1ZSwiZWZmZWN0aXZlQWRtaW4iOnRydWUsImV2aWRlbmNlU2hhMjU2IjoiZmMyODgwY2M5NzNlNzAzNWIxYmUzYzExNTUzY2U2MDg3MmM0NGNhNGJjMTVlMjdmMDkyMDRiZGZlY2RjZDcyMSIsImlzc3VlciI6Imh0dHBzOi8vZmN1bm8uY29tIiwia2luZCI6ImZjb3NfbGVnYWN5X3J1bnRpbWVfb3duX3Byb2ZpbGVfcHJlZmxpZ2h0X3YxIiwibGlua0JvdW5kVG9Qcm9maWxlIjp0cnVlLCJsaW5rRXhpc3RpbmciOnRydWUsImxpbmtSZXZva2VkQmVmb3JlIjoiMjAyNi0wOC0zMFQyMTowMToyOS43NzgrMDA6MDAiLCJsaW5rU291cmNlQWN0aXZlIjp0cnVlLCJsaW5rVXNlRmNvcyI6dHJ1ZSwib3JpZ2luIjoiaHR0cHM6Ly9mY29zLTNudDM2Z3FvdC1ob2NoZXVuZ2xhaS02NTM1cy1wcm9qZWN0cy52ZXJjZWwuYXBwIiwicHJvZmlsZUV4aXN0aW5nIjp0cnVlLCJwcm9maWxlUmxzT3duU2VsZWN0Ijp0cnVlLCJyZXZpZXdlcklkIjoiL3Jvb3QiLCJzb3VyY2VTaGEiOiJmMzQ3MjQ5MmZmNGQwYjBjNzAyNDhhM2M4ZTVjMDAxMjk4MWE5NGIzIiwic291cmNlU2hhMjU2IjoiOWNlMDQ0NWRlMTViZmY3OTkyODY3ZTY4OTMyOGMxMTg5YjljNTg2YTg1MDE0OWY1YWQyNjM4NDQ4MmYxYjdmNiJ9LCJwdWJsaWNBbm9uS2V5Ijoic2JfcHVibGlzaGFibGVfSjEzRkVrVUFWSHFhMkdWTHRocWktd19BWFZhcVZjVCIsInB1YmxpY0Fub25LZXlTaGEyNTYiOiI2NTgwZTdiNGYzNjE5MzQwNDgzZGE1YzI4YmY1MjA0ZGI4ZTE5ZDUzY2ViZWZmYmFlNGY0ZDg4OTgyZWU1OTI3Iiwic3VwYWJhc2VPcmlnaW4iOiJodHRwczovL3BqZm9yZnZjaHlnZHlxZmNncG13LnN1cGFiYXNlLmNvIn19LCJub3RBZnRlciI6MTc5MjUyMjQ5MDcyNiwicGxhbkpzb24iOiJ7XCJiaW5kaW5nXCI6e1wiYWJzb2x1dGVOb3RBZnRlclwiOjE3OTI1MjI0OTA3MjYsXCJhY3RvcklkXCI6XCI1YmYwNjk1Yy03MDAxLTQ0YzgtYmNlYi1kNjE5YjJhMjA2YjhcIixcImFwcHJvdmFsU2hhMjU2XCI6XCJjY2IyZWJlNjk5N2Q1ZWIxMDkwNWM2MjVjNzViMTkwZTdjM2FhYWQxOTI4MGFlZjBiZjEyM2FiYTFjOWViNzViXCIsXCJhcm1CZWZvcmVcIjoxNzkyNTE4NTkwNzI2LFwiYmluZGluZ1NoYTI1NlwiOlwiOTI5Mzc2NWI3ZDBkOGU4OTI2MGIyNDg1ODk5OTgxYmRlOTJjNWY1Yjc2ZGVkMjM1Yjg0Njc5MTNkNjYyMzRjMFwiLFwiY3JlZGVudGlhbFByZXNlcnZhdGlvbkNvbXBvc2l0ZUFwcHJvdmVkXCI6dHJ1ZSxcImV4ZWN1dGlvbldpbmRvd01zXCI6MTgwMDAwMCxcImV4cGVjdGVkVmVyc2lvblwiOjQ1NSxcIm9wZXJhdGlvbklkXCI6XCI3ZGMyMTMzMWZlNDVmZTYxYTY1YWU0ZDQ2NDU1MTUyMzQ4MTczNzJjMjAzMDA0MDEwNjQ2NWFiN2U0MDYzY2RjXCIsXCJvcmdhbmlzYXRpb25JZGVudGl0eVNoYTI1NlwiOm51bGwsXCJvd25lclRocmVhZElkXCI6XCIwMWEwYjBlMi1iMWFmLTdiZjAtOTYzZC0zMTM4YzQyNjQ4ZTNcIixcInByZXBhcmVkQXRcIjoxNzkyNTE3MDkwNzI2LFwicHJvYmVJZFwiOlwiOWQwMDBjNzktZDEyMC00ZDRlLWEwYTktZjI3ZGQ1ODhjNDNmXCIsXCJyZWZyZXNoTGVhc2VJZFwiOlwiNzM4ZmRmZGYtZjhiZC00Y2M4LWEzMjYtZWIwYjE4OTE2N2E1XCIsXCJyZXF1ZXN0SWRcIjpcIjk0NWY0NGMwLWUxMTItNGY1OC1iMDZkLWM5ZTE4NWMyNjUyNFwiLFwic291cmNlU2hhMjU2XCI6XCIzYjNiYmYyY2IzOGY0YTIzMjY1NjI5Y2MzZTVhOTdjNWIyZGJkNmYzMjI5Y2NkM2M5OTlkMjE0NWI3MzkyODFmXCIsXCJ0ZW5hbnRJZFwiOlwiYWE4YzA4ZTItMTdmZC00ODc0LWI3YmMtMTBmZmQ4MmRiOWQwXCJ9LFwia2luZFwiOlwiZmNvc194ZXJvX3JlY292ZXJ5X3N0ZXBfcGxhbl92M1wiLFwic2NoZW1hVmVyc2lvblwiOjN9IiwicmVhZEFjY2VwdGFuY2UiOnsidmVyY2VsUmVhZENyZWRlbnRpYWxBY2NlcHRhbmNlIjp7Impzb24iOiJ7XG4gIFwic2NoZW1hVmVyc2lvblwiOiAxLFxuICBcImtpbmRcIjogXCJmY29zX3Jvb3RfYWNjZXB0ZWRfdmVyY2VsX29hdXRoX2V4Y2hhbmdlXCIsXG4gIFwiYWNjZXB0ZWRcIjogdHJ1ZSxcbiAgXCJyZXZpZXdlcklkXCI6IFwiL3Jvb3RcIixcbiAgXCJvcGVyYXRvclwiOiBcImhvY2hldW5nbGFpLW9zc1wiLFxuICBcInJldmlld2VkQXRcIjogXCIyMDI2LTEwLTE3VDE0OjQ2OjA3Ljk4NTM2MCswMDowMFwiLFxuICBcIm9yaWdpbmFsRXhjaGFuZ2VSZWNlaXB0U2hhMjU2XCI6IFwiZjRlZGY5NjE1YjI0YTNjMTVkMzBkNTU4NGI4Y2YwNWFiYjZhMzE3ZGZjOWQzZDQ3ODRkYzBjODQzNDFlYzk3N1wiLFxuICBcImNvbmZpZ3VyYXRpb25SZWFkYmFja1NoYTI1NlwiOiBcImE4MTQzNWNlZjhiNTVmMzliMTFkOTllNzU3MGQzY2M2NTczZTllNjI2NzJlMGNlYTcxM2MwNDA4NDMwMDBhNWNcIixcbiAgXCJjcmVkZW50aWFsXCI6IHtcbiAgICBcImJlYXJlclNoYTI1NlwiOiBcIjVhNmUzZTI4ZDc2YTgxYmU1M2NiNzc1MGJlMmYxMmE4NDc0Y2Q4NjlmYWE5NzhmZGY0MDllNWQzMWJmMGI4YTFcIixcbiAgICBcImNsaWVudElkXCI6IFwib2FjX1JDREtGQ2RlaVVRRUVOMFFVdUVydjNNYlwiLFxuICAgIFwiaW50ZWdyYXRpb25JZFwiOiBcIm9hY19SQ0RLRkNkZWlVUUVFTjBRVXVFcnYzTWJcIixcbiAgICBcImNvbmZpZ3VyYXRpb25JZFwiOiBcImljZmdfMzFlTVh6MExjTFJLY1BBakMxUHZzaWdSXCIsXG4gICAgXCJ0ZWFtSWRcIjogXCJ0ZWFtX01iS0RhenpDcm91M2VLVHVhdXNQdjRYMlwiLFxuICAgIFwicHJvamVjdElkXCI6IFwicHJqXzBwVU9SUEdmRlB5S3RZaEtyNmVjd0o5eWR2RXNcIixcbiAgICBcInNjb3Blc1wiOiBbXG4gICAgICBcInJlYWQ6ZGVwbG95bWVudFwiLFxuICAgICAgXCJyZWFkOmludGVncmF0aW9uLWNvbmZpZ3VyYXRpb25cIixcbiAgICAgIFwicmVhZDpwcm9qZWN0XCJcbiAgICBdLFxuICAgIFwiaXNzdWVkQXRcIjogMTc5MjI0NzkxNzI3MSxcbiAgICBcIm5vdEFmdGVyXCI6IDE3OTQ3ODcyMDAwMDBcbiAgfVxufVxuIiwic2hhMjU2IjoiN2VhNzBhMTVkMmVhMTg3NTcyYWM1MzI4NmU0N2ExMDY3ZjExZmM3ZGY2MDNiOTg1NDI5MDFjZjhmMGI1ZjQxOSJ9fSwicmVhZENyZWRlbnRpYWwiOnsiYmVhcmVyU2hhMjU2IjoiNWE2ZTNlMjhkNzZhODFiZTUzY2I3NzUwYmUyZjEyYTg0NzRjZDg2OWZhYTk3OGZkZjQwOWU1ZDMxYmYwYjhhMSIsImNsaWVudElkIjoib2FjX1JDREtGQ2RlaVVRRUVOMFFVdUVydjNNYiIsImNvbmZpZ3VyYXRpb25JZCI6ImljZmdfMzFlTVh6MExjTFJLY1BBakMxUHZzaWdSIiwiaW50ZWdyYXRpb25JZCI6Im9hY19SQ0RLRkNkZWlVUUVFTjBRVXVFcnYzTWIiLCJpc3N1ZWRBdCI6MTc5MjI0NzkxNzI3MSwia2luZCI6ImZjb3NfdmVyY2VsX3JlYWRfaW50ZWdyYXRpb24iLCJub3RBZnRlciI6MTc5NDc4NzIwMDAwMCwib2F1dGhFeGNoYW5nZVJlY2VpcHRTaGEyNTYiOiJmNGVkZjk2MTViMjRhM2MxNWQzMGQ1NTg0YjhjZjA1YWJiNmEzMTdkZmM5ZDNkNDc4NGRjMGM4NDM0MWVjOTc3IiwicHJvamVjdElkIjoicHJqXzBwVU9SUEdmRlB5S3RZaEtyNmVjd0o5eWR2RXMiLCJyb290QWNjZXB0YW5jZVNoYTI1NiI6IjdlYTcwYTE1ZDJlYTE4NzU3MmFjNTMyODZlNDdhMTA2N2YxMWZjN2RmNjAzYjk4NTQyOTAxY2Y4ZjBiNWY0MTkiLCJzY2hlbWFWZXJzaW9uIjoxLCJzY29wZXMiOlsicmVhZDpkZXBsb3ltZW50IiwicmVhZDppbnRlZ3JhdGlvbi1jb25maWd1cmF0aW9uIiwicmVhZDpwcm9qZWN0Il0sInRlYW1JZCI6InRlYW1fTWJLRGF6ekNyb3UzZUtUdWF1c1B2NFgyIn0sInNjaGVtYVZlcnNpb24iOjN9\"}";
const effects=[{importId:'exact04ee-pr114-permission-corrected-three-successor-b53f1cbd-80ca-4f28-ac48-698a21e35b29',kind:'legacy_preview_env_row',effectSha256:digest('synthetic preview')},
 {importId:'production-execution-environment-d706f8b8-92c2-4f80-b85b-8724ea35e5c0',kind:'production_resume_environment_policy',effectSha256:digest('synthetic policy')}];
const unknowns=effects.map(e=>({operationId:e.importId,evidenceHash:H,ownerThreadId:OWNER,ownerReadbackHash:J}));
const policy={schemaVersion:1,policy:'legacy_control_plane_effects_v1',selection:'detached_node24_before_candidate_v1',effects};
function inputs(){
 const source={ref:BOOTSTRAP_SOURCE.ref,bootstrapSha:BOOTSTRAP_SOURCE.bootstrapSha,callerWorkflowRef:`hocheunglai-oss/fcos/.github/workflows/authenticated-release.yml@${BOOTSTRAP_SOURCE.ref}`,controllerSha:BOOTSTRAP_SOURCE.controllerSha,candidateSha:BOOTSTRAP_SOURCE.candidateSha};
 const setup={epoch:1,qualificationSource:source,legacyReleaseContainment:policy};
 const plan={releaseId:'synthetic-qualification',stage:'qualification',executionMode:'qualification',scope:{compatibilityOnly:true}};
 const proof={schemaVersion:1,bootstrapId:'synthetic-bootstrap',epoch:1,ownerThreadId:OWNER,repository:'hocheunglai-oss/fcos',repositoryId:'1278654816',operatorId:'265701760',operatorLogin:'hocheunglai-oss',...BOOTSTRAP_SOURCE,
  setup,setupSha256:digest(setup),plan,planSha256:digest(plan),sentinelSha256:H,inventorySha256:H,rootReviewSha256:H,independentReviewSha256:J,
  containmentProofs:effects.map((e,i)=>({schemaVersion:1,...e,importedEvidenceSha256:digest(unknowns[i]),originalIntentSha256:H,originalSourceSha256:H,confinementEvidenceSha256:H,controllerPolicySha256:digest(policy),rootReviewSha256:H,independentReviewSha256:J,originalOutcome:'unknown',replayAllowed:false,financialAuthorityGranted:false}))};
 proof.actions=bootstrapActions(proof);
 const manifest={schemaVersion:2,releaseId:plan.releaseId,epoch:1,stage:'qualification',executionMode:'qualification',scope:plan.scope,controller:{sha:source.controllerSha,workflow:'.github/workflows/hosted-release-controller.yml'},candidate:{sha:source.candidateSha},setupSha256:proof.setupSha256,qualificationSource:source,legacyReleaseContainment:policy};
 const principal={kind:'github',qualificationOnly:true,repositoryId:proof.repositoryId,actorId:proof.operatorId,actor:proof.operatorLogin,ref:source.ref,sha:source.bootstrapSha,workflowSha:source.bootstrapSha,workflowRef:source.callerWorkflowRef,
  jobWorkflowSha:source.controllerSha,jobWorkflowRef:`hocheunglai-oss/fcos/.github/workflows/hosted-release-controller.yml@${source.controllerSha}`,runId:'101',runAttempt:'1',
  qualificationAdmission:{repository:proof.repository,repositoryId:proof.repositoryId,ref:source.ref,bootstrapSha:source.bootstrapSha,callerWorkflowRef:source.callerWorkflowRef,callerWorkflowSha:source.bootstrapSha,jobWorkflowRef:`hocheunglai-oss/fcos/.github/workflows/hosted-release-controller.yml@${source.controllerSha}`,jobWorkflowSha:source.controllerSha,candidateSha:source.candidateSha,setupSha256:proof.setupSha256}};
 return {proof,manifest,principal,scope:{epoch:1,owner:{kind:'release',id:'features'},releaseId:manifest.releaseId,manifestHash:digest(manifest)}};
}


const incident={operationId:ID,evidenceHash:hash(originalIntentJson),ownerThreadId:OWNER,ownerReadbackHash:J};
function quarantineProof(){
 const originalLease=JSON.parse(originalIntentJson).lease;
 const p={schemaVersion:1,kind:'exact_7dc_public_metadata_quarantine_v1',epoch:1,importId:ID,ownerThreadId:OWNER,
  originalLease:Object.fromEntries(['epoch','objective','ownerThreadId','operationId','bindingSha256','leaseId'].map(k=>[k,originalLease[k]])),
  importedEvidenceSha256:digest(incident),originalIntentJson,originalRequestJson,
  originalGuardedResultSha256:'45bce1f5843c638ad6e9c5fa052efc7a0ecc207533a35141382f23a12c9adb88',
  localCancellationReceiptSha256:'518a39b00abc6ee876d9e8aa9324bc3436431588acbd055759ebcbcb86bb1330',
  localCancellationResolutionSha256:'8184bca0e5512cf4c7720eee619f2931de8e141b5327bb9a794e98dfed352695',
  sourceAcceptanceSha256:'5ccc27b86d0d2e203191df41491e9d2e5412543936a2b270d205c7e111f9c4e1',
  templateSha256:'ed2b7b44d4b1c8a6b5e7df33b6ead2f2d1bd830d9589e83df47cb844cf354556',
  valueSha256:'8a65468047b4c2c6266ab2539472405eab210381c46470e207e5eca4e80bb69f',templateNotAfter:1792522490726,
  expiryGuards:{nativeRelaySha256:'a8f15ea0e0610a5fee84dfa5e23aec3ab09ac3f8224d5d0e2db2f0ad13da25be',carrierSha256:'f1083979827e85fe8b933bea1cc0f80aa245ba5a9889e5165db17af2a61743d3',stepProtocolSha256:'e3ebeb7a1ae02c0ad5bdf2b854f6258d2f2a93a0e5c26b0cbcfc3b99e4e71922'},
  possibleLateMetadataEffect:true,originalOutcome:'unknown',replayAllowed:false,financialAuthorityGranted:false,hostCreationAllowed:false,warmDispatchAllowed:false,
  allOriginalMarkersPreserved:true,noOriginalHostOrWarmDispatchProofSha256:H,inventorySha256:H,legacyFenceSha256:H};
 return reviewed(p);
}
function reviewed(p){
 p=structuredClone(p);delete p.rootReview;delete p.independentReview;
 const scopeSha256=digest(p),common={kind:'fcos_exact_7dc_public_metadata_quarantine_review_v1',accepted:true,scopeSha256,reviewedAt:new Date().toISOString(),exactOriginalEvidenceReviewed:true,expiredMetadataConfinementReviewed:true};
 return {...p,rootReview:{...common,role:'root',reviewerId:'/root'},independentReview:{...common,role:'independent',reviewerId:'/root/test_peer'}};
}

// Mandatory real PostgreSQL, isolated task-owned Unix socket; no TCP listener.
test('exact expired 7dc public-metadata quarantine is private, append-only and leaves original unknown authority stopped',async t=>{
 const bin=execFileSync('pg_config',['--bindir'],{encoding:'utf8'}).trim();
 const dir=await mkdtemp(path.join(process.platform==='darwin'?'/private/tmp':tmpdir(),'fcos-exact7dc-pg-')),data=path.join(dir,'data'),port=54631;
 let started=false,db,admin;
 t.after(async()=>{await db?.end();await admin?.end();if(started)execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{stdio:'pipe'});await rm(dir,{recursive:true,force:true});});
 execFileSync(path.join(bin,'initdb'),['-D',data,'--username=fcos_test_bootstrap','--auth=trust','--no-locale','--encoding=UTF8'],{stdio:'pipe'});
 execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-l',path.join(dir,'server.log'),'-o',`-k ${dir} -h '' -p ${port}`,'-w','start'],{stdio:'pipe'});started=true;
 admin=new pg.Client({host:dir,port,user:'fcos_test_bootstrap',database:'postgres'});await admin.connect();
 await admin.query('create role postgres login nosuperuser nocreatedb createrole inherit nobypassrls;alter database postgres owner to postgres;create role anon;create role authenticated;create role service_role');
 db=new pg.Client({host:dir,port,user:'postgres',database:'postgres'});await db.connect();
 for(const name of names)await db.query(await load(name));
 assert.equal((await db.query('select rolsuper from pg_roles where rolname=current_user')).rows[0].rolsuper,false);
 const patched=['legacy_release_unknowns_contained(fcos_release_coordination.registrations,jsonb,boolean)','cutover_bootstrap_proof_valid(jsonb)'];
 const unchanged=['dispatch(text,jsonb,jsonb)','dispatch_without_auth_maintenance(text,jsonb,jsonb)','activate(bigint,jsonb)','install_epoch(bigint,jsonb)','legacy_release_registration_valid(fcos_release_coordination.registrations)','import_auth_maintenance_authority(jsonb,jsonb)'];
 const signatures=[...patched,...unchanged].map(s=>`fcos_release_coordination.${s}`);
 const metadata=async()=>(await db.query('select oid::int,proname,prosrc,prosecdef,proconfig,proowner::regrole::text owner,proacl::text acl from pg_proc where oid=any($1::regprocedure[]) order by oid',[signatures])).rows;
 const before=await metadata();
 for(const signature of patched)await t.test(`observed body drift in ${signature} rolls back the entire migration`,async()=>{
  await db.query('begin');const def=(await db.query('select pg_get_functiondef($1::regprocedure) v',[`fcos_release_coordination.${signature}`])).rows[0].v;
  await db.query(def.replace('AS $function$','AS $function$\n-- synthetic drift'));
  await assert.rejects(db.query(sql),/COORDINATION_EXACT_7DC_SOURCE_DRIFT/);await db.query('rollback');
  assert.equal((await db.query("select to_regclass('fcos_release_coordination.exact_7dc_publication_quarantines') v")).rows[0].v,null);
  assert.deepEqual(await metadata(),before);
 });
 await db.query(sql);
 for(const prior of before){const current=(await metadata()).find(r=>r.oid===prior.oid);
  for(const key of ['oid','prosecdef','proconfig','owner','acl'])assert.deepEqual(current[key],prior[key],`${prior.proname} ${key}`);
  if(unchanged.some(s=>s.startsWith(`${prior.proname}(`)))assert.equal(current.prosrc,prior.prosrc,`${prior.proname} body remains byte-identical`);
 }
 await admin.query('grant fcos_coordinator_runtime,anon,authenticated,service_role to postgres with inherit false,set true');
 let serial=0;
 async function fails(query,values,pattern){const point=`expected_${++serial}`;await db.query(`savepoint ${point}`);
  try{await assert.rejects(db.query(query,values),pattern);}finally{await db.query(`rollback to savepoint ${point}`);await db.query(`release savepoint ${point}`);}}
 async function asRole(role,query,values=[]){const point=`role_${++serial}`;await db.query(`savepoint ${point}`);await db.query(`set local role ${role}`);
  try{const result=await db.query(query,values);await db.query('reset role');await db.query(`release savepoint ${point}`);return result;}
  catch(e){await db.query(`rollback to savepoint ${point}`);await db.query('reset role');await db.query(`release savepoint ${point}`);throw e;}}
 const dispatch=async(action,p,principal)=>(await asRole('fcos_coordinator_runtime','select fcos_release_coordination.dispatch($1,$2,$3) v',[action,p,principal])).rows[0].v;
 const valid=async p=>(await db.query('select fcos_release_coordination.exact_7dc_publication_proof_valid($1) v',[p])).rows[0].v;
 const admit=async p=>(await db.query('select fcos_release_coordination.admit_exact_7dc_publication_quarantine($1) v',[p])).rows[0].v;
 const active=async()=>(await db.query('select fcos_release_coordination.exact_7dc_publication_quarantined($1,1) v',[ID])).rows[0].v;
 async function fixture(imports=[...unknowns,incident]){
  const f=inputs(),activation={notificationChallenge:createNotificationChallenge(),inventoryComplete:true,inventoryHash:H,legacyFence:{kind:'permanent_legacy_sentinel',snapshotHash:H,proofHash:H},writers:[{id:'original',disabled:true,proofHash:H}],uncertainties:imports};
  await db.query('select fcos_release_coordination.install_epoch(1,$1)',[activation]);
  const q=async(command,extra)=>{const commandSql=bootstrapSql(command,f.proof,extra);return(await db.query(commandSql.query,commandSql.parameters)).rows[0].result;};
  const finishBootstrap=async()=>{await q('admit');for(const action of f.proof.actions){await q('intent',{actionId:action.id});await q('record',{actionId:action.id,evidence:{basis:'native_ack',outcome:'applied',requestSha256:digest(action.request),providerEvidenceSha256:H,rootReviewSha256:H}});}await q('finish');};
  const boundary={validatedBy:'trusted_coordinator',manifestHash:f.scope.manifestHash,controllerSha:f.proof.controllerSha,setupSha256:f.proof.setupSha256,policySha256:digest(policy)};
  const authenticated={...f.principal,legacyContainmentBoundary:boundary};
  const register=()=>dispatch('register',{...f.scope,manifest:f.manifest},f.principal);
  const contain=i=>db.query('select fcos_release_coordination.admit_legacy_release_containment($1,$2)',[f.scope.releaseId,f.proof.containmentProofs[i]]);
  const intent={...f.scope,phase:'preview.create',operationId:'synthetic-preview',requestHash:H};
  const begin=(principal=authenticated)=>dispatch('begin',intent,principal);
  return {...f,activation,q,finishBootstrap,register,contain,authenticated,intent,begin,quarantine:quarantineProof()};
 }
 async function scenario(name,fn){await t.test(name,async()=>{await db.query('begin');try{await fn();}finally{await db.query('rollback');}});}
 await scenario('exact expired incident permits original 64aa/12bee/2ef handoff only after separate fixed-pair containment',async()=>{
  const f=await fixture();assert.equal(await valid(f.quarantine),true);assert.equal(await active(),false);
  await fails('select fcos_release_coordination.admit_cutover_bootstrap($1)',[f.proof],/ADMISSION_INVALID/);
  assert.deepEqual(await admit(f.quarantine),{disposition:'admitted',originalOutcome:'unknown',replayAllowed:false,financialAuthorityGranted:false});
  assert.equal((await admit(f.quarantine)).disposition,'readback');assert.equal(await active(),true);
  await f.finishBootstrap();assert.equal((await f.register()).registered,true);
  assert.equal((await f.begin()).disposition,'busy');await f.contain(0);assert.equal((await f.begin()).disposition,'busy');await f.contain(1);
  assert.equal((await f.begin(f.principal)).disposition,'busy');assert.equal((await f.begin()).disposition,'execute');
  assert.deepEqual((await db.query('select import_id,evidence from fcos_release_coordination.imported_uncertainty order by import_id')).rows,
   [...unknowns,incident].map(e=>({import_id:e.operationId,evidence:e})).sort((a,b)=>a.import_id.localeCompare(b.import_id)));
  for(const table of ['import_resolutions','authorizations','activations','auth_maintenance_authorities'])assert.equal((await db.query(`select count(*)::int n from fcos_release_coordination.${table}`)).rows[0].n,0);
  assert.equal(f.proof.controllerSha,BOOTSTRAP_SOURCE.controllerSha);assert.equal(f.proof.actions.length,2);
 });
 await scenario('every evidence/scope/owner/body/review mismatch and null fails closed, even with recalculated test review hashes',async()=>{
  const f=await fixture(),base=f.quarantine;
  const patches=[{importId:'another'},{ownerThreadId:'other'},{epoch:2},{epoch:null},{originalLease:{...base.originalLease,operationId:'other'}},
   {importedEvidenceSha256:J},{originalIntentJson:originalIntentJson+' '},{originalRequestJson:originalRequestJson+' '},
   {originalRequestJson:JSON.stringify({...JSON.parse(originalRequestJson),name:'OTHER'})},{originalGuardedResultSha256:J},
   {localCancellationReceiptSha256:J},{localCancellationResolutionSha256:J},{sourceAcceptanceSha256:J},{templateSha256:J},{valueSha256:J},
   {templateNotAfter:Date.now()+60000},{expiryGuards:{...base.expiryGuards,carrierSha256:J}},{possibleLateMetadataEffect:false},
   {originalOutcome:'not_applied'},{replayAllowed:true},{financialAuthorityGranted:true},{hostCreationAllowed:true},{warmDispatchAllowed:true},
   {allOriginalMarkersPreserved:false},{inventorySha256:J},{legacyFenceSha256:J},{noOriginalHostOrWarmDispatchProofSha256:null},{extra:true}];
  for(const patch of patches){const p=reviewed({...base,...patch});assert.equal(await valid(p),false,JSON.stringify(Object.keys(patch)));await fails('select fcos_release_coordination.admit_exact_7dc_publication_quarantine($1)',[p],/ADMISSION_INVALID/);}
  for(const key of Object.keys(base)){const p=structuredClone(base);p[key]=null;assert.equal(await valid(p),false,`null ${key}`);}
  for(const slot of ['rootReview','independentReview'])for(const patch of [{accepted:false},{scopeSha256:J},{role:null},{reviewerId:'/untrusted'},
   {exactOriginalEvidenceReviewed:false},{expiredMetadataConfinementReviewed:false},{reviewedAt:'infinity'},{reviewedAt:'invalid'},{reviewedAt:new Date(Date.now()+60000).toISOString()},{extra:true}]){
   const p={...base,[slot]:{...base[slot],...patch}};assert.equal(await valid(p),false,`${slot} ${JSON.stringify(patch)}`);
  }
  assert.equal(await active(),false);
 });
 await scenario('imported original owner/evidence, epoch fence, and original resolution stay authoritative',async()=>{
  for(const patch of [{ownerThreadId:'other'},{evidenceHash:J},{operationId:'different'}]){
   await db.query('savepoint import_case');await fixture([...unknowns,{...incident,...patch}]);assert.equal(await valid(quarantineProof()),false);await db.query('rollback to savepoint import_case');await db.query('release savepoint import_case');
  }
  const f=await fixture();await db.query('insert into fcos_release_coordination.import_resolutions(import_id,evidence) values($1,$2)',[ID,{outcome:'not_applied',ownerReadbackHash:H}]);assert.equal(await valid(f.quarantine),false);
 });
 await scenario('a fourth unknown remains a hard stop after exact quarantine',async()=>{
  const f=await fixture([...unknowns,incident,{operationId:'fourth-unresolved',evidenceHash:H}]);await admit(f.quarantine);
  assert.equal(await active(),true);await fails('select fcos_release_coordination.admit_cutover_bootstrap($1)',[f.proof],/ADMISSION_INVALID/);
 });
 await scenario('append-only revocation permanently blocks bootstrap and release follow-on; readback cannot reactivate',async()=>{
  const f=await fixture();await admit(f.quarantine);await f.finishBootstrap();await f.register();await f.contain(0);await f.contain(1);
  await db.query('select fcos_release_coordination.revoke_exact_7dc_publication_quarantine($1,$2,$3)',[ID,digest(f.quarantine),H]);
  assert.equal(await active(),false);assert.equal((await admit(f.quarantine)).disposition,'readback');assert.equal(await active(),false);
  assert.equal((await f.begin()).disposition,'busy');assert.equal((await db.query('select fcos_release_coordination.cutover_bootstrap_proof_valid($1) v',[f.proof])).rows[0].v,false);
  await fails('select fcos_release_coordination.revoke_exact_7dc_publication_quarantine($1,$2,$3)',[ID,J,H],/REVOCATION_INVALID/);
  await fails('select fcos_release_coordination.admit_exact_7dc_publication_quarantine($1)',[reviewed({...f.quarantine,noOriginalHostOrWarmDispatchProofSha256:J})],/CONFLICT/);
 });
 await scenario('quarantine cannot exempt financial, auth-maintenance, foreign release, wrong caller, or missing boundary contexts',async()=>{
  const f=await fixture();await admit(f.quarantine);await f.finishBootstrap();await f.register();await f.contain(0);await f.contain(1);
  for(const kind of ['financial','auth_maintenance']){
   const r=(await db.query('select * from fcos_release_coordination.registrations where release_id=$1',[f.scope.releaseId])).rows[0];
   const p={...f.authenticated,kind};
   assert.equal((await db.query('select fcos_release_coordination.legacy_release_unknowns_contained(r,$2,true) v from fcos_release_coordination.registrations r where release_id=$1',[f.scope.releaseId,p])).rows[0].v,false);
   assert.equal((await db.query('select fcos_release_coordination.legacy_release_unknowns_contained(jsonb_populate_record(null::fcos_release_coordination.registrations,to_jsonb(r)||jsonb_build_object(\'scope\',$3::text)),$2,true) v from fcos_release_coordination.registrations r where release_id=$1',[f.scope.releaseId,f.authenticated,kind])).rows[0].v,false);
   await fails('select fcos_release_coordination.activate(1,$1)',[{}],/ACTIVATION|QUALIFICATION|UNCERTAINTY|INVALID/);
   assert.equal(r.scope,'qualification');
  }
  for(const patch of [{kind:'financial'},{kind:'auth_maintenance'},{jobWorkflowSha:'c'.repeat(40)},{actorId:'9'},{legacyContainmentBoundary:{...f.authenticated.legacyContainmentBoundary,validatedBy:'caller'}}]){
   try{assert.equal((await f.begin({...f.authenticated,...patch})).disposition,'busy');}
   catch(e){assert.match(e.message,/^COORDINATION_/);}
  }
  assert.equal((await dispatch('begin',{...f.intent,owner:{kind:'release',id:'foreign'}},f.authenticated)).disposition,'busy');
 });
 await scenario('only postgres administers exact incident; all journals are private and immutable',async()=>{
  const f=await fixture();await admit(f.quarantine);
  const functions=['admit_exact_7dc_publication_quarantine(jsonb)','revoke_exact_7dc_publication_quarantine(text,text,text)','exact_7dc_publication_proof_valid(jsonb)','exact_7dc_publication_quarantined(text,bigint)'];
  for(const role of ['fcos_coordinator_runtime','anon','authenticated','service_role']){
   for(const signature of functions)assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') v',[role,`fcos_release_coordination.${signature}`])).rows[0].v,false);
   for(const table of ['exact_7dc_publication_quarantines','exact_7dc_publication_quarantine_revocations']){
    await assert.rejects(asRole(role,`select * from fcos_release_coordination.${table}`),/permission denied/);
    assert.equal((await db.query('select has_table_privilege($1,$2,\'insert\') v',[role,`fcos_release_coordination.${table}`])).rows[0].v,false);
   }
   await assert.rejects(asRole(role,'select fcos_release_coordination.admit_exact_7dc_publication_quarantine($1)',[f.quarantine]),/permission denied/);
  }
  for(const table of ['exact_7dc_publication_quarantines','exact_7dc_publication_quarantine_revocations']){
   for(const op of [`update fcos_release_coordination.${table} set proof_sha256=proof_sha256`,`delete from fcos_release_coordination.${table}`,`truncate fcos_release_coordination.${table} cascade`])await fails(op,[],/APPEND_ONLY/);
   assert.equal((await db.query('select relrowsecurity from pg_class where oid=$1::regclass',[`fcos_release_coordination.${table}`])).rows[0].relrowsecurity,true);
  }
  assert.equal((await db.query('select count(*)::int n from fcos_release_coordination.imported_uncertainty')).rows[0].n,3);
  assert.equal((await db.query('select count(*)::int n from fcos_release_coordination.import_resolutions')).rows[0].n,0);
 });
});
