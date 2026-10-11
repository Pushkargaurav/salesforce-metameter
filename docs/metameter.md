# MetaMeter

MetaMeter estimates Custom Metadata capacity by type and scans full field values to identify oversized Text fields. It is read only: recommendations never resize fields or edit records.

Deploy this standalone feature with the supplied manifest:

```powershell
sf project deploy start --manifest manifest/metameter-package.xml --test-level RunSpecifiedTests --tests MetaMeterControllerTest --target-org <org-alias>
sf org assign permset --name MetaMeter_User --target-org <org-alias>
```

Open **MetaMeter** in the App Launcher. The component can also be placed on a Lightning App Page or Home Page. Assign the permission set to other users who need the analyzer.

Capacity defaults to the ten heaviest types. Change the sortable columns, Top 5/10/25/50/All selector, or namespace toggle to explore usage. The namespace filter affects totals and type selection; the Top selector affects only displayed rows. Capacity CSV includes all types matching the namespace filter, with warnings for unknown counts. Refresh reads fresh definitions and records and reruns any selected analysis.

Each record costs 141 base characters plus its custom field allocations. Total usage is characters per record multiplied by record count. The gauge changes at 50% and 80% of the 10,000,000-character org allowance. A failed count stays blank, carries a warning icon, is excluded from totals, and makes the status **Incomplete**.

The total is an estimate of visible metadata. Installed records in certified managed packages have a separate allowance, while records created by an org in those same types count toward its own allowance. Namespace filtering excludes entire types and cannot distinguish record origins or package certification. Protected or otherwise unavailable metadata can also affect completeness. Compare with Setup before drawing conclusions about remaining capacity. See [Salesforce's allocation rules](https://help.salesforce.com/s/articleView?id=platform.custommetadatatypes_limits.htm&type=5).

Field analysis reads each custom field with keyset pagination, measuring full long-text values without returning the values to the browser. Page sizes adapt to declared field length to bound Apex heap use. Large types with many fields can take time; progress appears during the scan. Changing selection cancels further requests for the old scan. Successful scans expose longest value, declared-size utilization, and savings. Fields without a declared length have blank utilization; non-text lengths use the value's string representation.

Only Text fields receive suggestions: `max(10, ceil(longest * 1.25 / 10) * 10)`, provided it is smaller than the current declared size and the type has records. Savings equal `(current length - suggested length) * records`. Suggestions and field CSV are available after all fields have been scanned successfully. A scan failure or changed record count prevents publishing recommendations. The scan is not a transactional snapshot; avoid deploying or modifying records during analysis. Review intended future data and dependencies before resizing a field.

The calculation guide is available from the information button, including all field costs, a worked example, and caveats.

Validation:

```powershell
npm run test:unit -- --runInBand metaMeter
npx eslint force-app/main/default/lwc/metaMeter
sf project deploy start --dry-run --manifest manifest/metameter-package.xml --test-level RunSpecifiedTests --tests MetaMeterControllerTest --target-org <org-alias>
```
