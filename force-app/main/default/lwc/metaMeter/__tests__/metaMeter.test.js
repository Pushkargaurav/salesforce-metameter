import { createElement } from "lwc";
import MetaMeter from "c/metaMeter";
import getCatalog from "@salesforce/apex/MetaMeterController.getCatalog";
import getRecordCounts from "@salesforce/apex/MetaMeterController.getRecordCounts";
import getFieldDefinitions from "@salesforce/apex/MetaMeterController.getFieldDefinitions";
import getFieldValuePage from "@salesforce/apex/MetaMeterController.getFieldValuePage";

jest.mock(
  "@salesforce/apex/MetaMeterController.getCatalog",
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock(
  "@salesforce/apex/MetaMeterController.getRecordCounts",
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock(
  "@salesforce/apex/MetaMeterController.getFieldDefinitions",
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock(
  "@salesforce/apex/MetaMeterController.getFieldValuePage",
  () => ({ default: jest.fn() }),
  { virtual: true }
);
// Let Apex promises and LWC render jobs finish before inspecting the DOM.
// eslint-disable-next-line @lwc/lwc/no-async-operation
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const types = [
  {
    apiName: "Own__mdt",
    label: "Own",
    namespacePrefix: "",
    fieldCount: 1,
    charactersPerRecord: 396
  },
  {
    apiName: "pkg__Other__mdt",
    label: "Other",
    namespacePrefix: "pkg",
    fieldCount: 1,
    charactersPerRecord: 396
  },
  {
    apiName: "Failed__mdt",
    label: "Failed",
    namespacePrefix: "",
    fieldCount: 1,
    charactersPerRecord: 396
  }
];
function mount() {
  const element = createElement("c-meta-meter", { is: MetaMeter });
  document.body.appendChild(element);
  return element;
}
function analyze(element, apiName = "Own__mdt") {
  element.shadowRoot
    .querySelector(".type-picker")
    .dispatchEvent(new CustomEvent("change", { detail: { value: apiName } }));
}
beforeEach(() => {
  getCatalog.mockResolvedValue({
    orgLimit: 10000000,
    baseCharacters: 141,
    types
  });
  getRecordCounts.mockResolvedValue([
    {
      apiName: "Own__mdt",
      label: null,
      fieldCount: null,
      namespacePrefix: null,
      recordCount: 5,
      totalCharacters: 1980
    },
    { apiName: "pkg__Other__mdt", recordCount: 10, totalCharacters: 3960 },
    {
      apiName: "Failed__mdt",
      warning: "Cannot count",
      recordCount: null,
      totalCharacters: null
    }
  ]);
  getFieldDefinitions.mockResolvedValue([
    {
      apiName: "Text__c",
      label: "Text",
      fieldType: "STRING",
      declaredSize: 255,
      charactersPerRecord: 255,
      shrinkable: true
    }
  ]);
  getFieldValuePage.mockResolvedValue({
    longestValues: { Text__c: 40 },
    recordsScanned: 5,
    done: true
  });
});
afterEach(() => {
  while (document.body.firstChild) document.body.firstChild.remove();
  jest.resetAllMocks();
});

it("excludes failed counts, warns and updates usage when hiding namespaced types", async () => {
  const element = mount();
  await flush();
  const table = element.shadowRoot.querySelector("lightning-datatable");
  expect(table.data.map((row) => row.apiName)).toEqual([
    "pkg__Other__mdt",
    "Own__mdt",
    "Failed__mdt"
  ]);
  expect(table.data.find((row) => row.apiName === "Own__mdt")).toMatchObject({
    label: "Own",
    fieldCount: 1,
    namespacePrefix: ""
  });
  expect(
    element.shadowRoot.querySelector(".gauge-panel").textContent
  ).toContain("5,940");
  expect(element.shadowRoot.querySelector(".status").textContent).toBe(
    "Incomplete"
  );
  const toggle = element.shadowRoot.querySelector("lightning-input");
  toggle.checked = false;
  toggle.dispatchEvent(new CustomEvent("change"));
  await flush();
  expect(table.data).toHaveLength(2);
  expect(
    element.shadowRoot.querySelector(".gauge-panel").textContent
  ).toContain("1,980");
});

it("scans every page before showing savings and uses the global longest value", async () => {
  getFieldValuePage.mockResolvedValueOnce({
    longestValues: { Text__c: 40 },
    recordsScanned: 3,
    nextCursor: "cursor1",
    done: false
  });
  let finish;
  getFieldValuePage.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const element = mount();
  await flush();
  analyze(element);
  await flush();
  expect(element.shadowRoot.querySelector(".savings")).toBeNull();
  finish({ longestValues: { Text__c: 81 }, recordsScanned: 2, done: true });
  await flush();
  expect(getFieldValuePage).toHaveBeenLastCalledWith({
    apiName: "Own__mdt",
    fieldName: "Text__c",
    cursor: "cursor1"
  });
  const field = element.shadowRoot.querySelectorAll("lightning-datatable")[1]
    .data[0];
  expect(field).toMatchObject({
    longestValue: 81,
    suggestedSize: 110,
    potentialSavings: 725
  });
  expect(element.shadowRoot.querySelector(".savings").textContent).toContain(
    "725"
  );
});

it("suppresses savings and export when a value scan fails", async () => {
  getFieldValuePage.mockRejectedValue({
    body: { message: "Field is not readable" }
  });
  const element = mount();
  await flush();
  analyze(element);
  await flush();
  expect(element.shadowRoot.querySelector(".savings")).toBeNull();
  expect(
    element.shadowRoot.querySelectorAll("lightning-button")[0].disabled
  ).toBe(true);
  expect(element.shadowRoot.textContent).toContain("Field is not readable");
});

it("discards a stale scan after selecting another type", async () => {
  let finish;
  getFieldValuePage.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const element = mount();
  await flush();
  analyze(element);
  await flush();
  getFieldValuePage.mockResolvedValue({
    longestValues: { Text__c: 100 },
    recordsScanned: 10,
    done: true
  });
  analyze(element, "pkg__Other__mdt");
  await flush();
  finish({ longestValues: { Text__c: 1 }, recordsScanned: 5, done: true });
  await flush();
  expect(
    element.shadowRoot.querySelectorAll("lightning-datatable")[1].data[0]
      .longestValue
  ).toBe(100);
});

it("refuses savings if metadata changed between counting and scanning", async () => {
  getFieldValuePage.mockResolvedValue({
    longestValues: { Text__c: 20 },
    recordsScanned: 6,
    done: true
  });
  const element = mount();
  await flush();
  analyze(element);
  await flush();
  expect(element.shadowRoot.textContent).toContain(
    "Records changed during analysis"
  );
  expect(element.shadowRoot.querySelector(".savings")).toBeNull();
});

it.each([
  [4999999, "Healthy"],
  [5000000, "Watch"],
  [8000000, "Critical"]
])(
  "uses the threshold status at %i characters",
  async (totalCharacters, status) => {
    getRecordCounts.mockResolvedValue(
      types.map((type, index) => ({
        apiName: type.apiName,
        recordCount: 1,
        totalCharacters: index === 0 ? totalCharacters : 0
      }))
    );
    const element = mount();
    await flush();
    expect(element.shadowRoot.querySelector(".status").textContent).toBe(
      status
    );
  }
);

it("bounds count requests and applies the Top selector without changing totals", async () => {
  const many = Array.from({ length: 45 }, (_, index) => ({
    ...types[0],
    apiName: `Type${index}__mdt`,
    label: `Type ${index}`
  }));
  getCatalog.mockResolvedValue({
    orgLimit: 10000000,
    baseCharacters: 141,
    types: many
  });
  getRecordCounts.mockImplementation(({ apiNames }) =>
    Promise.resolve(
      apiNames.map((apiName) => ({
        apiName,
        recordCount: 1,
        totalCharacters: 396
      }))
    )
  );
  const element = mount();
  await flush();
  expect(
    getRecordCounts.mock.calls.map(([request]) => request.apiNames.length)
  ).toEqual([20, 20, 5]);
  const table = element.shadowRoot.querySelector("lightning-datatable");
  expect(table.data).toHaveLength(10);
  const selector = element.shadowRoot.querySelector(".top-picker");
  selector.dispatchEvent(new CustomEvent("change", { detail: { value: "5" } }));
  await flush();
  expect(table.data).toHaveLength(5);
  expect(
    element.shadowRoot.querySelector(".gauge-panel").textContent
  ).toContain("17,820");
  selector.dispatchEvent(
    new CustomEvent("change", { detail: { value: "all" } })
  );
  await flush();
  expect(table.data).toHaveLength(45);
});

it("exports both CSV views and disables field export until analysis is complete", async () => {
  URL.createObjectURL = jest.fn(() => "blob:csv");
  URL.revokeObjectURL = jest.fn();
  const click = jest
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  const element = mount();
  await flush();
  element.shadowRoot
    .querySelector('lightning-button-icon[icon-name="utility:download"]')
    ?.click();
  // Stub components expose iconName as a property rather than an HTML attribute.
  if (!click.mock.calls.length) {
    [...element.shadowRoot.querySelectorAll("lightning-button-icon")]
      .find((button) => button.iconName === "utility:download")
      .click();
  }
  expect(click).toHaveBeenCalledTimes(1);
  expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:csv");
  analyze(element);
  await flush();
  const button = element.shadowRoot.querySelector("lightning-button");
  expect(button.disabled).toBe(false);
  button.click();
  expect(click).toHaveBeenCalledTimes(2);
  click.mockRestore();
});

it("refreshes uncached counts and reruns the selected field analysis", async () => {
  const element = mount();
  await flush();
  analyze(element);
  await flush();
  [...element.shadowRoot.querySelectorAll("lightning-button-icon")]
    .find((button) => button.iconName === "utility:refresh")
    .click();
  await flush();
  expect(getCatalog).toHaveBeenCalledTimes(2);
  expect(getRecordCounts).toHaveBeenCalledTimes(2);
  expect(getFieldDefinitions).toHaveBeenCalledTimes(2);
  expect(element.shadowRoot.querySelector(".savings")).not.toBeNull();
});

it("opens the guide and closes it with Escape", async () => {
  const element = mount();
  await flush();
  element.shadowRoot.querySelector("[data-help-trigger]").click();
  await flush();
  const dialog = element.shadowRoot.querySelector('[role="dialog"]');
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(dialog.textContent).toContain("348,000");
  dialog.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
  );
  await flush();
  expect(element.shadowRoot.querySelector('[role="dialog"]')).toBeNull();
});

it("marks failed count batches as warnings instead of showing zero usage as healthy", async () => {
  getRecordCounts.mockRejectedValue(new Error("Query failed"));
  const element = mount();
  await flush();
  expect(element.shadowRoot.querySelector(".status").textContent).toBe(
    "Incomplete"
  );
  expect(
    element.shadowRoot
      .querySelector("lightning-datatable")
      .data.every((row) => row.warningIcon === "utility:warning")
  ).toBe(true);
  expect(element.shadowRoot.textContent).toContain("Query failed");
});
