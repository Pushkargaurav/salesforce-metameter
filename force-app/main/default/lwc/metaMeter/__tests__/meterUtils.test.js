import { enrichField, sortRows, csvContent } from "../meterUtils";

describe("field size recommendations", () => {
  const text = { declaredSize: 255, shrinkable: true };
  it("adds headroom, rounds up and scales savings across records", () => {
    expect(enrichField(text, 41, 500)).toMatchObject({
      longestValue: 41,
      suggestedSize: 60,
      potentialSavings: 97500,
      utilization: 41 / 255
    });
  });
  it("uses a valid minimum for blank fields and omits non-beneficial recommendations", () => {
    expect(enrichField(text, 0, 5).suggestedSize).toBe(10);
    expect(enrichField(text, 220, 5).suggestedSize).toBeNull();
    expect(enrichField(text, 41, 0).suggestedSize).toBeNull();
    expect(enrichField(text, 41, null).suggestedSize).toBeNull();
    expect(
      enrichField({ ...text, shrinkable: false }, 41, 500).potentialSavings
    ).toBe(0);
    expect(enrichField({ declaredSize: 0 }, 10, 5).utilization).toBeNull();
  });
});

it("sorts numeric usage and keeps failed counts last in both directions", () => {
  const rows = [
    { apiName: "small", total: 9 },
    { apiName: "failed", total: null },
    { apiName: "large", total: 100 }
  ];
  expect(sortRows(rows, "total", "desc").map((row) => row.apiName)).toEqual([
    "large",
    "small",
    "failed"
  ]);
  expect(sortRows(rows, "total", "asc").map((row) => row.apiName)).toEqual([
    "small",
    "large",
    "failed"
  ]);
  expect(rows[0].apiName).toBe("small");
});

it("exports quotes, newlines, nulls, Unicode and protects formula-like labels", () => {
  const csv = csvContent(
    ["Label", "Value"],
    [
      ['A,"B"\nC', 10],
      [' =HYPERLINK("bad")', null],
      ["設定", 0]
    ]
  );
  expect(csv).toContain('"A,""B""\nC","10"');
  expect(csv).toContain('"\' =HYPERLINK(""bad"")",""');
  expect(csv).toContain('"設定","0"');
  expect(csv.startsWith("\uFEFF")).toBe(true);
});
