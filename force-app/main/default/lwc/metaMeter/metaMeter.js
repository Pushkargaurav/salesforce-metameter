import { LightningElement } from "lwc";
import getCatalog from "@salesforce/apex/MetaMeterController.getCatalog";
import getRecordCounts from "@salesforce/apex/MetaMeterController.getRecordCounts";
import getFieldDefinitions from "@salesforce/apex/MetaMeterController.getFieldDefinitions";
import getFieldValuePage from "@salesforce/apex/MetaMeterController.getFieldValuePage";
import { enrichField, sortRows, csvContent, errorMessage } from "./meterUtils";

const number = new Intl.NumberFormat("en-US");
const TYPE_COLUMNS = [
  {
    label: "Custom Metadata Type",
    fieldName: "label",
    sortable: true,
    cellAttributes: {
      iconName: { fieldName: "warningIcon" },
      iconAlternativeText: { fieldName: "warning" }
    }
  },
  { label: "API Name", fieldName: "apiName", sortable: true },
  { label: "Namespace", fieldName: "namespacePrefix", sortable: true },
  { label: "Fields", fieldName: "fieldCount", type: "number", sortable: true },
  {
    label: "Records",
    fieldName: "recordCount",
    type: "number",
    sortable: true
  },
  {
    label: "Chars per Record",
    fieldName: "charactersPerRecord",
    type: "number",
    sortable: true
  },
  {
    label: "Total Chars",
    fieldName: "totalCharacters",
    type: "number",
    sortable: true
  },
  {
    label: "Share of Org Limit",
    fieldName: "share",
    type: "percent",
    typeAttributes: { maximumFractionDigits: 2 },
    sortable: true
  },
  {
    label: "",
    type: "button",
    typeAttributes: { label: "Analyze", name: "analyze", variant: "base" },
    initialWidth: 100
  }
];
const FIELD_COLUMNS = [
  { label: "Field", fieldName: "label", sortable: true },
  { label: "API Name", fieldName: "apiName", sortable: true },
  { label: "Type", fieldName: "fieldType", sortable: true },
  {
    label: "Declared Size",
    fieldName: "declaredSize",
    type: "number",
    sortable: true
  },
  {
    label: "Cost per Record",
    fieldName: "charactersPerRecord",
    type: "number",
    sortable: true
  },
  { label: "Why This Cost", fieldName: "reason", wrapText: true },
  {
    label: "Longest Value",
    fieldName: "longestValue",
    type: "number",
    sortable: true
  },
  {
    label: "Size Used",
    fieldName: "utilization",
    type: "percent",
    typeAttributes: { maximumFractionDigits: 1 },
    sortable: true
  },
  {
    label: "Suggested Size",
    fieldName: "suggestedSize",
    type: "number",
    sortable: true
  },
  {
    label: "Could Save",
    fieldName: "potentialSavings",
    type: "number",
    sortable: true
  }
];

export default class MetaMeter extends LightningElement {
  rows = [];
  fields = [];
  orgLimit = 10000000;
  baseCharacters = 141;
  includeManaged = true;
  topLimit = "10";
  sortedBy = "totalCharacters";
  sortDirection = "desc";
  fieldSortedBy = "charactersPerRecord";
  fieldSortDirection = "desc";
  selectedType = "";
  loading = false;
  analyzing = false;
  error = "";
  analysisError = "";
  analysisProgress = "";
  analysisComplete = false;
  refreshedAt;
  helpOpen = false;
  loadVersion = 0;
  analysisVersion = 0;
  helpFocused = false;
  typeColumns = TYPE_COLUMNS;
  fieldColumns = FIELD_COLUMNS;
  limitOptions = ["5", "10", "25", "50", "all"].map((value) => ({
    label: value === "all" ? "All types" : `Top ${value}`,
    value
  }));

  connectedCallback() {
    this.refresh();
  }
  disconnectedCallback() {
    this.loadVersion++;
    this.analysisVersion++;
  }
  renderedCallback() {
    if (this.helpOpen && !this.helpFocused) {
      this.template.querySelector("[data-modal-close]")?.focus();
      this.helpFocused = true;
    }
  }

  async refresh() {
    const version = ++this.loadVersion;
    ++this.analysisVersion;
    this.analyzing = false;
    this.analysisComplete = false;
    this.fields = [];
    this.analysisError = "";
    this.loading = true;
    this.error = "";
    this.rows = [];
    this.refreshedAt = undefined;
    try {
      const catalog = await getCatalog();
      if (version !== this.loadVersion) return;
      this.orgLimit = catalog.orgLimit;
      this.baseCharacters = catalog.baseCharacters;
      let rows = catalog.types;
      for (let offset = 0; offset < rows.length; offset += 20) {
        const batch = rows.slice(offset, offset + 20);
        let counts;
        try {
          // Each request bounds Apex work; sequential batches also avoid flooding the org.
          // eslint-disable-next-line no-await-in-loop
          counts = await getRecordCounts({
            apiNames: batch.map((row) => row.apiName)
          });
        } catch (error) {
          counts = batch.map((row) => ({
            apiName: row.apiName,
            warning: `Records could not be counted. ${errorMessage(error)}`
          }));
        }
        if (version !== this.loadVersion) return;
        const byName = new Map(counts.map((row) => [row.apiName, row]));
        rows = rows.map((row) => {
          if (!byName.has(row.apiName)) return row;
          const count = byName.get(row.apiName);
          // Apex count rows also serialize unused descriptive properties as null.
          const merged = {
            ...row,
            recordCount: count.recordCount,
            totalCharacters: count.totalCharacters,
            charactersPerRecord:
              count.charactersPerRecord ?? row.charactersPerRecord,
            warning: count.warning
          };
          return {
            ...merged,
            share:
              merged.totalCharacters == null
                ? null
                : merged.totalCharacters / this.orgLimit,
            warningIcon: merged.warning ? "utility:warning" : ""
          };
        });
      }
      this.rows = rows;
      this.refreshedAt = new Date();
    } catch (error) {
      if (version === this.loadVersion) this.error = errorMessage(error);
    } finally {
      if (version === this.loadVersion) this.loading = false;
    }
    if (version === this.loadVersion && this.selectedType) {
      if (this.filteredRows.some((row) => row.apiName === this.selectedType))
        this.analyze(this.selectedType);
      else this.selectedType = "";
    }
  }

  get filteredRows() {
    return this.rows.filter(
      (row) => this.includeManaged || !row.namespacePrefix
    );
  }
  get visibleRows() {
    const rows = sortRows(this.filteredRows, this.sortedBy, this.sortDirection);
    return this.topLimit === "all"
      ? rows
      : rows.slice(0, Number(this.topLimit));
  }
  get countedRows() {
    return this.filteredRows.filter(
      (row) => !row.warning && row.recordCount != null
    );
  }
  get totalCharacters() {
    return this.countedRows.reduce((sum, row) => sum + row.totalCharacters, 0);
  }
  get totalRecords() {
    return number.format(
      this.countedRows.reduce((sum, row) => sum + row.recordCount, 0)
    );
  }
  get typeCount() {
    return this.filteredRows.length;
  }
  get charactersLeft() {
    return number.format(Math.max(0, this.orgLimit - this.totalCharacters));
  }
  get percentage() {
    return this.loading || this.error
      ? "—"
      : `${((this.totalCharacters / this.orgLimit) * 100).toFixed(2)}%`;
  }
  get usageDescription() {
    if (this.loading) return "Reading metadata definitions and record counts…";
    if (this.error) return "Capacity could not be calculated.";
    return `${number.format(this.totalCharacters)} of ${number.format(this.orgLimit)} characters · ${this.includeManaged ? "includes namespaced types" : "excludes namespaced types"}`;
  }
  get health() {
    if (this.loading) return "Loading";
    if (this.error) return "Unavailable";
    if (this.warningRows.length) return "Incomplete";
    const ratio = this.totalCharacters / this.orgLimit;
    return ratio >= 0.8 ? "Critical" : ratio >= 0.5 ? "Watch" : "Healthy";
  }
  get gaugeClass() {
    const ratio = this.totalCharacters / this.orgLimit;
    return `gauge-panel ${ratio >= 0.8 ? "critical" : ratio >= 0.5 ? "watch" : "healthy"}`;
  }
  get gaugeStyle() {
    return `width: ${Math.min(100, (this.totalCharacters / this.orgLimit) * 100)}%;`;
  }
  get gaugeValue() {
    return Math.min(100, (this.totalCharacters / this.orgLimit) * 100);
  }
  get showingLabel() {
    return `Showing ${this.visibleRows.length} of ${this.filteredRows.length} types`;
  }
  get warningRows() {
    return this.filteredRows.filter((row) => row.warning);
  }
  get hasWarnings() {
    return this.warningRows.length > 0;
  }
  get hasRows() {
    return this.rows.length > 0;
  }
  get emptyCapacity() {
    return !this.loading && !this.error && !this.filteredRows.length;
  }
  get exportDisabled() {
    return this.loading || !this.filteredRows.length;
  }
  get lastRefreshed() {
    return this.refreshedAt
      ? `Last refreshed ${this.refreshedAt.toLocaleString()}`
      : "";
  }
  get typeOptions() {
    return [
      { label: "Choose a type", value: "" },
      ...sortRows(this.filteredRows, "label", "asc").map((row) => ({
        label: `${row.label} (${row.apiName})`,
        value: row.apiName
      }))
    ];
  }
  get sortedFields() {
    return sortRows(this.fields, this.fieldSortedBy, this.fieldSortDirection);
  }
  get hasFields() {
    return this.fields.length > 0;
  }
  get noCustomFields() {
    return this.analysisComplete && !this.fields.length;
  }
  get analysisExportDisabled() {
    return !this.analysisComplete || !this.fields.length;
  }
  get showSavings() {
    return this.analysisComplete && !this.analysisError;
  }
  get showAnalysisPrompt() {
    return !this.selectedType;
  }
  get couldSave() {
    return number.format(
      this.fields.reduce((sum, field) => sum + (field.potentialSavings || 0), 0)
    );
  }
  get analysisSummary() {
    const row = this.rows.find((type) => type.apiName === this.selectedType);
    return row
      ? `${row.label} · ${number.format(row.charactersPerRecord)} chars per record, including ${this.baseCharacters} base chars`
      : "";
  }
  get helpCosts() {
    return [
      { type: "Checkbox, Date, Date/Time, Picklist", cost: "10" },
      { type: "Phone", cost: "40" },
      { type: "Email", cost: "80" },
      { type: "URL", cost: "255" },
      { type: "Text", cost: "Declared length (maximum 255)" },
      {
        type: "Text Area / Long Text Area",
        cost: "Up to 255, even when declared larger"
      },
      {
        type: "Number / Percent",
        cost: "Total numeric precision, including decimal digits"
      },
      { type: "Relationship to Object / Field", cost: "10" },
      { type: "Relationship to another Custom Metadata Type", cost: "15" }
    ];
  }

  handleLimit(event) {
    this.topLimit = event.detail.value;
  }
  handleManaged(event) {
    this.includeManaged = event.target.checked;
    if (!this.filteredRows.some((row) => row.apiName === this.selectedType))
      this.analyze("");
  }
  handleSort(event) {
    this.sortedBy = event.detail.fieldName;
    this.sortDirection = event.detail.sortDirection;
  }
  handleFieldSort(event) {
    this.fieldSortedBy = event.detail.fieldName;
    this.fieldSortDirection = event.detail.sortDirection;
  }
  handleType(event) {
    this.analyze(event.detail.value);
  }
  handleRowAction(event) {
    if (event.detail.action.name === "analyze")
      this.analyze(event.detail.row.apiName);
  }

  async analyze(apiName) {
    const version = ++this.analysisVersion;
    this.selectedType = apiName;
    this.fields = [];
    this.analysisError = "";
    this.analysisComplete = false;
    this.analyzing = Boolean(apiName);
    this.analysisProgress = "Reading field definitions…";
    if (!apiName) return;
    try {
      const definitions = await getFieldDefinitions({ apiName });
      if (version !== this.analysisVersion) return;
      this.fields = definitions;
      const completedFields = [];
      const row = this.rows.find((type) => type.apiName === apiName);
      for (let index = 0; index < definitions.length; index++) {
        const field = definitions[index];
        let cursor = null;
        let longest = 0;
        let scanned = 0;
        let done = false;
        while (!done) {
          this.analysisProgress = `Scanning field ${index + 1} of ${definitions.length}: ${field.label} · ${number.format(scanned)} records`;
          // The next request depends on the cursor returned by this page.
          // eslint-disable-next-line no-await-in-loop
          const page = await getFieldValuePage({
            apiName,
            fieldName: field.apiName,
            cursor
          });
          if (version !== this.analysisVersion) return;
          longest = Math.max(longest, page.longestValues[field.apiName] || 0);
          scanned += page.recordsScanned;
          done = page.done;
          if (!done && (!page.nextCursor || page.nextCursor === cursor))
            throw new Error(
              "The scan could not advance. Refresh and try again."
            );
          cursor = page.nextCursor;
        }
        if (row?.recordCount != null && scanned !== row.recordCount)
          throw new Error(
            "Records changed during analysis. Refresh to calculate savings from a consistent record count."
          );
        const enriched = enrichField(field, longest, row?.recordCount);
        completedFields.push(enriched);
        this.fields = this.fields.map((item) => {
          if (item.apiName === field.apiName) {
            return { ...enriched, suggestedSize: null, potentialSavings: null };
          }
          return item;
        });
      }
      // Publish savings only after every field has been scanned successfully.
      this.analysisComplete = true;
      this.fields = completedFields;
      this.analysisProgress = "All fields scanned.";
      if (row?.warning)
        this.analysisError =
          "Record count is unavailable. Longest values are shown; savings cannot be calculated.";
    } catch (error) {
      if (version === this.analysisVersion) {
        this.analysisError = errorMessage(error);
        this.fields = this.fields.map((field) => ({
          ...field,
          suggestedSize: null,
          potentialSavings: null
        }));
      }
    } finally {
      if (version === this.analysisVersion) this.analyzing = false;
    }
  }

  exportCapacity() {
    const rows = sortRows(this.filteredRows, this.sortedBy, this.sortDirection);
    this.download(
      "metameter-capacity.csv",
      csvContent(
        [
          "Custom Metadata Type",
          "API Name",
          "Namespace",
          "Fields",
          "Records",
          "Chars per Record",
          "Total Chars",
          "Share of Org Limit (%)",
          "Warning"
        ],
        rows.map((row) => [
          row.label,
          row.apiName,
          row.namespacePrefix,
          row.fieldCount,
          row.recordCount,
          row.charactersPerRecord,
          row.totalCharacters,
          row.share == null ? null : (row.share * 100).toFixed(4),
          row.warning
        ])
      )
    );
  }
  exportFields() {
    this.download(
      `metameter-${this.selectedType}-fields.csv`,
      csvContent(
        [
          "Field",
          "API Name",
          "Type",
          "Declared Size",
          "Chars per Record",
          "Reason",
          "Longest Value",
          "Size Used (%)",
          "Suggested Size",
          "Could Save (chars)"
        ],
        this.sortedFields.map((field) => [
          field.label,
          field.apiName,
          field.fieldType,
          field.declaredSize,
          field.charactersPerRecord,
          field.reason,
          field.longestValue,
          field.utilization == null
            ? null
            : (field.utilization * 100).toFixed(2),
          field.suggestedSize,
          field.potentialSavings
        ])
      )
    );
  }
  download(filename, content) {
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/plain" })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }
  openHelp() {
    this.helpOpen = true;
  }
  closeHelp() {
    this.helpOpen = false;
    this.helpFocused = false;
    this.template.querySelector("[data-help-trigger]")?.focus();
  }
  handleHelpKey(event) {
    if (event.key === "Escape") this.closeHelp();
    if (event.key === "Tab") {
      const focusable = [
        ...this.template.querySelectorAll(".slds-modal button, .slds-modal a")
      ];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && event.target === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && event.target === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
}
