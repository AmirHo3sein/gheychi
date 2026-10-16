// apps/admin-panel/src/utils/stacked-table.ts
// Below md a dense data table becomes one card per row instead of a horizontal scroller: on a
// phone the scroller hid the trailing columns (status pills, actions) past the left edge with
// no hint they existed. Pure CSS on the SAME <table> markup -- no second mobile-only copy of
// each row -- so data-testids, `tbody tr` e2e locators and unit-spec counts all stay single.
// Each labeled cell carries `data-label`, rendered as a small caption above its value via
// ::before only in the card layout (the real <thead> takes over at md+).
// Usage: <table :class="STACKED_TABLE">, <thead :class="STACKED_THEAD">, <tbody :class="STACKED_TBODY">,
// <tr :class="STACKED_ROW">, <td :class="STACKED_CELL" data-label="…">.

// min-w-0! overrides ScrollTable's table/first-column floor widths, which only make sense for
// the scrolling table layout.
export const STACKED_TABLE = 'max-md:block max-md:min-w-0!'
export const STACKED_THEAD = 'max-md:hidden'
export const STACKED_TBODY = 'max-md:block'
export const STACKED_ROW = 'max-md:grid max-md:grid-cols-2 max-md:items-start max-md:gap-x-4 max-md:gap-y-3 max-md:px-4 max-md:py-4'
// A cell with no caption (the row's identity, or a self-describing badge).
export const STACKED_CELL_PLAIN = 'max-md:block max-md:min-w-0! max-md:p-0'
export const STACKED_CELL = `${STACKED_CELL_PLAIN} max-md:before:mb-1 max-md:before:block max-md:before:text-xs max-md:before:font-normal max-md:before:text-(--color-text-muted) max-md:before:content-[attr(data-label)]`
