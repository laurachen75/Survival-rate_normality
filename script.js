"use strict";

// Standard normal CDF, using an erf approximation (absolute error < 1.5e-7).
function normalCDF(z) {
  if (z === 0) return 0.5;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return Math.max(0, Math.min(1, (1 + Math.sign(z) * erf) / 2));
}

function calculate(mean, lower, upper, comparison) {
  if (![mean, lower, upper, comparison].every(Number.isFinite)) throw new Error("所有欄位都必須填入有效的有限數字。");
  if (!(lower < mean && mean < upper)) throw new Error("請確認：95% CI 下限 < 點估計 < 95% CI 上限。");
  const left = mean - lower;
  const right = upper - mean;
  // Allow only rounding noise from floating-point arithmetic, not asymmetric CIs.
  const tolerance = Math.max(left, right) * 1e-10;
  if (Math.abs(left - right) > tolerance) throw new Error("第一版僅接受對稱的 95% CI：點估計與上下限的距離必須相同。");
  const se = (upper - lower) / (2 * 1.96);
  const z = (comparison - mean) / se;
  const peak = 1 / (se * Math.sqrt(2 * Math.PI));
  const min = Math.min(mean - 4 * se, comparison - 0.5 * se);
  const max = Math.max(mean + 4 * se, comparison + 0.5 * se);
  if (![se, z, peak, min, max, max - min].every(Number.isFinite) || se <= 0 || !(min < max)) throw new Error("數值範圍超出可計算精度，請縮小數值或調整信賴區間。");
  const percentile = normalCDF(z) * 100;
  const bandLower = Math.min(95, Math.floor(percentile / 5) * 5);
  return { se, z, peak, min, max, percentile, bandLower };
}

function update() {
  const error = document.getElementById("error");
  const output = document.getElementById("output");
  try {
    const values = ["mean", "lower", "upper", "comparison"].map(id => {
      const input = document.getElementById(id);
      return input.value.trim() === "" ? NaN : Number(input.value);
    });
    const [mean, lower, upper, comparison] = values;
    const r = calculate(...values);
    if (!window.Plotly) throw new Error("Plotly.js 未載入，請確認網路連線後重新整理頁面。");
    error.hidden = true;
    output.hidden = false;
    document.getElementById("se").textContent = r.se.toLocaleString("zh-TW", { maximumSignificantDigits: 6 });
    document.getElementById("z").textContent = r.z.toFixed(3);
    document.getElementById("percentile").textContent = `${r.percentile.toFixed(1)}%`;
    document.getElementById("band").textContent = `${r.bandLower}%–${r.bandLower + 5}%`;
    const density = x => r.peak * Math.exp(-0.5 * ((x - mean) / r.se) ** 2);
    // Sample the bell independently of the expanded axis so distant comparisons
    // cannot remove detail around the mean.
    const x = Array.from({ length: 601 }, (_, i) => mean + (i / 600 * 8 - 4) * r.se);
    const ciX = Array.from({ length: 201 }, (_, i) => lower + (upper - lower) * i / 200);
    const markers = [
      { value: lower, label: "95% CI 下限", color: "#738296", dash: "dot", height: 0.85 },
      { value: upper, label: "95% CI 上限", color: "#738296", dash: "dot", height: 0.85 },
      { value: mean, label: "年齡調整5年存活率", color: "#237b72", dash: "solid", height: 1.07 },
      { value: comparison, label: "本院存活率", color: "#c67424", dash: "dash", height: 1.28 }
    ];
    Plotly.react("chart", [
      { x: ciX, y: ciX.map(density), type: "scatter", mode: "lines", fill: "tozeroy", fillcolor: "rgba(35,123,114,0.13)", line: { width: 0 }, hoverinfo: "skip", name: "95% 信賴區間" },
      { x, y: x.map(density), type: "scatter", mode: "lines", line: { color: "#237b72", width: 3 }, name: "近似抽樣分布", hovertemplate: "平均數：%{x:.4g}<br>機率密度：%{y:.4g}<extra></extra>" }
    ], {
      margin: { t: 65, r: 24, b: 60, l: 65 },
      font: { family: 'system-ui, "Microsoft JhengHei", sans-serif', color: "#435263" },
      xaxis: { title: { text: "平均數" }, range: [r.min, r.max], zeroline: false, fixedrange: true },
      yaxis: { title: { text: "機率密度" }, range: [0, r.peak * 1.45], gridcolor: "#edf0f3", zeroline: false, fixedrange: true },
      showlegend: false,
      shapes: markers.map(m => ({ type: "line", x0: m.value, x1: m.value, y0: 0, y1: r.peak * m.height, line: { color: m.color, width: 2, dash: m.dash } })),
      annotations: markers.map(m => ({ x: m.value, y: r.peak * m.height, text: `${m.label}<br>${m.value}`, showarrow: false, yanchor: "bottom", font: { color: m.color, size: 11 } }))
    }, { responsive: true, displayModeBar: false, staticPlot: true });
    document.getElementById("chart").setAttribute("aria-label", `點估計 ${mean}，95% CI ${lower} 至 ${upper}，比較平均數 ${comparison}，百分位數 ${r.percentile.toFixed(1)}%。`);
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
    output.hidden = true;
  }
}

document.getElementById("parameters").addEventListener("input", update);
document.getElementById("parameters").addEventListener("submit", event => event.preventDefault());
update();
