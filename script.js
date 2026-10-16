const DATA_PATH = "./weather.csv";

const margin = { top: 80, right: 60, bottom: 70, left: 100 };
const width = 800 - margin.left - margin.right;
const height = 560 - margin.top - margin.bottom;

const mapWidth = 800;
const mapHeight = 450;

let allData = [];
let allDates = [];
let targetDate = "";
let xVar = "precipitation"; 

let xScale, yScale, sizeScale, mapColor;
let mapProjection;
let mapK = 1;

const t = 800;

// Assign states to broad U.S. regions
const REGION_STATES = {
    Northeast: [
        "CT", "ME", "MA", "NH", "RI", "VT", "NJ", "NY", "PA"
    ],
    Midwest: [
        "IL", "IN", "MI", "OH", "WI", "IA", "KS", "MN",
        "MO", "NE", "ND", "SD"
    ],
    South: [
        "DE", "FL", "GA", "MD", "NC", "SC", "VA", "DC",
        "WV", "AL", "KY", "MS", "TN", "AR", "LA", "OK",
        "TX"
    ],
    West: [
        "AZ", "CO", "ID", "MT", "NV", "NM", "UT", "WY",
        "AK", "CA", "HI", "OR", "WA"
    ]
};

const regions = ["Northeast", "Midwest", "South", "West", "Territories"];

const colorScale = d3.scaleOrdinal()
    .domain(regions)
    .range(["pink", "orange", "lightgreen", "lightblue", "lightgray"]);

const regionOf = state =>
    regions.find(region =>
        (REGION_STATES[region] || []).includes(state)
    ) || "Territories";


// Convert missing NOAA values to NaN
function num(value) {
    if (value === "" || value === undefined || value === null) {
        return NaN;
    }
    const number = +value;
    if (!Number.isFinite(number) || number <= -9000) {
        return NaN;
    }
    return number;
}

function formatDate(dateString) {
    const date = d3.timeParse("%Y%m%d")(dateString);
    return date ? d3.timeFormat("%B %-d, %Y")(date) : dateString;
}

// Create the bubble SVG
const svg = d3.select("#vis")
    .append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)
    .attr("viewBox", `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

// Create the map SVG
const mapSvg = d3.select("#map")
    .append("svg")
    .attr("width", mapWidth)
    .attr("height", mapHeight);

mapSvg.append("defs")
    .append("clipPath")
    .attr("id", "mapClip")
    .append("rect")
    .attr("width", mapWidth)
    .attr("height", mapHeight);

mapSvg.append("rect")
    .attr("width", mapWidth)
    .attr("height", mapHeight)
    .attr("fill", "white");

const mapG = mapSvg.append("g")
    .attr("clip-path", "url(#mapClip)");

const mapPoints = mapG.append("g")
    .attr("class", "mapPoints");

// Load the weather data
function init() {
    d3.csv(DATA_PATH, function (d) {
        const tmin = num(d.TMIN);
        const tmax = num(d.TMAX);
        let tavg = num(d.TAVG);

        if (!Number.isFinite(tavg) && Number.isFinite(tmin) && Number.isFinite(tmax)) {
            tavg = (tmin + tmax) / 2;
        }

        return {
            id: d.station + "|" + d.latitude + "|" + d.longitude,
            name: d.station,
            state: d.state,
            region: regionOf(d.state),
            latitude: num(d.latitude),
            longitude: num(d.longitude),
            date: d.date, 

            tmin: tmin,
            tmax: tmax,
            tavg: tavg,
            precipitation: num(d.PRCP),
            wind: num(d.AWND),

            tempRange:
                Number.isFinite(tmin) && Number.isFinite(tmax)
                    ? Math.max(0, tmax - tmin)
                    : NaN
        };
    })
    .then(data => {
        allData = data.filter(d =>
            d.date.length === 8 &&
            Number.isFinite(d.latitude) &&
            Number.isFinite(d.longitude)
        );

        allDates = Array.from(new Set(allData.map(d => d.date))).sort();

        if (allDates.length === 0) {
            console.error("No valid dates were found in weather.csv.");
            return;
        }

        targetDate = allDates[0];

        const validTemps = allData.map(d => d.tavg).filter(Number.isFinite);
        
        mapColor = d3.scaleSequential()
            .domain([100, 0])
            .interpolator(d3.interpolateRdYlBu)
            .clamp(true);

        setupSelector();
        updateAxes();
        updateVis();
        addLegend();
        loadMap();
        setupZoom();
    })
    .catch(error => console.error("Error loading data:", error));
}

window.addEventListener("load", init);

const options = [
    { value: "precipitation", label: "Average daily precipitation (inches)" },
    { value: "wind", label: "Average daily wind speed (mph)" }
];

function setupSelector() {
    const dateSlider = d3.sliderHorizontal()
        .min(0)
        .max(allDates.length - 1)
        .step(1)
        .default(0)
        .width(width)
        .displayValue(false)
        .tickValues([])
        .on("onchange", value => {
            targetDate = allDates[Math.round(value)];
            d3.select("#dateValue").text("Selected date: " + formatDate(targetDate));
            updateAxes();
            updateVis();
        });

    d3.select("#slider")
        .append("svg")
        .attr("width", width + 40)
        .attr("height", 75)
        .append("g")
        .attr("transform", "translate(20,25)")
        .call(dateSlider);

    d3.select("#dateValue").text("Selected date: " + formatDate(targetDate));

    d3.select("#xVar")
        .selectAll("option")
        .data(options)
        .join("option")
        .attr("value", d => d.value)
        .text(d => d.label);

    d3.select("#xVar")
        .property("value", xVar)
        .on("change", function () {
            xVar = this.value;
            updateAxes();
            updateVis();
        });
}

function updateAxes() {
    svg.selectAll(".axis").remove();
    svg.selectAll(".labels").remove();

    const currentData = allData.filter(d => d.date === targetDate);

    const validX = currentData.map(d => d[xVar]).filter(Number.isFinite);
    const validY = currentData.map(d => d.tavg).filter(Number.isFinite);
    const validSize = currentData.map(d => d.tempRange).filter(Number.isFinite);

    if (!validX.length || !validY.length) return;

    const xMin = Math.min(0, d3.min(validX));
    const xMax = d3.max(validX) || 1;

    xScale = d3.scaleLinear().domain([xMin, xMax]).range([0, width]);
    yScale = d3.scaleLinear().domain(d3.extent(validY)).range([height, 0]);
    
    sizeScale = d3.scaleSqrt().domain([0, d3.max(validSize) || 1]).range([4, 20]);
   
    svg.append("g")
        .attr("class", "axis")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(xScale));

    svg.append("g").attr("class", "axis").call(d3.axisLeft(yScale));

    svg.append("text")
        .attr("class", "labels")
        .attr("x", width / 2)
        .attr("y", height + margin.bottom - 20)
        .attr("text-anchor", "middle")
        .text(options.find(d => d.value === xVar).label);

    svg.append("text")
        .attr("class", "labels")
        .attr("transform", "rotate(-90)")
        .attr("x", -height / 2)
        .attr("y", -margin.left + 35)
        .attr("text-anchor", "middle")
        .text("Average temperature (°F)");
}

function updateVis() {
    const currentData = allData.filter(d => d.date === targetDate);

    const bubbleData = currentData.filter(d =>
        Number.isFinite(d[xVar]) &&
        Number.isFinite(d.tavg) &&
        Number.isFinite(d.tempRange)
    );

    svg.selectAll(".points")
        .data(bubbleData, d => d.id)
        .join(
            enter => enter.append("circle")
                .attr("class", "points")
                .attr("cx", d => xScale(d[xVar]))
                .attr("cy", d => yScale(d.tavg))
                .attr("r", 0)
                .style("fill", d => colorScale(d.region))
                .style("opacity", 0.3)
                .on("mouseover", function (event, d) {
                    showTooltip(event, d);
                    d3.select(this).style("stroke", "black").style("stroke-width", 2);
                })
                .on("mousemove", moveTooltip)
                .on("mouseout", function () {
                    hideTooltip();
                    d3.select(this).style("stroke", "none");
                })
                .call(enter => enter.transition().duration(t).attr("r", d => sizeScale(d.tempRange))),
            update => update
                .transition().duration(t)
                .attr("cx", d => xScale(d[xVar]))
                .attr("cy", d => yScale(d.tavg))
                .attr("r", d => sizeScale(d.tempRange)),
            exit => exit.transition().duration(t).attr("r", 0).remove()
        );

    updateMap(currentData);
}

function showTooltip(event, d) {
    d3.select("#tooltip")
        .style("display", "block")
        .html(`
            <strong>${d.name}</strong><br>
            State: ${d.state}<br>
            Region: ${d.region}<br>
            Date: ${formatDate(d.date)}<br>
            Average temperature: ${formatValue(d.tavg, "°F")}<br>
            Minimum temperature: ${formatValue(d.tmin, "°F")}<br>
            Maximum temperature: ${formatValue(d.tmax, "°F")}<br>
            Temperature range: ${formatValue(d.tempRange, "°F")}<br>
            Precipitation: ${formatValue(d.precipitation, " in")}<br>
            Wind speed: ${formatValue(d.wind, " mph")}
        `);
    moveTooltip(event);
}

function moveTooltip(event) {
    d3.select("#tooltip")
        .style("left", (event.pageX + 15) + "px")
        .style("top", (event.pageY + 15) + "px");
}

function hideTooltip() {
    d3.select("#tooltip").style("display", "none");
}

function formatValue(value, unit = "") {
    return Number.isFinite(value) ? value.toFixed(1) + unit : "No data";
}

// Map initialization 
function loadMap() {
    mapProjection = d3.geoAlbersUsa()
        .scale(850)
        .translate([mapWidth / 2, mapHeight / 2]);

    updateMap(allData.filter(d => d.date === targetDate));
}

// Map updates using cx/cy dot logic
function updateMap(currentData) {
    if (!mapProjection) return;

    const mapData = currentData.filter(d => 
        Number.isFinite(d.latitude) &&
        Number.isFinite(d.longitude) &&
        mapProjection([d.longitude, d.latitude]) !== null
    );

    mapPoints.selectAll(".mapPoint")
        .data(mapData, d => d.id)
        .join(
            enter => enter.append("circle")
                .attr("class", "mapPoint")
                .attr("cx", d => mapProjection([d.longitude, d.latitude])[0])
                .attr("cy", d => mapProjection([d.longitude, d.latitude])[1])
                .attr("r", 0)
                .style("fill", d => Number.isFinite(d.tavg) ? mapColor(d.tavg) : "#999")
                .style("opacity", 0.8)
                .on("mouseover", function (event, d) {
                    showTooltip(event, d);
                    d3.select(this).style("stroke", "black").style("stroke-width", 1.5);
                })
                .on("mousemove", moveTooltip)
                .on("mouseout", function () {
                    hideTooltip();
                    d3.select(this).style("stroke", "white").style("stroke-width", 0.5);
                })
                .call(enter => enter.transition().duration(t).attr("r", 3.5)),
            update => update
                .transition().duration(t)
                .attr("cx", d => mapProjection([d.longitude, d.latitude])[0])
                .attr("cy", d => mapProjection([d.longitude, d.latitude])[1])
                .style("fill", d => Number.isFinite(d.tavg) ? mapColor(d.tavg) : "#999")
                .attr("r", 3.5),
            exit => exit.transition().duration(t).attr("r", 0).remove()
        );
}

function setupZoom() {
    mapSvg.call(
        d3.zoom()
            .scaleExtent([1, 8])
            .on("zoom", event => {
                mapK = event.transform.k;
                mapG.attr("transform", event.transform);
                mapG.selectAll(".mapPoint").attr("r", 3.5 / mapK);
            })
    );
}

function addLegend() {
    const size = 10;
    svg.selectAll(".legendSquare")
        .data(regions)
        .join("rect")
        .attr("class", "legendSquare")
        .attr("x", (d, i) => i * 105 - 10)
        .attr("y", -margin.top / 2)
        .attr("width", size)
        .attr("height", size)
        .style("fill", d => colorScale(d));

    svg.selectAll(".legendName")
        .data(regions)
        .join("text")
        .attr("class", "legendName")
        .attr("x", (d, i) => i * 105 + 5)
        .attr("y", -margin.top / 2 + size)
        .text(d => d)
        .style("fill", d => colorScale(d))
        .style("font-size", "12px");
}