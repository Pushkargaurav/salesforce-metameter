# MetaMeter for Salesforce

Estimate Salesforce Custom Metadata character usage and identify oversized Text fields with potential savings.

This standalone Salesforce DX repository includes the Lightning Web Component, Apex controller and tests, permission set, tab, and deployment manifest.

## Requirements

- Salesforce org supporting metadata API 67.0 and Lightning Experience.
- Salesforce CLI and deployment permissions in the target org.
- Node.js and npm for local Jest tests and lint checks.

## Install

Authenticate your sandbox (use https://login.salesforce.com for a production or Developer Edition org):

~~~~sh
sf org login web --instance-url https://test.salesforce.com --alias YOUR_SANDBOX
~~~~

Validate before installing:

~~~~sh
sf project deploy start --dry-run --manifest manifest/metameter-package.xml --target-org YOUR_SANDBOX --test-level RunSpecifiedTests --tests MetaMeterControllerTest --wait 10
~~~~

Deploy and assign access:

~~~~sh
sf project deploy start --manifest manifest/metameter-package.xml --target-org YOUR_SANDBOX --test-level RunSpecifiedTests --tests MetaMeterControllerTest --wait 10
sf org assign permset --name MetaMeter_User --target-org YOUR_SANDBOX
~~~~

Open MetaMeter from the App Launcher. You can also place its component on an App Page or Home Page. Usage is an estimate of visible metadata; compare it with Setup. Field-size recommendations do not modify metadata.

## Local checks

~~~~sh
npm install
npm run test:unit -- --runInBand
npm run lint
~~~~

Apex tests run through Salesforce deployment validation. Local checks require installing the development dependencies.

## Documentation

See the [MetaMeter installation and usage guide](docs/metameter.md).
