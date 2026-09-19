import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SearchBar } from '../SearchBar';
import * as productsApi from '../../api/products';
import { StoreProductSearchResult } from '../../types';

vi.mock('../../api/products', () => ({
  searchStoreCatalog: vi.fn(),
  createProduct: vi.fn(),
}));

describe('SearchBar Component Suite & Contract Verification', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
  });

  it('renders search results with name, category, brand, sku — and strictly NEVER renders a price field even if accidentally present in data', async () => {
    // Deliberately construct a payload that includes rogue price fields to test UI defense-in-depth
    const rogueSearchResult = {
      storeProductId: '915',
      name: 'Ironwood Trackpad Studio',
      url: 'https://demo.inelabteamdev.com/product/915',
      imageUrl: 'https://demo.inelabteamdev.com/img/915.jpg',
      category: 'Peripherals',
      brand: 'Inelab',
      sku: 'SKU-915',
      // Rogue fields that must never be rendered
      price: 14177,
      price_cents: 1417700,
      priceCents: 1417700,
      rawPrice: '₹14,177.00',
    } as unknown as StoreProductSearchResult;

    vi.spyOn(productsApi, 'searchStoreCatalog').mockResolvedValueOnce([
      rogueSearchResult,
    ]);

    render(
      <QueryClientProvider client={queryClient}>
        <SearchBar trackedProducts={[]} />
      </QueryClientProvider>,
    );

    const input = screen.getByLabelText(/search store catalogue/i);
    fireEvent.change(input, { target: { value: 'ironwood' } });

    // Wait for debounced search to trigger and results to render
    await waitFor(() => {
      expect(screen.getByText('Ironwood Trackpad Studio')).toBeInTheDocument();
    });

    // Verify expected metadata fields
    expect(screen.getByText('Inelab')).toBeInTheDocument();
    expect(screen.getByText('Peripherals')).toBeInTheDocument();
    expect(screen.getByText('SKU: SKU-915')).toBeInTheDocument();
    expect(screen.getByText('Track this product')).toBeInTheDocument();

    // CRITICAL CONTRACT DEFENSE-IN-DEPTH:
    // Strictly verify that no price text exists in the search result DOM
    const resultCard = screen.getByTestId('search-result-915');
    expect(resultCard.textContent).not.toContain('₹14,177');
    expect(resultCard.textContent).not.toContain('14177');
    expect(resultCard.textContent).not.toContain('1417700');
    expect(resultCard.textContent).not.toContain('$');
    expect(resultCard.textContent).not.toContain('₹');

    // Confirms explicit note that price is determined on Tier 2 scrape
    expect(
      screen.getByText(/price determined via tier 2 browser scrape/i),
    ).toBeInTheDocument();
  });
});
