import { TinyEmitter } from 'tiny-emitter';

/**
 * @typedef {import('../types/api').Annotation} Annotation
 * @typedef {import('../types/api').SearchQuery} SearchQuery
 * @typedef {import('../types/api').SearchResult} SearchResult
 */

/**
 * @typedef {'created'|'updated'} SortOrder
 * @typedef {'asc'|'desc'} SortBy
 */

/**
 * Client for the Hypothesis search API [1]
 *
 * SearchClient handles paging through results, canceling search etc.
 *
 * [1] https://h.readthedocs.io/en/latest/api-reference/#tag/annotations/paths/~1search/get
 */
export default class SearchClient extends TinyEmitter {
  /**
   * @param {(query: SearchQuery) => Promise<SearchResult>} searchFn - Function for querying the search API
   * @param {Object} options
   *   @param {number} [options.chunkSize] - page size/number of annotations
   *   per batch
   *   @param {boolean} [options.separateReplies] - When `true`, request that
   *   top-level annotations and replies be returned separately.
   *   NOTE: This has issues with annotations that have large numbers of
   *   replies.
   *   @param {boolean} [options.incremental] - Emit `results` events incrementally
   *   as batches of annotations are available
   *   @param {number|null} [options.maxResults] - Safety valve for protection when
   *   loading all annotations in a group in the NotebookView. If the Notebook
   *   is opened while focused on a group that contains many thousands of
   *   annotations, it could cause rendering and network misery in the browser.
   *   When present, do not load annotations if the result set size exceeds
   *   this value.
   *   @param {SortBy} [options.sortBy] - Together with `sortOrder`, specifies in
   *     what order annotations are fetched from the backend.
   *   @param {SortOrder} [options.sortOrder]
   */
  constructor(
    searchFn,
    {
      chunkSize = 200,
      separateReplies = true,
      incremental = true,
      maxResults = null,
      sortBy = /** @type {SortBy} */ ('created'),
      sortOrder = /** @type {SortOrder} */ ('asc'),
    } = {}
  ) {
    super();
    this._searchFn = searchFn;
    this._chunkSize = chunkSize;
    this._separateReplies = separateReplies;
    this._incremental = incremental;
    this._maxResults = maxResults;
    this._sortBy = sortBy;
    this._sortOrder = sortOrder;

    this._canceled = false;
    /** @type {Annotation[]} */
    this._results = [];
    this._resultCount = null;
  }

  /**
   * Fetch a batch of annotations.
   *
   * @param {SearchQuery} query - Query params for /api/search call
   * @param {string} [searchAfter] - Cursor value to use when paginating
   *   through results. Omitted for the first page. See docs for `search_after`
   *   query param for /api/search API.
   */
  async _getBatch(query, searchAfter) {
    /** @type {SearchQuery} */
    const searchQuery = {
      limit: this._chunkSize,
      sort: this._sortBy,
      order: this._sortOrder,
      _separate_replies: this._separateReplies,

      ...query,
    };

    if (searchAfter) {
      searchQuery.search_after = searchAfter;
    }

    try {
      const results = await this._searchFn(searchQuery);
      if (this._canceled) {
        return;
      }

      // For now, abort loading of annotations if `maxResults` is set and the
      // number of annotations in the results set exceeds that value.
      //
      // NB: We can’t currently, reliably load a subset of a group’s
      // annotations, as replies are mixed in with top-level annotations—when
      // `separateReplies` is false, which it is in most or all cases—so we’d
      // end up with partially-loaded threads.
      //
      // This change has no effect on loading annotations in the SidebarView,
      // where the `maxResults` option is not used.
      //
      // TODO: Implement pagination
      if (this._maxResults && results.total > this._maxResults) {
        this.emit(
          'error',
          new Error('Results size exceeds maximum allowed annotations')
        );
        this.emit('end');
        return;
      }

      const chunk = results.rows.concat(results.replies || []);
      if (this._resultCount === null) {
        // Emit the result count (total) on first encountering it
        this._resultCount = results.total;
        this.emit('resultCount', this._resultCount);
      }
      if (this._incremental) {
        this.emit('results', chunk);
      } else {
        this._results = this._results.concat(chunk);
      }

      // If the current batch was full, there might be additional batches available.
      const nextBatchAvailable = chunk.length === this._chunkSize;

      // Get the cursor for the start of the next batch. This is the last
      // value for whatever field results are sorted by from the current batch.
      const nextSearchAfter =
        chunk.length > 0 ? chunk[chunk.length - 1][this._sortBy] : null;

      if (nextBatchAvailable && nextSearchAfter) {
        this._getBatch(query, nextSearchAfter);
      } else {
        if (!this._incremental) {
          this.emit('results', this._results);
        }
        this.emit('end');
      }
    } catch (err) {
      if (this._canceled) {
        return;
      }
      this.emit('error', err);
      this.emit('end');
    }
  }

  /**
   * Perform a search against the Hypothesis API.
   *
   * Emits a 'results' event with an array of annotations as they become
   * available (in incremental mode) or when all annotations are available
   * (in non-incremental mode).
   *
   * Emits an 'error' event if the search fails.
   * Emits an 'end' event once the search completes.
   *
   * @param {SearchQuery} query
   */
  get(query) {
    this._results = [];
    this._resultCount = null;
    this._getBatch(query);
  }

  /**
   * Cancel the current search and emit the 'end' event.
   * No further events will be emitted after this.
   */
  cancel() {
    this._canceled = true;
    this.emit('end');
  }
}
