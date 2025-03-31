// --- START OF FILE Aladin_Cmd_Api_clean.js ---

// Updated HTML structure with CSS classes for styling
document.getElementById("cmdContainer").innerHTML = `
  <div class="control-panel">
    <h3>Finder Chart & CMD Tool</h3>

    <label for="raInput">RA (degrees):</label>
    <input id="raInput" value="250.423" type="text">

    <label for="decInput">Dec (degrees):</label>
    <input id="decInput" value="36.460" type="text">

    <label for="searchRadius">Radius (°):</label>
    <input id="searchRadius" value="0.2" type="text">

    <button onclick="fetchCatalog()">Plot CMD & Fetch Data</button>

    <!-- Read-only display of plot axes -->
    <label for="xAxis" style="margin-top: 20px;">X Axis:</label>
    <select id="xAxis" disabled>
        <option value="color">BP - RP</option>
    </select>

    <label for="yAxis">Y Axis:</label>
    <select id="yAxis" disabled>
        <option value="mag">G Magnitude</option>
    </select>


    <h4>Isochrone Overlay</h4>

    <label for="isoAge">Age (log(yr)):</label>
    <select id="isoAge">
      <option value="parsec_8.0">8.0</option>
      <option value="parsec_8.5">8.5</option>
      <option value="parsec_9.0" selected>9.0</option>
      <option value="parsec_9.5">9.5</option>
      <option value="parsec_10.0">10.0</option>
      <option value="parsec_globular">Globular (Old/Metal Poor)</option>
    </select>

    <label for="isoMetal">Metallicity Z:</label>
    <select id="isoMetal">
      <option value="0.004">0.004 (Metal-poor)</option>
      <option value="0.019" selected>0.019 (Solar)</option>
    </select>

    <label for="isoDistance">Distance Modulus:</label>
    <input id="isoDistance" value="10" type="text">

    <label for="isoTolerance">Tolerance (mag):</label>
    <input id="isoTolerance" value="0.2" type="text">

    <label style="margin-top: 15px;">
        <input type="checkbox" id="showMatchedOnly" onchange="drawCMD()">
        <span>Show Matched Stars Only</span>
    </label>

    <button onclick="loadIsochroneOverlay()">Apply Isochrone</button>

    <button onclick="downloadCMDData()" class="secondary" style="margin-top: 25px;">Download CSV</button>
  </div>

  <div class="cmd-plot-area">
    <canvas id="cmdCanvas" width="800" height="550"></canvas>
    <div id="statusDiv">Enter coordinates and click 'Plot CMD'.</div>
    <div id="finderChartPreview">
         <!-- Finder chart will be loaded here -->
         <p>Finder chart preview appears here.</p>
    </div>
  </div>

  <div id="aladin-lite-div"></div>
`;

// --- Aladin Initialization ---
let aladin = A.aladin('#aladin-lite-div', {
  survey: "P/SDSS9/color",
  fov: 12, // Initial FoV in arcmin (0.2 deg * 60)
  target: "250.423 36.460"
});

// --- Global Variables ---
let stars = []; // Holds star data {ra, dec, g, bp, rp, color, mag, match, canvasX, canvasY}
let currentIsochrone = null; // Holds the currently plotted isochrone data
let currentIsochroneParams = {}; // Holds params used for the current isochrone

// --- UI Helper ---
function setStatus(message, type = "info") { // type can be 'info', 'success', 'error'
    const statusDiv = document.getElementById("statusDiv");
    statusDiv.textContent = message;
    statusDiv.className = ''; // Clear previous classes
    if (type === "error") {
        statusDiv.classList.add("error");
    } else if (type === "success") {
        statusDiv.classList.add("success");
    }
    // 'info' type has no specific class, uses default styling
}

// --- Data Fetching ---
function fetchCatalog() {
  const ra = parseFloat(document.getElementById("raInput").value);
  const dec = parseFloat(document.getElementById("decInput").value);
  const radius = parseFloat(document.getElementById("searchRadius").value);

  if (isNaN(ra) || isNaN(dec) || isNaN(radius) || radius <= 0) {
    setStatus("Invalid input: RA, Dec must be numbers, Radius must be positive.", "error");
    // alert("Invalid input for RA, Dec, or Radius."); // Replaced by setStatus
    return;
  }

  setStatus(`Fetching Gaia DR2 data for RA=${ra}, Dec=${dec}, Radius=${radius}°...`);
  aladin.gotoRaDec(ra, dec);
  aladin.setFov(radius * 60); // AladinLite fov is in arcmin

  // Clear previous data and plot visually
  stars = [];
  currentIsochrone = null;
  currentIsochroneParams = {};
  clearCanvas();
  document.getElementById("finderChartPreview").innerHTML = '<p>Loading finder chart...</p>'; // Clear preview

  fetch('/api/cmd', {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ra, dec, radius })
  })
    .then(res => {
      if (!res.ok) {
          // Try to get error message from Vizier XML if possible
          return res.text().then(text => {
              const parser = new DOMParser();
              const xmlDoc = parser.parseFromString(text, "text/xml");
              const errorInfo = xmlDoc.querySelector('INFO[name="QUERY_STATUS"][value="ERROR"]');
              const errorMsg = errorInfo ? errorInfo.textContent : `Server responded with status ${res.status}`;
              throw new Error(errorMsg);
          });
      }
      return res.text();
    })
    .then(xmlText => {
      console.log("Received VOTable XML");

      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "text/xml");
      const tableData = xmlDoc.getElementsByTagName("TABLEDATA")[0];

      if (!tableData) {
          console.error("Could not find <TABLEDATA> in VOTable response.");
          const errorInfo = xmlDoc.querySelector('INFO[name="QUERY_STATUS"][value="ERROR"]');
           if (errorInfo) {
               const errorMsg = errorInfo.textContent || "Unknown VizieR Error";
               throw new Error(`Error from VizieR: ${errorMsg}`);
           } else if (xmlText.includes("No table found")) {
               throw new Error("No stars found in VizieR for this query.");
           }
           else {
               throw new Error("Error parsing star data: No <TABLEDATA> found in response.");
           }
      }

      const rows = tableData.getElementsByTagName("TR");
      stars = []; // Reset stars array

      console.log("Found potential data rows:", rows.length);

      for (let row of rows) {
        const cells = row.getElementsByTagName("TD");
        if (cells.length >= 5) {
            const gMag = parseFloat(cells[2].textContent);
            const bpMag = parseFloat(cells[3].textContent);
            const rpMag = parseFloat(cells[4].textContent);

            if (!isNaN(gMag) && !isNaN(bpMag) && !isNaN(rpMag)) {
                const star = {
                    ra: parseFloat(cells[0].textContent),
                    dec: parseFloat(cells[1].textContent),
                    g: gMag,
                    bp: bpMag,
                    rp: rpMag,
                    color: bpMag - rpMag,
                    mag: gMag,
                    match: false
                };
                stars.push(star);
            }
        }
      }

      if (stars.length === 0) {
        setStatus(`No stars with valid G, BP, RP magnitudes found. Try increasing the radius or changing coordinates.`, "error");
        clearCanvas();
        loadFinderChart(ra, dec, radius); // Still load finder chart
        return;
      }

      setStatus(`Found ${stars.length} stars. Plotting CMD...`, "success");
      console.log(`Processed ${stars.length} stars`);
      drawCMD(); // Draw the initial CMD plot
      loadFinderChart(ra, dec, radius); // Load the finder chart
      loadIsochroneOverlay(); // Automatically apply default/selected isochrone
    })
    .catch(error => {
      console.error("Error fetching or parsing catalog:", error);
      setStatus(`Error: ${error.message}`, "error");
      // alert(`Error fetching star data: ${error.message}. Please check the console.`); // Replaced by setStatus
      clearCanvas();
       document.getElementById("finderChartPreview").innerHTML = `<p style="color: red;">Could not fetch star data.</p>`;
    });
}


function loadIsochroneOverlay() {
  // If no stars, don't attempt to load isochrone overlay
  if (stars.length === 0) {
      setStatus("Cannot apply isochrone: No stars plotted.", "error");
      currentIsochrone = null; // Ensure no old isochrone is drawn
      drawCMD(); // Redraw without isochrone
      return;
  }

  const age = document.getElementById("isoAge").value;
  const z = document.getElementById("isoMetal").value;
  const distMod = parseFloat(document.getElementById("isoDistance").value);
  const tol = parseFloat(document.getElementById("isoTolerance").value);

  if (isNaN(distMod) || isNaN(tol) || tol < 0) {
      setStatus("Invalid Distance Modulus or Tolerance (must be non-negative).", "error");
      // alert("Invalid Distance Modulus or Tolerance."); // Replaced by setStatus
      return;
  }

  setStatus(`Loading isochrone (Age: ${age.split('_')[1]}, Z: ${z}, DM: ${distMod}, Tol: ${tol})...`);

  currentIsochroneParams = { age, z, distMod, tol };

  fetch(`/api/isochrone?age=${age}&z=${z}`)
    .then(res => {
        if (!res.ok) {
            throw new Error(`Isochrone file not found or server error (${res.status})`);
        }
        return res.json();
    })
    .then(rawIsoData => {
       currentIsochrone = rawIsoData.map(pt => ({
            color: pt.color,
            mag: pt.mag
       }));

      let matched = 0;
      stars.forEach(star => {
        star.match = false;
        for (let isoPt of currentIsochrone) {
          const dColor = Math.abs(star.color - isoPt.color);
          const dMag = Math.abs(star.mag - (isoPt.mag + distMod));
          // Simple rectangular tolerance box
          if (dColor < tol && dMag < tol) {
            star.match = true;
            matched++;
            break;
          }
        }
      });

      const totalStars = stars.length;
      const matchPercent = totalStars > 0 ? ((matched / totalStars) * 100).toFixed(1) : "0.0";
      setStatus(`Isochrone applied. Matched ${matched} / ${totalStars} stars (${matchPercent}%).`, "success");
      drawCMD(); // Redraw CMD with updated match status and isochrone
    })
    .catch(error => {
      console.error("Error loading or processing isochrone:", error);
      setStatus(`Error loading isochrone: ${error.message}`, "error");
      // alert(`Error loading isochrone data: ${error.message}`); // Replaced by setStatus
      currentIsochrone = null;
      drawCMD(); // Redraw without isochrone
    });
}

// --- Drawing ---

function clearCanvas() {
    const canvas = document.getElementById("cmdCanvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawAxes(ctx, canvas.width, canvas.height); // Draw axes even when cleared
}

function drawAxes(ctx, width, height) {
    const xMin = -0.5, xMax = 3.0;
    const yMin = 22, yMax = 10; // G Mag (inverted: fainter at bottom)
    const xPadding = 60, yPadding = 40;

    ctx.save(); // Save context state
    ctx.fillStyle = "#333"; // Axis/label color
    ctx.strokeStyle = "#ccc"; // Grid line color
    ctx.lineWidth = 1;
    ctx.font = "12px Arial";

    // Draw Grid lines (light gray)
     ctx.strokeStyle = "#e8e8e8";
     // Vertical grid lines
    for (let color = Math.ceil(xMin / 0.5) * 0.5; color <= xMax; color += 0.5) {
         const x = xPadding + ((color - xMin) / (xMax - xMin)) * (width - 2 * xPadding);
         if (x > xPadding && x < width - xPadding) { // Avoid drawing over axes
            ctx.beginPath();
            ctx.moveTo(x, yPadding);
            ctx.lineTo(x, height - yPadding);
            ctx.stroke();
         }
    }
    // Horizontal grid lines
     for (let mag = Math.ceil(yMax); mag <= Math.floor(yMin); mag++) {
        if (mag % 2 === 0) { // Only draw lines for labeled ticks
             const y = yPadding + ((mag - yMax) / (yMin - yMax)) * (height - 2 * yPadding);
             if (y > yPadding && y < height - yPadding) { // Avoid drawing over axes
                ctx.beginPath();
                ctx.moveTo(xPadding, y);
                ctx.lineTo(width - xPadding, y);
                ctx.stroke();
             }
        }
    }
    ctx.strokeStyle = "#333"; // Reset stroke color for axes

    // Draw Y axis (Magnitude)
    ctx.beginPath();
    ctx.moveTo(xPadding, yPadding);
    ctx.lineTo(xPadding, height - yPadding);
    ctx.stroke();
    ctx.save(); // Save state for rotation
    ctx.translate(xPadding / 2 - 5, height / 2); // Adjust position for label
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.font = "14px Arial"; // Slightly larger axis label
    ctx.fillText("G Magnitude", 0, 0);
    ctx.restore(); // Restore rotation state

    // Draw Y ticks and labels
    for (let mag = Math.ceil(yMax); mag <= Math.floor(yMin); mag++) {
        if (mag % 2 === 0) { // Label every 2 magnitudes
             const y = yPadding + ((mag - yMax) / (yMin - yMax)) * (height - 2 * yPadding);
             ctx.beginPath();
             ctx.moveTo(xPadding - 5, y);
             ctx.lineTo(xPadding, y);
             ctx.stroke();
             ctx.textAlign = "right";
             ctx.font = "12px Arial"; // Tick labels
             ctx.fillText(mag.toString(), xPadding - 8, y + 4);
        }
    }

    // Draw X axis (Color)
    ctx.beginPath();
    ctx.moveTo(xPadding, height - yPadding);
    ctx.lineTo(width - xPadding, height - yPadding);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.font = "14px Arial"; // Slightly larger axis label
    ctx.fillText("BP - RP Color", width / 2, height - yPadding / 2 + 10); // Adjust position

    // Draw X ticks and labels
    for (let color = Math.ceil(xMin / 0.5) * 0.5; color <= xMax; color += 0.5) { // Ticks every 0.5
         const x = xPadding + ((color - xMin) / (xMax - xMin)) * (width - 2 * xPadding);
         ctx.beginPath();
         ctx.moveTo(x, height - yPadding);
         ctx.lineTo(x, height - yPadding + 5);
         ctx.stroke();
         ctx.font = "12px Arial"; // Tick labels
         ctx.fillText(color.toFixed(1), x, height - yPadding + 20);
    }

     ctx.restore(); // Restore original context state
}


function drawCMD() {
  const canvas = document.getElementById("cmdCanvas");
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const xMin = -0.5, xMax = 3.0;
  const yMin = 22, yMax = 10; // Inverted G Mag
  const xPadding = 60, yPadding = 40;

  drawAxes(ctx, width, height); // Draw axes and grid first

  const plotWidth = width - 2 * xPadding;
  const plotHeight = height - 2 * yPadding;

  const showMatchedOnly = document.getElementById("showMatchedOnly").checked;

  // Plot Stars
  stars.forEach(star => {
    const x = xPadding + ((star.color - xMin) / (xMax - xMin)) * plotWidth;
    const y = yPadding + ((star.mag - yMax) / (yMin - yMax)) * plotHeight;

    if (x >= xPadding && x <= width - xPadding && y >= yPadding && y <= height - yPadding) {
        star.canvasX = x;
        star.canvasY = y;

        if (star.match) {
            ctx.fillStyle = "#28a745"; // Green for matched
            ctx.beginPath();
            ctx.arc(x, y, 2.5, 0, 2 * Math.PI); // Slightly larger circle for matched
            ctx.fill();
        } else if (!showMatchedOnly) {
             ctx.fillStyle = "#007bff"; // Blue for non-matched
             ctx.fillRect(x - 1.5, y - 1.5, 3, 3); // Square for non-matched
        }
    } else {
        star.canvasX = null;
        star.canvasY = null;
    }
  });

  // Plot Isochrone if loaded
  if (currentIsochrone && currentIsochroneParams.distMod !== undefined) {
      ctx.beginPath();
      ctx.strokeStyle = "#dc3545"; // Red for isochrone
      ctx.lineWidth = 2;
      let firstPointDrawn = false;

      currentIsochrone.forEach((pt, i) => {
        const isoMag = pt.mag + currentIsochroneParams.distMod;
        const x = xPadding + ((pt.color - xMin) / (xMax - xMin)) * plotWidth;
        const y = yPadding + ((isoMag - yMax) / (yMin - yMax)) * plotHeight;

         // Check if point is within plot area before drawing
        const onCanvas = (x >= xPadding && x <= width - xPadding && y >= yPadding && y <= height - yPadding);

        if (onCanvas) {
            if (!firstPointDrawn || currentIsochrone[i-1]?.canvasX === null) { // Start line if first point or previous was off-canvas
                ctx.moveTo(x, y);
                firstPointDrawn = true;
            } else {
                 ctx.lineTo(x, y);
            }
        }
        // Store canvas coords (or null) regardless of drawing, needed for line logic
        pt.canvasX = onCanvas ? x : null;
        pt.canvasY = onCanvas ? y : null;
      });
      ctx.stroke();
  }
}


// --- Finder Chart ---
function loadFinderChart(ra, dec, radiusDegrees) {
  if (isNaN(ra) || isNaN(dec)) return;

  const widthPixels = 250; // Larger preview
  const heightPixels = 250;
  const radiusArcsec = radiusDegrees * 3600;
  // Ensure minimum scale to avoid overly zoomed-in images for small radii
  let scale = Math.max(0.2, (radiusArcsec * 2) / widthPixels); // Min scale 0.2 arcsec/pix

  // Cap scale to avoid overly zoomed-out images (e.g., max 10 arcsec/pixel)
  scale = Math.min(10, scale);

  // Update status only if not already showing a final result message
  const statusDiv = document.getElementById("statusDiv");
  if (!statusDiv.classList.contains("success") && !statusDiv.classList.contains("error")) {
      setStatus("Loading finder chart...");
  }

  fetch(`/api/finder_chart?ra=${ra}&dec=${dec}&scale=${scale}&width=${widthPixels}&height=${heightPixels}`)
    .then(res => {
        if (!res.ok) throw new Error(`Finder chart server error (${res.status})`);
        return res.json();
        })
    .then(data => {
      const previewDiv = document.getElementById("finderChartPreview");
      if (data.finder_chart_url) {
        previewDiv.innerHTML = `
          <h5>Finder Chart (SDSS)</h5>
          <img src="${data.finder_chart_url}" alt="Finder Chart Image">
          <p>RA=${ra.toFixed(4)}, Dec=${dec.toFixed(4)}, Radius≈${radiusDegrees.toFixed(2)}°</p>
        `;
      } else {
        throw new Error("Finder chart URL not received.");
      }
    })
    .catch((error) => {
      console.error("Finder chart fetch error:", error)
      document.getElementById("finderChartPreview").innerHTML = `<p style="color: red;">Failed to load finder chart: ${error.message}</p>`;
      // Don't overwrite primary status if it's already showing star/isochrone result
       if (!statusDiv.classList.contains("success") && !statusDiv.classList.contains("error")) {
            setStatus("Failed to load finder chart.", "error");
       }
    });
}

// --- Data Download ---
function downloadCMDData() {
  if (!stars || stars.length === 0) {
      setStatus("No star data available to download.", "error");
      return;
  }

  const header = ["RA_ICRS", "DE_ICRS", "Gmag", "BPmag", "RPmag", "BP_RP", "Matched_Isochrone"];
  const csvRows = [header.join(",")];

  stars.forEach(s => {
    const colorStr = (s.color !== null && !isNaN(s.color)) ? s.color.toFixed(4) : "";
    const gStr = (s.g !== null && !isNaN(s.g)) ? s.g.toFixed(4) : "";
    const bpStr = (s.bp !== null && !isNaN(s.bp)) ? s.bp.toFixed(4) : "";
    const rpStr = (s.rp !== null && !isNaN(s.rp)) ? s.rp.toFixed(4) : "";

    const row = [
      s.ra.toFixed(6),
      s.dec.toFixed(6),
      gStr,
      bpStr,
      rpStr,
      colorStr,
      s.match ? "Yes" : "No"
    ];
    csvRows.push(row.join(","));
  });

  const csvString = csvRows.join("\n");
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", "cmd_data.csv");
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
       setStatus("CMD data downloaded as cmd_data.csv", "success");
  } else {
       setStatus("CSV download is not supported in this browser.", "error");
  }
}

// --- Initial Load ---
 window.onload = () => {
     const ra = parseFloat(document.getElementById("raInput").value);
     const dec = parseFloat(document.getElementById("decInput").value);
     const radius = parseFloat(document.getElementById("searchRadius").value);
     if(!isNaN(ra) && !isNaN(dec) && !isNaN(radius)) {
        loadFinderChart(ra, dec, radius); // Load initial chart
     }
     clearCanvas(); // Draw axes on load
     setStatus("Enter coordinates and click 'Plot CMD & Fetch Data'."); // Initial instruction
 };

// --- END OF FILE Aladin_Cmd_Api_clean.js ---