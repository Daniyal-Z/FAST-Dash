import Plot from "react-plotly.js";
import { useMemo } from "react";

// Helper function to generate random light colors
const getRandomColor = () => {
  const hue = Math.floor(Math.random() * 360);
  const saturation = Math.floor(Math.random() * 30) + 70; // Light tone
  const lightness = Math.floor(Math.random() * 20) + 80; // Light tone
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};

const GridTableView = ({ dataSheet, timeSlots }) => {
  // Extract unique days from dataSheet
  const days = [...new Set(dataSheet.map((item) => item.Day))];

  // Generate consistent colors for courses using useMemo
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

  days.forEach((day) => {
    const date = dataSheet.find((item) => item.Day === day)?.Date || "";
    const rowCourses = {}; // To store courses per time slot

    // Organize courses by time slot
    timeSlots.forEach((slot) => {
      const courses = dataSheet.filter((item) => item.Day === day && item["Time Slot"] === slot);
      rowCourses[slot] = courses.length > 0 ? courses : [null]; // Ensure at least one empty row
    });

    // Determine the maximum number of courses in a single time slot
    const maxCourses = Math.max(...Object.values(rowCourses).map((c) => c.length));

    // Create separate rows if multiple courses share a time slot
    for (let i = 0; i < maxCourses; i++) {
      const row = [i === 0 ? day : "", i === 0 ? date : ""]; // Only show Day/Date in the first row
      const colors = ["white", "white"]; // No color for Day & Date columns

      timeSlots.forEach((slot) => {
        const course = rowCourses[slot][i] || "";
        const courseKey = course ? `${course["Course Code"]} - ${course["Course Name"]}` : "";
        row.push(courseKey);
        colors.push(courseKey ? courseColors[courseKey] : "white");
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
  );
};

export default GridTableView;
