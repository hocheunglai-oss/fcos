import { runGuardedProviderWrite } from './lib/guarded-provider-write.mjs';

// This intentionally emits only the self-contained function. Consumers must
// hash-check this source before compiling it; this utility grants no authority.
process.stdout.write(runGuardedProviderWrite.toString());
