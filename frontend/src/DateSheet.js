import React, { useState } from "react";

const DateSheet = () => {
  const [courses, setCourses] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    console.log("Selected Courses:", courses); // Placeholder for now
  };

  return (
    <div style={{ padding: "20px", maxWidth: "500px", margin: "auto", textAlign: "center" }}>
      <h2>Generate Date Sheet</h2>
      <input
        type="text"
        value={courses}
        onChange={(e) => setCourses(e.target.value)}
        placeholder="Enter courses (comma-separated)"
        style={{ padding: "10px", width: "100%", marginBottom: "10px" }}
      />
      <button
        onClick={handleSubmit}
        style={{ padding: "10px", width: "100%", cursor: "pointer", backgroundColor: "blue", color: "white" }}
      >
        Submit
      </button>

      {/* Placeholder for output */}
      <div style={{ marginTop: "20px" }}>
        <h3>Output will be displayed here...</h3>
      </div>
    </div>
  );
};

export default DateSheet;
