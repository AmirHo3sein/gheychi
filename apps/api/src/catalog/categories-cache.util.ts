// Shared between CatalogController (reads/populates) and AdminCategoriesController
// (invalidates on every mutation) -- kept in one place so the two can never reference
// mismatched key strings.
export const CATEGORIES_CACHE_KEY = 'categories:list';
export const CATEGORIES_CACHE_TTL_SEC = 300;
