# AI model routing

FCOS resolves an actual provider model on the server before each AI request.
`api/_aiModelRouting.js` owns the task policy; `shared/aiModelCatalog.js` owns
the manual selection allowlist and usage pricing. Existing OpenAI credentials
are reused. Provider failures do not silently switch to a weaker model.

| Task | Automatic route |
| --- | --- |
| Simple positive single-field Dashboard lookup | GPT-5.6 Luna, low reasoning |
| Compound, numeric, non-English or ambiguous Dashboard search | GPT-5.6 Sol, medium reasoning |
| Email classification | GPT-5.6 Luna, low reasoning |
| Email routing recommendations | GPT-5.6 Sol, medium reasoning |
| Market image extraction | GPT-5.6 Sol, medium reasoning |
| Market report analysis and commentary | GPT-5.6 Sol, medium reasoning; complex evidence uses GPT-6 Astra, high reasoning |
| Trading exposure analysis and Special Terms drafting | GPT-6 Astra, high reasoning |

Dashboard, Trading Assistant and Email Router AI settings offer **Automatic by
task** and manual overrides. Market report analysis has the same choice per
request. Existing permission and revision controls still apply. The migration
changes only untouched original defaults; previously edited choices survive.
Market extraction/commentary environment overrides remain supported, including
the legacy `gpt-5-mini` alias.

Each response exposes routing metadata, including the actual model, effort,
task, reason and policy version. Usage records contain actual models, never
`auto`. Dashboard interpretation caches include routing version, setting
revision, current date and selected period. Routing does not change data scope,
validated output contracts, approval requirements or available actions.

Verification covers task selection, conservative complexity detection, manual
overrides, request budgets, actual-model usage and private migration access.
The Settings fixture at `/e2e/fixtures/ai-routing.html` uses synthetic data and
does not make provider calls.
