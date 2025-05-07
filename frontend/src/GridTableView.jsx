import Plot from "react-plotly.js";
import { useMemo } from "react";

// Helper function to generate random light colors
const getRandomColor = () => {
  const hue = Math.floor(Math.random() * 360);
  const saturation = Math.floor(Math.random() * 30) + 70; // Light tone
  const lightness = Math.floor(Math.random() * 20) + 80; // Light tone
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};

const handleDownload = () => {
  const plotDiv = document.getElementById("date-sheet-plot");
  if (plotDiv) {
    const downloadButton = plotDiv.querySelector('[data-title="Download plot as a png"]');
    if (downloadButton) {
      downloadButton.click();
    } else {
      alert("Download button not found. Try clicking on the plot first.");
    }
  }
};

const GridTableView = ({ dataSheet, timeSlots }) => {
  // Sort dataSheet by date first
  const sortedData = [...dataSheet].sort((a, b) => {
    return new Date(a.Date) - new Date(b.Date);
  });

  // Extract unique days in chronological order
  const days = [];
  const seenDays = new Set();
  sortedData.forEach((item) => {
    if (!seenDays.has(item.Day + item.Date)) {
      seenDays.add(item.Day + item.Date);
      days.push({ day: item.Day, date: item.Date });
    }
  });

  // Generate consistent colors for courses
  const courseColors = useMemo(() => {
    const colors = {};
    dataSheet.forEach((item) => {
      const courseKey = `${item["Course Code"]} - ${item["Course Name"]}`;
      if (!colors[courseKey]) {
        colors[courseKey] = getRandomColor();
      }
    });
    return colors;
  }, [dataSheet]);

  // Prepare table data and cell colors
  const tableData = [];
  const cellColors = [];

  days.forEach(({ day, date }) => {
    const dayItems = sortedData.filter((item) => item.Day === day && item.Date === date);
    
    // Create a map of time slots to courses for this day
    const timeSlotMap = {};
    timeSlots.forEach(slot => {
      timeSlotMap[slot] = dayItems.filter(item => item["Time Slot"] === slot);
    });

    // Determine the maximum number of courses in any time slot for this day
    const maxCourses = Math.max(...Object.values(timeSlotMap).map(courses => courses.length));

    // Create rows for this day
    for (let i = 0; i < maxCourses; i++) {
      const row = [i === 0 ? day : "", i === 0 ? date : ""];
      const colors = ["white", "white"];

      timeSlots.forEach((slot) => {
        const courses = timeSlotMap[slot];
        const course = courses[i] || null;
        
        if (course) {
          const courseKey = `${course["Course Code"]} - ${course["Course Name"]}`;
          row.push(courseKey);
          colors.push(courseColors[courseKey]);
        } else {
          row.push("");
          colors.push("white");
        }
      });

      tableData.push(row);
      cellColors.push(colors);
    }
  });

  // Debugging logs
  console.log("Data Sheet:", dataSheet);
  console.log("Time Slots:", timeSlots);
  console.log("Table Data:", tableData);
  console.log("Course Colors:", courseColors);

  return (
    <div style={{ width: "100%", overflowX: "auto", padding: "20px" }}>
      <div style={{ textAlign: "center", marginTop: "20px" }}>
      <button
        onClick={handleDownload}
        style={{
          padding: "10px 20px",
          backgroundColor: "#4CAF50",
          color: "white",
          border: "none",
          borderRadius: "5px",
          cursor: "pointer",
          fontSize: "16px",
        }}
      >
        Download Image
      </button>
      </div>
      
      <div id="date-sheet-plot">
      <Plot
        data={[
          {
            type: "table",
            columnwidth: [150, 150, ...Array(timeSlots.length).fill(200)], // Adjust column widths
            header: {
              values: ["Day", "Date", ...timeSlots], // Header row
              fill: { color: "lightblue" },
              align: "center",
              font: { size: 16, family: "Arial", color: "black" }, // Bigger font for headers
              height: 50, // Increase row height for header
            },
            cells: {
              values: tableData.reduce(
                (acc, row) => {
                  row.forEach((cell, i) => acc[i].push(cell));
                  return acc;
                },
                Array(timeSlots.length + 2).fill().map(() => []) // +2 for Day and Date
              ),
              fill: {
                color: cellColors.reduce(
                  (acc, row) => {
                    row.forEach((color, i) => acc[i].push(color));
                    return acc;
                  },
                  Array(timeSlots.length + 2).fill().map(() => []) // +2 for Day and Date
                ),
              },
              align: "center",
              font: { size: 14, family: "Arial", color: "black" }, // Increase font size
              height: 40, // Increase row height for better readability
            },
          },
        ]}
        layout={{
          title: "Date Sheet",
          width: 1400, // Set table width
          height: 600, // Set table height
          margin: { l: 20, r: 20, t: 70, b: 20 }, // Adjust margins
        }}
        config={{ responsive: true }} // Make it responsive
      />
      </div>

    </div>
  );
};

export default GridTableView;
