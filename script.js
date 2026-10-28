"use strict";

// Standard normal CDF, using an erf approximation (absolute error < 1.5e-7).
function normalCDF(z) {
  if (z === 0) return 0.5;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return Math.max(0, Math.min(1, (1 + Math.sign(z) * erf) / 2));
}

function validateEstimate(mean, lower, upper, label) {
  if (![mean, lower, upper].every(Number.isFinite)) throw new Error(`${label}：所有欄位都必須填入有效的有限數字。`);
  if (![mean, lower, upper].every(value => value >= 0 && value <= 100)) throw new Error(`${label}：存活率及 CI 上下限皆須在 0–100 之間。`);
  if (!(lower < mean && mean < upper)) throw new Error(`${label}：請確認 95% CI 下限 < 點估計 < 95% CI 上限。`);
  const difference = Math.abs((mean - lower) - (upper - mean));
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(mean), Math.abs(lower), Math.abs(upper)) * 8;
  if (difference > 0.01 + tolerance) throw new Error(`${label}：僅接受對稱的 95% CI：點估計與上下限的距離必須相同。`);
  const originalMean = mean;
  const corrected = difference > tolerance;
  if (corrected) mean = (lower + upper) / 2;
  const se = (upper - lower) / (2 * 1.96);
  if (!(se > 0) || !Number.isFinite(se)) throw new Error(`${label}：信賴區間超出可計算精度。`);
  return { mean, originalMean, corrected, se, label };
}

function calculate(mean, lower, upper, comparison, hospitalLower, hospitalUpper) {
  const reference = validateEstimate(mean, lower, upper, "參考存活率");
  const hospital = validateEstimate(comparison, hospitalLower, hospitalUpper, "本院存活率");
  mean = reference.mean;
  comparison = hospital.mean;
  const se = Math.sqrt(reference.se ** 2 + hospital.se ** 2);
  const z = (comparison - mean) / se;
  const peak = 1 / (se * Math.sqrt(2 * Math.PI));
  const min = Math.min(mean - 4 * se, comparison - 0.5 * se);
  const max = Math.max(mean + 4 * se, comparison + 0.5 * se);
  if (![se, z, peak, min, max, max - min].every(Number.isFinite) || se <= 0 || !(min < max)) throw new Error("數值範圍超出可計算精度，請調整信賴區間。");
  const percentile = normalCDF(z) * 100;
  const pValue = 2 * normalCDF(-Math.abs(z));
  const bandLower = Math.min(95, Math.floor(percentile / 5) * 5);
  const significance = z < -1.9599639845 ? "顯著低於參考存活率" : z > 1.9599639845 ? "顯著高於參考存活率" : "";
  return { mean, comparison, reference, hospital, se, z, peak, min, max, percentile, pValue, bandLower, significance,
    modelLower: mean - 1.96 * se, modelUpper: mean + 1.96 * se };
}

function update() {
  const error = document.getElementById("error");
  const output = document.getElementById("output");
  const correctionNotice = document.getElementById("correction-notice");
  correctionNotice.hidden = true;
  correctionNotice.textContent = "";
  try {
    if (["hospital-lower", "hospital-upper"].some(id => document.getElementById(id).value.trim() === "")) throw new Error("請輸入本院95%信賴區間");
    const values = ["mean", "lower", "upper", "comparison", "hospital-lower", "hospital-upper"].map(id => {
      const input = document.getElementById(id);
      return input.value.trim() === "" ? NaN : Number(input.value);
    });
    const r = calculate(...values);
    const { mean, comparison, modelLower: lower, modelUpper: upper } = r;
    if (!window.Plotly) throw new Error("Plotly.js 未載入，請確認網路連線後重新整理頁面。");
    error.hidden = true;
    output.hidden = false;
    const corrections = [];
    for (const [estimate, id] of [[r.reference, "mean"], [r.hospital, "comparison"]]) {
      if (estimate.corrected) {
        document.getElementById(id).value = String(estimate.mean);
        corrections.push(`${estimate.label}：校正前 ${estimate.originalMean}；校正後 ${estimate.mean}。`);
      }
    }
    if (corrections.length) {
      correctionNotice.textContent = "提示：95%信賴區間上下界與點估計的距離差異不超過0.01，系統已自動將對應存活率校正為上下界的平均值。" + corrections.join(" ");
      correctionNotice.hidden = false;
    }
    const formatSE = value => value.toLocaleString("zh-TW", { maximumSignificantDigits: 6 });
    document.getElementById("se").textContent = formatSE(r.reference.se);
    document.getElementById("hospital-se").textContent = formatSE(r.hospital.se);
    document.getElementById("diff-se").textContent = formatSE(r.se);
    document.getElementById("p-value").textContent = r.pValue === 0 ? "< 0.000001" : r.pValue.toPrecision(6);
    const significance = document.getElementById("significance");
    significance.textContent = r.significance;
    significance.hidden = !r.significance;
    document.getElementById("z").textContent = r.z.toFixed(3);
    document.getElementById("percentile").textContent = `${r.percentile.toFixed(1)}%`;
    const pValueLabel = r.pValue < 0.005 ? "P-value < 0.01" : `P-value = ${r.pValue.toFixed(2)}`;
    document.getElementById("band").textContent = `${r.bandLower}%–${r.bandLower + 5}%, ${pValueLabel}`;
    const density = x => r.peak * Math.exp(-0.5 * ((x - mean) / r.se) ** 2);
    // Sample the bell independently of the expanded axis so distant comparisons
    // cannot remove detail around the mean.
    const x = Array.from({ length: 601 }, (_, i) => mean + (i / 600 * 8 - 4) * r.se);
    const ciX = Array.from({ length: 201 }, (_, i) => lower + (upper - lower) * i / 200);
    const markers = [
      { value: lower, label: "零差異模型<br>95%範圍下限", color: "#738296", dash: "dot", height: 0.85 },
      { value: upper, label: "零差異模型<br>95%範圍上限", color: "#738296", dash: "dot", height: 0.85 },
      { value: mean, label: "年齡調整5年存活率", color: "#237b72", dash: "solid", height: 1.07 },
      { value: comparison, label: "本院存活率", color: "#c67424", dash: "dash", height: 1.28 }
    ];
    Plotly.react("chart", [
      { x: ciX, y: ciX.map(density), type: "scatter", mode: "lines", fill: "tozeroy", fillcolor: "rgba(35,123,114,0.13)", line: { width: 0 }, hoverinfo: "skip", name: "零差異模型95%範圍" },
      { x, y: x.map(density), type: "scatter", mode: "lines", line: { color: "#237b72", width: 3 }, name: "近似抽樣分布", hovertemplate: "平均數：%{x:.4g}<br>機率密度：%{y:.4g}<extra></extra>" }
    ], {
      margin: { t: 65, r: 24, b: 60, l: 65 },
      font: { family: 'system-ui, "Microsoft JhengHei", sans-serif', color: "#435263" },
      xaxis: { title: { text: "存活率, %" }, range: [r.min, r.max], zeroline: false, fixedrange: true },
      yaxis: { title: { text: "機率密度" }, range: [0, r.peak * 1.45], gridcolor: "#edf0f3", zeroline: false, fixedrange: true },
      showlegend: false,
      shapes: markers.map(m => ({ type: "line", x0: m.value, x1: m.value, y0: 0, y1: r.peak * m.height, line: { color: m.color, width: 2, dash: m.dash } })),
      annotations: markers.map(m => ({ x: m.value, y: r.peak * m.height, text: `${m.label}<br>${m.value.toLocaleString("zh-TW", { maximumSignificantDigits: 6 })}`, showarrow: false, yanchor: "bottom", font: { color: m.color, size: 11 } }))
    }, { responsive: true, displayModeBar: false, staticPlot: true });
    document.getElementById("chart").setAttribute("aria-label", `兩組獨立估計值之差異的常態近似模型；參考 ${mean}，零差異模型95%範圍 ${lower} 至 ${upper}，本院 ${comparison}，百分位數 ${r.percentile.toFixed(1)}%。`);
  } catch (e) {
    for (const id of ["se", "hospital-se", "diff-se", "z", "p-value", "percentile", "band"]) document.getElementById(id).textContent = "—";
    document.getElementById("significance").textContent = "";
    document.getElementById("significance").hidden = true;
    correctionNotice.hidden = true;
    correctionNotice.textContent = "";
    if (window.Plotly) Plotly.purge("chart");
    document.getElementById("chart").setAttribute("aria-label", "尚無有效比較結果");
    error.textContent = e.message;
    error.hidden = false;
    output.hidden = true;
  }
}

document.getElementById("parameters").addEventListener("input", update);
document.getElementById("parameters").addEventListener("submit", event => event.preventDefault());
update();
