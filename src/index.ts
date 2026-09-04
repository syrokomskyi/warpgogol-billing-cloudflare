/*
<MODULE_CONTRACT>
<purpose>Barrel export for the Cloudflare D1 billing adapter.</purpose>
<non-goals><item>Do not re-export billing-core schemas or types — consumers import from billing-core directly.</item></non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY><item>RFC-1012: initial D1 adapter barrel export.</item></CHANGE_SUMMARY>
*/

export { D1BillingStore, type D1BillingStoreOptions } from "./d1-billing-store.ts";
