import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash, TrendDown, TrendUp } from "@phosphor-icons/react";
import { addToWatchlist, getInvestorDashboard, removeFromWatchlist, type WatchlistDashboardItem } from "../api/client";
import DashboardShell from "./DashboardShell";
import {
  DashboardOnward,
  DashboardPage,
  DashboardRegister,
  RegisterRow,
} from "../components/dashboardArchetype";
import { EmptyState, EntryList, ErrorState } from "../components/uiStates";

function WatchlistRegister({ items, total, onRemove, removing, error }: { items: WatchlistDashboardItem[]; total: number; onRemove: (id: string) => void; removing: boolean; error: Error | null }) {
  return (
    <DashboardRegister heading="Your watchlist" folio={`Showing ${items.length} of ${total} tracked`}>
      {items.length === 0 ? (
        <EmptyState><p>No Tickers or sectors are tracked yet. Open a Story or browse a sector to add one.</p></EmptyState>
      ) : (
        <EntryList>
          {items.map((item) => {
            const quote = item.quote;
            const rising = quote ? quote.change >= 0 : true;
            return <RegisterRow key={item.id} name={item.value} to={item.kind === "sector" ? `/stories?category=${item.value}` : undefined} meta={[
              { term: "Type", value: item.kind },
              ...(quote ? [{ term: "Price", value: `$${quote.price.toFixed(2)}` }, { term: "Day", value: <span className={rising ? "market-up" : "market-down"}>{rising ? <TrendUp aria-hidden size={16} /> : <TrendDown aria-hidden size={16} />} {quote.changePercent >= 0 ? "+" : ""}{quote.changePercent.toFixed(2)}%</span> }] : item.coverage ? [{ term: "Stories", value: item.coverage.storyCount }, { term: "Articles", value: item.coverage.articleCount }] : item.kind === "ticker" ? [{ term: "Quote", value: item.quoteStatus === "unavailable" ? "Unavailable" : "No quote" }] : []),
            ]} action={<button type="button" aria-label={`Remove ${item.value} from watchlist`} className="icon-command" onClick={() => onRemove(item.id)} disabled={removing}><Trash aria-hidden size={18} /></button>} />;
          })}
        </EntryList>
      )}
      {error && <ErrorState>Could not update your watchlist: {error.message}</ErrorState>}
    </DashboardRegister>
  );
}

// The Investor surface (#36): the corpus rolled up by sector, as a register of
// categories against their coverage. The bar beside each count is relative to
// the widest-covered sector, so the column reads as a comparison — the numbers
// themselves are stated, and are what the reader takes away.
//
// Its second register is the route into the Investor Lens (#56): the Stories that hold
// citable reporting from two or more Publishers, which are the ones an analysis of how
// the coverage agrees and disagrees can be written about at all. A sector rollup says
// what is covered; this says what can be compared, which is what this role came for.
// Publishers, not newsrooms: the wire-copy collapse happens when an EvidenceSet is
// frozen, so a Story that turns out to be one report under two mastheads is listed here
// and refused on opening, with the reason stated on the record.
export default function InvestorDashboard() {
  const query = useQuery({ queryKey: ["dashboard", "investor"], queryFn: getInvestorDashboard });
  const queryClient = useQueryClient();
  const remove = useMutation({ mutationFn: removeFromWatchlist, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard", "investor"] }) });
  const add = useMutation({ mutationFn: addToWatchlist, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard", "investor"] }) });

  return (
    <DashboardShell query={query}>
      {(data) => {
        // Max, not total: the question a rollup answers is which sector is
        // covered most, not what fraction of everything one sector is. Guarded
        // because an all-zero corpus would otherwise divide by nothing.
        const widest = Math.max(1, ...data.sectors.map((sector) => sector.articleCount));

        return (
          <DashboardPage
            role="investor"
            folio="Investor dashboard"
            title="Sector watch"
            dek="Coverage across the corpus by sector, and the Stories more than one Publisher has reported. Counts are live, not a forecast."
          >
            <WatchlistRegister items={data.watchlist ?? []} total={data.watchlistTotal ?? data.watchlist?.length ?? 0} onRemove={(id) => remove.mutate(id)} removing={remove.isPending} error={(remove.error ?? add.error) as Error | null} />
            <DashboardRegister heading="Sectors" folio={`${data.sectors.length} covered`}>
              {data.sectors.length === 0 ? (
                <EmptyState>
                  <p>
                    No sectors are covered yet — run <code>npm run seed</code> in{" "}
                    <code>backend/</code> to load the corpus.
                  </p>
                </EmptyState>
              ) : (
                <EntryList>
                  {data.sectors.map((sector) => (
                    <RegisterRow
                      key={sector.category}
                      name={sector.category}
                      to={`/stories?category=${sector.category}`}
                      measure={sector.articleCount / widest}
                      meta={[
                        { term: "Stories", value: sector.storyCount },
                        { term: "Articles", value: sector.articleCount },
                      ]}
                      action={<button type="button" className="record-command" onClick={() => add.mutate({ kind: "sector", value: sector.category })} disabled={add.isPending}><Plus aria-hidden size={16} /> Track</button>}
                    />
                  ))}
                </EntryList>
              )}
            </DashboardRegister>

            <DashboardRegister
              heading="Comparable coverage"
              folio={`${data.comparableStories.length} most recent`}
            >
              {data.comparableStories.length === 0 ? (
                <EmptyState>
                  <p>
                    No Story yet carries citable reporting from two Publishers, so there is nothing to
                    compare. Clustering fills this as coverage arrives.
                  </p>
                </EmptyState>
              ) : (
                <EntryList>
                  {data.comparableStories.map((story) => (
                    <RegisterRow
                      key={story.id}
                      name={story.title}
                      to={`/stories/${story.id}`}
                      meta={[
                        { term: "Sector", value: story.category },
                        { term: "Publishers", value: story.publisherCount },
                        {
                          term: "Last seen",
                          value: (
                            <time dateTime={story.lastSeenAt}>
                              {new Date(story.lastSeenAt).toLocaleDateString()}
                            </time>
                          ),
                        },
                      ]}
                    />
                  ))}
                </EntryList>
              )}
            </DashboardRegister>

            <DashboardOnward
              links={[
                { to: "/stories", label: "Browse Stories" },
                { to: "/search", label: "Search the corpus" },
                { to: "/briefs", label: "My Briefs" },
              ]}
            />
          </DashboardPage>
        );
      }}
    </DashboardShell>
  );
}
