import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Web Search Tool - Tavily-backed
 *
 * WHY: Research agents need access to current, authoritative sources
 * HOW: Tavily API for web search with source citations and relevance scoring
 * EXAMPLE: Search for "RN job market trends Q4 2024" with citations
 */
export const webSearch = createTool({
  id: 'web.search',
  description: 'Search the web for current information, research, and authoritative sources. Returns results with citations and relevance scores.',
  inputSchema: z.object({
    query: z.string().describe('Search query'),
    maxResults: z.number().optional().default(5).describe('Maximum number of results to return (default: 5)'),
    searchDepth: z.enum(['basic', 'advanced']).optional().default('advanced').describe('Tavily search_depth: basic or advanced'),
  }),

  execute: async ({ context }) => {
    const { query, maxResults = 5, searchDepth = 'advanced' } = context;

    const tavilyKey = process.env.TAVILY_API_KEY;
    if (!tavilyKey) {
      return {
        results: [],
        query,
        note: 'Set TAVILY_API_KEY in .env to enable web search (Tavily REST API).',
      };
    }

    try {
      const resp = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tavilyKey,
          query,
          search_depth: searchDepth,
          max_results: Math.max(1, Math.min(maxResults, 10)),
          include_answer: true,
          include_images: false,
          include_raw_content: true,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Tavily error: ${resp.status} ${errText}`);
      }

      const data: any = await resp.json();
      const results = (data?.results ?? []).map((r: any) => ({
        url: r.url,
        title: r.title,
        snippet: r.content,
        score: r.score ?? null,
      })) ?? [];

      return {
        query,
        answer: data?.answer ?? null,
        results,
        citations: results.map((r: any) => r.url),
        source: 'tavily',
      };
    } catch (error: any) {
      console.error('Web search error:', error);
      throw new Error(`Web search failed: ${error?.message ?? String(error)}`);
    }
  },
});

/**
 * Web Scrape Tool - Static HTML fetch with Cheerio
 *
 * WHY: Extract specific content from known URLs
 * HOW: Static HTML fetch (no JS rendering), optional CSS selector
 * NOTE: For JS-heavy sites, consider adding Browserbase/Playwright later
 */
export const webScrape = createTool({
  id: 'web.scrape',
  description: 'Scrape content from a specific URL (static HTML). Provide selector to narrow extraction.',
  inputSchema: z.object({
    url: z.string().url().describe('URL to scrape'),
    selector: z.string().optional().describe('CSS selector for specific content (optional)'),
  }),

  execute: async ({ context }) => {
    const { url, selector } = context;

    try {
      // Dynamic import for cheerio
      const cheerio = await import('cheerio');

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'AgentBox/1.0 (+https://github.com/Awhitter/whastra) Mozilla/5.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Fetch failed: ${res.status} ${body.slice(0, 200)}`);
      }

      const html = await res.text();
      const $ = cheerio.load(html);

      const pick = (sel: string) => $(sel).text().trim();
      const title = $('meta[property="og:title"]').attr('content') ||
                    $('title').first().text().trim() ||
                    '';

      // If selector provided, use it; otherwise try common content containers
      const chosen = selector && pick(selector)
        ? pick(selector)
        : [
            'article',
            'main',
            '#content',
            '.post',
            '.article',
            '.article-body',
            '.post-content',
            '.content',
          ]
            .map(pick)
            .filter(Boolean)
            .join('\n\n') || $('body').text().trim();

      return {
        url,
        title,
        content: chosen,
        note: (selector
          ? 'Used CSS selector.'
          : 'Static scrape; JS not executed.') +
          ' Add Browserbase/Playwright later if needed.',
      };
    } catch (error: any) {
      console.error('Web scrape error:', error);
      throw new Error(`Web scrape failed: ${error?.message ?? String(error)}`);
    }
  },
});

/**
 * Extract Citations Tool - Parse real metadata from URLs
 *
 * WHY: Research agents need properly formatted citations
 * HOW: Fetch page and parse og:title, author, published date
 */
export const extractCitation = createTool({
  id: 'web.extractCitation',
  description: 'Extract citation information from a URL (title, author, date, source)',
  inputSchema: z.object({
    url: z.string().url().describe('URL to extract citation from'),
  }),

  execute: async ({ context }) => {
    try {
      const u = new URL(context.url);
      const domain = u.hostname.replace(/^www\./, '');

      let title = 'Untitled';
      let author = 'Unknown';
      let dateISO = '';

      try {
        const res = await fetch(context.url, {
          headers: {
            'User-Agent': 'AgentBox/1.0 Mozilla/5.0',
          },
        });

        if (res.ok) {
          const html = await res.text();
          const cheerio = await import('cheerio');
          const $ = cheerio.load(html);

          title = $('meta[property="og:title"]').attr('content') ||
                  $('title').first().text().trim() ||
                  title;

          author = $('meta[name="author"]').attr('content') ||
                   $('meta[property="article:author"]').attr('content') ||
                   author;

          const rawDate = $('meta[property="article:published_time"]').attr('content') ||
                          $('meta[name="date"]').attr('content') ||
                          $('time[datetime]').attr('datetime') ||
                          '';

          if (rawDate) {
            const d = new Date(rawDate);
            if (!Number.isNaN(+d)) dateISO = d.toISOString();
          }
        }
      } catch {
        /* non-fatal - use defaults */
      }

      const accessed = new Date();
      const citationMLA = `${author !== 'Unknown' ? author + '. ' : ''}"${title}." ${domain}. Accessed ${accessed.toLocaleDateString()}. Web.`;

      return {
        url: context.url,
        source: domain,
        title,
        author,
        date: dateISO || accessed.toISOString(),
        accessDate: accessed.toISOString(),
        citationMLA,
      };
    } catch (error: any) {
      console.error('Citation extraction error:', error);
      throw new Error(`Citation extraction failed: ${error?.message ?? String(error)}`);
    }
  },
});
