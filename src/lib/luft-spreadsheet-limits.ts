/** File and expanded-work budgets are independent of the small, filtered save request. */
export const spreadsheetLimits = {
  fileMb: 200,
  fileBytes: 200 * 1024 * 1024,
  expandedMb: 1024,
  expandedBytes: 1024 * 1024 * 1024,
  rows: 1048576,
  cells: 20000000,
  selectedRows: 50000,
  sharedStrings: 1000000,
  sharedCharacters: 64 * 1024 * 1024,
  timeoutMs: 120000,
} as const;
