const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const YAHOO_OPTIONS_URL = "https://query2.finance.yahoo.com/v7/finance/options";
const YAHOO_SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search";
let yahooAuth = null;

async function getYahooAuth() {
  if (yahooAuth) return yahooAuth;

  const cookieResponse = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": "Mozilla/5.0" },
    redirect: "manual",
  });
  const cookie = cookieResponse.headers.get("set-cookie")?.split(";")[0] ?? "";
  const crumbResponse = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Cookie: cookie,
    },
  });
  if (!crumbResponse.ok) {
    throw new Error(`Yahoo crumb request failed: ${crumbResponse.status}`);
  }
  const crumb = await crumbResponse.text();
  yahooAuth = { cookie, crumb };
  return yahooAuth;
}

export async function fetchHistory(symbol, range = "18mo", interval = "1d") {
  const url = `${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!response.ok) {
    throw new Error(`${symbol} data request failed: ${response.status}`);
  }

  const payload = await response.json();
  const result = payload.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!result?.timestamp || !quote) return [];

  return result.timestamp
    .map((timestamp, index) => ({
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      datetime: new Date(timestamp * 1000).toISOString(),
      open: quote.open?.[index],
      high: quote.high?.[index],
      low: quote.low?.[index],
      close: quote.close?.[index],
      volume: quote.volume?.[index],
    }))
    .filter((row) =>
      [row.open, row.high, row.low, row.close, row.volume].every((value) => Number.isFinite(value))
    );
}

export async function fetchOptionExpirations(symbol) {
  const { cookie, crumb } = await getYahooAuth();
  const url = `${YAHOO_OPTIONS_URL}/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(crumb)}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Cookie: cookie },
  });
  if (!response.ok) {
    throw new Error(`${symbol} options expiration request failed: ${response.status}`);
  }

  const payload = await response.json();
  return payload.optionChain?.result?.[0]?.expirationDates ?? [];
}

export async function fetchOptionChain(symbol, expiration) {
  const { cookie, crumb } = await getYahooAuth();
  const url = `${YAHOO_OPTIONS_URL}/${encodeURIComponent(symbol)}?date=${expiration}&crumb=${encodeURIComponent(crumb)}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Cookie: cookie },
  });
  if (!response.ok) {
    throw new Error(`${symbol} options chain request failed: ${response.status}`);
  }

  const payload = await response.json();
  const result = payload.optionChain?.result?.[0];
  const optionSet = result?.options?.[0];
  if (!result || !optionSet) return null;

  return {
    symbol,
    underlyingPrice: result.quote?.regularMarketPrice,
    expiration,
    calls: optionSet.calls ?? [],
    puts: optionSet.puts ?? [],
  };
}

export async function fetchQuoteSummary(symbol, modules = []) {
  const { cookie, crumb } = await getYahooAuth();
  const moduleList = modules.length
    ? modules.join(",")
    : "price,summaryDetail,financialData,defaultKeyStatistics,recommendationTrend,earningsTrend,assetProfile";
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${encodeURIComponent(moduleList)}&crumb=${encodeURIComponent(crumb)}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Cookie: cookie },
  });
  if (!response.ok) {
    throw new Error(`${symbol} quote summary request failed: ${response.status}`);
  }
  const payload = await response.json();
  const result = payload.quoteSummary?.result?.[0];
  if (!result) {
    const description = payload.quoteSummary?.error?.description ?? "No quote summary found";
    throw new Error(`${symbol} quote summary unavailable: ${description}`);
  }
  return result;
}

export async function fetchYahooNews(symbol, count = 8) {
  const url = `${YAHOO_SEARCH_URL}?q=${encodeURIComponent(symbol)}&quotesCount=0&newsCount=${count}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!response.ok) {
    throw new Error(`${symbol} news request failed: ${response.status}`);
  }
  const payload = await response.json();
  return (payload.news ?? [])
    .filter((item) => {
      const related = (item.relatedTickers ?? []).map((ticker) => String(ticker).toUpperCase());
      return !related.length || related.includes(symbol.toUpperCase());
    })
    .map((item) => ({
      title: item.title,
      publisher: item.publisher,
      link: item.link,
      publishedAt: item.providerPublishTime
        ? new Date(item.providerPublishTime * 1000).toISOString()
        : null,
      relatedTickers: item.relatedTickers ?? [],
    }));
}
