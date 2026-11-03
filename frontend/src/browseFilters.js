export const FACTS_PER_PAGE = 7;

export function getDocumentCategory(tag) {
  const normalized = (tag || '').trim().toLowerCase();
  if (normalized === 'historical document') return 'historical';
  if (normalized === 'policy document') return 'policy';
  return 'other';
}

export function filterFactsByCategory(facts, category) {
  if (category === 'all') return facts;
  return facts.filter((fact) => getDocumentCategory(fact.doc_tag) === category);
}

export function paginate(items, requestedPage, pageSize = FACTS_PER_PAGE) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.max(1, Math.min(requestedPage, pageCount));
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page,
    pageCount,
    start: items.length ? start + 1 : 0,
    end: Math.min(start + pageSize, items.length),
  };
}
