/**
 * Hub-crawl constants split into a dependency-free module.
 *
 * The main `hub-crawl.ts` pulls in `mongodb` (server-only), which makes
 * it unusable from any client-bundled / jsdom-test code path. Helpers
 * like `validateMaxTreePages` in `_lib/normalize.ts` only need the
 * numeric constants below — putting them here lets the validator import
 * the bound without forcing its callers to load Mongo.
 */

/**
 * Hard ceiling on `max_tree_pages` for a GitLab hub regardless of
 * admin input. Each tree page returns up to 100 entries, so 500 pages
 * tops out at 50,000 entries — generous for any sane skill hub but
 * bounded so a misconfigured admin entry cannot make the Node process
 * walk an unbounded number of pages.
 */
export const MAX_TREE_PAGES_HARD_LIMIT = 500;
