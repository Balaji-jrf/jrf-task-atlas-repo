import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterFactsByCategory, getDocumentCategory, paginate } from './browseFilters.js';

describe('document category filters', () => {
  it('groups known document tags and treats missing or custom tags as other', () => {
    assert.equal(getDocumentCategory('Historical Document'), 'historical');
    assert.equal(getDocumentCategory('Policy Document'), 'policy');
    assert.equal(getDocumentCategory('Grey Literature'), 'other');
    assert.equal(getDocumentCategory(''), 'other');
  });

  it('filters facts by their source document category', () => {
    const facts = [
      { doc_tag: 'Historical Document' },
      { doc_tag: 'Policy Document' },
      { doc_tag: 'Archival Record' },
      {},
    ];
    assert.deepEqual(filterFactsByCategory(facts, 'historical'), [facts[0]]);
    assert.deepEqual(filterFactsByCategory(facts, 'policy'), [facts[1]]);
    assert.deepEqual(filterFactsByCategory(facts, 'other'), [facts[2], facts[3]]);
    assert.equal(filterFactsByCategory(facts, 'all'), facts);
  });
});

describe('facts pagination', () => {
  it('shows seven items on a page and the remainder on the next page', () => {
    const facts = Array.from({ length: 16 }, (_, index) => index);
    const first = paginate(facts, 1);
    const second = paginate(facts, 2);
    const third = paginate(facts, 3);
    assert.deepEqual(first.items, [0, 1, 2, 3, 4, 5, 6]);
    assert.deepEqual(second.items, [7, 8, 9, 10, 11, 12, 13]);
    assert.deepEqual(third.items, [14, 15]);
    assert.equal(first.pageCount, 3);
    assert.equal(third.start, 15);
    assert.equal(third.end, 16);
  });

  it('clamps a page to the available range and handles empty results', () => {
    assert.equal(paginate([1, 2], 9).page, 1);
    assert.deepEqual(paginate([], 1), {
      items: [],
      page: 1,
      pageCount: 1,
      start: 0,
      end: 0,
    });
  });
});
