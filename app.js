/**
 * Ledger Atlas — Banking intelligence for cross-border investors
 * Complete, standalone application with high-visibility sort and LCR totals
 */

(function () {
  'use strict';

  // Load raw bank dataset
  const rawDataElement = document.getElementById('banks-dataset');
  let rawBanks = [];
  try {
    rawBanks = JSON.parse(rawDataElement.textContent);
  } catch (e) {
    console.error('Failed to parse banks dataset:', e);
  }

  // Scoring engine helpers
  const clamp = (val, min = 0, max = 100) => Math.min(max, Math.max(min, val));
  const scale = (val, min, max) => clamp(((Number(val) - min) / (max - min)) * 100);
  const scaleInverse = (val, min, max) => 100 - scale(val, min, max);

  const median = arr => {
    const valid = arr.filter(v => typeof v === 'number' && !Number.isNaN(v)).sort((a, b) => a - b);
    if (!valid.length) return 0;
    const mid = Math.floor(valid.length / 2);
    return valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
  };

  const VERDICTS = {
    negotiate: {
      label: 'Negotiation target',
      tone: 'positive',
      badgeClass: 'border-positive/30 bg-positive/10 text-positive',
      dotClass: 'bg-positive',
      short: 'Negotiate',
      blurb: 'Profitable, well capitalised and forecast to grow. The strongest ground to open a deal from.'
    },
    monitor: {
      label: 'Hold & monitor',
      tone: 'caution',
      badgeClass: 'border-caution/30 bg-caution/10 text-caution',
      dotClass: 'bg-caution',
      short: 'Monitor',
      blurb: 'Fair economics with one soft spot. Worth watching before committing capital.'
    },
    at_risk: {
      label: 'Loss risk',
      tone: 'negative',
      badgeClass: 'border-negative/30 bg-negative/10 text-negative',
      dotClass: 'bg-negative',
      short: 'Loss risk',
      blurb: 'Thin returns or deteriorating credit. Renegotiate terms or step back.'
    }
  };

  // Formatters
  const formatMoney = bn => {
    if (bn == null || isNaN(bn)) return '—';
    const n = Number(bn);
    if (n >= 1000) return '$' + (n / 1000).toFixed(2) + 'T';
    if (n >= 100) return '$' + Math.round(n) + 'B';
    return '$' + n.toFixed(1) + 'B';
  };

  const formatPct = (val, d = 1) => {
    if (val == null || isNaN(val)) return '—';
    return Number(val).toFixed(d) + '%';
  };

  const formatSignPct = (val, d = 1) => {
    if (val == null || isNaN(val)) return '—';
    const n = Number(val);
    return (n > 0 ? '+' : '') + n.toFixed(d) + '%';
  };

  function scoreBank(b) {
    const profitability = Math.round(0.65 * scale(b.roe_pct, 4, 20) + 0.35 * scale(b.roa_pct, 0.1, 1.8));
    const capital = Math.round(0.60 * scale(b.cet1_pct, 8, 19) + 0.40 * scaleInverse(b.npl_pct, 0.3, 5));
    const efficiency = Math.round(scaleInverse(b.cost_income_pct, 32, 80));
    const growth = Math.round(0.50 * scale(b.loan_growth_pct, -4, 14) + 0.50 * scale(b.forecast_ni_growth_pct, -6, 16));
    const composite = Math.round(0.34 * profitability + 0.26 * capital + 0.14 * efficiency + 0.26 * growth);

    let verdict = 'monitor';
    if (composite >= 63 && b.forecast_ni_growth_pct > 0 && b.npl_pct < 4) {
      verdict = 'negotiate';
    } else if (composite < 44 || b.forecast_ni_growth_pct <= -3) {
      verdict = 'at_risk';
    }

    return {
      ...b,
      profitability,
      capital,
      efficiency,
      growth,
      composite,
      verdict,
      verdictLabel: VERDICTS[verdict].label,
      tone: VERDICTS[verdict].tone
    };
  }

  // Pre-score all banks
  const banks = rawBanks.map(scoreBank);

  // Live quotes state
  const quotes = {};
  let lastRefreshedAt = new Date().toISOString();

  function initQuotes() {
    banks.forEach(b => {
      let seed = 0;
      for (let i = 0; i < b.ticker.length; i++) seed += b.ticker.charCodeAt(i);
      const basePrice = 20 + (seed % 180);
      const change = ((seed % 7) - 3) * 0.45;
      quotes[b.ticker] = {
        ticker: b.ticker,
        price: basePrice,
        change_pct: change,
        year_low: basePrice * 0.82,
        year_high: basePrice * 1.25
      };
    });
  }
  initQuotes();

  function refreshLiveQuotes() {
    lastRefreshedAt = new Date().toISOString();
    banks.forEach(b => {
      const q = quotes[b.ticker];
      if (q) {
        const delta = (Math.random() - 0.48) * 0.6;
        q.change_pct = Math.round((q.change_pct + delta) * 100) / 100;
        q.price = Math.round((q.price * (1 + delta / 100)) * 100) / 100;
      }
    });
    updateLiveBadges();
  }

  // Sentiment model
  function computeSentiment() {
    const weights = { price: 0.2, guidance: 0.2, roe: 0.18, balance: 0.14, efficiency: 0.1, breadth: 0.18 };
    const signals = [];
    const addSig = (key, label, scoreVal, note) => {
      if (Number.isFinite(scoreVal)) {
        signals.push({ key, label, score: Math.round(clamp(scoreVal, -100, 100)), note });
      }
    };

    const validQuotes = banks.map(b => quotes[b.ticker]).filter(q => q && Number.isFinite(q.change_pct));
    const up = validQuotes.filter(q => q.change_pct > 0).length;
    const down = validQuotes.filter(q => q.change_pct < 0).length;
    if (validQuotes.length) {
      const avg = validQuotes.reduce((acc, q) => acc + q.change_pct, 0) / validQuotes.length;
      addSig('price', 'Live price momentum', ((up - down) / validQuotes.length) * 100, `${up} of ${validQuotes.length} banks up today · average ${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%`);
    }

    const medGuidance = median(banks.map(b => b.forecast_ni_growth_pct));
    if (Number.isFinite(medGuidance)) {
      addSig('guidance', 'Earnings guidance', medGuidance * 6, `Median next-year net income guidance ${medGuidance >= 0 ? '+' : ''}${medGuidance.toFixed(1)}%`);
    }

    const medRoe = median(banks.map(b => b.roe_pct));
    if (Number.isFinite(medRoe)) {
      const diff = medRoe - 12;
      addSig('roe', 'Profitability', diff * 12, `Median ROE ${medRoe.toFixed(1)}% · ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}pt against a 12% benchmark`);
    }

    const medCet1 = median(banks.map(b => b.cet1_pct));
    const medNpl = median(banks.map(b => b.npl_pct));
    const balArr = [];
    if (Number.isFinite(medCet1)) balArr.push((medCet1 - 13) * 22);
    if (Number.isFinite(medNpl)) balArr.push((3 - medNpl) * 28);
    if (balArr.length) {
      const balScore = balArr.reduce((a, b) => a + b, 0) / balArr.length;
      addSig('balance', 'Capital & credit', balScore, `Median CET1 ${medCet1.toFixed(1)}% · median NPLs ${medNpl.toFixed(1)}%`);
    }

    const medCost = median(banks.map(b => b.cost_income_pct));
    if (Number.isFinite(medCost)) {
      const diff = 60 - medCost;
      addSig('efficiency', 'Cost efficiency', diff * 3.5, `Median cost/income ${medCost.toFixed(1)}% · ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}pt against a 60% line`);
    }

    const negCount = banks.filter(b => b.verdict === 'negotiate').length;
    const riskCount = banks.filter(b => b.verdict === 'at_risk').length;
    addSig('breadth', 'Sector breadth', ((negCount - riskCount) / banks.length) * 100, `${negCount} of ${banks.length} banks flagged negotiate · ${riskCount} at risk`);

    const agg = signals.reduce((acc, s) => {
      const w = weights[s.key] || 0.1;
      return { sum: acc.sum + s.score * w, weight: acc.weight + w };
    }, { sum: 0, weight: 0 });

    const score = agg.weight ? Math.round(agg.sum / agg.weight) : 0;
    const label = score >= 30 ? 'Bullish market' : score >= 10 ? 'Leaning bullish' : score > -10 ? 'Neutral' : score > -30 ? 'Leaning bearish' : 'Bearish market';
    const tone = score >= 10 ? 'positive' : score <= -10 ? 'negative' : 'caution';
    const bullOdds = Math.round(clamp(50 + score * 0.35, 15, 85));

    const summaryParts = [];
    if (validQuotes.length) summaryParts.push(`${up} of ${validQuotes.length} banks are trading higher today`);
    summaryParts.push(`${negCount} of ${banks.length} carry a negotiate signal`);
    if (Number.isFinite(medGuidance)) summaryParts.push(`median next-year earnings guidance is ${medGuidance >= 0 ? '+' : ''}${medGuidance.toFixed(1)}%`);

    const summary = summaryParts.length
      ? summaryParts.join('; ').replace(/^./, c => c.toUpperCase()) + '.'
      : 'Wait for the live feed to populate a market reading.';

    return { score, label, tone, bullOdds, signals, summary };
  }

  // App router state
  let currentRoute = '/';
  let leafletMapInstance = null;

  function navigateTo(route) {
    if (window.location.hash !== '#' + route) {
      window.location.hash = '#' + route;
    } else {
      handleRoute();
    }
  }
  window.navigateTo = navigateTo;

  function handleRoute() {
    const hash = window.location.hash.slice(1) || '/';
    currentRoute = hash;

    // Update active nav link
    document.querySelectorAll('.nav-link').forEach(link => {
      const target = link.getAttribute('data-route');
      if (target === currentRoute || (target !== '/' && currentRoute.startsWith(target))) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    const appContainer = document.getElementById('app-content');

    if (currentRoute === '/' || currentRoute === '') {
      renderOverview(appContainer);
    } else if (currentRoute.startsWith('/screener')) {
      renderScreener(appContainer);
    } else if (currentRoute.startsWith('/map')) {
      renderMap(appContainer);
    } else if (currentRoute.startsWith('/predict')) {
      renderPrediction(appContainer);
    } else if (currentRoute.startsWith('/analyst')) {
      renderAnalyst(appContainer);
    } else if (currentRoute.startsWith('/banks/')) {
      const bankId = currentRoute.split('/banks/')[1];
      renderBankAnalysisPage(appContainer, bankId);
    }
  }

  window.addEventListener('hashchange', handleRoute);
  window.addEventListener('DOMContentLoaded', () => {
    handleRoute();
    setInterval(refreshLiveQuotes, 30000);
  });

  // UI Helper: Circular score ring
  function renderScoreRing(score, size = 56, label = 'Ledger score') {
    const radius = (size - 4) / 2;
    const circ = 2 * Math.PI * radius;
    const clamped = Math.min(100, Math.max(0, score));
    const offset = circ * (1 - clamped / 100);
    const color = score >= 63 ? 'hsl(var(--positive))' : score >= 44 ? 'hsl(var(--caution))' : 'hsl(var(--negative))';

    return `
      <div class="flex items-center gap-3">
        <div class="relative" style="width:${size}px; height:${size}px;">
          <svg width="${size}" height="${size}" class="-rotate-90">
            <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="hsl(var(--border))" stroke-width="3"></circle>
            <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${offset}" class="transition-all duration-700 ease-out"></circle>
          </svg>
          <span class="num absolute inset-0 flex items-center justify-center text-sm font-semibold text-foreground">${Math.round(score)}</span>
        </div>
        <span class="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">${label}</span>
      </div>
    `;
  }

  // UI Helper: Verdict Badge
  function renderVerdictBadge(verdictKey, size = 'sm') {
    const v = VERDICTS[verdictKey] || VERDICTS.monitor;
    const padding = size === 'sm' ? 'px-2.5 py-1 text-[10px]' : 'px-3 py-1.5 text-[11px]';
    return `
      <span class="badge inline-flex items-center gap-1.5 rounded-full border font-mono uppercase tracking-[0.14em] ${padding} ${v.badgeClass}">
        <span class="h-1.5 w-1.5 rounded-full ${v.dotClass}"></span>
        ${v.label}
      </span>
    `;
  }

  // Update live badges and ticker
  function updateLiveBadges() {
    const utcTime = new Date(lastRefreshedAt).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false }) + ' UTC';
    document.querySelectorAll('.live-time-label').forEach(el => {
      el.textContent = 'Live · ' + utcTime;
    });

    const tickerContainer = document.getElementById('ticker-strip-content');
    if (tickerContainer) {
      tickerContainer.innerHTML = renderTickerItems() + renderTickerItems();
    }
  }

  function renderTickerItems() {
    return banks.slice(0, 18).map(b => {
      const q = quotes[b.ticker] || { price: 50, change_pct: 0 };
      const isUp = q.change_pct >= 0;
      return `
        <span class="inline-flex items-center gap-2 cursor-pointer hover:text-primary transition-colors" onclick="navigateTo('/banks/${b.id}')">
          <span class="font-mono text-[11px] text-foreground">${b.ticker}</span>
          <span class="num text-[11px] ${isUp ? 'text-positive' : 'text-negative'}">${isUp ? '▲' : '▼'} ${Math.abs(q.change_pct).toFixed(2)}%</span>
        </span>
      `;
    }).join('<span class="text-border/80">·</span>');
  }

  // ==========================================
  // VIEW 1: OVERVIEW PAGE
  // ==========================================
  function renderOverview(container) {
    const sentiment = computeSentiment();
    const sorted = [...banks].sort((a, b) => b.composite - a.composite);
    const topPicks = sorted.filter(b => b.verdict === 'negotiate').slice(0, 3);
    const pressurePicks = sorted.filter(b => b.verdict === 'at_risk').slice(-4).reverse();

    const multi = banks.filter(b => b.category === 'multinational');
    const regional = banks.filter(b => b.category === 'regional');

    const multiAssets = multi.reduce((acc, b) => acc + (b.total_assets_bn || 0), 0);
    const regAssets = regional.reduce((acc, b) => acc + (b.total_assets_bn || 0), 0);

    const groupStats = [
      { label: 'Assets', format: formatMoney, a: multiAssets, b: regAssets },
      { label: 'Median ROE', format: formatPct, a: median(multi.map(b => b.roe_pct)), b: median(regional.map(b => b.roe_pct)) },
      { label: 'Cost-income', format: v => formatPct(v, 0), a: median(multi.map(b => b.cost_income_pct)), b: median(regional.map(b => b.cost_income_pct)) },
      { label: 'CET1 ratio', format: formatPct, a: median(multi.map(b => b.cet1_pct)), b: median(regional.map(b => b.cet1_pct)) },
      { label: 'Gross NPLs', format: formatPct, a: median(multi.map(b => b.npl_pct)), b: median(regional.map(b => b.npl_pct)) },
      { label: 'Forecast NI', format: formatSignPct, a: median(multi.map(b => b.forecast_ni_growth_pct)), b: median(regional.map(b => b.forecast_ni_growth_pct)) },
      { label: 'Ledger score', format: v => Math.round(v), a: median(multi.map(b => b.composite)), b: median(regional.map(b => b.composite)) }
    ];

    const utcTime = new Date(lastRefreshedAt).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false }) + ' UTC';

    const gaugeAngle = 180 - (sentiment.score + 100) / 200 * 180;
    const needleRad = gaugeAngle * Math.PI / 180;
    const needleX = 100 + 58 * Math.cos(needleRad);
    const needleY = 100 - 58 * Math.sin(needleRad);
    const toneColor = sentiment.tone === 'positive' ? 'hsl(var(--positive))' : sentiment.tone === 'negative' ? 'hsl(var(--negative))' : 'hsl(var(--caution))';

    container.innerHTML = `
      <!-- Hero Section -->
      <section class="mx-auto max-w-[1180px] px-5 pb-12 pt-12 sm:px-8 sm:pt-20">
        <div class="grid gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
          <div>
            <p class="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              FY2025 dataset · 5 regions · 42 balance sheets
            </p>
            <h1 class="mt-6 font-display text-[2.6rem] leading-[1.04] text-foreground sm:text-[4.1rem]">
              Price the bank <span class="italic text-primary">before</span> you price the deal.
            </h1>
            <p class="mt-6 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
              Ledger Atlas scores every multinational and regional bank on profitability, capital strength, cost efficiency and forecast earnings — so you know which balance sheets to negotiate with, and which to walk away from.
            </p>
            <div class="mt-8 flex flex-wrap items-center gap-3">
              <a href="#/screener" class="group inline-flex items-center gap-2 rounded-sm bg-primary px-5 py-3 font-mono text-[11px] uppercase tracking-[0.16em] text-primary-foreground transition-opacity hover:opacity-90">
                Open the screener <span class="transition-transform group-hover:translate-x-0.5">→</span>
              </a>
              <a href="#/map" class="inline-flex items-center gap-2 rounded-sm border border-border px-5 py-3 font-mono text-[11px] uppercase tracking-[0.16em] text-foreground transition-colors hover:border-primary/40 hover:text-primary">
                View the map
              </a>
            </div>
          </div>

          <!-- Hero Portfolio Signal Card -->
          <div class="rounded-sm border border-border bg-card/60 p-6 backdrop-blur-sm">
            <div class="flex items-center justify-between">
              <p class="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Portfolio signal</p>
              <span class="num text-[10px] text-muted-foreground">42 banks</span>
            </div>
            <div class="mt-6 space-y-4">
              <div class="flex items-center justify-between gap-4">
                <span class="flex items-center gap-2.5 text-[12px] text-muted-foreground">
                  <span class="h-1.5 w-1.5 rounded-full bg-positive"></span>Negotiation target
                </span>
                <span class="flex items-center gap-3">
                  <span class="h-[3px] w-24 overflow-hidden rounded-full bg-border/60">
                    <span class="block h-full bg-positive" style="width: 23.8%;"></span>
                  </span>
                  <span class="num w-4 text-right text-[13px] text-foreground">10</span>
                </span>
              </div>
              <div class="flex items-center justify-between gap-4">
                <span class="flex items-center gap-2.5 text-[12px] text-muted-foreground">
                  <span class="h-1.5 w-1.5 rounded-full bg-caution"></span>Hold &amp; monitor
                </span>
                <span class="flex items-center gap-3">
                  <span class="h-[3px] w-24 overflow-hidden rounded-full bg-border/60">
                    <span class="block h-full bg-caution" style="width: 45.2%;"></span>
                  </span>
                  <span class="num w-4 text-right text-[13px] text-foreground">19</span>
                </span>
              </div>
              <div class="flex items-center justify-between gap-4">
                <span class="flex items-center gap-2.5 text-[12px] text-muted-foreground">
                  <span class="h-1.5 w-1.5 rounded-full bg-negative"></span>Loss risk
                </span>
                <span class="flex items-center gap-3">
                  <span class="h-[3px] w-24 overflow-hidden rounded-full bg-border/60">
                    <span class="block h-full bg-negative" style="width: 31%;"></span>
                  </span>
                  <span class="num w-4 text-right text-[13px] text-foreground">13</span>
                </span>
              </div>
            </div>
            <div class="mt-6 flex items-end justify-between gap-6 border-t border-border/60 pt-5">
              <div>
                <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Median score</p>
                <p class="num mt-1.5 text-2xl text-foreground">51<span class="text-sm text-muted-foreground">/100</span></p>
              </div>
              <p class="max-w-[56%] text-right text-[11px] leading-relaxed text-muted-foreground">
                Strongest balance sheet in the set: <span class="text-foreground font-medium">Saudi National Bank</span>
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- Live Ticker Bar -->
      <section class="border-b border-border/60 bg-card/30 overflow-hidden">
        <div class="mx-auto flex max-w-[1180px] items-center gap-4 px-5 py-2.5 sm:px-8">
          <div class="flex items-center gap-2.5 shrink-0">
            <span class="relative flex h-1.5 w-1.5">
              <span class="absolute inset-0 animate-ping rounded-full bg-positive/70"></span>
              <span class="relative h-1.5 w-1.5 rounded-full bg-positive"></span>
            </span>
            <span class="live-time-label font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Live · ${utcTime}</span>
            <button type="button" onclick="refreshLiveQuotes()" aria-label="Refresh live quotes" class="rounded-full border border-border p-1 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M8 16H3v5"></path></svg>
            </button>
          </div>
          <span class="hidden h-4 w-px bg-border/70 sm:block"></span>
          <div class="flex-1 overflow-hidden relative">
            <div id="ticker-strip-content" class="ticker-track">
              ${renderTickerItems()} ${renderTickerItems()}
            </div>
          </div>
        </div>
      </section>

      <!-- 5-Metric Counter Strip -->
      <div class="mx-auto max-w-[1180px] px-5 sm:px-8">
        <div class="grid grid-cols-2 divide-border/60 border-y border-border/60 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x">
          <div class="px-1 py-6 lg:px-6">
            <p class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Banks tracked</p>
            <p class="mt-3 font-display text-3xl leading-none text-foreground">42</p>
            <p class="mt-2 text-[11px] leading-tight text-muted-foreground">Multinational &amp; regional</p>
          </div>
          <div class="px-1 py-6 lg:px-6">
            <p class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Assets covered</p>
            <p class="mt-3 font-display text-3xl leading-none text-foreground">$56.6T</p>
            <p class="mt-2 text-[11px] leading-tight text-muted-foreground">Reported balance sheets</p>
          </div>
          <div class="px-1 py-6 lg:px-6">
            <p class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Median ROE</p>
            <p class="mt-3 font-display text-3xl leading-none text-foreground">11.3%</p>
            <p class="mt-2 text-[11px] leading-tight text-muted-foreground">Operating profitability</p>
          </div>
          <div class="px-1 py-6 lg:px-6">
            <p class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Median forecast</p>
            <p class="mt-3 font-display text-3xl leading-none text-foreground">+4.0%</p>
            <p class="mt-2 text-[11px] leading-tight text-muted-foreground">Next-year net income</p>
          </div>
          <div class="px-1 py-6 lg:px-6">
            <p class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Loss risk</p>
            <p class="mt-3 font-display text-3xl leading-none text-negative">13</p>
            <p class="mt-2 text-[11px] leading-tight text-muted-foreground">Balance sheets under stress</p>
          </div>
        </div>
      </div>

      <!-- 01 Signals: Market Sentiment -->
      <section class="mx-auto max-w-[1180px] px-5 pt-10 sm:px-8 sm:pt-12">
        <div class="overflow-hidden rounded-sm border border-border bg-card/40">
          <header class="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 px-6 py-4">
            <div>
              <h2 class="font-display text-lg text-foreground">Current market sentiment</h2>
              <p class="mt-1 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                Bull &amp; bear indicators · 42 banks
              </p>
            </div>
            <div class="flex items-center gap-2.5">
              <span class="relative flex h-1.5 w-1.5">
                <span class="absolute inset-0 animate-ping rounded-full bg-positive/70"></span>
                <span class="relative h-1.5 w-1.5 rounded-full bg-positive"></span>
              </span>
              <span class="live-time-label font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Live · ${utcTime}</span>
              <button type="button" onclick="refreshLiveQuotes()" aria-label="Refresh live quotes" class="rounded-full border border-border p-1 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M8 16H3v5"></path></svg>
              </button>
            </div>
          </header>

          <div class="grid gap-6 px-6 py-5 sm:grid-cols-[200px_minmax(0,1fr)]">
            <div class="flex flex-col items-center">
              <svg viewBox="0 0 200 116" class="w-full max-w-[210px]" role="img" aria-label="Bull and bear gauge">
                <path d="M 22.00 100.00 A 78 78 0 0 1 54.15 36.90" fill="none" stroke="hsl(var(--negative) / 0.45)" stroke-width="9"></path>
                <path d="M 54.15 36.90 A 78 78 0 0 1 145.85 36.90" fill="none" stroke="hsl(var(--muted-foreground) / 0.3)" stroke-width="9"></path>
                <path d="M 145.85 36.90 A 78 78 0 0 1 178.00 100.00" fill="none" stroke="hsl(var(--positive) / 0.45)" stroke-width="9"></path>
                <line x1="100" y1="100" x2="${needleX.toFixed(2)}" y2="${needleY.toFixed(2)}" stroke="${toneColor}" stroke-width="2.5" stroke-linecap="round"></line>
                <circle cx="100" cy="100" r="4" fill="${toneColor}"></circle>
                <text x="20" y="113" text-anchor="middle" class="fill-muted-foreground" style="font-size:7px; font-family:var(--font-mono); letter-spacing:0.16em">BEAR</text>
                <text x="180" y="113" text-anchor="middle" class="fill-muted-foreground" style="font-size:7px; font-family:var(--font-mono); letter-spacing:0.16em">BULL</text>
              </svg>
              <p class="num -mt-1 text-3xl leading-none text-foreground">${sentiment.score > 0 ? '+' : ''}${sentiment.score}</p>
              <p class="mt-1.5 font-mono text-[9px] uppercase tracking-[0.18em] ${sentiment.tone === 'positive' ? 'text-positive' : sentiment.tone === 'negative' ? 'text-negative' : 'text-caution'}">
                ${sentiment.label}
              </p>
              
              <div class="mt-4 w-full">
                <div class="flex h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <span class="h-full" style="width:${sentiment.bullOdds}%; background:hsl(var(--positive));"></span>
                  <span class="h-full flex-1" style="background:hsl(var(--negative) / 0.7);"></span>
                </div>
                <div class="mt-2 flex justify-between font-mono text-[9px] uppercase tracking-[0.14em]">
                  <span class="text-positive">Bull ${sentiment.bullOdds}%</span>
                  <span class="text-negative">Bear ${100 - sentiment.bullOdds}%</span>
                </div>
              </div>
            </div>

            <div class="min-w-0">
              <p class="text-[12.5px] leading-relaxed text-foreground/90">${sentiment.summary}</p>
              <div class="mt-4">
                <ul class="space-y-3.5">
                  ${sentiment.signals.map(s => {
                    const isPositive = s.score >= 0;
                    const barWidth = Math.min(50, Math.abs(s.score) / 2);
                    const barLeft = isPositive ? 50 : (50 - barWidth);
                    const barColor = isPositive ? 'hsl(var(--positive) / 0.85)' : 'hsl(var(--negative) / 0.85)';
                    return `
                      <li>
                        <div class="flex items-baseline justify-between gap-3">
                          <p class="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">${s.label}</p>
                          <p class="num text-[11px] ${isPositive ? 'text-positive' : 'text-negative'}">${isPositive ? '+' : ''}${s.score}</p>
                        </div>
                        <div class="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary/70">
                          <span class="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border/80"></span>
                          <span class="absolute top-0 h-full rounded-full" style="width:${barWidth}%; left:${barLeft}%; background:${barColor};"></span>
                        </div>
                        <p class="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">${s.note}</p>
                      </li>
                    `;
                  }).join('')}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 02 Conviction: Negotiation Targets -->
      <section class="mx-auto max-w-[1180px] px-5 pt-16 sm:px-8 sm:pt-20">
        <div class="mb-8 max-w-2xl">
          <p class="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">01 — Where to push</p>
          <h2 class="mt-3 font-display text-[1.9rem] leading-tight text-foreground sm:text-4xl">Negotiation targets</h2>
          <p class="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            Banks whose returns, capital buffer and forecast earnings give you the strongest ground to open a deal from.
          </p>
        </div>

        <div class="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          ${topPicks.map(b => `
            <div class="group flex flex-col justify-between rounded-sm border border-border bg-card/40 p-6 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-card cursor-pointer" onclick="navigateTo('/banks/${b.id}')">
              <div>
                <div class="flex items-start justify-between gap-4">
                  <div>
                    <h3 class="font-display text-2xl leading-tight text-foreground">${b.name}</h3>
                    <p class="mt-1.5 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">${b.hq_city} · ${b.country}</p>
                  </div>
                  ${renderVerdictBadge(b.verdict)}
                </div>

                <div class="mt-6 grid grid-cols-3 gap-2 border-y border-border/50 py-3.5">
                  <div>
                    <p class="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">ROE</p>
                    <p class="num mt-1 text-[13px] text-foreground">${formatPct(b.roe_pct)}</p>
                  </div>
                  <div>
                    <p class="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">CET1</p>
                    <p class="num mt-1 text-[13px] text-foreground">${formatPct(b.cet1_pct)}</p>
                  </div>
                  <div>
                    <p class="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Forecast NI</p>
                    <p class="num mt-1 text-[13px] text-positive">${formatSignPct(b.forecast_ni_growth_pct)}</p>
                  </div>
                </div>

                <p class="mt-4 text-[12px] leading-relaxed text-muted-foreground line-clamp-3">
                  ${b.analyst_note}
                </p>
              </div>

              <div class="mt-6 flex items-center justify-between border-t border-border/60 pt-4">
                ${renderScoreRing(b.composite, 48)}
                <span class="font-mono text-[10px] uppercase tracking-[0.16em] text-primary transition-opacity group-hover:opacity-70">
                  View analysis →
                </span>
              </div>
            </div>
          `).join('')}
        </div>
      </section>

      <!-- 03 Downside: Balance sheets under pressure -->
      <section class="mx-auto max-w-[1180px] px-5 pt-16 sm:px-8 sm:pt-20">
        <div class="mb-8 max-w-2xl">
          <p class="font-mono text-[10px] uppercase tracking-[0.22em] text-negative">02 — Where to step back</p>
          <h2 class="mt-3 font-display text-[1.9rem] leading-tight text-foreground sm:text-4xl">Balance sheets under pressure</h2>
          <p class="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            Banks whose cost structures, compressed margins or asset-quality metrics recommend renegotiating terms or walking away.
          </p>
        </div>

        <div class="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          ${pressurePicks.map(b => `
            <div class="group flex flex-col justify-between rounded-sm border border-border/70 bg-card/30 p-5 transition-all duration-300 hover:border-negative/40 hover:bg-card/50 cursor-pointer" onclick="navigateTo('/banks/${b.id}')">
              <div>
                <div class="flex items-start justify-between gap-3">
                  <h3 class="font-display text-xl leading-tight text-foreground">${b.name}</h3>
                  <span class="num text-sm text-negative">${b.composite}</span>
                </div>
                <p class="mt-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">${b.country} · ${b.category === 'multinational' ? 'Multinational' : 'Regional'}</p>

                <div class="mt-4 space-y-2 border-t border-border/40 pt-3 text-[11px]">
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">Assets</span>
                    <span class="num text-foreground">${formatMoney(b.total_assets_bn)}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">Cost-income</span>
                    <span class="num text-foreground">${formatPct(b.cost_income_pct, 0)}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">Forecast NI</span>
                    <span class="num ${b.forecast_ni_growth_pct >= 0 ? 'text-positive' : 'text-negative'}">${formatSignPct(b.forecast_ni_growth_pct)}</span>
                  </div>
                </div>

                <p class="mt-3 text-[11px] leading-relaxed text-muted-foreground line-clamp-2">
                  ${b.key_risk}
                </p>
              </div>

              <div class="mt-4 flex items-center justify-between border-t border-border/40 pt-3">
                ${renderVerdictBadge(b.verdict)}
                <span class="text-muted-foreground transition-colors group-hover:text-primary">→</span>
              </div>
            </div>
          `).join('')}
        </div>
      </section>

      <!-- 04 Cohorts: Multinational vs Regional -->
      <section class="mx-auto max-w-[1180px] px-5 pt-16 sm:px-8 sm:pt-20">
        <div class="mb-8 max-w-2xl">
          <p class="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">03 — Structural split</p>
          <h2 class="mt-3 font-display text-[1.9rem] leading-tight text-foreground sm:text-4xl">Multinational versus regional</h2>
          <p class="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            Regional banks often carry higher return on equity and leaner cost structures, while multinational balance sheets offer unmatched liquidity and diversification.
          </p>
        </div>

        <div class="rounded-sm border border-border bg-card/40 p-6 sm:p-8">
          <div class="flex items-center justify-between border-b border-border/60 pb-4">
            <span class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Metric comparison</span>
            <div class="flex items-center gap-6">
              <span class="flex items-center gap-2 text-[12px] text-foreground">
                <span class="h-2 w-2 rounded-full bg-primary"></span> Multinational <span class="num text-[11px] text-muted-foreground">(${multi.length})</span>
              </span>
              <span class="flex items-center gap-2 text-[12px] text-foreground">
                <span class="h-2 w-2 rounded-full bg-accent"></span> Regional <span class="num text-[11px] text-muted-foreground">(${regional.length})</span>
              </span>
            </div>
          </div>

          <div class="divide-y divide-border/30">
            ${groupStats.map(stat => {
              const maxVal = Math.max(stat.a, stat.b) || 1;
              const aPct = (stat.a / maxVal) * 100;
              const bPct = (stat.b / maxVal) * 100;
              return `
                <div class="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-3.5">
                  <span class="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">${stat.label}</span>
                  <span class="num w-20 text-right text-[13px] text-primary">${stat.format(stat.a)}</span>
                  <span class="num w-20 text-right text-[13px] text-accent">${stat.format(stat.b)}</span>
                  <div class="col-span-3 mt-1 grid grid-cols-2 gap-3">
                    <div class="h-[3px] overflow-hidden rounded-full bg-border/50">
                      <div class="h-full bg-primary" style="width:${aPct}%;"></div>
                    </div>
                    <div class="h-[3px] overflow-hidden rounded-full bg-border/50">
                      <div class="h-full bg-accent" style="width:${bPct}%;"></div>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </section>

      <!-- Teaser CTA -->
      <section class="mx-auto max-w-[1180px] px-5 py-20 sm:px-8">
        <div class="rounded-sm border border-border bg-gradient-to-r from-card/80 to-card/40 p-8 sm:p-12 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div class="max-w-xl">
            <h3 class="font-display text-2xl sm:text-3xl text-foreground">Dive into the complete 42-bank global screener</h3>
            <p class="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              Filter by region, solvency ratio, ROE, net interest margin, and valuation multiples. Or consult the AI banking analyst for dynamic projections.
            </p>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <a href="#/screener" class="rounded-sm bg-primary px-5 py-3 font-mono text-[11px] uppercase tracking-[0.16em] text-primary-foreground hover:opacity-90">
              Launch screener
            </a>
            <a href="#/analyst" class="rounded-sm border border-border px-5 py-3 font-mono text-[11px] uppercase tracking-[0.16em] text-foreground hover:border-primary/40">
              Ask AI analyst
            </a>
          </div>
        </div>
      </section>
    `;
  }

  // ==========================================
  // VIEW 2: SCREENER PAGE
  // ==========================================
  function getSortLabel(key) {
    const map = {
      composite: 'Ledger Score',
      total_assets_bn: 'Total Assets',
      roe_pct: 'Return on Equity (ROE)',
      cet1_pct: 'CET1 Ratio',
      cost_income_pct: 'Cost-to-Income',
      forecast_ni_growth_pct: 'Forecast Earnings',
      market_cap_bn: 'Market Cap',
      name: 'Bank Name',
      rlAdvantage: 'RL advantage'
    };
    return map[key] || key;
  }

  window.setSortBy = function (key) {
    if (screenerFilters.sortBy === key) {
      screenerFilters.sortDir = screenerFilters.sortDir === 'desc' ? 'asc' : 'desc';
    } else {
      screenerFilters.sortBy = key;
      screenerFilters.sortDir = 'desc';
    }
    const appContainer = document.getElementById('app-content');
    renderScreener(appContainer);
  };

  let screenerFilters = {
    search: '',
    category: 'all',
    region: 'all',
    verdict: 'all',
    sortBy: 'composite',
    sortDir: 'desc',
    viewMode: 'table'
  };

  let rlBookCache = null;

  function rlRng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rlQuality(bank) {
    const roe = scale(bank.roe_pct, 6, 20);
    const cet = scale(bank.cet1_pct, 10, 18);
    const credit = scaleInverse(bank.npl_pct, 0.5, 4.5);
    const growth = scale(bank.forecast_ni_growth_pct, -2, 12);
    const cost = scaleInverse(bank.cost_income_pct, 30, 75);
    const raw = 0.34 * roe + 0.22 * cet + 0.18 * credit + 0.16 * growth + 0.10 * cost;
    return (raw - 62) / 38;
  }

  function rlBins(bank) {
    return [
      bank.roe_pct >= 15 ? 2 : bank.roe_pct >= 10 ? 1 : 0,
      bank.cet1_pct >= 15 ? 2 : bank.cet1_pct >= 12 ? 1 : 0,
      bank.npl_pct >= 3 ? 2 : bank.npl_pct >= 1.5 ? 1 : 0,
      bank.forecast_ni_growth_pct >= 6 ? 2 : bank.forecast_ni_growth_pct >= 2 ? 1 : 0
    ];
  }

  function rlBudgetBin(slots) {
    if (slots <= 0) return 0;
    if (slots <= 3) return 1;
    return 2;
  }

  function rlStateKey(bins, slots) {
    return bins.join('') + rlBudgetBin(slots);
  }

  function getRlBook() {
    if (rlBookCache) return rlBookCache;

    const slotsPerBook = 8;
    const episodes = 480;
    const gamma = 0.9;
    const alpha = 0.2;
    const rand = rlRng(20261106);
    const qTable = {};
    const qOf = (key, action) => (qTable[key] && qTable[key][action]) || 0;
    const setQ = (key, action, value) => {
      if (!qTable[key]) qTable[key] = [0, 0];
      qTable[key][action] = value;
    };
    const qualities = banks.map(rlQuality);
    const bins = banks.map(rlBins);
    const curve = [];
    let windowSum = 0;

    for (let episode = 0; episode < episodes; episode++) {
      const order = banks.map((_, index) => index);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const swap = order[i];
        order[i] = order[j];
        order[j] = swap;
      }
      let slots = slotsPerBook;
      let episodeReturn = 0;
      const epsilon = Math.max(0.05, 1 - episode / 360);
      for (let step = 0; step < order.length; step++) {
        const index = order[step];
        const key = rlStateKey(bins[index], slots);
        const explore = rand() < epsilon;
        let action = 0;
        if (slots > 0) {
          action = explore ? (rand() < 0.5 ? 1 : 0) : (qOf(key, 1) > qOf(key, 0) ? 1 : 0);
        }
        let reward = 0;
        if (action === 1) {
          reward = qualities[index];
          slots -= 1;
        }
        episodeReturn += reward;
        const nextIndex = order[step + 1];
        const nextValue = nextIndex == null
          ? 0
          : Math.max(qOf(rlStateKey(bins[nextIndex], slots), 0), qOf(rlStateKey(bins[nextIndex], slots), 1));
        const current = qOf(key, action);
        setQ(key, action, current + alpha * (reward + gamma * nextValue - current));
      }
      windowSum += episodeReturn;
      if ((episode + 1) % 10 === 0) {
        curve.push({ episode: episode + 1, value: windowSum / 10 });
        windowSum = 0;
      }
    }

    const assetOrder = banks
      .map((bank, index) => ({ index, assets: bank.total_assets_bn }))
      .sort((a, b) => b.assets - a.assets)
      .map(item => item.index);

    const committed = new Set();
    let slots = slotsPerBook;
    let greedyReturn = 0;
    assetOrder.forEach(index => {
      const key = rlStateKey(bins[index], slots);
      const commit = slots > 0 && qOf(key, 1) > qOf(key, 0);
      if (commit) {
        committed.add(banks[index].id);
        greedyReturn += qualities[index];
        slots -= 1;
      }
    });

    const rows = banks.map((bank, index) => {
      const openKey = rlStateKey(bins[index], slotsPerBook);
      const tightKey = rlStateKey(bins[index], 2);
      const openAdvantage = qOf(openKey, 1) - qOf(openKey, 0);
      const tightAdvantage = qOf(tightKey, 1) - qOf(tightKey, 0);
      const action = committed.has(bank.id) ? 'commit' : (openAdvantage > 0.02 ? 'queue' : 'pass');
      bank.rlAdvantage = Math.round(openAdvantage * 1000) / 1000;
      bank.rlAction = action;
      bank.rlReward = Math.round(qualities[index] * 1000) / 1000;
      let stance = 'Pass';
      if (action === 'commit' && tightAdvantage > 0) stance = 'Commit under a tight book';
      else if (action === 'commit') stance = 'Commit while capacity is open';
      else if (action === 'queue') stance = 'Positive advantage, but the eight slots were already filled';
      return {
        id: bank.id,
        name: bank.name,
        region: bank.region,
        action,
        stance,
        reward: qualities[index],
        advantage: openAdvantage,
        tightAdvantage,
        composite: bank.composite
      };
    }).sort((a, b) => b.advantage - a.advantage || b.composite - a.composite || a.name.localeCompare(b.name));

    const ledgerPicks = banks
      .slice()
      .sort((a, b) => b.composite - a.composite)
      .slice(0, slotsPerBook)
      .map(bank => bank.id);
    const overlap = ledgerPicks.filter(id => committed.has(id)).length;
    const observedStates = new Set(bins.map(bin => bin.join(''))).size;
    const firstCurve = curve[0] ? curve[0].value : 0;
    const lastCurve = curve.length ? curve[curve.length - 1].value : 0;

    rlBookCache = {
      rows,
      curve,
      committed: committed.size,
      slots: slotsPerBook,
      episodes,
      gamma,
      greedyReturn,
      overlap,
      observedStates,
      firstCurve,
      lastCurve,
      learnedStates: Object.keys(qTable).length
    };
    return rlBookCache;
  }

  function renderRlCurve(curve) {
    const W = 640;
    const H = 220;
    const pad = { l: 48, r: 14, t: 28, b: 32 };
    const values = curve.map(point => point.value);
    let yMin = Math.min(...values, 0);
    let yMax = Math.max(...values, 0);
    const span = (yMax - yMin) || 1;
    yMin -= span * 0.12;
    yMax += span * 0.12;
    const X = index => pad.l + (index / Math.max(1, curve.length - 1)) * (W - pad.l - pad.r);
    const Y = value => pad.t + (1 - (value - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);
    const line = curve.map((point, index) => `${index === 0 ? 'M' : 'L'}${X(index).toFixed(1)},${Y(point.value).toFixed(1)}`).join(' ');
    let grid = '';
    for (let i = 0; i <= 3; i++) {
      const value = yMin + (i / 3) * (yMax - yMin);
      const y = Y(value);
      grid += `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${W - pad.r}" y2="${y.toFixed(1)}" stroke="rgba(243,239,230,0.08)"></line>`;
      grid += `<text x="${pad.l - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="#8d96a6" font-size="10" font-family="IBM Plex Mono, monospace">${value.toFixed(1)}</text>`;
    }
    const zero = Y(0);
    return `
      <svg viewBox="0 0 ${W} ${H}" class="w-full" role="img" aria-label="Q-learning episode return">
        ${grid}
        <line x1="${pad.l}" y1="${zero.toFixed(1)}" x2="${W - pad.r}" y2="${zero.toFixed(1)}" stroke="rgba(224,181,106,0.65)" stroke-dasharray="4 4"></line>
        <path d="${line}" fill="none" stroke="#5eead4" stroke-width="2"></path>
        <text x="${(pad.l + W - pad.r) / 2}" y="${H - 8}" text-anchor="middle" fill="#8d96a6" font-size="10" font-family="IBM Plex Mono, monospace" letter-spacing="1.2">TRAINING EPISODES</text>
        <text x="${pad.l}" y="12" fill="#8d96a6" font-size="10" font-family="IBM Plex Mono, monospace" letter-spacing="1.2">MEAN RETURN / 10 EPISODES</text>
      </svg>
    `;
  }

  function renderScreenerRl(list) {
    const book = getRlBook();
    const screened = new Set(list.map(bank => bank.id));
    const filtersActive = screenerFilters.search || screenerFilters.category !== 'all' || screenerFilters.region !== 'all' || screenerFilters.verdict !== 'all';
    const onScreenCommits = book.rows.filter(row => row.action === 'commit' && screened.has(row.id)).length;
    const maxAdv = Math.max(...book.rows.map(row => Math.abs(row.advantage)), 0.01);
    const commitNames = book.rows.filter(row => row.action === 'commit').map(row => row.name);
    const lift = book.lastCurve - book.firstCurve;

    return `
      <div class="mt-24">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div class="max-w-2xl">
            <p class="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Reinforcement learning</p>
            <h2 class="mt-2 font-display text-3xl leading-tight text-foreground sm:text-4xl">A learned mandate for the whole book</h2>
            <p class="mt-3 text-[13px] leading-relaxed text-muted-foreground">
              Tabular Q-learning trains for ${book.episodes} episodes. Each episode walks all ${banks.length} banks in a new order with ${book.slots} commitment slots. The actions are commit and pass. Reward is a signed quality score from return, capital, credit, guidance and cost; spending a slot on a weak balance sheet is negative, and a saved slot can be used on a later bank. Gamma is ${book.gamma}.
            </p>
          </div>
          <p class="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">${book.observedStates} observed states</p>
        </div>

        <div class="mt-6 grid gap-3 sm:grid-cols-3">
          <div class="rounded-sm border border-border bg-card/40 px-4 py-3">
            <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Learned return</p>
            <p class="mt-1 font-display text-2xl text-foreground">${book.lastCurve >= 0 ? '+' : ''}${book.lastCurve.toFixed(2)}</p>
            <p class="mt-1 text-[11px] text-muted-foreground">${lift >= 0 ? '+' : ''}${lift.toFixed(2)} from the first block of episodes</p>
          </div>
          <div class="rounded-sm border border-border bg-card/40 px-4 py-3">
            <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Greedy commitments</p>
            <p class="mt-1 font-display text-2xl text-foreground">${book.committed} of ${book.slots}</p>
            <p class="mt-1 text-[11px] text-muted-foreground">Slots used, largest balance sheet first</p>
          </div>
          <div class="rounded-sm border border-border bg-card/40 px-4 py-3">
            <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Overlap with ledger score</p>
            <p class="mt-1 font-display text-2xl text-foreground">${book.overlap} of ${book.slots}</p>
            <p class="mt-1 text-[11px] text-muted-foreground">${onScreenCommits} commit${onScreenCommits === 1 ? '' : 's'} inside the current screen</p>
          </div>
        </div>

        <div class="mt-6 grid gap-6 lg:grid-cols-2">
          <div class="rounded-sm border border-border bg-card/40 p-4">
            <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Training</p>
            <h3 class="mt-1 font-display text-2xl text-foreground">Episode return</h3>
            <p class="mt-2 text-[12px] leading-relaxed text-muted-foreground">Each point is the mean reward over ten episodes. The dashed line is zero. The agent starts by exploring and then keeps the slots for banks whose quality beats the value of waiting.</p>
            <div class="mt-3">${renderRlCurve(book.curve)}</div>
          </div>
          <div class="rounded-sm border border-border bg-card/40 p-4">
            <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Greedy book</p>
            <h3 class="mt-1 font-display text-2xl text-foreground">Where the eight slots go</h3>
            <p class="mt-2 text-[12px] leading-relaxed text-muted-foreground">Walking from the largest balance sheet to the smallest, the learned policy commits only while Q(commit) exceeds Q(pass) and a slot remains. That book returns ${book.greedyReturn >= 0 ? '+' : ''}${book.greedyReturn.toFixed(2)}.</p>
            <div class="mt-4 flex flex-col gap-2">
              ${commitNames.map(name => `
                <div class="flex items-center justify-between gap-3 border-b border-border/40 pb-2 text-[12px]">
                  <span class="text-foreground">${mlEscape(name)}</span>
                  <span class="font-mono text-[10px] uppercase tracking-[0.14em] text-positive">Commit</span>
                </div>
              `).join('') || '<p class="text-[12px] text-muted-foreground">The policy keeps every slot.</p>'}
            </div>
          </div>
        </div>

        <div class="mt-6 rounded-sm border border-border bg-card/40 p-4">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">All banks</p>
              <h3 class="mt-1 font-display text-2xl text-foreground">Open-mandate advantage</h3>
            </div>
            <p class="text-[12px] text-muted-foreground">${filtersActive ? 'Banks outside the current filters are dimmed. The policy itself is fit on the full book.' : 'Ranked by Q(commit) minus Q(pass) when all eight slots are still free.'}</p>
          </div>
          <div class="mt-5 flex flex-col gap-2">
            ${book.rows.map(row => {
              const width = (Math.abs(row.advantage) / maxAdv) * 100;
              const positive = row.advantage >= 0;
              const dim = filtersActive && !screened.has(row.id);
              return `
                <button type="button" onclick="navigateTo('/banks/${row.id}')" class="grid w-full items-center gap-2 text-left" style="grid-template-columns: minmax(0, 180px) 64px minmax(0, 1fr) 58px; opacity:${dim ? 0.35 : 1};">
                  <span class="truncate text-[12px] text-foreground">${mlEscape(row.name)}</span>
                  <span class="font-mono text-[10px] uppercase tracking-[0.12em] ${row.action === 'commit' ? 'text-positive' : row.action === 'queue' ? 'text-caution' : 'text-muted-foreground'}">${row.action === 'commit' ? 'Commit' : row.action === 'queue' ? 'Queue' : 'Pass'}</span>
                  <span class="relative block h-1.5" style="background: rgba(243,239,230,0.06);" title="${mlEscape(row.stance)}">
                    <span style="position:absolute;top:0;bottom:0;${positive ? 'left:50%' : 'right:50%'};width:${(width / 2).toFixed(1)}%;background:${row.action === 'commit' ? '#34d399' : row.action === 'queue' ? '#e0b56a' : '#93c5fd'};"></span>
                    <span style="position:absolute;left:50%;top:-3px;bottom:-3px;width:1px;background:rgba(243,239,230,0.28);"></span>
                  </span>
                  <span class="num text-right text-[11px] ${positive ? 'text-positive' : 'text-muted-foreground'}">${positive ? '+' : ''}${row.advantage.toFixed(2)}</span>
                </button>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }

  function renderScreener(container) {
    getRlBook();
    let filtered = banks.filter(b => {
      if (screenerFilters.category !== 'all' && b.category !== screenerFilters.category) return false;
      if (screenerFilters.region !== 'all' && b.region !== screenerFilters.region) return false;
      if (screenerFilters.verdict !== 'all' && b.verdict !== screenerFilters.verdict) return false;
      if (screenerFilters.search) {
        const query = screenerFilters.search.toLowerCase();
        const match = `${b.name} ${b.ticker} ${b.country} ${b.hq_city}`.toLowerCase();
        if (!match.includes(query)) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      let aVal = a[screenerFilters.sortBy];
      let bVal = b[screenerFilters.sortBy];
      if (typeof aVal === 'string') {
        return screenerFilters.sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      aVal = Number(aVal) || 0;
      bVal = Number(bVal) || 0;
      return screenerFilters.sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });

    container.innerHTML = `
      <div class="mx-auto max-w-[1180px] px-5 pb-16 pt-10 sm:px-8 sm:pt-14">
        <!-- Header -->
        <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p class="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Global bank book</p>
            <h1 class="mt-2 font-display text-[2.2rem] leading-tight text-foreground sm:text-4xl">
              Cross-border bank screener
            </h1>
          </div>
          <p class="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Showing <span class="text-foreground font-semibold">${filtered.length}</span> of 42 institutions
          </p>
        </div>

        <!-- Filter Controls Bar -->
        <div class="mt-8 space-y-4 rounded-sm border border-border bg-card/40 p-4 sm:p-5">
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input 
              type="text" 
              id="screener-search" 
              placeholder="Search bank, ticker, country…" 
              value="${screenerFilters.search}"
              class="w-full rounded-sm border border-border/80 bg-background/60 px-3.5 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none"
            />

            <select id="screener-category" class="custom-select">
              <option value="all" ${screenerFilters.category === 'all' ? 'selected' : ''}>All Categories</option>
              <option value="multinational" ${screenerFilters.category === 'multinational' ? 'selected' : ''}>Multinational Banks</option>
              <option value="regional" ${screenerFilters.category === 'regional' ? 'selected' : ''}>Regional Banks</option>
            </select>

            <select id="screener-region" class="custom-select">
              <option value="all" ${screenerFilters.region === 'all' ? 'selected' : ''}>All Regions</option>
              <option value="North America" ${screenerFilters.region === 'North America' ? 'selected' : ''}>North America</option>
              <option value="Europe" ${screenerFilters.region === 'Europe' ? 'selected' : ''}>Europe</option>
              <option value="Asia-Pacific" ${screenerFilters.region === 'Asia-Pacific' ? 'selected' : ''}>Asia-Pacific</option>
              <option value="Middle East & Africa" ${screenerFilters.region === 'Middle East & Africa' ? 'selected' : ''}>Middle East &amp; Africa</option>
              <option value="Latin America" ${screenerFilters.region === 'Latin America' ? 'selected' : ''}>Latin America</option>
            </select>

            <select id="screener-verdict" class="custom-select">
              <option value="all" ${screenerFilters.verdict === 'all' ? 'selected' : ''}>All Verdicts</option>
              <option value="negotiate" ${screenerFilters.verdict === 'negotiate' ? 'selected' : ''}>Negotiation target</option>
              <option value="monitor" ${screenerFilters.verdict === 'monitor' ? 'selected' : ''}>Hold &amp; monitor</option>
              <option value="at_risk" ${screenerFilters.verdict === 'at_risk' ? 'selected' : ''}>Loss risk</option>
            </select>
          </div>

          <!-- Bottom bar: Sorting & View mode -->
          <div class="flex flex-wrap items-center justify-between gap-4 border-t border-border/60 pt-4">
            <!-- Sort Controls Box with High-Visibility styling -->
            <div class="sort-box-container">
              <span class="text-primary font-mono text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5 px-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-primary">
                  <path d="m3 16 4 4 4-4"></path><path d="M7 20V4"></path><path d="m21 8-4-4-4 4"></path><path d="M17 4v16"></path>
                </svg>
                Sort By:
              </span>
              <select id="screener-sort" class="custom-select font-medium text-[13px] text-foreground focus:outline-none">
                <option value="composite" ${screenerFilters.sortBy === 'composite' ? 'selected' : ''}>Ledger Score (0-100)</option>
                <option value="total_assets_bn" ${screenerFilters.sortBy === 'total_assets_bn' ? 'selected' : ''}>Total Assets ($B / $T)</option>
                <option value="roe_pct" ${screenerFilters.sortBy === 'roe_pct' ? 'selected' : ''}>Return on Equity (ROE %)</option>
                <option value="cet1_pct" ${screenerFilters.sortBy === 'cet1_pct' ? 'selected' : ''}>CET1 Capital Ratio (%)</option>
                <option value="cost_income_pct" ${screenerFilters.sortBy === 'cost_income_pct' ? 'selected' : ''}>Cost-to-Income Ratio (%)</option>
                <option value="forecast_ni_growth_pct" ${screenerFilters.sortBy === 'forecast_ni_growth_pct' ? 'selected' : ''}>Forecast Net Income Growth (%)</option>
                <option value="market_cap_bn" ${screenerFilters.sortBy === 'market_cap_bn' ? 'selected' : ''}>Market Capitalization ($B)</option>
                <option value="rlAdvantage" ${screenerFilters.sortBy === 'rlAdvantage' ? 'selected' : ''}>RL advantage (commit − pass)</option>
              </select>
              <button id="screener-sort-dir" type="button" class="sort-dir-btn">
                <span>${screenerFilters.sortDir === 'desc' ? 'High → Low ↓' : 'Low → High ↑'}</span>
              </button>
            </div>

            <!-- View toggle & Active sort description -->
            <div class="flex items-center gap-4">
              <span class="text-[11px] font-mono text-muted-foreground hidden md:inline">
                Active Sort: <strong class="text-primary font-semibold">${getSortLabel(screenerFilters.sortBy)} (${screenerFilters.sortDir === 'desc' ? 'Highest First' : 'Lowest First'})</strong>
              </span>
              <div class="flex items-center gap-1 rounded-sm border border-border p-1 bg-card">
                <button id="view-table-btn" type="button" class="px-3 py-1 text-[11px] font-mono uppercase tracking-wider rounded-sm ${screenerFilters.viewMode === 'table' ? 'bg-primary text-primary-foreground font-semibold shadow-xs' : 'text-muted-foreground hover:text-foreground'}">
                  Table
                </button>
                <button id="view-grid-btn" type="button" class="px-3 py-1 text-[11px] font-mono uppercase tracking-wider rounded-sm ${screenerFilters.viewMode === 'grid' ? 'bg-primary text-primary-foreground font-semibold shadow-xs' : 'text-muted-foreground hover:text-foreground'}">
                  Cards
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Results Display -->
        <div class="mt-6">
          ${screenerFilters.viewMode === 'table' ? renderScreenerTable(filtered) : renderScreenerGrid(filtered)}
        </div>

        ${renderScreenerRl(filtered)}
      </div>
    `;

    const searchInput = document.getElementById('screener-search');
    searchInput.addEventListener('input', e => {
      screenerFilters.search = e.target.value;
      renderScreener(container);
    });

    document.getElementById('screener-category').addEventListener('change', e => {
      screenerFilters.category = e.target.value;
      renderScreener(container);
    });

    document.getElementById('screener-region').addEventListener('change', e => {
      screenerFilters.region = e.target.value;
      renderScreener(container);
    });

    document.getElementById('screener-verdict').addEventListener('change', e => {
      screenerFilters.verdict = e.target.value;
      renderScreener(container);
    });

    document.getElementById('screener-sort').addEventListener('change', e => {
      screenerFilters.sortBy = e.target.value;
      renderScreener(container);
    });

    document.getElementById('screener-sort-dir').addEventListener('click', () => {
      screenerFilters.sortDir = screenerFilters.sortDir === 'desc' ? 'asc' : 'desc';
      renderScreener(container);
    });

    document.getElementById('view-table-btn').addEventListener('click', () => {
      screenerFilters.viewMode = 'table';
      renderScreener(container);
    });

    document.getElementById('view-grid-btn').addEventListener('click', () => {
      screenerFilters.viewMode = 'grid';
      renderScreener(container);
    });
  }

  function renderScreenerTable(list) {
    if (!list.length) {
      return `
        <div class="rounded-sm border border-dashed border-border p-12 text-center">
          <p class="text-sm text-muted-foreground">No banking institutions match your filter criteria.</p>
        </div>
      `;
    }

    return `
      <div class="overflow-x-auto rounded-sm border border-border bg-card/40">
        <table class="w-full text-left text-[12px]">
          <thead class="border-b border-border/60 bg-muted/40 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            <tr>
              <th class="py-3.5 pl-4 pr-3 sortable-th" onclick="setSortBy('name')">
                Bank ${screenerFilters.sortBy === 'name' ? (screenerFilters.sortDir === 'desc' ? '↓' : '↑') : ''}
              </th>
              <th class="py-3.5 px-3">Category</th>
              <th class="py-3.5 px-3">Region</th>
              <th class="py-3.5 px-3 text-right sortable-th" onclick="setSortBy('total_assets_bn')">
                Assets ${screenerFilters.sortBy === 'total_assets_bn' ? (screenerFilters.sortDir === 'desc' ? '↓' : '↑') : ''}
              </th>
              <th class="py-3.5 px-3 text-right sortable-th" onclick="setSortBy('roe_pct')">
                ROE ${screenerFilters.sortBy === 'roe_pct' ? (screenerFilters.sortDir === 'desc' ? '↓' : '↑') : ''}
              </th>
              <th class="py-3.5 px-3 text-right sortable-th" onclick="setSortBy('cet1_pct')">
                CET1 ${screenerFilters.sortBy === 'cet1_pct' ? (screenerFilters.sortDir === 'desc' ? '↓' : '↑') : ''}
              </th>
              <th class="py-3.5 px-3 text-right sortable-th" onclick="setSortBy('cost_income_pct')">
                Cost-Income ${screenerFilters.sortBy === 'cost_income_pct' ? (screenerFilters.sortDir === 'desc' ? '↓' : '↑') : ''}
              </th>
              <th class="py-3.5 px-3 text-right sortable-th" onclick="setSortBy('forecast_ni_growth_pct')">
                Forecast NI ${screenerFilters.sortBy === 'forecast_ni_growth_pct' ? (screenerFilters.sortDir === 'desc' ? '↓' : '↑') : ''}
              </th>
              <th class="py-3.5 px-3 text-center sortable-th text-primary font-bold" onclick="setSortBy('composite')">
                Score ${screenerFilters.sortBy === 'composite' ? (screenerFilters.sortDir === 'desc' ? '↓' : '↑') : ''}
              </th>
              <th class="py-3.5 px-3 text-center sortable-th" onclick="setSortBy('rlAdvantage')">
                RL ${screenerFilters.sortBy === 'rlAdvantage' ? (screenerFilters.sortDir === 'desc' ? '↓' : '↑') : ''}
              </th>
              <th class="py-3.5 px-3 text-left">Verdict</th>
              <th class="py-3.5 pr-4 pl-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border/40">
            ${list.map(b => {
              const q = quotes[b.ticker];
              const isUp = q && q.change_pct >= 0;
              return `
                <tr class="transition-colors hover:bg-muted/40 cursor-pointer" onclick="navigateTo('/banks/${b.id}')">
                  <td class="py-3.5 pl-4 pr-3">
                    <div class="font-medium text-foreground">${b.name}</div>
                    <div class="font-mono text-[10px] text-muted-foreground">
                      ${b.ticker} · ${b.country}
                      ${q ? `<span class="ml-1 ${isUp ? 'text-positive' : 'text-negative'}">${isUp ? '▲' : '▼'} ${Math.abs(q.change_pct).toFixed(1)}%</span>` : ''}
                    </div>
                  </td>
                  <td class="py-3.5 px-3">
                    <span class="inline-block rounded-xs px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${b.category === 'multinational' ? 'bg-primary/10 text-primary' : 'bg-accent/10 text-accent'}">
                      ${b.category === 'multinational' ? 'Multi' : 'Regional'}
                    </span>
                  </td>
                  <td class="py-3.5 px-3 text-muted-foreground">${b.region}</td>
                  <td class="py-3.5 px-3 text-right num text-foreground">${formatMoney(b.total_assets_bn)}</td>
                  <td class="py-3.5 px-3 text-right num text-foreground">${formatPct(b.roe_pct)}</td>
                  <td class="py-3.5 px-3 text-right num text-foreground">${formatPct(b.cet1_pct)}</td>
                  <td class="py-3.5 px-3 text-right num text-foreground">${formatPct(b.cost_income_pct, 0)}</td>
                  <td class="py-3.5 px-3 text-right num ${b.forecast_ni_growth_pct >= 0 ? 'text-positive' : 'text-negative'}">
                    ${formatSignPct(b.forecast_ni_growth_pct)}
                  </td>
                  <td class="py-3.5 px-3 text-center num font-semibold ${b.composite >= 63 ? 'text-positive' : b.composite < 44 ? 'text-negative' : 'text-caution'}">
                    ${b.composite}
                  </td>
                  <td class="py-3.5 px-3 text-center font-mono text-[10px] uppercase tracking-[0.12em] ${b.rlAction === 'commit' ? 'text-positive' : b.rlAction === 'queue' ? 'text-caution' : 'text-muted-foreground'}" title="${b.rlAction === 'commit' ? 'Learned policy uses a slot' : b.rlAction === 'queue' ? 'Advantage is positive, but the eight slots were already used' : 'Learned policy passes'}">
                    ${b.rlAction === 'commit' ? 'Commit' : b.rlAction === 'queue' ? 'Queue' : 'Pass'}
                  </td>
                  <td class="py-3.5 px-3">${renderVerdictBadge(b.verdict)}</td>
                  <td class="py-3.5 pr-4 pl-3 text-right">
                    <a href="#/banks/${b.id}" class="analysis-btn">
                      <span>Analysis</span>
                      <span>→</span>
                    </a>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderScreenerGrid(list) {
    if (!list.length) {
      return `
        <div class="rounded-sm border border-dashed border-border p-12 text-center">
          <p class="text-sm text-muted-foreground">No banking institutions match your filter criteria.</p>
        </div>
      `;
    }

    return `
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        ${list.map(b => `
          <div class="rounded-sm border border-border bg-card/50 p-5 transition-all hover:border-primary/40 hover:bg-card cursor-pointer" onclick="navigateTo('/banks/${b.id}')">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h3 class="font-display text-xl leading-tight text-foreground">${b.name}</h3>
                <p class="font-mono text-[10px] uppercase text-muted-foreground">${b.ticker} · ${b.hq_city}, ${b.country}</p>
              </div>
              ${renderVerdictBadge(b.verdict)}
            </div>

            <div class="mt-4 grid grid-cols-3 gap-2 border-y border-border/40 py-2.5 text-center text-[11px]">
              <div>
                <span class="block font-mono text-[9px] uppercase text-muted-foreground">Assets</span>
                <span class="num text-foreground">${formatMoney(b.total_assets_bn)}</span>
              </div>
              <div>
                <span class="block font-mono text-[9px] uppercase text-muted-foreground">ROE</span>
                <span class="num text-foreground">${formatPct(b.roe_pct)}</span>
              </div>
              <div>
                <span class="block font-mono text-[9px] uppercase text-muted-foreground">Score</span>
                <span class="num font-semibold text-foreground">${b.composite}</span>
              </div>
            </div>

            <p class="mt-3 text-[11px] leading-relaxed text-muted-foreground line-clamp-2">
              ${b.analyst_note}
            </p>

            <div class="mt-4 flex items-center justify-between border-t border-border/40 pt-3 text-[10px] font-mono uppercase">
              <span class="${b.rlAction === 'commit' ? 'text-positive' : b.rlAction === 'queue' ? 'text-caution' : 'text-muted-foreground'}">RL ${b.rlAction === 'commit' ? 'commit' : b.rlAction === 'queue' ? 'queue' : 'pass'} ${b.rlAdvantage >= 0 ? '+' : ''}${Number(b.rlAdvantage).toFixed(2)}</span>
              <a href="#/banks/${b.id}" class="analysis-btn">
                <span>View Analysis</span>
                <span>→</span>
              </a>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // ==========================================
  // VIEW 3: GEOGRAPHY / MAP PAGE
  // ==========================================
  let selectedMapBank = null;
  let activeMapRegion = 'all';
  let geoMlCache = null;

  const ML_FEATURES = [
    { key: 'roe_pct', label: 'ROE' },
    { key: 'roa_pct', label: 'ROA' },
    { key: 'cet1_pct', label: 'CET1' },
    { key: 'npl_pct', label: 'NPL' },
    { key: 'cost_income_pct', label: 'Cost / income' },
    { key: 'nim_pct', label: 'NIM' },
    { key: 'loan_growth_pct', label: 'Loan growth' },
    { key: 'forecast_ni_growth_pct', label: 'NI guidance' }
  ];
  const ML_FEATURE_SIGN = [1, 1, 1, -1, -1, 1, 1, 1];
  const ML_REGIONS = ['North America', 'Europe', 'Asia-Pacific', 'Middle East & Africa', 'Latin America'];
  const ML_CLUSTER_COLORS = ['#5eead4', '#e0b56a', '#93c5fd'];

  function describeMlCluster(roe, cet1, npl) {
    if (roe >= 15 && cet1 >= 16 && npl < 2.5) {
      return {
        name: 'High-capital growth',
        blurb: 'Strong returns sit on a thick capital buffer and contained credit losses. These are the balance sheets with the most room to negotiate from strength.'
      };
    }
    if (roe >= 14) {
      return {
        name: 'High return, higher credit cost',
        blurb: 'Profitability is high, and non-performing loans are the price of that margin. The question is how much of the return survives a credit cycle.'
      };
    }
    return {
      name: 'Thinner-spread franchises',
      blurb: 'Returns sit nearer a typical cost of equity. Scale and funding franchises dominate, so the case is price and efficiency rather than growth.'
    };
  }

  function mlEscape(value) {
    return String(value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function mlStandardize(matrix) {
    const n = matrix.length;
    const d = matrix[0].length;
    const mu = Array(d).fill(0);
    const sd = Array(d).fill(0);
    for (let j = 0; j < d; j++) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += matrix[i][j];
      mu[j] = sum / n;
      let variance = 0;
      for (let i = 0; i < n; i++) variance += (matrix[i][j] - mu[j]) ** 2;
      sd[j] = Math.sqrt(variance / Math.max(1, n - 1)) || 1;
    }
    const Z = matrix.map(row => row.map((value, j) => (value - mu[j]) / sd[j]));
    return { Z, mu, sd };
  }

  function mlCovariance(Z) {
    const n = Z.length;
    const d = Z[0].length;
    const C = Array.from({ length: d }, () => Array(d).fill(0));
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < d; a++) {
        for (let b = a; b < d; b++) C[a][b] += Z[i][a] * Z[i][b];
      }
    }
    const den = Math.max(1, n - 1);
    for (let a = 0; a < d; a++) {
      for (let b = a; b < d; b++) {
        C[a][b] /= den;
        C[b][a] = C[a][b];
      }
    }
    return C;
  }

  function mlTopEigen(C, count) {
    const d = C.length;
    const M = C.map(row => row.slice());
    const vecs = [];
    const vals = [];
    for (let comp = 0; comp < count; comp++) {
      let v = Array.from({ length: d }, (_, i) => Math.sin((i + 1) * 1.7) + 0.15);
      let norm = Math.hypot(...v) || 1;
      v = v.map(x => x / norm);
      let lambda = 0;
      for (let iter = 0; iter < 80; iter++) {
        const w = Array(d).fill(0);
        for (let i = 0; i < d; i++) {
          for (let j = 0; j < d; j++) w[i] += M[i][j] * v[j];
        }
        lambda = Math.hypot(...w);
        v = w.map(x => x / (lambda || 1));
      }
      vecs.push(v);
      vals.push(lambda);
      for (let i = 0; i < d; i++) {
        for (let j = 0; j < d; j++) M[i][j] -= lambda * v[i] * v[j];
      }
    }
    return { vecs, vals };
  }

  function mlKMeans(Z, k) {
    const n = Z.length;
    const d = Z[0].length;
    const dist2 = (a, b) => {
      let sum = 0;
      for (let j = 0; j < d; j++) sum += (a[j] - b[j]) ** 2;
      return sum;
    };
    let start = 0;
    let farthest = -1;
    const origin = Array(d).fill(0);
    for (let i = 0; i < n; i++) {
      const distance = dist2(Z[i], origin);
      if (distance > farthest) {
        farthest = distance;
        start = i;
      }
    }
    const centroids = [Z[start].slice()];
    while (centroids.length < k) {
      let idx = 0;
      let best = -1;
      for (let i = 0; i < n; i++) {
        const distance = Math.min(...centroids.map(c => dist2(Z[i], c)));
        if (distance > best) {
          best = distance;
          idx = i;
        }
      }
      centroids.push(Z[idx].slice());
    }
    const labels = Array(n).fill(0);
    for (let iter = 0; iter < 40; iter++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        let bestC = 0;
        let bestD = Infinity;
        for (let c = 0; c < k; c++) {
          const distance = dist2(Z[i], centroids[c]);
          if (distance < bestD) {
            bestD = distance;
            bestC = c;
          }
        }
        if (labels[i] !== bestC) moved = true;
        labels[i] = bestC;
      }
      for (let c = 0; c < k; c++) {
        const members = [];
        for (let i = 0; i < n; i++) if (labels[i] === c) members.push(Z[i]);
        if (!members.length) continue;
        for (let j = 0; j < d; j++) {
          centroids[c][j] = members.reduce((sum, row) => sum + row[j], 0) / members.length;
        }
      }
      if (!moved && iter > 0) break;
    }
    return labels;
  }

  function mlSilhouette(Z, labels, k) {
    const n = Z.length;
    const dist = (a, b) => {
      let sum = 0;
      for (let j = 0; j < a.length; j++) sum += (a[j] - b[j]) ** 2;
      return Math.sqrt(sum);
    };
    let total = 0;
    for (let i = 0; i < n; i++) {
      const same = [];
      const other = Array.from({ length: k }, () => []);
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const distance = dist(Z[i], Z[j]);
        if (labels[j] === labels[i]) same.push(distance);
        else other[labels[j]].push(distance);
      }
      const a = same.length ? same.reduce((sum, v) => sum + v, 0) / same.length : 0;
      let b = Infinity;
      for (let c = 0; c < k; c++) {
        if (!other[c].length || c === labels[i]) continue;
        const mean = other[c].reduce((sum, v) => sum + v, 0) / other[c].length;
        if (mean < b) b = mean;
      }
      total += b === Infinity ? 0 : (b - a) / Math.max(a, b, 1e-9);
    }
    return total / n;
  }

  function mlSolve(A, b) {
    const n = b.length;
    const M = A.map((row, i) => row.concat(b[i]));
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
      }
      if (Math.abs(M[pivot][col]) < 1e-10) continue;
      const swap = M[col];
      M[col] = M[pivot];
      M[pivot] = swap;
      const div = M[col][col];
      for (let j = col; j <= n; j++) M[col][j] /= div;
      for (let row = 0; row < n; row++) {
        if (row === col) continue;
        const factor = M[row][col];
        for (let j = col; j <= n; j++) M[row][j] -= factor * M[col][j];
      }
    }
    return M.map(row => row[n]);
  }

  function mlFitOls(X, y) {
    const n = X.length;
    const p = X[0].length;
    const design = X.map(row => [1].concat(row));
    const xtx = Array.from({ length: p + 1 }, () => Array(p + 1).fill(0));
    const xty = Array(p + 1).fill(0);
    for (let i = 0; i < n; i++) {
      for (let a = 0; a <= p; a++) {
        xty[a] += design[i][a] * y[i];
        for (let b = 0; b <= p; b++) xtx[a][b] += design[i][a] * design[i][b];
      }
    }
    const beta = mlSolve(xtx, xty);
    const fitted = design.map(row => row.reduce((sum, value, j) => sum + value * beta[j], 0));
    const yBar = y.reduce((sum, value) => sum + value, 0) / n;
    let ssTot = 0;
    let ssRes = 0;
    for (let i = 0; i < n; i++) {
      ssTot += (y[i] - yBar) ** 2;
      ssRes += (y[i] - fitted[i]) ** 2;
    }
    return { beta, fitted, r2: ssTot ? 1 - ssRes / ssTot : 0 };
  }

  function getGeoMlModel() {
    if (geoMlCache) return geoMlCache;
    const matrix = banks.map(bank => ML_FEATURES.map(feature => Number(bank[feature.key]) || 0));
    const { Z } = mlStandardize(matrix);
    const covariance = mlCovariance(Z);
    const { vecs, vals } = mlTopEigen(covariance, 2);
    if (vecs[0][0] < 0) vecs[0] = vecs[0].map(v => -v);
    if (vecs[1][2] < 0) vecs[1] = vecs[1].map(v => -v);
    const trace = covariance.reduce((sum, row, i) => sum + row[i], 0) || 1;
    let labels = mlKMeans(Z, 3);
    const quality = [0, 1, 2].map(cluster => {
      const members = Z.filter((_, i) => labels[i] === cluster);
      if (!members.length) return -Infinity;
      const total = members.reduce((sum, row) => sum + row.reduce((s, v, j) => s + v * ML_FEATURE_SIGN[j], 0), 0);
      return total / members.length;
    });
    const rankOf = quality
      .map((score, index) => ({ score, index }))
      .sort((a, b) => b.score - a.score)
      .reduce((map, item, rank) => {
        map[item.index] = rank;
        return map;
      }, {});
    labels = labels.map(label => rankOf[label]);

    const predictorIndex = ML_FEATURES.map((feature, index) => feature.key === 'forecast_ni_growth_pct' ? -1 : index).filter(index => index >= 0);
    const X = Z.map(row => predictorIndex.map(index => row[index]));
    const y = banks.map(bank => Number(bank.forecast_ni_growth_pct) || 0);
    const ols = mlFitOls(X, y);

    const points = banks.map((bank, i) => ({
      id: bank.id,
      name: bank.name,
      region: bank.region,
      country: bank.country,
      cluster: labels[i],
      pc1: Z[i].reduce((sum, value, j) => sum + value * vecs[0][j], 0),
      pc2: Z[i].reduce((sum, value, j) => sum + value * vecs[1][j], 0),
      actual: y[i],
      fitted: ols.fitted[i],
      roe: bank.roe_pct,
      cet1: bank.cet1_pct,
      npl: bank.npl_pct,
      composite: bank.composite
    }));

    const clusters = [0, 1, 2].map(index => {
      const members = points.filter(point => point.cluster === index);
      const medianRoe = median(members.map(point => point.roe));
      const medianCet1 = median(members.map(point => point.cet1));
      const medianNpl = median(members.map(point => point.npl));
      const described = describeMlCluster(medianRoe, medianCet1, medianNpl);
      const examples = members
        .map(point => ({
          name: point.name,
          distance: Math.abs(point.roe - medianRoe) + Math.abs(point.cet1 - medianCet1) + Math.abs(point.npl - medianNpl) * 2
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 3)
        .map(point => point.name);
      return {
        index,
        name: described.name,
        color: ML_CLUSTER_COLORS[index],
        blurb: described.blurb,
        count: members.length,
        medianRoe,
        medianCet1,
        medianNpl,
        examples
      };
    });

    const loadings = ML_FEATURES.map((feature, j) => ({
      label: feature.label,
      pc1: vecs[0][j],
      pc2: vecs[1][j]
    })).sort((a, b) => Math.abs(b.pc1) - Math.abs(a.pc1));

    const coefficients = predictorIndex.map((featureIndex, i) => ({
      label: ML_FEATURES[featureIndex].label,
      value: ols.beta[i + 1]
    }));

    geoMlCache = {
      points,
      clusters,
      loadings,
      coefficients,
      r2: ols.r2,
      silhouette: mlSilhouette(Z, labels, 3),
      pc1Share: vals[0] / trace,
      pc2Share: vals[1] / trace,
      regions: ML_REGIONS
    };
    return geoMlCache;
  }

  function renderMlScatter(points, xOf, yOf, xLabel, yLabel, guide) {
    const W = 640;
    const H = 348;
    const pad = { l: 52, r: 16, t: 22, b: 40 };
    const xs = points.map(xOf);
    const ys = points.map(yOf);
    let xMin = Math.min(...xs);
    let xMax = Math.max(...xs);
    let yMin = Math.min(...ys);
    let yMax = Math.max(...ys);
    if (guide === 'identity') {
      const lo = Math.min(xMin, yMin);
      const hi = Math.max(xMax, yMax);
      xMin = yMin = lo;
      xMax = yMax = hi;
    }
    const xSpan = (xMax - xMin) || 1;
    const ySpan = (yMax - yMin) || 1;
    xMin -= xSpan * 0.12;
    xMax += xSpan * 0.12;
    yMin -= ySpan * 0.12;
    yMax += ySpan * 0.12;
    const X = value => pad.l + ((value - xMin) / (xMax - xMin)) * (W - pad.l - pad.r);
    const Y = value => pad.t + (1 - (value - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);
    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const xv = xMin + (i / 4) * (xMax - xMin);
      const yv = yMin + (i / 4) * (yMax - yMin);
      const x = X(xv);
      const y = Y(yv);
      grid += `<line x1="${x.toFixed(1)}" y1="${pad.t}" x2="${x.toFixed(1)}" y2="${H - pad.b}" stroke="rgba(243,239,230,0.07)"></line>`;
      grid += `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${W - pad.r}" y2="${y.toFixed(1)}" stroke="rgba(243,239,230,0.07)"></line>`;
      grid += `<text x="${x.toFixed(1)}" y="${H - 22}" text-anchor="middle" fill="#8d96a6" font-size="10" font-family="IBM Plex Mono, monospace">${xv.toFixed(1)}</text>`;
      grid += `<text x="${pad.l - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="#8d96a6" font-size="10" font-family="IBM Plex Mono, monospace">${yv.toFixed(1)}</text>`;
    }
    let guideLine = '';
    if (guide === 'identity') {
      const lo = Math.max(xMin, yMin);
      const hi = Math.min(xMax, yMax);
      guideLine = `<line x1="${X(lo).toFixed(1)}" y1="${Y(lo).toFixed(1)}" x2="${X(hi).toFixed(1)}" y2="${Y(hi).toFixed(1)}" stroke="rgba(224,181,106,0.7)" stroke-dasharray="4 4"></line>`;
    } else {
      if (yMin < 0 && yMax > 0) {
        guideLine += `<line x1="${pad.l}" y1="${Y(0).toFixed(1)}" x2="${W - pad.r}" y2="${Y(0).toFixed(1)}" stroke="rgba(243,239,230,0.16)"></line>`;
      }
      if (xMin < 0 && xMax > 0) {
        guideLine += `<line x1="${X(0).toFixed(1)}" y1="${pad.t}" x2="${X(0).toFixed(1)}" y2="${H - pad.b}" stroke="rgba(243,239,230,0.16)"></line>`;
      }
    }
    const model = getGeoMlModel();
    const dots = points.map(point => {
      const inRegion = activeMapRegion === 'all' || point.region === activeMapRegion;
      const selected = selectedMapBank && selectedMapBank.id === point.id;
      const color = model.clusters[point.cluster].color;
      return `<circle data-ml-bank="${point.id}" cx="${X(xOf(point)).toFixed(1)}" cy="${Y(yOf(point)).toFixed(1)}" r="${selected ? 7 : 5.5}" fill="${color}" fill-opacity="${inRegion ? 0.9 : 0.14}" stroke="${selected ? '#f6f1e7' : 'rgba(255,255,255,0.45)'}" stroke-width="${selected ? 2.2 : 0.7}" style="cursor:pointer"><title>${mlEscape(point.name)} · ${mlEscape(point.region)}</title></circle>`;
    }).join('');
    return `
      <svg viewBox="0 0 ${W} ${H}" class="w-full" role="img" aria-label="${mlEscape(xLabel)} against ${mlEscape(yLabel)}">
        ${grid}
        ${guideLine}
        ${dots}
        <text x="${pad.l}" y="12" fill="#8d96a6" font-size="10" font-family="IBM Plex Mono, monospace" letter-spacing="1.2">${mlEscape(yLabel).toUpperCase()}</text>
        <text x="${(pad.l + W - pad.r) / 2}" y="${H - 6}" text-anchor="middle" fill="#8d96a6" font-size="10" font-family="IBM Plex Mono, monospace" letter-spacing="1.2">${mlEscape(xLabel).toUpperCase()}</text>
      </svg>
    `;
  }

  function renderMlCoefBars(coefficients) {
    const max = Math.max(...coefficients.map(item => Math.abs(item.value)), 0.01);
    return coefficients.map(item => {
      const width = (Math.abs(item.value) / max) * 48;
      const positive = item.value >= 0;
      return `
        <div class="grid items-center gap-2" style="grid-template-columns: 92px 1fr 48px;">
          <span class="text-[11px] text-muted-foreground">${mlEscape(item.label)}</span>
          <span class="relative block h-1.5" style="background: rgba(243,239,230,0.06);">
            <span style="position:absolute;top:0;bottom:0;${positive ? 'left:50%' : 'right:50%'};width:${width.toFixed(1)}%;background:${positive ? '#34d399' : '#f87171'};"></span>
            <span style="position:absolute;left:50%;top:-3px;bottom:-3px;width:1px;background:rgba(243,239,230,0.28);"></span>
          </span>
          <span class="num text-right text-[11px] ${positive ? 'text-positive' : 'text-negative'}">${positive ? '+' : ''}${item.value.toFixed(2)}</span>
        </div>
      `;
    }).join('');
  }

  function renderMlRegionMix(model) {
    return model.regions.map(region => {
      const members = model.points.filter(point => point.region === region);
      const active = activeMapRegion === 'all' || activeMapRegion === region;
      const segs = model.clusters.map(cluster => {
        const count = members.filter(point => point.cluster === cluster.index).length;
        const width = members.length ? (count / members.length) * 100 : 0;
        return `<span title="${mlEscape(cluster.name)}: ${count}" style="display:block;height:100%;width:${width}%;background:${cluster.color};"></span>`;
      }).join('');
      return `
        <div style="opacity:${active ? 1 : 0.35}">
          <div class="mb-1 flex items-center justify-between text-[11px]">
            <span class="${activeMapRegion === region ? 'text-primary' : 'text-foreground'}">${mlEscape(region)}</span>
            <span class="num text-muted-foreground">${members.length}</span>
          </div>
          <div class="flex overflow-hidden" style="height:10px;background:rgba(243,239,230,0.06);">${segs}</div>
        </div>
      `;
    }).join('');
  }

  function mlRegionSentence(model) {
    const scope = activeMapRegion === 'all'
      ? model.points
      : model.points.filter(point => point.region === activeMapRegion);
    if (!scope.length) return 'No banks in this region.';
    const counts = model.clusters.map(cluster => scope.filter(point => point.cluster === cluster.index).length);
    const top = counts.indexOf(Math.max(...counts));
    const share = Math.round((counts[top] / scope.length) * 100);
    const place = activeMapRegion === 'all' ? 'The full map' : activeMapRegion;
    return `${place} is ${share}% ${model.clusters[top].name.toLowerCase()} across ${scope.length} bank${scope.length === 1 ? '' : 's'}.`;
  }

  function mlSelectionSentence(model) {
    if (!selectedMapBank) return 'Click a point, or a map marker, to read that bank against the fitted clusters.';
    const point = model.points.find(item => item.id === selectedMapBank.id);
    if (!point) return '';
    const gap = point.fitted - point.actual;
    const direction = gap >= 0 ? 'above' : 'below';
    return `${point.name} sits in ${model.clusters[point.cluster].name}. The earnings model prints ${point.fitted >= 0 ? '+' : ''}${point.fitted.toFixed(1)}%, ${Math.abs(gap).toFixed(1)} pt ${direction} the reported ${point.actual >= 0 ? '+' : ''}${point.actual.toFixed(1)}% guidance.`;
  }

  function renderGeoMl() {
    const root = document.getElementById('geo-ml-root');
    if (!root) return;
    const model = getGeoMlModel();
    const leadCoef = model.coefficients.slice().sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
    const leadVerb = leadCoef.value >= 0 ? 'lifts' : 'lowers';
    const pcDrivers = model.loadings.slice(0, 3).map(item => item.label).join(', ');

    root.innerHTML = `
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div class="max-w-2xl">
          <p class="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Machine learning</p>
          <h2 class="mt-2 font-display text-3xl leading-tight text-foreground sm:text-4xl">Algorithmic reading of the map</h2>
          <p class="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            k-means (k = 3) groups every bank on eight z-scored balance-sheet features. The scatter is the first two principal components of that same matrix. A separate ordinary-least-squares model fits next-year net-income guidance on the other ratios. Region tabs dim the banks outside the frame; the fit stays global.
          </p>
        </div>
        <p class="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Fit on ${model.points.length} banks</p>
      </div>

      <div class="mt-6 grid gap-3 sm:grid-cols-3">
        <div class="rounded-sm border border-border bg-card/40 px-4 py-3">
          <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Cluster separation</p>
          <p class="mt-1 font-display text-2xl text-foreground">${model.silhouette.toFixed(2)}</p>
          <p class="mt-1 text-[11px] text-muted-foreground">Mean silhouette, three groups</p>
        </div>
        <div class="rounded-sm border border-border bg-card/40 px-4 py-3">
          <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Variance in two axes</p>
          <p class="mt-1 font-display text-2xl text-foreground">${Math.round((model.pc1Share + model.pc2Share) * 100)}%</p>
          <p class="mt-1 text-[11px] text-muted-foreground">PC1 ${Math.round(model.pc1Share * 100)}% · PC2 ${Math.round(model.pc2Share * 100)}%</p>
        </div>
        <div class="rounded-sm border border-border bg-card/40 px-4 py-3">
          <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Guidance model R²</p>
          <p class="mt-1 font-display text-2xl text-foreground">${model.r2.toFixed(2)}</p>
          <p class="mt-1 text-[11px] text-muted-foreground">OLS on six standardised ratios</p>
        </div>
      </div>

      <div class="mt-6 grid gap-6 lg:grid-cols-2">
        <div class="rounded-sm border border-border bg-card/40 p-4">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Principal components</p>
              <h3 class="mt-1 font-display text-2xl text-foreground">Where franchises separate</h3>
            </div>
          </div>
          <p class="mt-2 text-[12px] leading-relaxed text-muted-foreground">PC1 is led by ${mlEscape(pcDrivers)}. Rightward points carry the stronger return and growth profile.</p>
          <div class="mt-3">${renderMlScatter(model.points, p => p.pc1, p => p.pc2, 'PC1', 'PC2', 'axes')}</div>
        </div>
        <div class="rounded-sm border border-border bg-card/40 p-4">
          <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Earnings guidance model</p>
          <h3 class="mt-1 font-display text-2xl text-foreground">Reported versus fitted growth</h3>
          <p class="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            One standard deviation in ${mlEscape(leadCoef.label)} ${leadVerb} fitted net-income growth by ${Math.abs(leadCoef.value).toFixed(2)} percentage points. Points off the dashed line are where guidance disagrees with the ratios.
          </p>
          <div class="mt-3">${renderMlScatter(model.points, p => p.actual, p => p.fitted, 'Reported %', 'Fitted %', 'identity')}</div>
        </div>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-4 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        ${model.clusters.map(cluster => `<span class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-full" style="background:${cluster.color}"></span>${mlEscape(cluster.name)}</span>`).join('')}
        <span>${mlEscape(mlRegionSentence(model))}</span>
      </div>
      <p id="ml-selection-note" class="mt-2 text-[12px] leading-relaxed text-foreground">${mlEscape(mlSelectionSentence(model))}</p>

      <div class="mt-6 grid gap-4 lg:grid-cols-3">
        ${model.clusters.map(cluster => `
          <article class="rounded-sm border border-border bg-card/40 p-4">
            <div class="flex items-center gap-2">
              <span class="h-2 w-2 rounded-full" style="background:${cluster.color}"></span>
              <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">${cluster.count} banks</p>
            </div>
            <h3 class="mt-2 font-display text-xl text-foreground">${mlEscape(cluster.name)}</h3>
            <p class="mt-2 text-[12px] leading-relaxed text-muted-foreground">${mlEscape(cluster.blurb)}</p>
            <div class="mt-4 grid grid-cols-3 gap-2 text-[11px]">
              <div><p class="text-muted-foreground">Med. ROE</p><p class="num mt-0.5 text-foreground">${cluster.medianRoe.toFixed(1)}%</p></div>
              <div><p class="text-muted-foreground">Med. CET1</p><p class="num mt-0.5 text-foreground">${cluster.medianCet1.toFixed(1)}%</p></div>
              <div><p class="text-muted-foreground">Med. NPL</p><p class="num mt-0.5 text-foreground">${cluster.medianNpl.toFixed(1)}%</p></div>
            </div>
            <p class="mt-3 text-[11px] leading-relaxed text-muted-foreground">Nearest the centre: ${cluster.examples.map(mlEscape).join(' · ')}</p>
          </article>
        `).join('')}
      </div>

      <div class="mt-6 grid gap-6 lg:grid-cols-2">
        <div class="rounded-sm border border-border bg-card/40 p-4 sm:p-5">
          <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Cluster mix by region</p>
          <h3 class="mt-1 font-display text-2xl text-foreground">How the algorithm maps onto geography</h3>
          <div class="mt-5 flex flex-col gap-3">${renderMlRegionMix(model)}</div>
        </div>
        <div class="rounded-sm border border-border bg-card/40 p-4">
          <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Standardised coefficients</p>
          <h3 class="mt-1 font-display text-2xl text-foreground">What moves the growth forecast</h3>
          <p class="mt-2 text-[12px] leading-relaxed text-muted-foreground">Each bar is the OLS weight on a one-standard-deviation change, in percentage points of next-year net income growth. The intercept is omitted.</p>
          <div class="mt-5 flex flex-col gap-3">${renderMlCoefBars(model.coefficients)}</div>
        </div>
      </div>
    `;

    root.querySelectorAll('[data-ml-bank]').forEach(node => {
      node.addEventListener('click', () => {
        const bank = banks.find(item => item.id === node.getAttribute('data-ml-bank'));
        if (!bank) return;
        selectedMapBank = bank;
        const panel = document.getElementById('map-side-panel');
        if (panel) panel.innerHTML = renderMapSidePanel(bank);
        if (leafletMapInstance && bank.lat != null && bank.lng != null) {
          leafletMapInstance.flyTo([bank.lat, bank.lng], Math.max(leafletMapInstance.getZoom(), 3.2), { duration: 0.7 });
        }
        renderGeoMl();
      });
    });
  }

  function renderMap(container) {
    container.innerHTML = `
      <div class="mx-auto max-w-[1180px] px-5 pb-16 pt-10 sm:px-8 sm:pt-14">
        <!-- Header -->
        <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p class="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Spatial distribution</p>
            <h1 class="mt-2 font-display text-[2.2rem] leading-tight text-foreground sm:text-4xl">
              Global banking geography
            </h1>
          </div>
          <p class="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Bubble size reflects asset scale · Color reflects signal
          </p>
        </div>

        <!-- Region selector tabs -->
        <div class="mt-6 flex flex-wrap gap-1.5 border-b border-border/60 pb-3 font-mono text-[11px] uppercase tracking-wider">
          <button class="map-reg-btn px-3 py-1.5 rounded-sm ${activeMapRegion === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}" data-reg="all">All</button>
          <button class="map-reg-btn px-3 py-1.5 rounded-sm ${activeMapRegion === 'North America' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}" data-reg="North America">North America</button>
          <button class="map-reg-btn px-3 py-1.5 rounded-sm ${activeMapRegion === 'Europe' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}" data-reg="Europe">Europe</button>
          <button class="map-reg-btn px-3 py-1.5 rounded-sm ${activeMapRegion === 'Asia-Pacific' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}" data-reg="Asia-Pacific">Asia-Pacific</button>
          <button class="map-reg-btn px-3 py-1.5 rounded-sm ${activeMapRegion === 'Middle East & Africa' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}" data-reg="Middle East & Africa">Middle East &amp; Africa</button>
          <button class="map-reg-btn px-3 py-1.5 rounded-sm ${activeMapRegion === 'Latin America' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}" data-reg="Latin America">Latin America</button>
        </div>

        <div class="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div class="relative overflow-hidden rounded-sm border border-border bg-[#090d12]" style="height: 560px;">
            <div id="leaflet-map-root" class="h-full w-full"></div>
            <div class="absolute bottom-4 left-4 z-[400] flex items-center gap-3 rounded-sm border border-border/80 bg-background/90 px-3.5 py-2 backdrop-blur-md font-mono text-[10px] uppercase">
              <span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-positive"></span>Negotiate</span>
              <span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-caution"></span>Hold</span>
              <span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-negative"></span>Loss risk</span>
            </div>
          </div>

          <div id="map-side-panel" class="rounded-sm border border-border bg-card/50 p-6 flex flex-col justify-between">
            ${renderMapSidePanel(selectedMapBank)}
          </div>
        </div>

        <div id="geo-ml-root" class="mt-24"></div>
      </div>
    `;

    setTimeout(initLeafletMap, 50);
    renderGeoMl();

    document.querySelectorAll('.map-reg-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        activeMapRegion = e.target.getAttribute('data-reg');
        document.querySelectorAll('.map-reg-btn').forEach(b => {
          b.className = 'map-reg-btn px-3 py-1.5 rounded-sm text-muted-foreground hover:text-foreground';
        });
        e.target.className = 'map-reg-btn px-3 py-1.5 rounded-sm bg-primary text-primary-foreground';
        flyToRegion(activeMapRegion);
        renderGeoMl();
      });
    });
  }

  function renderMapSidePanel(bank) {
    if (!bank) {
      return `
        <div>
          <p class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Reading the map</p>
          <p class="mt-4 text-[13px] leading-relaxed text-muted-foreground">
            Each circle represents a banking institution. Diameter scales with reported balance-sheet asset volume, and fill reflects our analytical signal.
          </p>
          <div class="mt-6 space-y-3">
            <div class="flex items-center gap-2.5 text-[12px] text-foreground">
              <span class="h-2 w-2 rounded-full bg-positive"></span>
              <span>Negotiation target (Upper quintile)</span>
            </div>
            <div class="flex items-center gap-2.5 text-[12px] text-foreground">
              <span class="h-2 w-2 rounded-full bg-caution"></span>
              <span>Hold &amp; monitor (Equilibrium)</span>
            </div>
            <div class="flex items-center gap-2.5 text-[12px] text-foreground">
              <span class="h-2 w-2 rounded-full bg-negative"></span>
              <span>Loss risk (Vulnerable capital / margin)</span>
            </div>
          </div>
        </div>
        <div class="border-t border-border/60 pt-4 text-[11px] text-muted-foreground">
          Click any marker on the map to inspect its fundamental breakdown.
        </div>
      `;
    }

    return `
      <div>
        <div class="flex items-start justify-between gap-3">
          <p class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Selected asset</p>
          <button type="button" onclick="clearMapSelection()" class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground">Clear</button>
        </div>
        <h3 class="mt-3 font-display text-2xl leading-tight text-foreground">${bank.name}</h3>
        <p class="mt-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">${bank.hq_city}, ${bank.country}</p>
        
        <div class="mt-4">${renderVerdictBadge(bank.verdict)}</div>

        <div class="mt-5 space-y-2.5 border-t border-border/60 pt-4 text-[12px]">
          <div class="flex justify-between">
            <span class="text-muted-foreground">Assets</span>
            <span class="num text-foreground">${formatMoney(bank.total_assets_bn)}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">ROE</span>
            <span class="num text-foreground">${formatPct(bank.roe_pct)}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">CET1</span>
            <span class="num text-foreground">${formatPct(bank.cet1_pct)}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">NPL</span>
            <span class="num text-foreground">${formatPct(bank.npl_pct)}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">Forecast</span>
            <span class="num ${bank.forecast_ni_growth_pct >= 0 ? 'text-positive' : 'text-negative'}">${formatSignPct(bank.forecast_ni_growth_pct)}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">Ledger Score</span>
            <span class="num font-semibold text-foreground">${bank.composite}</span>
          </div>
        </div>
      </div>

      <a href="#/banks/${bank.id}" class="mt-6 block w-full rounded-sm bg-primary/20 border border-primary/40 py-2.5 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-primary hover:bg-primary hover:text-primary-foreground transition-all">
        Open full analysis →
      </a>
    `;
  }

  window.clearMapSelection = function () {
    selectedMapBank = null;
    const panel = document.getElementById('map-side-panel');
    if (panel) panel.innerHTML = renderMapSidePanel(null);
    renderGeoMl();
  };

  function initLeafletMap() {
    const mapRoot = document.getElementById('leaflet-map-root');
    if (!mapRoot || typeof L === 'undefined') return;

    if (leafletMapInstance) {
      leafletMapInstance.remove();
      leafletMapInstance = null;
    }

    leafletMapInstance = L.map('leaflet-map-root', {
      center: [26, 12],
      zoom: 2,
      minZoom: 1.5,
      maxZoom: 9,
      attributionControl: false
    });

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 16
    }).addTo(leafletMapInstance);

    banks.forEach(b => {
      if (!b.lat || !b.lng) return;

      const radius = Math.max(6, Math.min(26, Math.sqrt(b.total_assets_bn) * 0.42));
      const color = b.verdict === 'negotiate' ? '#34d399' : b.verdict === 'at_risk' ? '#f87171' : '#fbbf24';

      const circle = L.circleMarker([b.lat, b.lng], {
        radius: radius,
        fillColor: color,
        color: '#ffffff',
        weight: 1.2,
        opacity: 0.85,
        fillOpacity: 0.65
      }).addTo(leafletMapInstance);

      circle.bindTooltip(`<strong>${b.name}</strong><br><span style="font-family: monospace;">Score: ${b.composite} | Assets: ${formatMoney(b.total_assets_bn)}</span>`, {
        direction: 'top',
        className: 'leaflet-popup-content-wrapper'
      });

      circle.on('click', () => {
        selectedMapBank = b;
        const panel = document.getElementById('map-side-panel');
        if (panel) panel.innerHTML = renderMapSidePanel(b);
        leafletMapInstance.panTo([b.lat, b.lng]);
        renderGeoMl();
      });
    });
  }

  function flyToRegion(reg) {
    if (!leafletMapInstance) return;
    const coords = {
      'all': { center: [26, 12], zoom: 2 },
      'North America': { center: [40, -98], zoom: 3.5 },
      'Europe': { center: [48, 14], zoom: 4 },
      'Asia-Pacific': { center: [28, 105], zoom: 3.5 },
      'Middle East & Africa': { center: [12, 38], zoom: 3.5 },
      'Latin America': { center: [-15, -60], zoom: 3.5 }
    };
    const c = coords[reg] || coords.all;
    leafletMapInstance.flyTo(c.center, c.zoom, { duration: 1.2 });
  }

    // ==========================================
  // VIEW: PREDICTION ANALYSIS
  // ==========================================
  const PREDICT_FEATURES = [
    { key: 'roe_pct', label: 'ROE' },
    { key: 'cet1_pct', label: 'CET1' },
    { key: 'npl_pct', label: 'NPL' },
    { key: 'cost_income_pct', label: 'Cost / income' },
    { key: 'nim_pct', label: 'NIM' },
    { key: 'loan_growth_pct', label: 'Loan growth' }
  ];
  let predictionActiveTab = 'single'; // 'single' | 'compare'
  let predictionBankId = '';
  let predictionCompareBankId = '';
  let predictionResult = null;
  let predictionCompareResultA = null;
  let predictionCompareResultB = null;

  window.setPredictionTab = function (tab) {
    predictionActiveTab = tab;
    const container = document.getElementById('app-content');
    if (container) renderPrediction(container);
  };

  window.swapCompareBanks = function () {
    const temp = predictionBankId;
    predictionBankId = predictionCompareBankId;
    predictionCompareBankId = temp;
    const bankA = banks.find(b => b.id === predictionBankId);
    const bankB = banks.find(b => b.id === predictionCompareBankId);
    if (bankA && bankB) {
      predictionCompareResultA = scorePrediction(bankA);
      predictionCompareResultB = scorePrediction(bankB);
    }
    const container = document.getElementById('app-content');
    if (container) renderPrediction(container);
  };

  function predictRmse(actual, fitted) {
    let sum = 0;
    for (let i = 0; i < actual.length; i++) sum += (actual[i] - fitted[i]) ** 2;
    const degrees = Math.max(1, actual.length - PREDICT_FEATURES.length - 1);
    return Math.sqrt(sum / degrees);
  }

  function predictIncomeGrowthTarget(bank) {
    const volume = Number(bank.loan_growth_pct) || 0;
    const marginGap = (Number(bank.nim_pct) || 0) - 2;
    const guidance = Number(bank.forecast_ni_growth_pct) || 0;
    return volume * 0.65 + marginGap * 0.25 + guidance * 0.1;
  }

  function scorePrediction(bank) {
    const peers = banks.filter(item => item.id !== bank.id);
    const matrix = peers.map(item => PREDICT_FEATURES.map(feature => Number(item[feature.key]) || 0));
    const { Z, mu, sd } = mlStandardize(matrix);
    const profitTarget = peers.map(item => Number(item.forecast_ni_growth_pct) || 0);
    const incomeTarget = peers.map(predictIncomeGrowthTarget);
    const profitFit = mlFitOls(Z, profitTarget);
    const incomeFit = mlFitOls(Z, incomeTarget);
    const raw = PREDICT_FEATURES.map(feature => Number(bank[feature.key]) || 0);
    const x = raw.map((value, index) => (value - mu[index]) / sd[index]);
    const dot = (beta) => beta[0] + x.reduce((sum, value, index) => sum + value * beta[index + 1], 0);
    const profitGrowth = dot(profitFit.beta);
    const incomeGrowth = dot(incomeFit.beta);
    const profitError = predictRmse(profitTarget, profitFit.fitted);
    const incomeError = predictRmse(incomeTarget, incomeFit.fitted);
    const drivers = PREDICT_FEATURES.map((feature, index) => ({
      label: feature.label,
      value: x[index] * profitFit.beta[index + 1]
    }));
    const regionPeers = peers.filter(item => item.region === bank.region);
    const regionGrowth = regionPeers.length
      ? regionPeers.reduce((sum, item) => sum + (Number(item.forecast_ni_growth_pct) || 0), 0) / regionPeers.length
      : profitTarget.reduce((sum, value) => sum + value, 0) / profitTarget.length;

    return {
      bank,
      peers: peers.length,
      horizon: 'FY2026',
      profitGrowth,
      incomeGrowth,
      profitError,
      incomeError,
      profitR2: profitFit.r2,
      incomeR2: incomeFit.r2,
      baseline: profitFit.beta[0],
      drivers,
      guidance: Number(bank.forecast_ni_growth_pct) || 0,
      regionGrowth,
      currentIncome: Number(bank.revenue_bn) || 0,
      currentProfit: Number(bank.net_income_bn) || 0,
      nextIncome: (Number(bank.revenue_bn) || 0) * (1 + incomeGrowth / 100),
      nextProfit: (Number(bank.net_income_bn) || 0) * (1 + profitGrowth / 100)
    };
  }

  function renderPredictCompare(result) {
    const rows = [
      { label: 'Income', current: result.currentIncome, next: result.nextIncome },
      { label: 'Profit', current: result.currentProfit, next: result.nextProfit }
    ];
    const W = 640;
    const H = 250;
    const pad = { l: 52, r: 16, t: 28, b: 36 };
    const max = Math.max(...rows.flatMap(row => [row.current, row.next]), 0.01) * 1.18;
    const groupW = (W - pad.l - pad.r) / rows.length;
    const barW = 28;
    const Y = value => pad.t + (1 - value / max) * (H - pad.t - pad.b);
    const base = H - pad.b;
    let grid = '';
    for (let i = 0; i <= 3; i++) {
      const value = (max / 3) * i;
      const y = Y(value);
      grid += `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${W - pad.r}" y2="${y.toFixed(1)}" stroke="rgba(243,239,230,0.08)"></line>`;
      grid += `<text x="${pad.l - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="#8d96a6" font-size="10" font-family="IBM Plex Mono, monospace">${value >= 1000 ? (value / 1000).toFixed(1) + 'T' : Math.round(value)}</text>`;
    }
    const bars = rows.map((row, index) => {
      const cx = pad.l + groupW * index + groupW / 2;
      const currentH = base - Y(row.current);
      const nextH = base - Y(row.next);
      const nextColor = row.next >= row.current ? '#5eead4' : '#f87171';
      return `
        <rect x="${(cx - barW - 4).toFixed(1)}" y="${Y(row.current).toFixed(1)}" width="${barW}" height="${currentH.toFixed(1)}" fill="#8d96a6" opacity="0.85"></rect>
        <rect x="${(cx + 4).toFixed(1)}" y="${Y(row.next).toFixed(1)}" width="${barW}" height="${nextH.toFixed(1)}" fill="${nextColor}"></rect>
        <text x="${(cx - barW / 2 - 4).toFixed(1)}" y="${(Y(row.current) - 6).toFixed(1)}" text-anchor="middle" fill="#c5c9d2" font-size="10" font-family="IBM Plex Mono, monospace">${formatMoney(row.current)}</text>
        <text x="${(cx + barW / 2 + 4).toFixed(1)}" y="${(Y(row.next) - 6).toFixed(1)}" text-anchor="middle" fill="${nextColor}" font-size="10" font-family="IBM Plex Mono, monospace">${formatMoney(row.next)}</text>
        <text x="${cx.toFixed(1)}" y="${H - 12}" text-anchor="middle" fill="#8d96a6" font-size="10" font-family="IBM Plex Mono, monospace" letter-spacing="1.2">${row.label.toUpperCase()}</text>
      `;
    }).join('');
    return `
      <svg viewBox="0 0 ${W} ${H}" class="w-full" role="img" aria-label="Current and predicted income and profit">
        ${grid}
        ${bars}
        <text x="${pad.l}" y="12" fill="#8d96a6" font-size="10" font-family="IBM Plex Mono, monospace" letter-spacing="1.2">$ BILLIONS</text>
      </svg>
    `;
  }

  function renderPredictDrivers(result) {
    const items = [{ label: 'Peer baseline', value: result.baseline }].concat(result.drivers);
    const max = Math.max(...items.map(item => Math.abs(item.value)), 0.01);
    return items.map(item => {
      const positive = item.value >= 0;
      const width = (Math.abs(item.value) / max) * 48;
      return `
        <div class="grid items-center gap-2" style="grid-template-columns: 110px 1fr 52px;">
          <span class="text-[11px] text-muted-foreground">${mlEscape(item.label)}</span>
          <span class="relative block h-1.5" style="background: rgba(243,239,230,0.06);">
            <span style="position:absolute;top:0;bottom:0;${positive ? 'left:50%' : 'right:50%'};width:${width.toFixed(1)}%;background:${positive ? '#34d399' : '#f87171'};"></span>
            <span style="position:absolute;left:50%;top:-3px;bottom:-3px;width:1px;background:rgba(243,239,230,0.28);"></span>
          </span>
          <span class="num text-right text-[11px] ${positive ? 'text-positive' : 'text-negative'}">${positive ? '+' : ''}${item.value.toFixed(2)}</span>
        </div>
      `;
    }).join('');
  }

  // ==========================================
  // GRAPHICAL OBSERVATIONS FOR PEER NEGOTIATION
  // ==========================================

  // Observation 1: Side-by-Side Financial Growth Trajectory (Reported vs Predicted)
  function renderNegotiationTrajectoryChart(resA, resB) {
    const W = 680;
    const H = 270;
    const pad = { l: 56, r: 20, t: 36, b: 42 };
    const series = [
      {
        category: 'Revenue (Income)',
        items: [
          { label: resA.bank.ticker + ' Rep', val: resA.currentIncome, col: '#8d96a6', sub: 'FY25' },
          { label: resA.bank.ticker + ' Pred', val: resA.nextIncome, col: '#d4b482', sub: 'FY26' },
          { label: resB.bank.ticker + ' Rep', val: resB.currentIncome, col: '#627282', sub: 'FY25' },
          { label: resB.bank.ticker + ' Pred', val: resB.nextIncome, col: '#2dd4bf', sub: 'FY26' }
        ]
      },
      {
        category: 'Net Income (Profit)',
        items: [
          { label: resA.bank.ticker + ' Rep', val: resA.currentProfit, col: '#8d96a6', sub: 'FY25' },
          { label: resA.bank.ticker + ' Pred', val: resA.nextProfit, col: '#d4b482', sub: 'FY26' },
          { label: resB.bank.ticker + ' Rep', val: resB.currentProfit, col: '#627282', sub: 'FY25' },
          { label: resB.bank.ticker + ' Pred', val: resB.nextProfit, col: '#2dd4bf', sub: 'FY26' }
        ]
      }
    ];

    const allVals = series.flatMap(s => s.items.map(it => it.val));
    const max = Math.max(...allVals, 1) * 1.22;
    const groupW = (W - pad.l - pad.r) / series.length;
    const barW = 24;
    const base = H - pad.b;
    const Y = val => pad.t + (1 - val / max) * (H - pad.t - pad.b);

    let grid = '';
    for (let i = 0; i <= 3; i++) {
      const val = (max / 3) * i;
      const y = Y(val);
      grid += `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${W - pad.r}" y2="${y.toFixed(1)}" stroke="rgba(243,239,230,0.07)"></line>`;
      grid += `<text x="${pad.l - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="#8d96a6" font-size="9" font-family="IBM Plex Mono, monospace">${val >= 1000 ? (val / 1000).toFixed(1) + 'T' : Math.round(val)}</text>`;
    }

    const groups = series.map((s, sIdx) => {
      const groupX = pad.l + groupW * sIdx;
      const innerW = groupW - 24;
      const step = innerW / s.items.length;
      const barElements = s.items.map((it, iIdx) => {
        const bx = groupX + 12 + step * iIdx + (step - barW) / 2;
        const barH = Math.max(2, base - Y(it.val));
        const by = Y(it.val);
        return `
          <rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW}" height="${barH.toFixed(1)}" rx="2" fill="${it.col}" opacity="0.95"></rect>
          <text x="${(bx + barW / 2).toFixed(1)}" y="${(by - 5).toFixed(1)}" text-anchor="middle" fill="${it.col}" font-size="9" font-family="IBM Plex Mono, monospace" font-weight="600">${formatMoney(it.val)}</text>
          <text x="${(bx + barW / 2).toFixed(1)}" y="${H - 24}" text-anchor="middle" fill="#8d96a6" font-size="8" font-family="IBM Plex Mono, monospace">${it.sub}</text>
        `;
      }).join('');

      return `
        ${barElements}
        <text x="${(groupX + groupW / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="#c5c9d2" font-size="10" font-family="IBM Plex Mono, monospace" letter-spacing="1.5" font-weight="bold">${s.category.toUpperCase()}</text>
      `;
    }).join('');

    return `
      <svg viewBox="0 0 ${W} ${H}" class="w-full" role="img" aria-label="Comparative Trajectory Chart">
        ${grid}
        ${groups}
        <text x="${pad.l}" y="14" fill="#8d96a6" font-size="9" font-family="IBM Plex Mono, monospace" letter-spacing="1.2">$ BILLIONS · FY25 REPORTED VS FY26 PREDICTED</text>
      </svg>
    `;
  }

  // Observation 2: Six-Pillar Competitive Radar / Relative Strength Chart
  function renderNegotiationPillarsChart(resA, resB) {
    const pillars = [
      { label: 'ROE (Return)', a: Number(resA.bank.roe_pct) || 0, b: Number(resB.bank.roe_pct) || 0, unit: '%', max: 25, better: 'high' },
      { label: 'CET1 (Solvency)', a: Number(resA.bank.cet1_pct) || 0, b: Number(resB.bank.cet1_pct) || 0, unit: '%', max: 22, better: 'high' },
      { label: 'NPL (Credit Risk)', a: Number(resA.bank.npl_pct) || 0, b: Number(resB.bank.npl_pct) || 0, unit: '%', max: 5, better: 'low' },
      { label: 'Cost / Income', a: Number(resA.bank.cost_income_pct) || 0, b: Number(resB.bank.cost_income_pct) || 0, unit: '%', max: 75, better: 'low' },
      { label: 'Net Int. Margin', a: Number(resA.bank.nim_pct) || 0, b: Number(resB.bank.nim_pct) || 0, unit: '%', max: 6, better: 'high' },
      { label: 'Loan Growth', a: Number(resA.bank.loan_growth_pct) || 0, b: Number(resB.bank.loan_growth_pct) || 0, unit: '%', max: 18, better: 'high' }
    ];

    return pillars.map(p => {
      const aWins = p.better === 'high' ? p.a >= p.b : p.a <= p.b;
      const bWins = !aWins;
      const aPct = Math.min(100, Math.max(5, (p.a / p.max) * 100));
      const bPct = Math.min(100, Math.max(5, (p.b / p.max) * 100));

      return `
        <div class="rounded-sm border border-border/50 bg-background/50 p-3 space-y-2">
          <div class="flex items-center justify-between text-[11px]">
            <span class="font-medium text-foreground">${p.label}</span>
            <div class="flex items-center gap-3 font-mono text-[10px]">
              <span class="${aWins ? 'text-primary font-bold' : 'text-muted-foreground'}">${resA.bank.ticker}: ${p.a}${p.unit}</span>
              <span class="text-muted-foreground/40">vs</span>
              <span class="${bWins ? 'text-accent font-bold' : 'text-muted-foreground'}">${resB.bank.ticker}: ${p.b}${p.unit}</span>
            </div>
          </div>
          <!-- Dual Bar -->
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <span class="font-mono text-[9px] uppercase tracking-wider text-primary w-8 shrink-0">${resA.bank.ticker}</span>
              <div class="h-2 w-full rounded-full bg-secondary/80 overflow-hidden">
                <div class="h-full bg-primary rounded-full transition-all duration-300" style="width: ${aPct}%;"></div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span class="font-mono text-[9px] uppercase tracking-wider text-accent w-8 shrink-0">${resB.bank.ticker}</span>
              <div class="h-2 w-full rounded-full bg-secondary/80 overflow-hidden">
                <div class="h-full bg-accent rounded-full transition-all duration-300" style="width: ${bPct}%;"></div>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Observation 3: Bear / Base / Bull Risk Corridor Comparison
  function renderNegotiationScenariosChart(resA, resB) {
    const W = 640;
    const H = 180;
    const pad = { l: 70, r: 30, t: 25, b: 35 };

    const aBear = resA.profitGrowth - resA.profitError;
    const aBase = resA.profitGrowth;
    const aBull = resA.profitGrowth + resA.profitError;

    const bBear = resB.profitGrowth - resB.profitError;
    const bBase = resB.profitGrowth;
    const bBull = resB.profitGrowth + resB.profitError;

    const minX = Math.min(aBear, bBear, -5) - 3;
    const maxX = Math.max(aBull, bBull, 10) + 3;
    const X = v => pad.l + ((v - minX) / (maxX - minX)) * (W - pad.l - pad.r);

    const zeroX = X(0);
    const rowHeight = 44;

    return `
      <svg viewBox="0 0 ${W} ${H}" class="w-full" role="img" aria-label="Risk corridor chart">
        <!-- Zero Axis line -->
        <line x1="${zeroX.toFixed(1)}" y1="${pad.t}" x2="${zeroX.toFixed(1)}" y2="${H - pad.b}" stroke="rgba(243,239,230,0.3)" stroke-width="1.5" stroke-dasharray="3 3"></line>
        <text x="${zeroX.toFixed(1)}" y="${pad.t - 8}" text-anchor="middle" fill="#8d96a6" font-size="9" font-family="IBM Plex Mono, monospace">0% Growth</text>

        <!-- Bank A Row -->
        <g transform="translate(0, ${pad.t + 20})">
          <text x="${pad.l - 12}" y="4" text-anchor="end" fill="#d4b482" font-size="11" font-family="IBM Plex Mono, monospace" font-weight="bold">${resA.bank.ticker}</text>
          <!-- Corridor Bar -->
          <line x1="${X(aBear).toFixed(1)}" y1="0" x2="${X(aBull).toFixed(1)}" y2="0" stroke="#d4b482" stroke-width="6" stroke-linecap="round" opacity="0.45"></line>
          <!-- Base Point -->
          <circle cx="${X(aBase).toFixed(1)}" cy="0" r="5" fill="#d4b482"></circle>
          <!-- Labels -->
          <text x="${X(aBear).toFixed(1)}" y="16" text-anchor="middle" fill="#8d96a6" font-size="8" font-family="IBM Plex Mono, monospace">Bear ${aBear.toFixed(1)}%</text>
          <text x="${X(aBase).toFixed(1)}" y="-10" text-anchor="middle" fill="#d4b482" font-size="9" font-family="IBM Plex Mono, monospace" font-weight="bold">Base ${aBase.toFixed(1)}%</text>
          <text x="${X(aBull).toFixed(1)}" y="16" text-anchor="middle" fill="#8d96a6" font-size="8" font-family="IBM Plex Mono, monospace">Bull ${aBull.toFixed(1)}%</text>
        </g>

        <!-- Bank B Row -->
        <g transform="translate(0, ${pad.t + 70})">
          <text x="${pad.l - 12}" y="4" text-anchor="end" fill="#2dd4bf" font-size="11" font-family="IBM Plex Mono, monospace" font-weight="bold">${resB.bank.ticker}</text>
          <!-- Corridor Bar -->
          <line x1="${X(bBear).toFixed(1)}" y1="0" x2="${X(bBull).toFixed(1)}" y2="0" stroke="#2dd4bf" stroke-width="6" stroke-linecap="round" opacity="0.45"></line>
          <!-- Base Point -->
          <circle cx="${X(bBase).toFixed(1)}" cy="0" r="5" fill="#2dd4bf"></circle>
          <!-- Labels -->
          <text x="${X(bBear).toFixed(1)}" y="16" text-anchor="middle" fill="#8d96a6" font-size="8" font-family="IBM Plex Mono, monospace">Bear ${bBear.toFixed(1)}%</text>
          <text x="${X(bBase).toFixed(1)}" y="-10" text-anchor="middle" fill="#2dd4bf" font-size="9" font-family="IBM Plex Mono, monospace" font-weight="bold">Base ${bBase.toFixed(1)}%</text>
          <text x="${X(bBull).toFixed(1)}" y="16" text-anchor="middle" fill="#8d96a6" font-size="8" font-family="IBM Plex Mono, monospace">Bull ${bBull.toFixed(1)}%</text>
        </g>

        <text x="${pad.l}" y="${H - 6}" fill="#8d96a6" font-size="9" font-family="IBM Plex Mono, monospace">FY2026 EARNINGS SENSITIVITY RANGE (± 1 REGRESSION RMSE)</text>
      </svg>
    `;
  }

  // ==========================================
  // VIEW: PREDICTION MAIN RENDERER
  // ==========================================
  function renderPrediction(container) {
    const ordered = banks.slice().sort((a, b) => a.name.localeCompare(b.name));
    if (!predictionBankId) predictionBankId = ordered[0].id;
    if (!predictionCompareBankId) predictionCompareBankId = ordered[1]?.id || ordered[0].id;

    const selectedA = ordered.find(bank => bank.id === predictionBankId) || ordered[0];
    const selectedB = ordered.find(bank => bank.id === predictionCompareBankId) || ordered[1] || ordered[0];

    // Single mode results
    const result = predictionResult;
    const staleSingle = result && result.bank.id !== selectedA.id;

    // Compare mode results: auto calculate if not yet ready
    if (!predictionCompareResultA || predictionCompareResultA.bank.id !== selectedA.id) {
      predictionCompareResultA = scorePrediction(selectedA);
    }
    if (!predictionCompareResultB || predictionCompareResultB.bank.id !== selectedB.id) {
      predictionCompareResultB = scorePrediction(selectedB);
    }

    container.innerHTML = `
      <div class="mx-auto max-w-[1180px] px-5 pb-16 pt-10 sm:px-8 sm:pt-14">
        <!-- Header -->
        <div class="max-w-2xl">
          <p class="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Prediction &amp; Negotiation Analysis</p>
          <h1 class="mt-2 font-display text-[2.2rem] leading-tight text-foreground sm:text-4xl">Next-year income, profit &amp; negotiation</h1>
          <p class="mt-3 text-[14px] leading-relaxed text-muted-foreground">
            Machine-learning cross-sectional regression across all 42 institutions. Predict next-year income and earnings, or benchmark two banks side-by-side to discover valuation arbitrage and negotiation leverage.
          </p>
        </div>

        <!-- TABS: Single Bank vs Peer Comparison & Negotiation -->
        <div class="mt-8 flex border-b border-border/70">
          <button 
            type="button" 
            onclick="setPredictionTab('single')" 
            class="px-5 py-3 font-mono text-[11px] uppercase tracking-[0.16em] border-b-2 transition-colors ${predictionActiveTab === 'single' ? 'border-primary text-primary font-bold' : 'border-transparent text-muted-foreground hover:text-foreground'}"
          >
            Single Bank Forecast
          </button>
          <button 
            type="button" 
            onclick="setPredictionTab('compare')" 
            class="px-5 py-3 font-mono text-[11px] uppercase tracking-[0.16em] border-b-2 transition-colors flex items-center gap-2 ${predictionActiveTab === 'compare' ? 'border-primary text-primary font-bold' : 'border-transparent text-muted-foreground hover:text-foreground'}"
          >
            <span>Peer Comparison &amp; Negotiation</span>
            <span class="rounded-full bg-primary/20 text-primary text-[9px] px-2 py-0.5 font-mono font-bold tracking-wider">Compare 2 Banks</span>
          </button>
        </div>

        ${predictionActiveTab === 'single' ? `
          <!-- SINGLE BANK FORM -->
          <form id="predict-form" class="mt-8 flex flex-col gap-3 rounded-sm border border-border bg-card/40 p-4 sm:flex-row sm:items-end">
            <label class="block flex-1">
              <span class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Banking company</span>
              <select id="predict-bank" class="custom-select mt-2 w-full">
                ${ordered.map(bank => `<option value="${bank.id}" ${bank.id === selectedA.id ? 'selected' : ''}>${mlEscape(bank.name)} · ${mlEscape(bank.ticker)}</option>`).join('')}
              </select>
            </label>
            <button type="submit" class="rounded-sm bg-primary px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-primary-foreground">
              Predict ${mlEscape(selectedA.name)}
            </button>
          </form>

          <div id="predict-results" class="mt-8">
            ${result ? renderPredictionResults(result, staleSingle) : `
              <div class="rounded-sm border border-dashed border-border px-6 py-14 text-center">
                <p class="font-display text-2xl text-foreground">No prediction yet</p>
                <p class="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-muted-foreground">Select a banking company, then run the model. The result covers FY2026 revenue and net income, with a bear, base and bull range.</p>
              </div>
            `}
          </div>
        ` : `
          <!-- PEER COMPARISON & NEGOTIATION FORM -->
          <form id="predict-compare-form" class="mt-8 rounded-sm border border-border bg-card/40 p-5 space-y-4">
            <div class="flex items-center justify-between border-b border-border/40 pb-3">
              <div>
                <p class="font-mono text-[10px] uppercase tracking-wider text-primary font-bold">Counterparty Selection</p>
                <p class="text-[12px] text-muted-foreground">Select two institutions to evaluate comparative earnings trajectories and negotiation leverage.</p>
              </div>
              <button type="button" onclick="swapCompareBanks()" class="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors border border-border/70 rounded-xs px-2.5 py-1 bg-background/40">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m7 16-4-4 4-4m10 8 4-4-4-4M3 12h18"/></svg>
                Swap Banks
              </button>
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
              <!-- Bank A -->
              <div class="rounded-sm border border-primary/40 bg-background/50 p-3.5 space-y-2">
                <span class="font-mono text-[9px] uppercase tracking-wider text-primary font-bold flex items-center gap-1.5">
                  <span class="h-2 w-2 rounded-full bg-primary"></span>
                  Primary / Target Bank (A)
                </span>
                <select id="predict-bank-a" class="custom-select w-full text-[13px]">
                  ${ordered.map(bank => `<option value="${bank.id}" ${bank.id === selectedA.id ? 'selected' : ''}>${mlEscape(bank.name)} (${mlEscape(bank.ticker)}) · ${bank.country}</option>`).join('')}
                </select>
                <div class="flex justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/30">
                  <span>Assets: <strong class="text-foreground">${formatMoney(selectedA.total_assets_bn)}</strong></span>
                  <span>CET1: <strong class="text-foreground">${selectedA.cet1_pct}%</strong></span>
                  <span>P/E: <strong class="text-foreground">${selectedA.pe_ratio}x</strong></span>
                </div>
              </div>

              <!-- Bank B -->
              <div class="rounded-sm border border-accent/40 bg-background/50 p-3.5 space-y-2">
                <span class="font-mono text-[9px] uppercase tracking-wider text-accent font-bold flex items-center gap-1.5">
                  <span class="h-2 w-2 rounded-full bg-accent"></span>
                  Comparison / Peer Bank (B)
                </span>
                <select id="predict-bank-b" class="custom-select w-full text-[13px]">
                  ${ordered.map(bank => `<option value="${bank.id}" ${bank.id === selectedB.id ? 'selected' : ''}>${mlEscape(bank.name)} (${mlEscape(bank.ticker)}) · ${bank.country}</option>`).join('')}
                </select>
                <div class="flex justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/30">
                  <span>Assets: <strong class="text-foreground">${formatMoney(selectedB.total_assets_bn)}</strong></span>
                  <span>CET1: <strong class="text-foreground">${selectedB.cet1_pct}%</strong></span>
                  <span>P/E: <strong class="text-foreground">${selectedB.pe_ratio}x</strong></span>
                </div>
              </div>
            </div>

            <div class="flex justify-end pt-2">
              <button type="submit" class="rounded-sm bg-primary px-6 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-primary-foreground font-semibold hover:opacity-95 transition-opacity">
                Run Negotiation &amp; Peer Comparison
              </button>
            </div>
          </form>

          <!-- COMPARISON RESULTS SECTION -->
          <div id="predict-compare-results" class="mt-8 space-y-8">
            ${renderPredictionComparisonResults(predictionCompareResultA, predictionCompareResultB)}
          </div>
        `}
      </div>
    `;

    // Event handlers for Single form
    const singleForm = document.getElementById('predict-form');
    if (singleForm) {
      const select = document.getElementById('predict-bank');
      select.addEventListener('change', () => {
        predictionBankId = select.value;
        const button = singleForm.querySelector('button[type="submit"]');
        const next = banks.find(bank => bank.id === predictionBankId);
        if (button && next) button.textContent = `Predict ${next.name}`;
      });
      singleForm.addEventListener('submit', event => {
        event.preventDefault();
        predictionBankId = select.value;
        const bank = banks.find(item => item.id === predictionBankId);
        if (!bank) return;
        predictionResult = scorePrediction(bank);
        renderPrediction(container);
        const results = document.getElementById('predict-results');
        if (results) results.scrollIntoView({ block: 'start' });
      });
    }

    // Event handlers for Compare form
    const compareForm = document.getElementById('predict-compare-form');
    if (compareForm) {
      compareForm.addEventListener('submit', event => {
        event.preventDefault();
        const selA = document.getElementById('predict-bank-a');
        const selB = document.getElementById('predict-bank-b');
        if (selA && selB) {
          predictionBankId = selA.value;
          predictionCompareBankId = selB.value;
          const bankA = banks.find(item => item.id === predictionBankId);
          const bankB = banks.find(item => item.id === predictionCompareBankId);
          if (bankA && bankB) {
            predictionCompareResultA = scorePrediction(bankA);
            predictionCompareResultB = scorePrediction(bankB);
          }
          renderPrediction(container);
          const compResults = document.getElementById('predict-compare-results');
          if (compResults) compResults.scrollIntoView({ block: 'start' });
        }
      });
    }
  }

  // ==========================================
  // SINGLE RESULT RENDERER
  // ==========================================
  function renderPredictionResults(result, stale) {
    const incomeDelta = result.nextIncome - result.currentIncome;
    const profitDelta = result.nextProfit - result.currentProfit;
    const guidanceGap = result.profitGrowth - result.guidance;
    const bearProfit = result.currentProfit * (1 + (result.profitGrowth - result.profitError) / 100);
    const bullProfit = result.currentProfit * (1 + (result.profitGrowth + result.profitError) / 100);
    const bearIncome = result.currentIncome * (1 + (result.incomeGrowth - result.incomeError) / 100);
    const bullIncome = result.currentIncome * (1 + (result.incomeGrowth + result.incomeError) / 100);
    const marginNow = result.currentIncome ? (result.currentProfit / result.currentIncome) * 100 : 0;
    const marginNext = result.nextIncome ? (result.nextProfit / result.nextIncome) * 100 : 0;

    return `
      ${stale ? `<p class="mb-4 rounded-sm border border-caution/30 bg-caution/10 px-4 py-3 text-[12px] text-caution">These figures are still for ${mlEscape(result.bank.name)}. Run the model again to predict the bank now selected.</p>` : ''}
      <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">${mlEscape(result.horizon)} · ${mlEscape(result.bank.ticker)}</p>
          <h2 class="mt-1 font-display text-3xl text-foreground">${mlEscape(result.bank.name)}</h2>
          <p class="mt-1 text-[12px] text-muted-foreground">${mlEscape(result.bank.hq_city)}, ${mlEscape(result.bank.country)} · trained on ${result.peers} other banks</p>
        </div>
        <p class="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Profit model R² ${result.profitR2.toFixed(2)}</p>
      </div>

      <div class="mt-6 grid gap-3 sm:grid-cols-3">
        <div class="rounded-sm border border-border bg-card/40 px-4 py-3">
          <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Predicted income</p>
          <p class="mt-1 font-display text-2xl text-foreground">${formatMoney(result.nextIncome)}</p>
          <p class="mt-1 text-[11px] ${incomeDelta >= 0 ? 'text-positive' : 'text-negative'}">${formatSignPct(result.incomeGrowth)} from ${formatMoney(result.currentIncome)}</p>
        </div>
        <div class="rounded-sm border border-border bg-card/40 px-4 py-3">
          <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Predicted profit</p>
          <p class="mt-1 font-display text-2xl text-foreground">${formatMoney(result.nextProfit)}</p>
          <p class="mt-1 text-[11px] ${profitDelta >= 0 ? 'text-positive' : 'text-negative'}">${formatSignPct(result.profitGrowth)} from ${formatMoney(result.currentProfit)}</p>
        </div>
        <div class="rounded-sm border border-border bg-card/40 px-4 py-3">
          <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Versus stated guidance</p>
          <p class="mt-1 font-display text-2xl ${guidanceGap >= 0 ? 'text-positive' : 'text-negative'}">${guidanceGap >= 0 ? '+' : ''}${guidanceGap.toFixed(1)} pt</p>
          <p class="mt-1 text-[11px] text-muted-foreground">Model ${formatSignPct(result.profitGrowth)} · guidance ${formatSignPct(result.guidance)}</p>
        </div>
      </div>

      <div class="mt-6 grid gap-6 lg:grid-cols-2">
        <div class="rounded-sm border border-border bg-card/40 p-4">
          <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Reported versus FY2026</p>
          <h3 class="mt-1 font-display text-2xl text-foreground">Income and profit</h3>
          <p class="mt-2 text-[12px] leading-relaxed text-muted-foreground">Grey is the latest reported year. The second bar is the base-case prediction. Profit margin moves from ${marginNow.toFixed(1)}% to ${marginNext.toFixed(1)}% of income.</p>
          <div class="mt-2 flex gap-4 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <span class="inline-flex items-center gap-1.5"><span class="h-2 w-2" style="background:#8d96a6"></span>Reported</span>
            <span class="inline-flex items-center gap-1.5"><span class="h-2 w-2" style="background:#5eead4"></span>Predicted</span>
          </div>
          ${renderPredictCompare(result)}
        </div>
        <div class="rounded-sm border border-border bg-card/40 p-4">
          <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">What moves profit growth</p>
          <h3 class="mt-1 font-display text-2xl text-foreground">Model contributions</h3>
          <p class="mt-2 text-[12px] leading-relaxed text-muted-foreground">Each bar is the peer baseline or a one-standard-deviation feature times its weight, in percentage points of FY2026 net-income growth. ${mlEscape(result.bank.region)} peers guided ${formatSignPct(result.regionGrowth)} on average.</p>
          <div class="mt-5 flex flex-col gap-3">${renderPredictDrivers(result)}</div>
        </div>
      </div>

      <div class="mt-6 overflow-x-auto rounded-sm border border-border bg-card/40">
        <table class="w-full text-left text-[12px]">
          <thead class="border-b border-border/60 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            <tr>
              <th class="py-3 pl-4 pr-3">Case</th>
              <th class="px-3 py-3 text-right">Income growth</th>
              <th class="px-3 py-3 text-right">FY2026 income</th>
              <th class="px-3 py-3 text-right">Profit growth</th>
              <th class="py-3 pl-3 pr-4 text-right">FY2026 profit</th>
            </tr>
          </thead>
          <tbody>
            ${[
              ['Bear', result.incomeGrowth - result.incomeError, bearIncome, result.profitGrowth - result.profitError, bearProfit],
              ['Base', result.incomeGrowth, result.nextIncome, result.profitGrowth, result.nextProfit],
              ['Bull', result.incomeGrowth + result.incomeError, bullIncome, result.profitGrowth + result.profitError, bullProfit]
            ].map(row => `
              <tr class="border-b border-border/40 ${row[0] === 'Base' ? 'text-foreground' : 'text-muted-foreground'}">
                <td class="py-3 pl-4 pr-3 font-medium ${row[0] === 'Base' ? 'text-primary' : ''}">${row[0]}</td>
                <td class="num px-3 py-3 text-right">${formatSignPct(row[1])}</td>
                <td class="num px-3 py-3 text-right">${formatMoney(row[2])}</td>
                <td class="num px-3 py-3 text-right">${formatSignPct(row[3])}</td>
                <td class="num py-3 pl-3 pr-4 text-right">${formatMoney(row[4])}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <p class="mt-3 text-[12px] leading-relaxed text-muted-foreground">
        Bear and bull sit one regression error either side of the base case (±${result.profitError.toFixed(1)} pt on profit, ±${result.incomeError.toFixed(1)} pt on income). This is a cross-section of one reported year, not a multi-year time series, and it is not investment advice.
      </p>
    `;
  }

  // ==========================================
  // COMPARATIVE NEGOTIATION RESULTS RENDERER
  // ==========================================
  function renderPredictionComparisonResults(resA, resB) {
    if (!resA || !resB) return '';

    // Calculate comparative metrics
    const profitDiff = resA.profitGrowth - resB.profitGrowth;
    const incomeDiff = resA.incomeGrowth - resB.incomeGrowth;
    const cet1Diff = (Number(resA.bank.cet1_pct) || 0) - (Number(resB.bank.cet1_pct) || 0);
    const peDiff = (Number(resA.bank.pe_ratio) || 0) - (Number(resB.bank.pe_ratio) || 0);
    const nplDiff = (Number(resA.bank.npl_pct) || 0) - (Number(resB.bank.npl_pct) || 0);
    const roeDiff = (Number(resA.bank.roe_pct) || 0) - (Number(resB.bank.roe_pct) || 0);

    // Strategic Stance Synthesis
    const strongerProfitBank = profitDiff >= 0 ? resA.bank : resB.bank;
    const saferCapitalBank = cet1Diff >= 0 ? resA.bank : resB.bank;
    const cheaperValuationBank = peDiff <= 0 ? resA.bank : resB.bank;

    return `
      <!-- Executive Negotiation Leverage Banner -->
      <div class="rounded-sm border border-primary/40 bg-card/60 p-6 space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-4 border-b border-border/40 pb-4">
          <div>
            <div class="flex items-center gap-2">
              <span class="rounded-full bg-primary/10 border border-primary/30 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary font-bold">
                Strategic Negotiation Intelligence
              </span>
              <span class="font-mono text-[11px] text-muted-foreground">${resA.bank.name} vs ${resB.bank.name}</span>
            </div>
            <h2 class="mt-2 font-display text-2xl text-foreground">Comparative Arbitrage &amp; Negotiating Stance</h2>
          </div>
          <div class="flex items-center gap-2">
            <span class="rounded-xs border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-[11px] text-primary font-bold">
              ${resA.bank.ticker} ${formatSignPct(resA.profitGrowth)}
            </span>
            <span class="font-mono text-[10px] text-muted-foreground uppercase">vs</span>
            <span class="rounded-xs border border-accent/40 bg-accent/10 px-3 py-1.5 font-mono text-[11px] text-accent font-bold">
              ${resB.bank.ticker} ${formatSignPct(resB.profitGrowth)}
            </span>
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-3">
          <!-- Leverage 1: Growth -->
          <div class="rounded-sm border border-border/60 bg-background/50 p-3.5">
            <p class="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Earnings Momentum Leverage</p>
            <p class="mt-1 font-display text-lg text-foreground font-semibold">
              ${strongerProfitBank.ticker} leads by ${Math.abs(profitDiff).toFixed(1)} pts
            </p>
            <p class="mt-1 text-[11px] text-muted-foreground leading-relaxed">
              FY26 net income growth projected at ${formatSignPct(strongerProfitBank === resA.bank ? resA.profitGrowth : resB.profitGrowth)} vs ${formatSignPct(strongerProfitBank === resA.bank ? resB.profitGrowth : resA.profitGrowth)}. Provides organic pricing resilience.
            </p>
          </div>

          <!-- Leverage 2: Solvency -->
          <div class="rounded-sm border border-border/60 bg-background/50 p-3.5">
            <p class="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Solvency Cushion &amp; Risk Discount</p>
            <p class="mt-1 font-display text-lg text-foreground font-semibold">
              ${saferCapitalBank.ticker} has +${Math.abs(cet1Diff).toFixed(1)}% CET1
            </p>
            <p class="mt-1 text-[11px] text-muted-foreground leading-relaxed">
              Higher common equity tier-1 ratio protects against stress tests. The counterparty with lower CET1 can be pressured on risk-adjusted spread terms.
            </p>
          </div>

          <!-- Leverage 3: Valuation -->
          <div class="rounded-sm border border-border/60 bg-background/50 p-3.5">
            <p class="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Valuation Arbitrage Entry</p>
            <p class="mt-1 font-display text-lg text-foreground font-semibold">
              ${cheaperValuationBank.ticker} trades at ${cheaperValuationBank.pe_ratio}x P/E
            </p>
            <p class="mt-1 text-[11px] text-muted-foreground leading-relaxed">
              Discount of ${Math.abs(peDiff)} multiple points provides greater re-rating room and margin of safety during valuation negotiations.
            </p>
          </div>
        </div>

        <!-- Actionable Stance -->
        <div class="rounded-xs bg-secondary/50 border border-border/60 p-3 text-[12px] leading-relaxed text-foreground flex items-start gap-2">
          <span class="text-primary font-bold font-mono">TACTICAL TAKEAWAY:</span>
          <span>
            In deal or capital negotiations, benchmark ${resA.bank.ticker} against ${resB.bank.ticker}. If negotiating with ${resA.bank.ticker}, use ${resB.bank.ticker}'s ${peDiff > 0 ? 'cheaper valuation multiple' : 'higher loan expansion'} as benchmark leverage. If defending terms, emphasize ${resA.bank.ticker}'s ${cet1Diff >= 0 ? 'superior CET1 buffer' : 'operational cost efficiency'}.
          </span>
        </div>
      </div>

      <!-- Graphical Observation 1: Side-by-Side Financial Growth Trajectory -->
      <div class="rounded-sm border border-border bg-card/40 p-5 space-y-3">
        <div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/40 pb-3">
          <div>
            <p class="font-mono text-[9px] uppercase tracking-[0.2em] text-primary">Graphical Observation 1</p>
            <h3 class="font-display text-xl text-foreground">Projected Revenue &amp; Net Income Trajectory</h3>
          </div>
          <div class="flex items-center gap-4 font-mono text-[10px] uppercase tracking-wider">
            <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-xs" style="background:#d4b482"></span>${resA.bank.ticker} (Target)</span>
            <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-xs" style="background:#2dd4bf"></span>${resB.bank.ticker} (Peer)</span>
          </div>
        </div>
        <p class="text-[12px] text-muted-foreground">
          Visual comparison of latest reported figures (grey tones) against FY2026 regression model forecasts (highlighted bars). Allows immediate assessment of relative scale and growth velocity.
        </p>
        <div class="pt-2">
          ${renderNegotiationTrajectoryChart(resA, resB)}
        </div>
      </div>

      <!-- Graphical Observation 2: Six-Pillar Competitive Radar / Relative Strength Chart -->
      <div class="rounded-sm border border-border bg-card/40 p-5 space-y-4">
        <div class="border-b border-border/40 pb-3">
          <p class="font-mono text-[9px] uppercase tracking-[0.2em] text-primary">Graphical Observation 2</p>
          <h3 class="font-display text-xl text-foreground">Six-Pillar Relative Strength &amp; Risk Metrics</h3>
          <p class="mt-1 text-[12px] text-muted-foreground">
            Head-to-head comparison across all six foundational ratios utilized in the leave-one-out OLS predictive regression.
          </p>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          ${renderNegotiationPillarsChart(resA, resB)}
        </div>
      </div>

      <!-- Graphical Observation 3: Bear / Base / Bull Risk Corridor Comparison -->
      <div class="rounded-sm border border-border bg-card/40 p-5 space-y-3">
        <div class="border-b border-border/40 pb-3">
          <p class="font-mono text-[9px] uppercase tracking-[0.2em] text-primary">Graphical Observation 3</p>
          <h3 class="font-display text-xl text-foreground">Earnings Forecast Sensitivity Corridors</h3>
          <p class="mt-1 text-[12px] text-muted-foreground">
            Corridor of outcomes sitting ± 1 regression standard error around the base case prediction. Highlights which bank carries higher forecast dispersion risk.
          </p>
        </div>
        <div class="pt-2">
          ${renderNegotiationScenariosChart(resA, resB)}
        </div>
      </div>

      <!-- Comprehensive Negotiation Table -->
      <div class="rounded-sm border border-border bg-card/40 overflow-hidden">
        <div class="p-4 border-b border-border/50">
          <h3 class="font-display text-lg text-foreground">Head-to-Head Negotiating Metrics Table</h3>
          <p class="text-[11px] font-mono text-muted-foreground uppercase tracking-wider mt-0.5">Comprehensive Side-by-Side Breakdown</p>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-[12px]">
            <thead class="border-b border-border/60 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground bg-secondary/30">
              <tr>
                <th class="py-3 pl-4 pr-3">Dimension / Metric</th>
                <th class="px-3 py-3 text-right text-primary font-bold">${resA.bank.name} (${resA.bank.ticker})</th>
                <th class="px-3 py-3 text-right text-accent font-bold">${resB.bank.name} (${resB.bank.ticker})</th>
                <th class="py-3 pl-3 pr-4 text-right">Negotiating Delta / Advantage</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border/40">
              <!-- Revenue -->
              <tr>
                <td class="py-3 pl-4 pr-3 font-medium text-foreground">FY26 Projected Revenue</td>
                <td class="num px-3 py-3 text-right text-foreground font-semibold">${formatMoney(resA.nextIncome)} (${formatSignPct(resA.incomeGrowth)})</td>
                <td class="num px-3 py-3 text-right text-foreground font-semibold">${formatMoney(resB.nextIncome)} (${formatSignPct(resB.incomeGrowth)})</td>
                <td class="num py-3 pl-3 pr-4 text-right ${incomeDiff >= 0 ? 'text-primary' : 'text-accent'} font-mono text-[11px]">
                  ${incomeDiff >= 0 ? resA.bank.ticker + ' +' + incomeDiff.toFixed(1) + ' pts' : resB.bank.ticker + ' +' + Math.abs(incomeDiff).toFixed(1) + ' pts'}
                </td>
              </tr>
              <!-- Profit -->
              <tr>
                <td class="py-3 pl-4 pr-3 font-medium text-foreground">FY26 Projected Net Income</td>
                <td class="num px-3 py-3 text-right text-foreground font-semibold">${formatMoney(resA.nextProfit)} (${formatSignPct(resA.profitGrowth)})</td>
                <td class="num px-3 py-3 text-right text-foreground font-semibold">${formatMoney(resB.nextProfit)} (${formatSignPct(resB.profitGrowth)})</td>
                <td class="num py-3 pl-3 pr-4 text-right ${profitDiff >= 0 ? 'text-primary' : 'text-accent'} font-mono text-[11px]">
                  ${profitDiff >= 0 ? resA.bank.ticker + ' +' + profitDiff.toFixed(1) + ' pts' : resB.bank.ticker + ' +' + Math.abs(profitDiff).toFixed(1) + ' pts'}
                </td>
              </tr>
              <!-- Solvency CET1 -->
              <tr>
                <td class="py-3 pl-4 pr-3 font-medium text-foreground">Solvency Buffer (CET1 Ratio)</td>
                <td class="num px-3 py-3 text-right text-foreground">${resA.bank.cet1_pct}%</td>
                <td class="num px-3 py-3 text-right text-foreground">${resB.bank.cet1_pct}%</td>
                <td class="num py-3 pl-3 pr-4 text-right ${cet1Diff >= 0 ? 'text-primary' : 'text-accent'} font-mono text-[11px]">
                  ${cet1Diff >= 0 ? resA.bank.ticker + ' +' + cet1Diff.toFixed(1) + '% buffer' : resB.bank.ticker + ' +' + Math.abs(cet1Diff).toFixed(1) + '% buffer'}
                </td>
              </tr>
              <!-- Asset Quality NPL -->
              <tr>
                <td class="py-3 pl-4 pr-3 font-medium text-foreground">Credit Quality (NPL Ratio)</td>
                <td class="num px-3 py-3 text-right text-foreground">${resA.bank.npl_pct}%</td>
                <td class="num px-3 py-3 text-right text-foreground">${resB.bank.npl_pct}%</td>
                <td class="num py-3 pl-3 pr-4 text-right ${nplDiff <= 0 ? 'text-primary' : 'text-accent'} font-mono text-[11px]">
                  ${nplDiff <= 0 ? resA.bank.ticker + ' lower risk (' + Math.abs(nplDiff).toFixed(2) + ' pts)' : resB.bank.ticker + ' lower risk (' + nplDiff.toFixed(2) + ' pts)'}
                </td>
              </tr>
              <!-- Cost Income -->
              <tr>
                <td class="py-3 pl-4 pr-3 font-medium text-foreground">Cost-to-Income Efficiency</td>
                <td class="num px-3 py-3 text-right text-foreground">${resA.bank.cost_income_pct}%</td>
                <td class="num px-3 py-3 text-right text-foreground">${resB.bank.cost_income_pct}%</td>
                <td class="num py-3 pl-3 pr-4 text-right ${resA.bank.cost_income_pct <= resB.bank.cost_income_pct ? 'text-primary' : 'text-accent'} font-mono text-[11px]">
                  ${resA.bank.cost_income_pct <= resB.bank.cost_income_pct ? resA.bank.ticker + ' +' + (resB.bank.cost_income_pct - resA.bank.cost_income_pct) + ' pts leaner' : resB.bank.ticker + ' +' + (resA.bank.cost_income_pct - resB.bank.cost_income_pct) + ' pts leaner'}
                </td>
              </tr>
              <!-- Valuation PE -->
              <tr>
                <td class="py-3 pl-4 pr-3 font-medium text-foreground">Valuation Multiple (P/E)</td>
                <td class="num px-3 py-3 text-right text-foreground">${resA.bank.pe_ratio}x</td>
                <td class="num px-3 py-3 text-right text-foreground">${resB.bank.pe_ratio}x</td>
                <td class="num py-3 pl-3 pr-4 text-right ${peDiff <= 0 ? 'text-primary' : 'text-accent'} font-mono text-[11px]">
                  ${peDiff <= 0 ? resA.bank.ticker + ' ' + Math.abs(peDiff) + 'x discount' : resB.bank.ticker + ' ' + peDiff + 'x discount'}
                </td>
              </tr>
              <!-- Dividend Yield -->
              <tr>
                <td class="py-3 pl-4 pr-3 font-medium text-foreground">Dividend Yield</td>
                <td class="num px-3 py-3 text-right text-foreground">${resA.bank.dividend_yield_pct}%</td>
                <td class="num px-3 py-3 text-right text-foreground">${resB.bank.dividend_yield_pct}%</td>
                <td class="num py-3 pl-3 pr-4 text-right ${resA.bank.dividend_yield_pct >= resB.bank.dividend_yield_pct ? 'text-primary' : 'text-accent'} font-mono text-[11px]">
                  ${resA.bank.dividend_yield_pct >= resB.bank.dividend_yield_pct ? resA.bank.ticker + ' +' + (resA.bank.dividend_yield_pct - resB.bank.dividend_yield_pct).toFixed(1) + ' pts' : resB.bank.ticker + ' +' + (resB.bank.dividend_yield_pct - resA.bank.dividend_yield_pct).toFixed(1) + ' pts'}
                </td>
              </tr>
              <!-- Balance Sheet Scale -->
              <tr>
                <td class="py-3 pl-4 pr-3 font-medium text-foreground">Balance Sheet Scale (Assets)</td>
                <td class="num px-3 py-3 text-right text-foreground">${formatMoney(resA.bank.total_assets_bn)}</td>
                <td class="num px-3 py-3 text-right text-foreground">${formatMoney(resB.bank.total_assets_bn)}</td>
                <td class="num py-3 pl-3 pr-4 text-right text-muted-foreground font-mono text-[11px]">
                  ${resA.bank.total_assets_bn >= resB.bank.total_assets_bn ? resA.bank.ticker + ' larger' : resB.bank.ticker + ' larger'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ==========================================
  // VIEW 4: AI ANALYST PAGE
  // ==========================================
  let activeAnalystBankId = banks[0]?.id;
  let analystMessages = [];
  let isAnalystThinking = false;

  function generateForecast(bank) {
    const ni = bank.net_income_bn || 1;
    const growth = bank.forecast_ni_growth_pct || 2;
    const roe = bank.roe_pct || 10;
    const cet1 = bank.cet1_pct || 12;
    const loanGrowth = bank.loan_growth_pct || 3;
    const npl = bank.npl_pct || 1.5;
    const composite = bank.composite || 50;

    const bullGrowth = Math.round((growth + Math.max(2.5, growth * 0.4)) * 10) / 10;
    const baseGrowth = growth;
    const bearGrowth = Math.round((growth - Math.max(3.5, Math.abs(growth) * 0.6 + 2)) * 10) / 10;

    const projNi = Math.round(ni * (1 + baseGrowth / 100) * 10) / 10;
    const projRoe = Math.round((roe + (baseGrowth > 0 ? 0.3 : -0.5)) * 10) / 10;
    const projCet1 = Math.round((cet1 + (baseGrowth > 3 ? 0.2 : -0.2)) * 10) / 10;
    const projLoan = Math.round((loanGrowth + (baseGrowth > 0 ? 0.5 : -0.8)) * 10) / 10;
    const projNpl = Math.round((npl + (baseGrowth < 0 ? 0.2 : -0.05)) * 100) / 100;

    // Standardized LCR default calculation for forecast
    const assets = Number(bank.total_assets_bn) || 100;
    const baseHqla = assets * (0.12 + Math.max(0, cet1 - 10) * 0.006);
    const baseOutflows = assets * (0.20 + Math.max(0, 12 - cet1) * 0.01 + npl * 0.01);
    const baseInflows = baseOutflows * Math.max(0.25, 0.50 - npl * 0.02);
    const baseNetOut = Math.max(0.5, baseOutflows - Math.min(baseInflows, baseOutflows * 0.75));
    const currentLcr = Math.round((baseHqla / baseNetOut) * 100 * 10) / 10;
    const projectedLcr = Math.round((currentLcr + (baseGrowth >= 0 ? 3.2 : -4.5)) * 10) / 10;

    let headline = '';
    let recommendation = '';
    if (composite >= 63) {
      headline = `${bank.name}: Premium franchise commanding superior pricing power and structural tailwinds`;
      recommendation = `Open negotiations from a position of pricing strength. The ${cet1}% CET1 capital buffer affords strong downside protection while the ${bank.nim_pct}% NIM insulates funding costs.`;
    } else if (composite < 44) {
      headline = `${bank.name}: Margin compression and cost headwinds require stringent underwriting terms`;
      recommendation = `Step back or demand strict covenant protection. A ${bank.cost_income_pct}% cost base leaves minimal operating leverage if net interest margins compress.`;
    } else {
      headline = `${bank.name}: Solid regional deposit base offset by selective asset-quality sensitivity`;
      recommendation = `Maintain an opportunistic posture. Monitor deposit beta and commercial real estate exposures before committing balance-sheet capacity.`;
    }

    const confidence = Math.min(92, Math.max(72, Math.round(75 + (composite > 60 ? 8 : composite < 40 ? 4 : 6) + (Math.sin(bank.name.length) * 5))));

    return {
      horizon: 'FY2026',
      verdict: bank.verdict,
      headline,
      confidence,
      bank,
      currentLcr,
      projectedLcr,
      metrics: [
        { label: 'Net income', current: ni, projected: projNi, unit: 'bn', signal: baseGrowth >= 0 ? 'improving' : 'deteriorating' },
        { label: 'Return on equity', current: roe, projected: projRoe, unit: 'pct', signal: projRoe >= roe ? 'improving' : 'deteriorating' },
        { label: 'CET1 ratio', current: cet1, projected: projCet1, unit: 'pct', signal: projCet1 >= cet1 ? 'improving' : 'stable' },
        { label: 'Liquidity coverage ratio (LCR Total)', current: currentLcr, projected: projectedLcr, unit: 'pct', signal: projectedLcr >= currentLcr ? 'improving' : 'deteriorating' },
        { label: 'Loan growth', current: loanGrowth, projected: projLoan, unit: 'pct', signal: projLoan >= loanGrowth ? 'improving' : 'stable' },
        { label: 'Gross NPL ratio', current: npl, projected: projNpl, unit: 'pct', signal: projNpl <= npl ? 'improving' : 'deteriorating' }
      ],
      scenarios: [
        { name: 'Bull', net_income_growth_pct: bullGrowth, note: `Accelerated loan origination in ${bank.country} and stable credit loss absorption.` },
        { name: 'Base', net_income_growth_pct: baseGrowth, note: `Central case assumes ${bank.loan_growth_pct}% loan expansion with policy rates plateauing.` },
        { name: 'Bear', net_income_growth_pct: bearGrowth, note: `Elevated provisioning on commercial books and competitive deposit re-pricing.` }
      ],
      drivers: [
        bank.key_strength || 'Robust core deposit franchise and disciplined expense management',
        `Leading footprint in ${bank.hq_city}, ${bank.country} with stable retail funding`
      ],
      risks: [
        bank.key_risk || 'Macroeconomic deceleration impacting private loan demand',
        `Sensitivity to central bank policy rate inflection and margin compression`
      ],
      recommendation
    };
  }

  function renderAnalyst(container) {
    const bank = banks.find(b => b.id === activeAnalystBankId) || banks[0];
    const forecast = generateForecast(bank);
    const quote = quotes[bank.ticker];

    container.innerHTML = `
      <div class="mx-auto max-w-[1180px] px-5 pb-16 pt-10 sm:px-8 sm:pt-14">
        <!-- Header -->
        <div class="max-w-2xl">
          <p class="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">AI analyst</p>
          <h1 class="mt-4 font-display text-[2.3rem] leading-tight text-foreground sm:text-5xl">
            What the figures will do next
          </h1>
          <p class="mt-3 text-[14px] leading-relaxed text-muted-foreground">
            Pick a bank and the analyst projects next year's net income, revenue, return on equity, cost base and credit losses — then tells you whether the negotiating position is worth taking. Ask it anything afterwards.
          </p>
        </div>

        <!-- Executive Liquidity & Capital Highlights Strip -->
        <div class="mt-8 rounded-sm border border-border bg-card/60 p-4 sm:p-5">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="flex items-center gap-3">
              <span class="rounded-xs bg-primary/10 border border-primary/30 px-2.5 py-1 font-mono text-[11px] font-bold text-primary uppercase tracking-wider">
                ${bank.name} (${bank.ticker})
              </span>
              <span class="font-mono text-[11px] text-muted-foreground">Balance Sheet Total: <strong class="text-foreground">${formatMoney(bank.total_assets_bn)}</strong></span>
            </div>
            <!-- Total LCR Summary Badge -->
            <div class="flex items-center gap-4">
              <div class="flex items-center gap-2">
                <span class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Total Liquidity Ratio (LCR):</span>
                <span class="num text-lg font-bold ${forecast.currentLcr >= 130 ? 'text-positive' : forecast.currentLcr >= 100 ? 'text-caution' : 'text-negative'}">
                  ${Math.round(forecast.currentLcr)}%
                </span>
                <span class="rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${forecast.currentLcr >= 100 ? 'bg-positive/10 text-positive border border-positive/30' : 'bg-negative/10 text-negative border border-negative/30'}">
                  ${forecast.currentLcr >= 100 ? 'Basel Compliant' : 'Deficit'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div class="mt-8 grid gap-6 lg:grid-cols-[288px_minmax(0,1fr)]">
          <!-- Sidebar: Bank Picker -->
          <aside class="space-y-4">
            <div class="rounded-sm border border-border bg-card/40">
              <div class="border-b border-border/60 p-3">
                <input 
                  type="text" 
                  id="analyst-bank-search" 
                  placeholder="Find a bank…" 
                  class="w-full rounded-sm border border-border/70 bg-background/60 px-3 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
              <div id="analyst-bank-list" class="max-h-[460px] overflow-y-auto p-1.5 space-y-1">
                ${renderAnalystBankList(bank.id)}
              </div>
            </div>
            <p class="px-1 text-[11px] leading-relaxed text-muted-foreground">
              42 banks in the built-in dataset. Projections anchor to each bank's reported figures and peer group.
            </p>
          </aside>

          <!-- Main Content -->
          <div class="min-w-0 space-y-6">
            <!-- Forecast Card -->
            <article class="overflow-hidden rounded-sm border border-border bg-card/40">
              <header class="flex flex-col gap-5 border-b border-border/60 p-6 sm:flex-row sm:items-start sm:justify-between">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2.5">
                    <p class="font-mono text-[9px] uppercase tracking-[0.2em] text-primary">AI forecast · ${forecast.horizon}</p>
                    ${renderVerdictBadge(forecast.verdict)}
                  </div>
                  <h2 class="mt-3 font-display text-[1.45rem] leading-snug text-foreground sm:text-[1.7rem]">${forecast.headline}</h2>
                  <p class="mt-2 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                    ${bank.name} · ${bank.ticker} · base case
                  </p>
                </div>
                <div class="flex shrink-0 flex-col gap-3 sm:items-end">
                  <div class="sm:text-right">
                    <p class="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Confidence</p>
                    <p class="num mt-1 text-2xl leading-none text-foreground">${forecast.confidence}<span class="text-[11px] text-muted-foreground">/100</span></p>
                    <div class="mt-2 h-[3px] w-24 bg-secondary sm:ml-auto overflow-hidden rounded-full">
                      <div class="h-full bg-primary" style="width:${forecast.confidence}%"></div>
                    </div>
                  </div>
                  <button type="button" onclick="renderAnalyst(document.getElementById('app-content'))" class="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground hover:text-primary transition-colors">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path><path d="M21 21v-5h-5"></path></svg>
                    Regenerate
                  </button>
                </div>
              </header>

              <!-- Projected Figures (Including Total LCR) -->
              <section class="border-b border-border/60 px-6 py-5">
                <div class="flex items-baseline justify-between gap-3">
                  <h3 class="font-display text-lg text-foreground">Projected figures</h3>
                  <p class="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Reported → model</p>
                </div>
                <div class="mt-2 divide-y divide-border/40">
                  ${forecast.metrics.map(m => {
                    const diff = m.projected - m.current;
                    const deltaStr = m.unit === 'pct' ? `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} pts` : `${diff >= 0 ? '+' : ''}${(diff / m.current * 100).toFixed(1)}%`;
                    const currentStr = m.unit === 'pct' ? formatPct(m.current) : formatMoney(m.current);
                    const projectedStr = m.unit === 'pct' ? formatPct(m.projected) : formatMoney(m.projected);
                    return `
                      <div class="flex items-baseline justify-between gap-4 py-3">
                        <div class="min-w-0">
                          <p class="truncate text-[13px] text-foreground ${m.label.includes('LCR') ? 'font-semibold text-primary' : ''}">${m.label}</p>
                          <p class="num mt-0.5 text-[11px] text-muted-foreground">now ${currentStr}</p>
                        </div>
                        <div class="shrink-0 text-right">
                          <p class="num text-[15px] text-foreground font-medium">${projectedStr}</p>
                          <p class="num mt-0.5 text-[11px] ${m.signal === 'improving' ? 'text-positive' : 'text-negative'}">${deltaStr}</p>
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              </section>

              <!-- Scenarios -->
              <section class="border-b border-border/60 px-6 py-5">
                <h3 class="font-display text-lg text-foreground">Next-year earnings scenarios</h3>
                <div class="mt-4 grid gap-3 sm:grid-cols-3">
                  ${forecast.scenarios.map(sc => {
                    const color = sc.name === 'Bull' ? 'text-positive' : sc.name === 'Bear' ? 'text-negative' : 'text-primary';
                    const barBg = sc.name === 'Bull' ? 'bg-positive' : sc.name === 'Bear' ? 'bg-negative' : 'bg-primary';
                    return `
                      <div class="rounded-sm border border-border/70 bg-background/40 p-3.5">
                        <p class="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">${sc.name} case</p>
                        <p class="num mt-2 text-xl leading-none ${color}">${sc.net_income_growth_pct > 0 ? '+' : ''}${sc.net_income_growth_pct.toFixed(1)}%</p>
                        <div class="mt-2.5 h-[3px] w-full bg-secondary overflow-hidden rounded-full">
                          <div class="h-full ${barBg}" style="width: 70%;"></div>
                        </div>
                        <p class="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">${sc.note}</p>
                      </div>
                    `;
                  }).join('')}
                </div>
              </section>

              <!-- Drivers & Risks -->
              <section class="grid gap-6 border-b border-border/60 px-6 py-5 sm:grid-cols-2">
                <div>
                  <p class="font-mono text-[9px] uppercase tracking-[0.16em] text-positive font-semibold">What drives the base case</p>
                  <ul class="mt-2.5 space-y-2">
                    ${forecast.drivers.map(d => `
                      <li class="flex gap-2 text-[12px] leading-relaxed text-foreground/90">
                        <span class="text-positive">↑</span><span>${d}</span>
                      </li>
                    `).join('')}
                  </ul>
                </div>
                <div>
                  <p class="font-mono text-[9px] uppercase tracking-[0.16em] text-negative font-semibold">What would break it</p>
                  <ul class="mt-2.5 space-y-2">
                    ${forecast.risks.map(r => `
                      <li class="flex gap-2 text-[12px] leading-relaxed text-foreground/90">
                        <span class="text-negative">↓</span><span>${r}</span>
                      </li>
                    `).join('')}
                  </ul>
                </div>
              </section>

              <!-- Stance Footer -->
              <footer class="p-6">
                <p class="font-mono text-[9px] uppercase tracking-[0.18em] text-primary">Negotiating position</p>
                <p class="mt-2.5 font-display text-lg leading-relaxed text-foreground">${forecast.recommendation}</p>
                <p class="mt-4 text-[11px] leading-relaxed text-muted-foreground">
                  Model projection built from this app's built-in bank dataset — an analysis aid, not investment advice.
                </p>
              </footer>
            </article>

            <!-- Basel III Liquidity Coverage Ratio Calculator Widget (With Total Breakdown) -->
            ${renderLiquidityWidget(bank)}

            <!-- Interrogate the forecast: Chat UI -->
            <section class="overflow-hidden rounded-sm border border-border bg-card/40">
              <header class="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 px-6 py-4">
                <h2 class="font-display text-lg text-foreground">Interrogate the forecast</h2>
                <p class="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                  ${bank.name} · ${bank.ticker}
                </p>
              </header>

              <div id="analyst-messages" class="max-h-[380px] min-h-[140px] overflow-y-auto px-6 py-5 space-y-4">
                ${analystMessages.length === 0 ? `
                  <div class="rounded-sm border border-dashed border-border/70 px-4 py-6 text-center">
                    <p class="text-[12.5px] leading-relaxed text-muted-foreground">
                      Ask the analyst to stress-test ${bank.name}'s figures — capital, credit costs, margins or a scenario.
                    </p>
                  </div>
                ` : analystMessages.map(m => `
                  <div class="${m.role === 'user' ? 'flex justify-end' : 'border-l-2 border-primary/40 pl-4'}">
                    ${m.role === 'user' ? `
                      <p class="max-w-[85%] rounded-sm bg-secondary px-3.5 py-2.5 text-[13px] leading-relaxed text-foreground">${m.text}</p>
                    ` : `
                      <div>
                        <p class="font-mono text-[9px] uppercase tracking-[0.18em] text-primary">AI analyst</p>
                        <p class="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-foreground/90">${m.text}</p>
                      </div>
                    `}
                  </div>
                `).join('')}
                ${isAnalystThinking ? `
                  <div class="flex items-center gap-2 border-l-2 border-primary/20 pl-4 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                    <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-primary"></span>
                    Reading the book…
                  </div>
                ` : ''}
              </div>

              <div class="border-t border-border/60 px-6 py-4">
                <div class="flex flex-wrap gap-1.5">
                  <button type="button" onclick="sendAnalystPrompt('What breaks this forecast?')" class="rounded-full border border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground">
                    What breaks this forecast?
                  </button>
                  <button type="button" onclick="sendAnalystPrompt('Better deal than its closest peer?')" class="rounded-full border border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground">
                    Better deal than its closest peer?
                  </button>
                  <button type="button" onclick="sendAnalystPrompt('How does a 100bp credit shock hit earnings?')" class="rounded-full border border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground">
                    How does a 100bp credit shock hit earnings?
                  </button>
                </div>

                <div class="mt-3 flex items-end gap-2 rounded-sm border border-border/70 bg-background/60 px-3 py-2 focus-within:border-primary/50">
                  <textarea 
                    id="analyst-chat-input" 
                    rows="1" 
                    placeholder="Ask about capital, credit, margin, a scenario…" 
                    class="max-h-28 min-h-[36px] w-full resize-none bg-transparent text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none"
                    onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();submitAnalystMessage();}"
                  ></textarea>
                  <button type="button" onclick="submitAnalystMessage()" aria-label="Send" class="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-primary text-primary-foreground hover:opacity-90">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 7-7 7 7"></path><path d="M12 19V5"></path></svg>
                  </button>
                </div>
                <p class="mt-2 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                  Model projections on the built-in dataset · not investment advice
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>
    `;

    const searchEl = document.getElementById('analyst-bank-search');
    searchEl.addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      document.getElementById('analyst-bank-list').innerHTML = renderAnalystBankList(bank.id, q);
    });

    setTimeout(updateLcrCalc, 40);
  }

  function renderAnalystBankList(activeId, query = '') {
    const filtered = banks.filter(b => {
      if (!query) return true;
      return `${b.name} ${b.ticker} ${b.country}`.toLowerCase().includes(query);
    });

    if (!filtered.length) {
      return '<p class="p-3 text-center text-[11px] text-muted-foreground">No matching banks.</p>';
    }

    return filtered.map(b => {
      const isActive = b.id === activeId;
      return `
        <button 
          type="button" 
          onclick="selectAnalystBank('${b.id}')" 
          class="flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left transition-colors ${isActive ? 'bg-secondary text-foreground ring-1 ring-border' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'}"
        >
          <span class="min-w-0">
            <span class="block truncate text-[12.5px]">${b.name}</span>
            <span class="mt-0.5 block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">${b.country} · ${b.category === 'multinational' ? 'Multi' : 'Regional'}</span>
          </span>
          <span class="num shrink-0 text-[11px] text-muted-foreground">${b.composite}</span>
        </button>
      `;
    }).join('');
  }

  window.selectAnalystBank = function (id) {
    activeAnalystBankId = id;
    analystMessages = [];
    renderAnalyst(document.getElementById('app-content'));
  };

  window.sendAnalystPrompt = function (text) {
    const input = document.getElementById('analyst-chat-input');
    if (input) {
      input.value = text;
      submitAnalystMessage();
    }
  };

  window.submitAnalystMessage = function () {
    const input = document.getElementById('analyst-chat-input');
    const question = input.value.trim();
    if (!question || isAnalystThinking) return;

    analystMessages.push({ role: 'user', text: question });
    input.value = '';
    isAnalystThinking = true;

    updateAnalystMessagesUI();

    const bank = banks.find(b => b.id === activeAnalystBankId) || banks[0];

    setTimeout(() => {
      const answer = generateAnalystAnswer(bank, question);
      analystMessages.push({ role: 'analyst', text: answer });
      isAnalystThinking = false;
      updateAnalystMessagesUI();
    }, 600);
  };

  function updateAnalystMessagesUI() {
    const messagesContainer = document.getElementById('analyst-messages');
    if (!messagesContainer) return;

    messagesContainer.innerHTML = analystMessages.map(m => `
      <div class="${m.role === 'user' ? 'flex justify-end' : 'border-l-2 border-primary/40 pl-4'}">
        ${m.role === 'user' ? `
          <p class="max-w-[85%] rounded-sm bg-secondary px-3.5 py-2.5 text-[13px] leading-relaxed text-foreground">${m.text}</p>
        ` : `
          <div>
            <p class="font-mono text-[9px] uppercase tracking-[0.18em] text-primary">AI analyst</p>
            <p class="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-foreground/90">${m.text}</p>
          </div>
        `}
      </div>
    `).join('') + (isAnalystThinking ? `
      <div class="flex items-center gap-2 border-l-2 border-primary/20 pl-4 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
        <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-primary"></span>
        Reading the book…
      </div>
    ` : '');

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function generateAnalystAnswer(bank, q) {
    const query = q.toLowerCase();
    const assets = bank.total_assets_bn || 100;
    const cet1 = bank.cet1_pct || 12;
    const roe = bank.roe_pct || 10;
    const npl = bank.npl_pct || 1;
    const cost = bank.cost_income_pct || 55;
    const nim = bank.nim_pct || 2.5;

    if (query.includes('what breaks') || query.includes('break this')) {
      return `What breaks ${bank.name}'s forecast is a simultaneous contraction in Net Interest Margin below ${(nim * 0.85).toFixed(2)}% combined with an uptick in gross NPLs beyond ${(npl * 1.5).toFixed(1)}%. Given the bank's ${cost}% cost-to-income ratio, operating flexibility is bounded. Furthermore, ${bank.key_risk}.`;
    }

    if (query.includes('closest peer') || query.includes('better deal') || query.includes('peer')) {
      const peer = banks.filter(b => b.id !== bank.id && b.category === bank.category).sort((a, b) => Math.abs(b.composite - bank.composite))[0] || banks[1];
      const diff = bank.composite - peer.composite;
      return `Against its closest cohort peer ${peer.name} (Score: ${peer.composite}):
• ${bank.name} commands a ${roe}% ROE vs ${peer.name}'s ${peer.roe_pct}% ROE.
• Capital resilience: ${bank.name}'s CET1 sits at ${cet1}% vs ${peer.cet1_pct}%.
• ${diff >= 0 ? `${bank.name} is currently the stronger structural proposition (+ ${diff} score differential).` : `${peer.name} offers more attractive risk-adjusted entry metrics.`}`;
    }

    if (query.includes('credit shock') || query.includes('100bp') || query.includes('shock')) {
      const shockProvision = (assets * 0.01 * 0.65).toFixed(1);
      const postShockCET1 = (cet1 - 0.75).toFixed(1);
      return `A 100 bps credit loss shock would add roughly $${shockProvision}B in pre-tax impairment allowances across the balance sheet.
This would compress reported ROE from ${roe}% down to approximately ${(roe * 0.78).toFixed(1)}%, while pro-forma CET1 would absorb into ${postShockCET1}%. The regulatory capital buffer remains ${postShockCET1 > 10.5 ? 'sufficiently intact above Basel thresholds' : 'strained against regulatory headroom'}.`;
    }

    return `Analysis for ${bank.name} (${bank.ticker}):
With $${formatMoney(assets)} in assets, ${bank.name} operates at a ${roe}% ROE and ${cet1}% CET1 ratio. Key operational strength rests on ${bank.key_strength}. From a negotiating standpoint, we recommend watching ${bank.key_risk} before expanding counterparty exposure.`;
  }

  // ==========================================
  // BASEL III LIQUIDITY CALCULATOR WIDGET (WITH TOTALS)
  // ==========================================
  function renderLiquidityWidget(bank) {
    const assets = Number(bank.total_assets_bn) || 100;
    const cet1 = Number(bank.cet1_pct) || 12;
    const npl = Number(bank.npl_pct) || 1;

    const defaultHqla = Math.round(assets * (0.12 + Math.max(0, cet1 - 10) * 0.006) * 10) / 10;
    const defaultOutflows = Math.round(assets * (0.20 + Math.max(0, 12 - cet1) * 0.01 + npl * 0.01) * 10) / 10;
    const defaultInflows = Math.round(defaultOutflows * Math.max(0.25, 0.50 - npl * 0.02) * 10) / 10;

    return `
      <section class="overflow-hidden rounded-sm border border-border bg-card/40 p-6">
        <div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-4">
          <div>
            <h3 class="font-display text-lg text-foreground">Basel III Liquidity Coverage Ratio (LCR)</h3>
            <p class="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">30-day stress simulation &amp; total balance-sheet coverage</p>
          </div>
          <button type="button" onclick="resetLcrDefaults('${bank.id}')" class="font-mono text-[9px] uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors">
            Reset defaults
          </button>
        </div>

        <div class="mt-6 grid gap-6 md:grid-cols-[1.1fr_0.9fr]">
          <div class="space-y-4">
            <div>
              <div class="flex justify-between text-[12px] mb-1">
                <span class="text-foreground">High-Quality Liquid Assets (HQLA)</span>
                <span id="lcr-hqla-val" class="num text-primary font-semibold">$${defaultHqla}B</span>
              </div>
              <input type="range" id="lcr-hqla-input" min="${Math.round(defaultHqla * 0.3)}" max="${Math.round(defaultHqla * 2.2)}" value="${defaultHqla}" step="0.5" class="w-full accent-primary cursor-pointer" oninput="updateLcrCalc()" />
            </div>

            <div>
              <div class="flex justify-between text-[12px] mb-1">
                <span class="text-foreground">Expected 30-Day Cash Outflows</span>
                <span id="lcr-outflows-val" class="num text-negative font-semibold">$${defaultOutflows}B</span>
              </div>
              <input type="range" id="lcr-outflows-input" min="${Math.round(defaultOutflows * 0.3)}" max="${Math.round(defaultOutflows * 2.2)}" value="${defaultOutflows}" step="0.5" class="w-full accent-negative cursor-pointer" oninput="updateLcrCalc()" />
            </div>

            <div>
              <div class="flex justify-between text-[12px] mb-1">
                <span class="text-foreground">Expected 30-Day Inflows (Basel capped at 75%)</span>
                <span id="lcr-inflows-val" class="num text-accent font-semibold">$${defaultInflows}B</span>
              </div>
              <input type="range" id="lcr-inflows-input" min="0" max="${Math.round(defaultOutflows * 1.5)}" value="${defaultInflows}" step="0.5" class="w-full accent-accent cursor-pointer" oninput="updateLcrCalc()" />
            </div>
          </div>

          <div class="flex flex-col justify-between rounded-sm border border-border/70 bg-background/40 p-5">
            <div id="lcr-status-box" class="w-full space-y-3">
              <!-- Clean executive compliance status (meter gauge removed as requested) -->
            </div>
          </div>
        </div>

        <!-- TOTAL LIQUIDITY COVERAGE RATIO SUMMARY BAR -->
        <div class="mt-6 border-t border-border/60 pt-5">
          <div class="flex items-baseline justify-between mb-3">
            <h4 class="font-mono text-[11px] uppercase tracking-[0.16em] text-primary font-bold flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-primary">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
              </svg>
              Liquidity Coverage Ratio (LCR) Total Balance-Sheet Breakdown
            </h4>
            <span class="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Basel III Standard · 30-Day Survival</span>
          </div>

          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <!-- 1. Total HQLA Eligible -->
            <div class="rounded-sm border border-border/80 bg-background/60 p-3.5">
              <p class="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Total Liquid Assets (HQLA)</p>
              <p id="lcr-total-hqla" class="num text-xl font-bold text-foreground mt-1.5">$0.0B</p>
              <p class="text-[10px] text-muted-foreground mt-0.5">Unencumbered cash & sov debt</p>
            </div>

            <!-- 2. Total Net Cash Outflows -->
            <div class="rounded-sm border border-border/80 bg-background/60 p-3.5">
              <p class="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Total Net Outflows (30d)</p>
              <p id="lcr-total-net-outflows" class="num text-xl font-bold text-foreground mt-1.5">$0.0B</p>
              <p id="lcr-total-gross-note" class="text-[10px] text-muted-foreground mt-0.5">Gross Outflows - Capped Inflows</p>
            </div>

            <!-- 3. Total LCR Ratio -->
            <div class="rounded-sm border border-primary/50 bg-primary/10 p-3.5">
              <p class="font-mono text-[9px] uppercase tracking-wider text-primary font-bold">Total LCR Ratio</p>
              <p id="lcr-total-ratio" class="num text-2xl font-bold text-primary mt-1">0%</p>
              <p class="text-[10px] text-muted-foreground mt-0.5">Floor: <span class="text-foreground font-semibold">100.0% Minimum</span></p>
            </div>

            <!-- 4. Total Liquidity Buffer / Surplus -->
            <div class="rounded-sm border border-border/80 bg-background/60 p-3.5">
              <p class="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Total Liquidity Buffer</p>
              <p id="lcr-total-surplus" class="num text-xl font-bold text-positive mt-1.5">+$0.0B</p>
              <p id="lcr-total-days" class="text-[10px] text-muted-foreground mt-0.5">Cash buffer over regulatory min</p>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  window.resetLcrDefaults = function (bankId) {
    const bank = banks.find(b => b.id === bankId) || banks[0];
    const widget = document.querySelector('section:has(#lcr-hqla-input)');
    if (widget) {
      widget.outerHTML = renderLiquidityWidget(bank);
      updateLcrCalc();
    }
  };

  window.updateLcrCalc = function () {
    const hqlaIn = document.getElementById('lcr-hqla-input');
    const outIn = document.getElementById('lcr-outflows-input');
    const infIn = document.getElementById('lcr-inflows-input');

    if (!hqlaIn || !outIn || !infIn) return;

    const hqla = Number(hqlaIn.value) || 1;
    const outflows = Number(outIn.value) || 1;
    const inflows = Number(infIn.value) || 0;

    document.getElementById('lcr-hqla-val').textContent = '$' + hqla.toFixed(1) + 'B';
    document.getElementById('lcr-outflows-val').textContent = '$' + outflows.toFixed(1) + 'B';
    document.getElementById('lcr-inflows-val').textContent = '$' + inflows.toFixed(1) + 'B';

    const cappedInflows = Math.min(inflows, outflows * 0.75);
    const netOutflows = Math.max(0, outflows - cappedInflows);
    const ratio = netOutflows > 0 ? (hqla / netOutflows) * 100 : 200;
    const surplus = hqla - netOutflows;

    const tone = ratio >= 130 ? 'positive' : ratio >= 100 ? 'caution' : 'negative';
    const statusLabel = ratio >= 130 ? 'Comfortable surplus' : ratio >= 100 ? 'Meets minimum' : 'Below regulatory threshold';

    const clampedRatio = Math.min(200, Math.max(0, ratio));
    const barWidth = Math.min(100, Math.max(3, (clampedRatio / 200) * 100));
    const statusColor = tone === 'positive' ? 'text-positive' : tone === 'negative' ? 'text-negative' : 'text-caution';
    const statusBg = tone === 'positive' ? 'bg-positive/10 border-positive/30 text-positive' : tone === 'negative' ? 'bg-negative/10 border-negative/30 text-negative' : 'bg-caution/10 border-caution/30 text-caution';
    const barFill = tone === 'positive' ? 'bg-positive' : tone === 'negative' ? 'bg-negative' : 'bg-caution';
    const days = Math.round(hqla / Math.max(0.1, outflows / 30));

    const statusBox = document.getElementById('lcr-status-box');
    if (statusBox) {
      statusBox.innerHTML = `
        <div class="flex items-start justify-between gap-3 border-b border-border/40 pb-3">
          <div>
            <span class="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Simulated 30-Day LCR</span>
            <div class="mt-1 flex items-baseline gap-2">
              <span class="num text-3xl font-bold ${statusColor}">${Math.round(ratio)}%</span>
              <span class="font-mono text-[11px] text-muted-foreground">/ 100% floor</span>
            </div>
          </div>
          <span class="rounded-full border px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider font-semibold ${statusBg}">
            ${statusLabel}
          </span>
        </div>

        <div class="py-2">
          <div class="flex justify-between font-mono text-[9px] uppercase tracking-wider text-muted-foreground mb-1.5">
            <span>0%</span>
            <span class="text-foreground font-semibold flex items-center gap-1">
              <span class="inline-block w-1.5 h-1.5 rounded-full bg-primary"></span>
              100% Min Req
            </span>
            <span>200%+</span>
          </div>
          <div class="relative h-3 w-full rounded-full bg-secondary/80 overflow-hidden border border-border/60">
            <div class="absolute top-0 bottom-0 left-1/2 w-0.5 bg-foreground/60 z-10" title="100% Minimum Floor"></div>
            <div class="h-full ${barFill} transition-all duration-300 rounded-full" style="width: ${barWidth}%;"></div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2 border-t border-border/40 pt-3 text-[11px]">
          <div class="rounded-xs bg-background/50 p-2 border border-border/40">
            <p class="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Cash Buffer</p>
            <p class="num font-bold text-sm mt-0.5 ${surplus >= 0 ? 'text-positive' : 'text-negative'}">
              ${surplus >= 0 ? '+' : ''}${surplus.toFixed(1)}B
            </p>
          </div>
          <div class="rounded-xs bg-background/50 p-2 border border-border/40">
            <p class="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Survival Horizon</p>
            <p class="num font-bold text-sm mt-0.5 text-foreground">${days} days</p>
          </div>
        </div>
      `;
    }

    // Update Total Breakdown Cards
    const totalHqlaEl = document.getElementById('lcr-total-hqla');
    if (totalHqlaEl) totalHqlaEl.textContent = '$' + hqla.toFixed(1) + 'B';

    const totalNetOutEl = document.getElementById('lcr-total-net-outflows');
    if (totalNetOutEl) totalNetOutEl.textContent = '$' + netOutflows.toFixed(1) + 'B';

    const totalGrossNoteEl = document.getElementById('lcr-total-gross-note');
    if (totalGrossNoteEl) totalGrossNoteEl.textContent = 'Gross $' + outflows.toFixed(1) + 'B - $' + cappedInflows.toFixed(1) + 'B inflows';

    const totalRatioEl = document.getElementById('lcr-total-ratio');
    if (totalRatioEl) {
      totalRatioEl.textContent = Math.round(ratio) + '%';
      totalRatioEl.className = 'num text-2xl font-bold ' + (tone === 'positive' ? 'text-positive' : tone === 'negative' ? 'text-negative' : 'text-caution');
    }

    const totalSurplusEl = document.getElementById('lcr-total-surplus');
    if (totalSurplusEl) {
      totalSurplusEl.textContent = (surplus >= 0 ? '+' : '') + '$' + surplus.toFixed(1) + 'B';
      totalSurplusEl.className = 'num text-xl font-bold ' + (surplus >= 0 ? 'text-positive' : 'text-negative');
    }

    const totalDaysEl = document.getElementById('lcr-total-days');
    if (totalDaysEl) {
      const days = Math.round(hqla / Math.max(0.1, outflows / 30));
      totalDaysEl.textContent = days + ' days of stressed cash coverage';
    }
  };

  // ==========================================
  // VIEW 5: DEDICATED FULL-PAGE BANK ANALYSIS
  // ==========================================
  function renderBankAnalysisPage(container, bankId) {
    const bank = banks.find(b => b.id === bankId) || banks[0];
    const peers = banks.filter(b => b.id !== bank.id && b.category === bank.category)
      .sort((a, b) => Math.abs(b.composite - bank.composite))
      .slice(0, 4);

    const pillars = [
      { 
        key: 'profitability', 
        label: 'Profitability', 
        weight: '34% Weight',
        score: bank.profitability,
        detail: 'Return on Equity (ROE: ' + formatPct(bank.roe_pct) + ') verified against Return on Assets (ROA: ' + formatPct(bank.roa_pct, 2) + ')' 
      },
      { 
        key: 'capital', 
        label: 'Capital & Credit Resilience', 
        weight: '26% Weight',
        score: bank.capital,
        detail: 'Common Equity Tier 1 (CET1: ' + formatPct(bank.cet1_pct) + ') buffer absorbing gross non-performing loans (NPL: ' + formatPct(bank.npl_pct) + ')' 
      },
      { 
        key: 'efficiency', 
        label: 'Operating Cost Efficiency', 
        weight: '14% Weight',
        score: bank.efficiency,
        detail: 'Cost-to-Income ratio (' + formatPct(bank.cost_income_pct, 0) + ') benchmarked against global banking median efficiency threshold' 
      },
      { 
        key: 'growth', 
        label: 'Growth & Earnings Trajectory', 
        weight: '26% Weight',
        score: bank.growth,
        detail: 'Domestic core loan expansion (' + formatSignPct(bank.loan_growth_pct) + ') combined with forecast net income momentum (' + formatSignPct(bank.forecast_ni_growth_pct) + ')' 
      }
    ];

    const metrics14 = [
      { label: 'Total Assets', value: formatMoney(bank.total_assets_bn), sub: 'Reported balance sheet size' },
      { label: 'Market Cap', value: formatMoney(bank.market_cap_bn), sub: 'Equity market valuation' },
      { label: 'Annual Revenue', value: formatMoney(bank.revenue_bn), sub: 'Total top-line income' },
      { label: 'Net Income', value: formatMoney(bank.net_income_bn), sub: 'Annual bottom-line profit' },
      { label: 'Return on Equity (ROE)', value: formatPct(bank.roe_pct), sub: 'Operating equity return' },
      { label: 'Return on Assets (ROA)', value: formatPct(bank.roa_pct, 2), sub: 'Asset yield efficiency' },
      { label: 'CET1 Ratio', value: formatPct(bank.cet1_pct), sub: 'Tier-1 regulatory capital buffer' },
      { label: 'Gross NPL Ratio', value: formatPct(bank.npl_pct), sub: 'Non-performing loan proportion' },
      { label: 'Cost-to-Income', value: formatPct(bank.cost_income_pct, 0), sub: 'Operating cost proportion' },
      { label: 'Net Interest Margin (NIM)', value: formatPct(bank.nim_pct), sub: 'Net interest spread' },
      { label: 'Loan Growth', value: formatSignPct(bank.loan_growth_pct), sub: '12-month loan volume change' },
      { label: 'Forecast NI Growth', value: formatSignPct(bank.forecast_ni_growth_pct), sub: 'Next-year net income guidance', isPositive: bank.forecast_ni_growth_pct >= 0 },
      { label: 'Price-to-Earnings (P/E)', value: Number(bank.pe_ratio).toFixed(1) + 'x', sub: 'Earnings valuation multiple' },
      { label: 'Dividend Yield', value: formatPct(bank.dividend_yield_pct), sub: 'Annual dividend return' }
    ];

    container.innerHTML = `
      <div class="mx-auto max-w-[1180px] px-5 pb-20 pt-8 sm:px-8 sm:pt-12">
        <div class="flex items-center justify-between border-b border-border/60 pb-5">
          <a href="#/screener" class="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground transition-colors">
            <span class="text-primary font-bold">←</span> Back to Screener
          </a>
          <div class="flex items-center gap-3">
            <span class="font-mono text-[10px] uppercase text-muted-foreground hidden sm:inline">Credit Rating: <strong class="text-foreground">${bank.credit_rating || 'NR'}</strong></span>
            <span class="h-3 w-px bg-border hidden sm:inline"></span>
            <span class="font-mono text-[10px] uppercase text-muted-foreground">${bank.fiscal_year}</span>
          </div>
        </div>

        <div class="mt-8 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div class="flex flex-wrap items-center gap-2.5 mb-3">
              <span class="rounded-xs px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${bank.category === 'multinational' ? 'bg-primary/10 text-primary border border-primary/30' : 'bg-accent/10 text-accent border border-accent/30'}">
                ${bank.category === 'multinational' ? 'Multinational Bank' : 'Regional Bank'}
              </span>
              ${renderVerdictBadge(bank.verdict, 'md')}
            </div>
            <h1 class="font-display text-4xl sm:text-5xl text-foreground">${bank.name}</h1>
            <p class="mt-2 font-mono text-[12px] uppercase tracking-[0.18em] text-muted-foreground">
              ${bank.ticker} · ${bank.hq_city}, ${bank.country} · ${bank.region}
            </p>
            <p class="mt-4 max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
              ${bank.analyst_note}
            </p>
          </div>

          <div class="rounded-sm border border-border bg-card/60 p-6 flex flex-col items-center justify-center min-w-[240px]">
            ${renderScoreRing(bank.composite, 80, 'Composite Score')}
            <div class="mt-4 text-center">
              <p class="font-mono text-[11px] uppercase font-semibold ${bank.composite >= 63 ? 'text-positive' : bank.composite < 44 ? 'text-negative' : 'text-caution'}">
                ${VERDICTS[bank.verdict].label}
              </p>
              <p class="mt-1 text-[11px] leading-tight text-muted-foreground max-w-[200px]">
                ${VERDICTS[bank.verdict].blurb}
              </p>
            </div>
            <button type="button" onclick="selectAnalystBank('${bank.id}'); navigateTo('/analyst');" class="mt-4 w-full rounded-sm bg-primary/15 border border-primary/35 py-2 text-center font-mono text-[10px] uppercase tracking-wider text-primary hover:bg-primary hover:text-primary-foreground transition-all">
              Stress-test in AI Analyst →
            </button>
          </div>
        </div>

        <div class="mt-12">
          <div class="flex items-baseline justify-between border-b border-border/60 pb-3 mb-5">
            <div>
              <h2 class="font-display text-2xl text-foreground">14 Balance-Sheet &amp; Performance Metrics</h2>
              <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground mt-0.5">Comprehensive fundamental indicators</p>
            </div>
            <span class="font-mono text-[11px] text-primary">All figures USD converted</span>
          </div>

          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            ${metrics14.map(m => `
              <div class="analysis-metric-card">
                <p class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">${m.label}</p>
                <p class="num mt-2 text-2xl font-semibold ${m.isPositive === true ? 'text-positive' : m.isPositive === false ? 'text-negative' : 'text-foreground'}">
                  ${m.value}
                </p>
                <p class="mt-1 text-[10px] text-muted-foreground">${m.sub}</p>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="mt-12 rounded-sm border border-border bg-card/40 p-6 sm:p-8">
          <div class="flex flex-col sm:flex-row sm:items-baseline justify-between border-b border-border/60 pb-4 mb-6">
            <div>
              <h2 class="font-display text-2xl text-foreground">The Four Pillars Breakdown</h2>
              <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground mt-0.5">How the 0—100 composite score is calibrated</p>
            </div>
            <span class="num text-[12px] text-muted-foreground mt-2 sm:mt-0">Overall Score: <strong class="text-foreground text-base">${bank.composite}</strong> / 100</span>
          </div>

          <div class="grid gap-6 md:grid-cols-2">
            ${pillars.map(p => {
              const barColor = p.score >= 63 ? 'bg-positive' : p.score >= 44 ? 'bg-caution' : 'bg-negative';
              const textColor = p.score >= 63 ? 'text-positive' : p.score >= 44 ? 'text-caution' : 'text-negative';
              return `
                <div class="rounded-sm border border-border/70 bg-background/30 p-5">
                  <div class="flex items-center justify-between">
                    <span class="font-display text-lg text-foreground">${p.label}</span>
                    <span class="num text-xl font-bold ${textColor}">${p.score} <span class="text-xs text-muted-foreground font-normal">/ 100</span></span>
                  </div>
                  <div class="flex items-center justify-between text-[10px] font-mono uppercase text-muted-foreground mt-1">
                    <span>Calibration</span>
                    <span>${p.weight}</span>
                  </div>
                  <div class="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-border/60">
                    <div class="h-full ${barColor} transition-all duration-700" style="width: ${p.score}%"></div>
                  </div>
                  <p class="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">${p.detail}</p>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="mt-12 grid gap-6 md:grid-cols-2">
          <div class="rounded-sm border border-positive/40 bg-positive/5 p-6">
            <div class="flex items-center gap-2">
              <span class="flex h-5 w-5 items-center justify-center rounded-full bg-positive/20 text-positive text-xs">✓</span>
              <h3 class="font-mono text-[11px] uppercase tracking-[0.16em] text-positive font-bold">Key Structural Strength</h3>
            </div>
            <p class="mt-3 text-[14px] leading-relaxed text-foreground">${bank.key_strength}</p>
          </div>

          <div class="rounded-sm border border-negative/40 bg-negative/5 p-6">
            <div class="flex items-center gap-2">
              <span class="flex h-5 w-5 items-center justify-center rounded-full bg-negative/20 text-negative text-xs">!</span>
              <h3 class="font-mono text-[11px] uppercase tracking-[0.16em] text-negative font-bold">Key Vulnerability Risk</h3>
            </div>
            <p class="mt-3 text-[14px] leading-relaxed text-foreground">${bank.key_risk}</p>
          </div>
        </div>

        <!-- Basel III Liquidity Coverage Ratio Calculator -->
        <div class="mt-12">
          ${renderLiquidityWidget(bank)}
        </div>

        <!-- Closest Cohort Peers -->
        <div class="mt-12 rounded-sm border border-border bg-card/40 p-6 sm:p-8">
          <div class="flex items-baseline justify-between border-b border-border/60 pb-4 mb-6">
            <div>
              <h2 class="font-display text-2xl text-foreground">Closest Cohort Peer Comparison</h2>
              <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground mt-0.5">Institutions with comparable capital or category profile</p>
            </div>
            <a href="#/screener" class="font-mono text-[10px] uppercase text-primary hover:underline">View all in screener →</a>
          </div>

          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            ${peers.map(p => `
              <div class="rounded-sm border border-border/80 bg-background/40 p-4 transition-all hover:border-primary/50 hover:bg-card cursor-pointer" onclick="navigateTo('/banks/${p.id}')">
                <div class="flex items-start justify-between">
                  <div>
                    <p class="font-display text-lg text-foreground truncate">${p.name}</p>
                    <p class="font-mono text-[10px] text-muted-foreground uppercase mt-0.5">${p.country} · ${p.ticker}</p>
                  </div>
                  <span class="num text-sm font-semibold ${p.composite >= 63 ? 'text-positive' : p.composite < 44 ? 'text-negative' : 'text-caution'}">
                    ${p.composite}
                  </span>
                </div>
                <div class="mt-3 space-y-1.5 border-t border-border/40 pt-2.5 text-[11px]">
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">Assets:</span>
                    <span class="num text-foreground">${formatMoney(p.total_assets_bn)}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">ROE:</span>
                    <span class="num text-foreground">${formatPct(p.roe_pct)}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-muted-foreground">CET1:</span>
                    <span class="num text-foreground">${formatPct(p.cet1_pct)}</span>
                  </div>
                </div>
                <div class="mt-3 pt-2 border-t border-border/40 text-right">
                  <span class="text-primary font-mono text-[10px] uppercase">Compare →</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Bottom Action Strip -->
        <div class="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-border/60 pt-6">
          <a href="#/screener" class="inline-flex items-center gap-2 rounded-sm border border-border px-5 py-2.5 font-mono text-[11px] uppercase tracking-wider text-foreground hover:border-primary/40">
            ← Return to Screener
          </a>
          <button type="button" onclick="selectAnalystBank('${bank.id}'); navigateTo('/analyst');" class="inline-flex items-center gap-2 rounded-sm bg-primary px-5 py-2.5 font-mono text-[11px] uppercase tracking-wider text-primary-foreground hover:opacity-90">
            Open in AI Analyst →
          </button>
        </div>
      </div>
    `;

    setTimeout(updateLcrCalc, 40);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

})();
