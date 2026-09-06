import { trpc } from "@/lib/trpc";
import type {
  MarketHistoryResponse,
  ResearchKlineInterval,
  SignalPlusDayResponse,
} from "@shared/maxPainResearch";
import { useCallback, useRef, useState } from "react";

interface ResearchState {
  days: SignalPlusDayResponse[];
  market?: MarketHistoryResponse;
  loading: boolean;
  completed: number;
  total: number;
  errors: string[];
}

const memoryDayCache = new Map<string, SignalPlusDayResponse>();

function datesBetween(startDate: string, endDate: string) {
  const result: string[] = [];
  const end = Date.parse(`${endDate}T00:00:00Z`);
  for (
    let cursor = Date.parse(`${startDate}T00:00:00Z`);
    cursor <= end;
    cursor += 86_400_000
  ) {
    result.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return result;
}

/**
 * Runs four day workers for visible progress while the K-line request runs in
 * parallel. Calls go through Cronus tRPC, so auth and /optionhedger/ base paths
 * use the same transport as the rest of the site.
 */
export function useMaxPainResearch() {
  const utils = trpc.useUtils();
  const generation = useRef(0);
  const [state, setState] = useState<ResearchState>({
    days: [],
    loading: false,
    completed: 0,
    total: 0,
    errors: [],
  });

  const calculate = useCallback(
    async (
      startDate: string,
      endDate: string,
      interval: ResearchKlineInterval
    ) => {
      const currentGeneration = ++generation.current;
      const dates = datesBetween(startDate, endDate);
      setState({
        days: [],
        loading: true,
        completed: 0,
        total: dates.length,
        errors: [],
      });

      const dayResults: SignalPlusDayResponse[] = [];
      const errors: string[] = [];
      let nextIndex = 0;
      let completed = 0;
      const marketPromise = utils.client.maxPainResearch.marketHistory.query({
        startDate,
        endDate,
        interval,
      });

      const worker = async () => {
        while (
          nextIndex < dates.length &&
          generation.current === currentGeneration
        ) {
          const date = dates[nextIndex++];
          try {
            const value =
              memoryDayCache.get(date) ??
              (await utils.client.maxPainResearch.intradayDay.query({ date }));
            memoryDayCache.set(date, value);
            dayResults.push(value);
          } catch (error) {
            errors.push(
              `${date}: ${error instanceof Error ? error.message : "读取失败"}`
            );
          } finally {
            completed++;
            if (generation.current === currentGeneration) {
              setState(previous => ({
                ...previous,
                days: [...dayResults].sort((a, b) =>
                  a.date.localeCompare(b.date)
                ),
                completed,
                errors: [...errors],
              }));
            }
          }
        }
      };

      try {
        const [, market] = await Promise.all([
          Promise.all(
            Array.from({ length: Math.min(4, dates.length) }, worker)
          ),
          marketPromise,
        ]);
        if (generation.current !== currentGeneration) return;
        setState({
          days: dayResults.sort((a, b) => a.date.localeCompare(b.date)),
          market,
          loading: false,
          completed,
          total: dates.length,
          errors,
        });
      } catch (error) {
        if (generation.current !== currentGeneration) return;
        setState(previous => ({
          ...previous,
          loading: false,
          errors: [
            ...errors,
            `BTC K线: ${error instanceof Error ? error.message : "读取失败"}`,
          ],
        }));
      }
    },
    [utils.client]
  );

  const cancel = useCallback(() => {
    generation.current++;
    setState(previous => ({ ...previous, loading: false }));
  }, []);

  return { ...state, calculate, cancel };
}
