// ---------- Config ----------
const DATA_PATH = "weather.csv"; // change if your CSV lives elsewhere
const t = 800;
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const margin = { top: 60, right: 40, bottom: 60, left: 80 };
const width = 800 - margin.left - margin.right;
const height = 560 - margin.top - margin.bottom;

const REGION_STATES = {
  Northeast: ["CT","ME","MA","NH","RI","VT","NJ","NY","PA"],
  Midwest: ["IL","IN","MI","OH","WI","IA","KS","MN","MO","NE","ND","SD"],
  South: ["DE","FL","GA","MD","NC","SC","VA","DC","WV","AL","KY","MS","TN","AR","LA","OK","TX"],
  West: ["AZ","CO","ID","MT","NV","NM","UT","WY","AK","CA","HI","OR","WA"]
};
const regions = ["Northeast", "Midwest", "South", "West", "Territories"];
const color = d3.scaleOrdinal().domain(regions).range(["#4e79a7", "#59a14f", "#e15759", "#f28e2b", "#8e6bb8"]);
const regionOf = s => regions.find(r => (REGION_STATES[r] || []).includes(s)) || "Territories";

let data = [], month = 1, xScale, yScale, sizeScale, tempColor, projection, mapK = 1;

// ---------- Scatterplot SVG ----------
const svg = d3.select("#vis").append("svg")
  .attr("width", 800).attr("height", 560).attr("viewBox", "0 0 800 560")
  .append("g").attr("transform", `translate(${margin.left},${margin.top})`);

// ---------- Map SVG ----------
const MW = 800, MH = 450;
const mapSvg = d3.select("#map").append("svg").attr("width", MW).attr("height", MH).attr("viewBox", `0 0 ${MW} ${MH}`);
mapSvg.append("rect").attr("width", MW).attr("height", MH).attr("fill", "#eef3f7");
mapSvg.append("clipPath").attr("id", "mapclip").append("rect").attr("width", MW).attr("height", MH);
const mapG = mapSvg.append("g").attr("clip-path", "url(#mapclip)").append("g");
const inContig = d => d.longitude > -125 && d.longitude < -66 && d.latitude > 24 && d.latitude < 50;

// ---------- Load and aggregate ----------
const num = v => (v === "" || v === undefined || +v <= -9000) ? NaN : +v;

function init() {
  d3.csv(DATA_PATH, d => ({
    id: d.station + "|" + d.latitude + "|" + d.longitude, name: d.station, state: d.state,
    latitude: +d.latitude, longitude: +d.longitude, month: +String(d.date).slice(4, 6),
    tmin: num(d.TMIN), tmax: num(d.TMAX), tavg: num(d.TAVG), precip: num(d.PRCP)
  })).then(rows => {
    const groups = d3.group(rows.filter(r => r.month >= 1 && r.month <= 12), r => r.id + "|" + r.month);
    data = Array.from(groups.values(), g => {
      const f = g[0];
      const tavg = d3.mean(g, r => Number.isFinite(r.tavg) ? r.tavg
        : (Number.isFinite(r.tmax) && Number.isFinite(r.tmin)) ? (r.tmax + r.tmin) / 2 : NaN);
      return { id: f.id, name: f.name, state: f.state, region: regionOf(f.state), month: f.month,
        latitude: f.latitude, longitude: f.longitude, tavg, precip: d3.mean(g, r => r.precip), days: g.length };
    }).filter(d => Number.isFinite(d.tavg) && Number.isFinite(d.precip));

    if (!data.length) throw new Error("No valid records. Check the CSV columns and path.");
    console.log("Station-months:", data.length);

    // Fixed scales so marks move meaningfully between months
    const tExt = d3.extent(data, d => d.tavg);
    xScale = d3.scaleLinear().domain(d3.extent(data, d => d.latitude)).nice().range([0, width]);
    yScale = d3.scaleLinear().domain(tExt).nice().range([height, 0]);
    const p95 = d3.quantile(data.map(d => d.precip).sort(d3.ascending), 0.95) || 1;
    sizeScale = d3.scaleSqrt().domain([0, p95]).range([3, 16]).clamp(true);
    tempColor = d3.scaleSequential(d3.interpolateRdYlBu).domain([tExt[1], tExt[0]]); // red = hot, blue = cold

    const pts = Array.from(new Set(data.filter(inContig).map(d => d.longitude + "," + d.latitude)), s => s.split(",").map(Number));
    projection = d3.geoAlbers();
    if (pts.length) projection.fitExtent([[15, 15], [MW - 15, MH - 15]], { type: "MultiPoint", coordinates: pts });

    drawAxes(); drawLegend(); drawMapKey(tExt); setupSlider(); setupZoom(); updateVis();
  }).catch(err => {
    console.error(err);
    d3.select("#vis").append("p").text("Could not load the dataset. Check DATA_PATH in script.js and run a local server.");
  });
}

// ---------- Static chart parts ----------
function drawAxes() {
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height})`).call(d3.axisBottom(xScale).ticks(8));
  svg.append("g").attr("class", "axis").call(d3.axisLeft(yScale).ticks(8));
  svg.append("text").attr("class", "labels").attr("x", width / 2).attr("y", height + 45)
    .attr("text-anchor", "middle").text("Station Latitude (°N)");
  svg.append("text").attr("class", "labels").attr("transform", "rotate(-90)").attr("x", -height / 2).attr("y", -55)
    .attr("text-anchor", "middle").text("Average Temperature (°F)");
}

function drawLegend() {
  const spacing = width / regions.length;
  const items = svg.append("g").selectAll("g").data(regions).join("g")
    .attr("transform", (d, i) => `translate(${i * spacing},${-35})`);
  items.append("rect").attr("width", 10).attr("height", 10).style("fill", d => color(d));
  items.append("text").attr("class", "legend-label").attr("x", 15).attr("y", 9).text(d => d);
}

function drawMapKey(ext) {
  const defs = mapSvg.append("defs").append("linearGradient").attr("id", "tempgrad");
  d3.range(0, 1.01, 0.1).forEach(f => defs.append("stop").attr("offset", f)
    .attr("stop-color", tempColor(ext[0] + f * (ext[1] - ext[0]))));
  const g = mapSvg.append("g").attr("transform", `translate(20,${MH - 40})`);
  g.append("rect").attr("width", 160).attr("height", 10).attr("fill", "url(#tempgrad)").attr("stroke", "#444");
  g.append("text").attr("class", "legend-label").attr("y", 24).text(`${Math.round(ext[0])}°F`);
  g.append("text").attr("class", "legend-label").attr("x", 160).attr("y", 24).attr("text-anchor", "end").text(`${Math.round(ext[1])}°F`);
  g.append("text").attr("class", "legend-label").attr("y", -6).text("Average temperature");
}

// ---------- Category I: month slider (dynamic filter) ----------
function setupSlider() {
  d3.select("#monthSlider").on("input", function () {
    month = +this.value;
    d3.select("#monthValue").text(MONTHS[month - 1]);
    updateVis();
  });
}

// ---------- Category II: pan and zoom on the map ----------
function setupZoom() {
  const zoom = d3.zoom().scaleExtent([1, 12]).on("zoom", e => {
    mapK = e.transform.k;
    mapG.attr("transform", e.transform);
    mapG.selectAll(".dot").attr("r", 5 / mapK); // keep dots a readable size while zooming
  });
  mapSvg.call(zoom);
}

// ---------- Category II: tooltip (details on demand) ----------
function attachTooltip(sel) {
  return sel
    .on("mouseover", (event, d) => {
      d3.select("#tooltip").style("display", "block").html(
        `<strong>${d.name}</strong> (${d.state})<br>Region: ${d.region}<br>${MONTHS[d.month - 1]} · ${d.days} day(s) of data<br>` +
        `Latitude: ${d.latitude.toFixed(2)}°<br>Avg temperature: ${d.tavg.toFixed(1)} °F<br>` +
        `Avg precipitation: ${d.precip.toFixed(3)} in/day`);
      moveTip(event);
    })
    .on("mousemove", moveTip)
    .on("mouseout", () => d3.select("#tooltip").style("display", "none"));
}
const moveTip = e => d3.select("#tooltip").style("left", (e.pageX + 15) + "px").style("top", (e.pageY + 15) + "px");

// ---------- Update ----------
function updateVis() {
  const current = data.filter(d => d.month === month);

  svg.selectAll(".point").data(current, d => d.id).join(
    enter => {
      const s = attachTooltip(enter.append("circle").attr("class", "point")
        .attr("cx", d => xScale(d.latitude)).attr("cy", d => yScale(d.tavg)).attr("r", 0)
        .style("fill", d => color(d.region)));
      s.transition().duration(t).attr("r", d => sizeScale(d.precip));
      return s;
    },
    update => {
      update.transition().duration(t)
        .attr("cx", d => xScale(d.latitude)).attr("cy", d => yScale(d.tavg)).attr("r", d => sizeScale(d.precip));
      return update;
    },
    exit => exit.transition().duration(t).attr("r", 0).remove()
  );

  const mapData = current.filter(inContig);
  mapG.selectAll(".dot").data(mapData, d => d.id).join(
    enter => {
      const s = attachTooltip(enter.append("circle").attr("class", "dot").attr("r", 5 / mapK)
        .attr("cx", d => projection([d.longitude, d.latitude])[0])
        .attr("cy", d => projection([d.longitude, d.latitude])[1])
        .style("fill", d => tempColor(d.tavg)).style("opacity", 0));
      s.transition().duration(t).style("opacity", 0.9);
      return s;
    },
    update => { update.transition().duration(t).style("fill", d => tempColor(d.tavg)); return update; },
    exit => exit.transition().duration(t).style("opacity", 0).remove()
  );
  d3.select("#mapCaption").text(
    `Station map for ${MONTHS[month - 1]}, colored by average temperature (${mapData.length} contiguous-U.S. stations; ` +
    `Alaska, Hawaii and territories appear only in the scatterplot). Scroll to zoom and drag to pan. Hover a dot for details.`);

  updateInsight(current);
}

function updateInsight(rows) {
  let msg = `${MONTHS[month - 1]}: not enough stations to describe a pattern.`;
  if (rows.length > 2) {
    const mx = d3.mean(rows, d => d.latitude), my = d3.mean(rows, d => d.tavg);
    const den = Math.sqrt(d3.sum(rows, d => (d.latitude - mx) ** 2) * d3.sum(rows, d => (d.tavg - my) ** 2));
    const r = den ? d3.sum(rows, d => (d.latitude - mx) * (d.tavg - my)) / den : null;
    if (r !== null) {
      const word = Math.abs(r) >= 0.7 ? "a strong" : Math.abs(r) >= 0.3 ? "a moderate" : "a weak";
      msg = `Dataset insight: in ${MONTHS[month - 1]}, across ${rows.length} stations, latitude and average temperature show ` +
        `${word} ${r >= 0 ? "positive" : "negative"} linear relationship (Pearson r = ${r.toFixed(2)}). ` +
        `This is an association, not necessarily causation.`;
    }
  }
  d3.select("#datasetInsight").text(msg);
}

window.addEventListener("load", init);